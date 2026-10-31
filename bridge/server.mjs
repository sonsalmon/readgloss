import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiError, AiTimeoutError, createClaudeClient } from './claude-client.mjs';
import { createCache } from './cache.mjs';
import { extensionIdFromKey } from './ext-id.mjs';
import { AiParseError } from './parse.mjs';
import { SYSTEM_PROMPT, WORD_RE, buildPrompt, createLookup } from './lookup.mjs';
import { DictUnavailableError, createDict } from './dict.mjs';
import { MtUnavailableError, createMt } from './mt.mjs';
import { ANNOTATE_LEVELS, DEFAULT_LEVEL, createAnnotate, formsOf, isCommon, loadWordLevels, pickEntry, pickSense, shortGloss, taggedGlosses } from './annotate.mjs';
import { createWords, parseWordsOp } from './words.mjs';
import { MAX_TERMS, createGlossary } from './glossary.mjs';
import { MAX_TEXT, buildTranslatePrompt, createTranslate, normalizeText } from './translate.mjs';
import { LIMITS, parseContext, parseWide } from './context.mjs';
import { createContextTranslate } from './translate-context.mjs';
import { createMydict, parseMydictOp } from './mydict.mjs';
import { createStudy, parseDays } from './study.mjs';
import { createScraps, normalizeUrl, parseScrapOp, scrapId } from './scraps.mjs';
import { guessTask, lastTaskToday, loadHtbModules, loadLearning, rememberedTask } from './task-guess.mjs';
import { dateOf } from '../scripts/export-day.mjs';
import { openDb, migrateJson } from './db.mjs';
import { createConcepts, parseConceptOp } from './concepts.mjs';
import { createMemos, parseMemoOp } from './memos.mjs';
import { createTutorQuote } from './tutor-quote.mjs';
import { createStudyTime, parseStudyTimeOp, parseStudyTimeRange } from './study-time.mjs';
import { adjustOffset, createWstat, LEMMA_RE, probability, threshold } from './wstat.mjs';
import { createStructure } from './structure.mjs';
import { BadPolishError, createPolish, parsePolishRequest } from './polish.mjs';
import { createAsk, parseAskRequest } from './ask.mjs';

const PORT = 47831;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]); // DNS 리바인딩 차단
const MAX_BODY = 16 * 1024;
const MAX_WORDS_BODY = 24 * 1024;
const MAX_MEMOS_BODY = 96 * 1024; // 메모(표 인용 포함)는 명세 상한이 커서 따로 둔다
const MAX_ANNOTATE_STATS_BODY = 64 * 1024;
const MAX_STUDY_TIME_BODY = 256 * 1024; // /study-time 항목이 많이 쌓였을 때를 위한 본문 상한
const MAX_WIDE_BODY = 64 * 1024; // /translate-context·/lookup 은 "더 넓은 문맥"을 실을 수 있어 본문 상한이 크다
const MAX_POLISH_BODY = 1024 * 1024; // /video/polish 는 낱말 6000개(낱말당 100자)까지 실을 수 있다
const MAX_ACRONYMS = 100;
const ACRONYM_RE = /^[A-Z]{2,6}$/;
const MAX_SENTENCE = 1000;
const MAX_ANNOTATE_WORDS = 300;

function loadOrCreateToken(file) {
  try {
    const t = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(t)) {
      chmodSync(file, 0o600);
      return t;
    }
  } catch {
    // 없거나 못 읽음: 새로 만든다
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const t = randomBytes(32).toString('hex');
  writeFileSync(file, t, { mode: 0o600 });
  chmodSync(file, 0o600); // mode 는 새 파일에만 적용되므로 한 번 더
  return t;
}

// scoreOf는 신호 표에서 lemma·surface 둘 다 본다(Map/Set has만 사용하여 constructor 등 방지)
export function createScoreOf(signals, wstat = null) {
  const fn = (lemma, level, surface) => {
    const saved = signals?.saved ? signals.saved.has(lemma) || (surface ? signals.saved.has(surface) : false) : false;
    const done = signals?.done ? signals.done.has(lemma) || (surface ? signals.done.has(surface) : false) : false;
    const n1 = signals?.looked && signals.looked.has(lemma) ? (signals.looked.get(lemma) ?? 0) : 0;
    const n2 = (surface && surface !== lemma && signals?.looked && signals.looked.has(surface)) ? (signals.looked.get(surface) ?? 0) : 0;
    const totalLookups = Math.max(n1, n2);
    const stat = wstat ? wstat.get(lemma) : null;

    let lookedAfterDone = false;
    if (done) {
      const doneLastTs = Math.max(
        signals?.doneLast?.get(lemma) ?? 0,
        surface ? (signals?.doneLast?.get(surface) ?? 0) : 0,
      );
      const lastLookedTs = Math.max(
        signals?.lastLooked?.get(lemma) ?? 0,
        surface ? (signals?.lastLooked?.get(surface) ?? 0) : 0,
      );
      if (lastLookedTs > doneLastTs) {
        lookedAfterDone = true;
      }
    }

    return probability({ level, saved, lookups: totalLookups, stat, done, lookedAfterDone });
  };
  fn.hasSavedOrLookup = (word) => {
    return Boolean((signals?.saved && signals.saved.has(word)) || (signals?.looked && signals.looked.has(word)));
  };
  return fn;
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c); // 넘치면 버리면서 끝까지 읽는다(응답을 먼저 보내려면 소켓을 닫지 말아야 한다)
    });
    req.on('end', () => {
      if (size > limit) return resolve({ status: 413 });
      try {
        resolve({ value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ status: 400 });
      }
    });
    req.on('error', () => resolve({ status: 400 }));
  });
}

// AI 호출 실패를 응답 코드로: 시간 초과 504, AI·파싱 실패 502, 그 밖은 500(내부 내용은 응답에 싣지 않는다)
function sendAiError(res, e, cors) {
  if (e instanceof AiTimeoutError) send(res, 504, { error: 'timeout' }, cors);
  else if (e instanceof AiError || e instanceof AiParseError) send(res, 502, { error: 'ai-failed' }, cors);
  else send(res, 500, { error: 'internal' }, cors);
}

// ask({word, sentence, context?}) / askTranslate(문단, 용어 지정 목록) / askContext(프롬프트 문자열) -> AI 원문. 테스트는 가짜를, 실제 실행은 claude 클라이언트를 넘긴다. dict 는 맥 사전 도우미.
export function createBridge({ ask, askTranslate, askContext, askStructure = askContext, askPolish = askContext, askAsk = askContext, cacheFile, translationsFile = join(dirname(cacheFile), 'translations.json'), contextFile = join(dirname(cacheFile), 'context-translations.json'), structureFile = join(dirname(cacheFile), 'structure-explanations.json'), polishFile = join(dirname(cacheFile), 'polish.json'), askFile = join(dirname(cacheFile), 'asks.json'), wordsFile = join(dirname(cacheFile), 'words.json'), mydictFile = join(dirname(cacheFile), 'mydict.json'), studyFile = join(dirname(cacheFile), 'study-log.jsonl'), scrapsFile = join(dirname(cacheFile), 'scraps.json'), dbFile = join(dirname(cacheFile), 'readgloss.db'), learningDir = process.env.READGLOSS_LEARNING_DIR || join(homedir(), 'dev', 'learning', 'security-career'), tutorSessionsDir = join(homedir(), '.aside', 'u', '0', 'sessions'), now = Date.now, tokenFile, extensionId, dict = createDict(), mt = createMt() }) {
  const dataDir = dirname(cacheFile);
  const dbExisted = existsSync(dbFile);
  // db 를 못 열거나 옮기기가 실패하면 JSON 으로 계속 돈다(변경 기록 11-2). 단, db 파일이 이미 있었는데 openDb 가 실패하면 예외를 던진다.
  let rawDb = null;
  let migration = { ok: false };
  try {
    rawDb = openDb(dbFile);
  } catch (e) {
    if (dbExisted) {
      throw new Error(`readgloss.db 를 열 수 없어요: ${dbFile} — 백업에서 되살리거나 파일을 옮긴 뒤 다시 시작하세요`);
    }
    migration = { ok: false, error: e?.message ?? String(e) };
  }

  if (rawDb) {
    try {
      migration = migrateJson({ db: rawDb, dataDir, now });
    } catch (e) {
      migration = { ok: false, error: e?.message ?? String(e) };
    }
  }

  let db = null;
  if (!migration.ok) {
    console.error(`이전 실패: ${migration.error}`);
    try {
      rawDb?.close();
    } catch {}
  } else {
    db = rawDb;
  }

  const token = loadOrCreateToken(tokenFile);
  const tokenBuf = Buffer.from(token);
  const lookup = createLookup({ cache: createCache(cacheFile), ask });
  const translate = createTranslate({ cache: createCache(translationsFile), ask: askTranslate });
  const contextTranslate = createContextTranslate({ cache: createCache(contextFile), ask: askContext });
  const structure = createStructure({ cache: createCache(structureFile), ask: askStructure, db, now });
  const polish = createPolish({ cache: createCache(polishFile), ask: askPolish });
  const askQuestion = createAsk({ cache: createCache(askFile), ask: askAsk });
  const words = db ? createWords({ db, now }) : createWords({ file: wordsFile, now });
  const glossary = createGlossary();
  const mydict = db ? createMydict({ db, now }) : createMydict({ file: mydictFile, now });
  const study = createStudy({ file: studyFile, now });
  const scraps = db ? createScraps({ db, now }) : createScraps({ file: scrapsFile, now });
  const concepts = db ? createConcepts({ db, now, learning: () => loadLearning(learningDir) }) : null;
  const memos = db ? createMemos({ db, now }) : null;
  const tutorQuote = createTutorQuote({ sessionsDir: tutorSessionsDir, now });
  const wstat = db ? createWstat({ db, now }) : null;

  const taskGuessCache = new Map();
  const TASK_GUESS_TTL = 10 * 60 * 1000; // 10분 캐시 (600000ms)
  const MAX_TASK_GUESS_CACHE = 500;

  function guessTaskForUrl(rawUrl, pageTitle = null) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2000) return null;
    const normUrl = normalizeUrl(rawUrl);
    if (!normUrl) return null;

    const nowTs = typeof now === 'function' ? now() : now;
    const cacheKey = `${normUrl}\n${pageTitle ?? ''}`;
    const cached = taskGuessCache.get(cacheKey);
    if (cached && (nowTs - cached.ts < TASK_GUESS_TTL)) {
      return cached.result;
    }

    const learning = loadLearning(learningDir);
    const allScraps = scraps.all();
    const lastToday = lastTaskToday(allScraps, now);
    const today = dateOf(typeof now === 'function' ? now() : now);
    const todayTasks = Array.from(
      new Set(
        allScraps
          .filter((s) => Number.isFinite(s?.ts) && dateOf(s.ts) === today)
          .map((s) => s.task)
          .filter(Boolean),
      ),
    );
    const allMemos = memos ? memos.list() : [];
    const allConcepts = concepts ? concepts.list() : [];
    const records = [];
    for (const s of allScraps) {
      if (s.task) records.push({ url: s.url, task: s.task, ts: s.ts });
    }
    for (const m of allMemos) {
      if (m.task) records.push({ url: m.url, task: m.task, ts: m.ts });
    }
    for (const c of allConcepts) {
      if (c.firstTask && c.firstUrl) {
        records.push({ url: c.firstUrl, task: c.firstTask, ts: c.ts });
      }
    }
    const remembered = rememberedTask(normUrl, records);
    const result = guessTask({
      thisWeek: learning.thisWeek,
      url: normUrl,
      nodes: learning.nodes,
      next: learning.next,
      lastToday,
      todayTasks,
      roadmapOk: learning.roadmapOk,
      remembered,
      htbModules: loadHtbModules(),
      title: pageTitle,
    });

    if (taskGuessCache.size >= MAX_TASK_GUESS_CACHE) {
      const oldestKey = taskGuessCache.keys().next().value;
      if (oldestKey !== undefined) taskGuessCache.delete(oldestKey);
    }
    taskGuessCache.set(cacheKey, { result, ts: nowTs });

    return result;
  }

  const studyTime = db ? createStudyTime({ db, guessTaskFor: guessTaskForUrl, now }) : null;
  const levels = loadWordLevels();

  let lookupsCache = null;
  let lookupsCacheTs = 0;
  const LOOKUPS_TTL = 60 * 1000;
  function getLookups(days = 60) {
    const t = typeof now === 'function' ? now() : now;
    if (days === 60) {
      if (!lookupsCache || t - lookupsCacheTs >= LOOKUPS_TTL) {
        lookupsCache = study.lookups(60);
        lookupsCacheTs = t;
      }
      return lookupsCache;
    }
    return study.lookups(days);
  }
  function clearLookupsCache() {
    lookupsCache = null;
    lookupsCacheTs = 0;
    signalsCache = null; // 신호 표도 다시 만든다
  }
  // 신호 표는 만들기가 비싸서(활용형 펼치기) 한 번 만들어 두고, 단어장·찾아봄이 바뀌거나 1분이 지나면 다시 만든다
  let signalsCache = null;
  let signalsCacheTs = 0;
  function getSignals() {
    const t = typeof now === 'function' ? now() : now;
    if (!signalsCache || t - signalsCacheTs >= LOOKUPS_TTL) {
      signalsCache = buildSignals();
      signalsCacheTs = t;
    }
    return signalsCache;
  }

  // 신호 표: saved 원형, history 원형(60일, 횟수 1), study.lookups(60) 표면형 횟수를 흔한 활용형으로 펼친다.
  // 원형별 마지막 찾아본 시각(words history의 ts) 및 done 단어의 review.last 도 함께 수집한다.
  // ponytail: 불규칙 활용(ran→run)은 사전이 원형을 줄 때만 이어진다.
  function buildSignals() {
    const savedSet = new Set();
    const doneSet = new Set();
    const doneLastMap = new Map();
    const allWords = words.all();
    if (allWords && typeof allWords.saved === 'object' && allWords.saved !== null) {
      for (const [k, v] of Object.entries(allWords.saved)) {
        if (typeof k === 'string') {
          savedSet.add(k);
          for (const f of formsOf(k)) {
            savedSet.add(f);
          }
          if (v?.review?.done === true) {
            doneSet.add(k);
            const rLast = typeof v.review.last === 'number' ? v.review.last : 0;
            doneLastMap.set(k, Math.max(doneLastMap.get(k) ?? 0, rLast));
            for (const f of formsOf(k)) {
              doneSet.add(f);
              doneLastMap.set(f, Math.max(doneLastMap.get(f) ?? 0, rLast));
            }
          }
        }
      }
    }

    const lastLookedMap = new Map();
    if (Array.isArray(allWords?.history)) {
      for (const h of allWords.history) {
        if (h && typeof h.lemma === 'string' && Number.isFinite(h.ts)) {
          lastLookedMap.set(h.lemma, Math.max(lastLookedMap.get(h.lemma) ?? 0, h.ts));
        }
      }
    }
    const historyEntries = [...lastLookedMap.entries()];
    for (const [w, ts] of historyEntries) {
      for (const f of formsOf(w)) {
        lastLookedMap.set(f, Math.max(lastLookedMap.get(f) ?? 0, ts));
      }
    }

    const lookedMap = new Map();
    if (typeof words.historyLemmas === 'function') {
      const hl = words.historyLemmas(60);
      for (const [lemma] of hl.entries()) {
        lookedMap.set(lemma, Math.max(lookedMap.get(lemma) ?? 0, 1));
      }
    }
    const lookups60 = getLookups(60);
    for (const [w, cnt] of lookups60.entries()) {
      lookedMap.set(w, Math.max(lookedMap.get(w) ?? 0, cnt));
    }

    const entries = [...lookedMap.entries()];
    for (const [w, cnt] of entries) {
      for (const f of formsOf(w)) {
        lookedMap.set(f, Math.max(lookedMap.get(f) ?? 0, cnt));
      }
    }

    return { saved: savedSet, looked: lookedMap, done: doneSet, doneLast: doneLastMap, lastLooked: lastLookedMap };
  }

  function scoreOf(lemma, level, surface) {
    return createScoreOf(getSignals(), wstat)(lemma, level, surface);
  }
  scoreOf.hasSavedOrLookup = (word) => {
    return createScoreOf(getSignals(), wstat).hasSavedOrLookup(word);
  };

  function thresholdFor(level) {
    const offset = wstat ? wstat.getOffset() : 0;
    return threshold(level, offset);
  }

  const annotate = createAnnotate({ dict, levels, isKnown: words.isKnown, glossary, mydict, scoreOf, thresholdFor });
  const mine = `chrome-extension://${extensionId}`;

  const tokenOk = (h) => {
    if (typeof h !== 'string') return false;
    const b = Buffer.from(h);
    return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf);
  };

  // 공부 기록. 확장이 실어 보낸 page.url 이 있으면 그 주소를 쓴다. 기록 실패는 응답에 영향 주지 않는다.
  const pageUrl = (v) => (typeof v?.page?.url === 'string' && v.page.url.length <= 2000 && /^https?:\/\//i.test(v.page.url) ? v.page.url : undefined);
  const log = (kind, text, ko, value, url) => {
    try {
      study.record({ kind, text, ko, url: url || pageUrl(value) });
    } catch {
      // 기록이 안 돼도 번역·사전은 그대로 답한다
    }
  };

  // 번역 프롬프트의 "용어 지정": 내 사전(본문에 나온 키)이 먼저, 그다음 분야 용어집. mineKey 는 내 사전 몫(캐시 키용).
  function termsFor(text, active) {
    const mine = mydict.termsIn(text, MAX_TERMS);
    const taken = new Set(mine.map((t) => t.slice(0, t.indexOf('='))));
    const terms = [...mine, ...glossary.termsIn(text, active).filter((t) => !taken.has(t.slice(0, t.indexOf('='))))].slice(0, MAX_TERMS);
    return { terms, mineKey: mine.join(',') };
  }

  async function handleLookup(req, res, cors) {
    const { value, status } = await readJson(req, MAX_WIDE_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const { word, sentence = '', force } = value ?? {};
    if (typeof word !== 'string' || !WORD_RE.test(word) || typeof sentence !== 'string' || sentence.length > MAX_SENTENCE) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    const wide = parseWide(value.wide);
    if (wide === null) return send(res, 400, { error: 'bad-request' }, cors);
    const ctx = parseContext(value.context, wide);
    if (ctx.status) return send(res, ctx.status, { error: ctx.status === 413 ? 'too-large' : 'bad-request' }, cors);
    try {
      const r = await lookup({ word, sentence, context: ctx.context, force: force === true, terms: mydict.termsIn(`${word} ${sentence}`, MAX_TERMS), wide });
      log('aigloss', word, r.gloss, value);
      send(res, 200, r, cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  async function handleTranslate(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const { text, force } = value ?? {};
    const norm = normalizeText(text);
    if (!norm) return send(res, 400, { error: 'bad-request' }, cors);
    if (norm.length > MAX_TEXT) return send(res, 413, { error: 'too-large' }, cors);
    const active = glossary.domains(value);
    const { terms, mineKey } = termsFor(norm, active);
    try {
      const r = await translate({ text: norm, force: force === true, domainsKey: [glossary.keyOf(active), mineKey && `mine:${mineKey}`].filter(Boolean).join('|'), terms });
      if (value.bulk !== true) log('paragraph', norm.slice(0, 200), r.translation, value); // T19: 전체 번역(bulk)은 문단마다 기록하지 않는다
      send(res, 200, r, cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  // 드래그 번역 2단계: 앞뒤 문맥·제목을 보고 AI 가 번역(문맥 번역 버튼). 상한은 context.mjs 의 LIMITS.
  async function handleTranslateContext(req, res, cors) {
    const { value, status } = await readJson(req, MAX_WIDE_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const text = normalizeText(value?.text);
    if (!text) return send(res, 400, { error: 'bad-request' }, cors);
    if (text.length > LIMITS.text) return send(res, 413, { error: 'too-large' }, cors);
    const wide = parseWide(value.wide);
    if (wide === null) return send(res, 400, { error: 'bad-request' }, cors);
    const ctx = parseContext(value.context, wide);
    if (ctx.status) return send(res, ctx.status, { error: ctx.status === 413 ? 'too-large' : 'bad-request' }, cors);
    const active = glossary.domains(value);
    const { terms, mineKey } = termsFor(text, active);
    try {
      const r = await contextTranslate({ text, context: ctx.context, force: value.force === true, domainsKey: glossary.keyOf(active), terms, wide, mineKey });
      log('context', text, r.translation, value);
      send(res, 200, r, cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  // 드래그 번역 1단계: 맥 번역(기기 안, AI 아님). 구가 분야 구 용어집과 같으면 term 도 붙인다.
  async function handleMt(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const text = normalizeText(value?.text);
    if (!text) return send(res, 400, { error: 'bad-request' }, cors);
    if (text.length > LIMITS.text) return send(res, 413, { error: 'too-large' }, cors);
    try {
      const term = glossary.findPhrase(text, glossary.domains(value));
      // 내 사전: 선택한 글 전체가 키와 같으면 응답에 mine 을 싣는다(맥 번역이 안 돼도 내 뜻은 답한다).
      const m = mydict.findText(text);
      const mine = m && { ko: m.ko, ...(m.exp && { exp: m.exp }), ...(m.note && { note: m.note }) };
      // 맥 번역이 안 되고 내 사전 뜻이 있으면 내 뜻만이라도 답한다(translation 은 내 뜻, engine 은 'mydict').
      let translation = null;
      try {
        translation = await mt.translate(text);
      } catch (e) {
        if (!mine) throw e;
      }
      // T19: /mt 는 공부 기록을 남기지 않는다(맥 번역은 복사하려는 드래그에도 불리므로).
      send(res, 200, { translation: translation ?? mine.ko, engine: translation === null ? 'mydict' : 'apple', ...(term ? { term } : {}), ...(mine ? { mine } : {}) }, cors);
    } catch (e) {
      if (e instanceof MtUnavailableError) send(res, 503, { error: 'mt-unavailable' }, cors);
      else send(res, 502, { error: 'mt-failed' }, cors);
    }
  }

  async function handleDict(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const word = value?.word;
    if (typeof word !== 'string' || !WORD_RE.test(word)) return send(res, 400, { error: 'bad-request' }, cors);
    try {
      // 원형(lemma)은 /annotate 와 같은 함수로 다리가 정한다. 카드 버튼과 단어장은 이 값만 쓴다. gloss 는 단어장에 남길 짧은 뜻.
      const r = await dict.lookup(word);
      const lower = word.toLowerCase();
      const { e, lemma } = r.found ? pickEntry(r.entries, lower) : { e: null, lemma: lower };
      // 분야 용어집(요청의 domains 힌트로 켜진 것)에 이 원형이 있으면 카드 맨 위 "용어:" 줄용으로 붙인다. 사전에 없는 단어도 용어집은 답한다.
      const active = glossary.domains(value);
      const t = glossary.find(lemma, active) ?? glossary.find(lower, active);
      // 용어집에 없으면 사전 뜻 중 활성 분야 표시(〔수학〕 등)가 붙은 것을 "분야 뜻"으로 덧붙인다(/annotate 와 같은 규칙: 흔한 낱말은 뺀다)
      const sense = !t && e && !isCommon(levels.get(lemma)) ? pickSense(taggedGlosses(r.entries), active) : null;
      // 내 사전(가장 우선, 캐시 밖에서 읽는다): 철자 -> 원형 순. 약어(전부 대문자 2~6자 원래 철자)면 약어집 풀이도 붙인다(분야와 무관).
      const m = mydict.find(lower) ?? mydict.find(lemma);
      const mine = m && { ko: m.ko, ...(m.exp && { exp: m.exp }), ...(m.note && { note: m.note }) };
      const ac = ACRONYM_RE.test(word) ? glossary.acronym(lower) : null;
      const acronym = ac && { exp: ac.exp, ko: ac.ko };
      // nolog: 드래그로 연 카드는 공부 기록에 남기지 않는다(요청이 그렇게 실어 보낸다).
      if (value.nolog !== true && (r.found || mine || t || acronym)) {
        log('dict', word, mine?.ko || t?.ko || sense?.ko || (e && shortGloss(e.senses?.[0]?.text)) || acronym?.ko, value);
        clearLookupsCache();
      }
      send(res, 200, { ...r, lemma, ...(e ? { gloss: shortGloss(e.senses?.[0]?.text) } : {}), ...(t ? { term: { ko: t.ko, domain: t.domain } } : {}), ...(sense ? { sense } : {}), ...(mine ? { mine } : {}), ...(acronym ? { acronym } : {}) }, cors);
    } catch (e) {
      if (e instanceof DictUnavailableError) send(res, 503, { error: 'dict-unavailable' }, cors);
      else send(res, 502, { error: 'dict-failed' }, cors);
    }
  }

  // 어려운 단어 주석: 단어 목록 -> { items: { 단어: { lemma, level, gloss } } }. 맥 사전만 쓰고 AI 는 안 부른다.
  async function handleAnnotate(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const { words, level = DEFAULT_LEVEL, acronyms = [], minP } = value ?? {};
    if (!Array.isArray(words) || words.some((w) => typeof w !== 'string') || !ANNOTATE_LEVELS.includes(level)) return send(res, 400, { error: 'bad-request' }, cors);
    if (!Array.isArray(acronyms) || acronyms.some((a) => typeof a !== 'string')) return send(res, 400, { error: 'bad-request' }, cors);
    if (minP !== undefined && (typeof minP !== 'number' || !Number.isFinite(minP) || minP < 0 || minP > 1)) return send(res, 400, { error: 'bad-request' }, cors);
    if (words.length > MAX_ANNOTATE_WORDS || acronyms.length > MAX_ACRONYMS) return send(res, 413, { error: 'too-large' }, cors);

    // 하루 한 번 자동 조절: annot_offset_day 가 오늘이 아니고 auto 가 켜져 있으면
    if (wstat && wstat.getAuto()) {
      const today = dateOf(typeof now === 'function' ? now() : now);
      const lastDay = wstat.getOffsetDay();
      if (lastDay !== today) {
        const last7 = wstat.last7();
        const history7 = typeof words.historyLemmas === 'function' ? words.historyLemmas(7) : new Map();
        let missedLookups = 0;
        for (const lemma of history7.keys()) {
          const stat = wstat.get(lemma);
          if (!stat || !stat.shown || stat.shown === 0) {
            missedLookups++;
          }
        }
        const curOffset = wstat.getOffset();
        const newOffset = adjustOffset({ offset: curOffset, shown: last7.shown, seen: last7.seen, missedLookups });
        wstat.setOffset(newOffset);
        wstat.setOffsetDay(today);
      }
    }

    const reqSignals = getSignals();
    const reqScoreOf = createScoreOf(reqSignals, wstat);
    try {
      send(res, 200, { items: await annotate(words.map((w) => w.toLowerCase()).filter((w) => WORD_RE.test(w)), level, glossary.domains(value), acronyms.filter((a) => ACRONYM_RE.test(a)), reqScoreOf, minP) }, cors);
    } catch (e) {
      if (e instanceof DictUnavailableError) send(res, 503, { error: 'dict-unavailable' }, cors);
      else send(res, 502, { error: 'dict-failed' }, cors);
    }
  }

  // 주석 통계 및 기준선 조절: GET -> { offset, auto, updated, last7:{shown, seen, missedLookups} }, POST { shown, seen } | { op:'reset' } | { op:'auto', on }
  async function handleAnnotateStats(req, res, cors) {
    if (!wstat) return send(res, 503, { error: 'no-db' }, cors);

    if (req.method === 'GET') {
      const offset = wstat.getOffset();
      const auto = wstat.getAuto();
      const updated = wstat.getOffsetDay() ?? null;
      const last7Stats = wstat.last7();
      const history7 = typeof words.historyLemmas === 'function' ? words.historyLemmas(7) : new Map();
      let missedLookups = 0;
      for (const lemma of history7.keys()) {
        const stat = wstat.get(lemma);
        if (!stat || !stat.shown || stat.shown === 0) {
          missedLookups++;
        }
      }
      return send(res, 200, {
        offset,
        auto,
        updated,
        last7: {
          shown: last7Stats.shown,
          seen: last7Stats.seen,
          missedLookups,
        },
      }, cors);
    }

    if (req.method === 'POST') {
      const { value, status } = await readJson(req, MAX_ANNOTATE_STATS_BODY);
      if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return send(res, 400, { error: 'bad-request' }, cors);

      if (value.op === 'reset') {
        wstat.setOffset(0);
        return send(res, 200, { ok: true, offset: 0 }, cors);
      }

      if (value.op === 'auto') {
        if (typeof value.on !== 'boolean') return send(res, 400, { error: 'bad-request' }, cors);
        wstat.setAuto(value.on);
        return send(res, 200, { ok: true, auto: value.on }, cors);
      }

      if (value.op !== undefined) {
        return send(res, 400, { error: 'bad-request' }, cors);
      }

      const { shown, seen } = value;
      const hasShown = shown !== undefined;
      const hasSeen = seen !== undefined;
      if (!hasShown && !hasSeen) return send(res, 400, { error: 'bad-request' }, cors);

      if (hasShown) {
        if (!Array.isArray(shown) || shown.length > 500) return send(res, 400, { error: 'bad-request' }, cors);
        for (const w of shown) {
          if (typeof w !== 'string' || !LEMMA_RE.test(w.toLowerCase())) return send(res, 400, { error: 'bad-request' }, cors);
        }
      }
      if (hasSeen) {
        if (!Array.isArray(seen) || seen.length > 500) return send(res, 400, { error: 'bad-request' }, cors);
        for (const w of seen) {
          if (typeof w !== 'string' || !LEMMA_RE.test(w.toLowerCase())) return send(res, 400, { error: 'bad-request' }, cors);
        }
      }

      wstat.record({
        shown: hasShown ? shown.map((w) => w.toLowerCase()) : [],
        seen: hasSeen ? seen.map((w) => w.toLowerCase()) : [],
      });
      return send(res, 200, { ok: true }, cors);
    }

    return send(res, 405, { error: 'method-not-allowed' }, cors);
  }

  // 내 단어: GET -> { known, saved, history }, POST { op, lemma, ... } -> 바뀐 같은 모양의 상태
  async function handleWords(req, res, cors) {
    if (req.method === 'GET') return send(res, 200, words.all(), cors);
    const { value, status } = await readJson(req, MAX_WORDS_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseWordsOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    const out = words.apply(op);
    signalsCache = null; // 단어장·아는 단어·찾아봄이 바뀌었을 수 있다
    if (!out) return send(res, 404, { error: 'not-found' }, cors); // memo 대상(saved·phrases)이 없다
    if (op.op === 'save') log('save', op.word, op.gloss, value, op.url);
    else if (op.op === 'save-phrase') log('save', op.text, op.translation, value, op.url);
    else if (op.op === 'known') log('known', op.lemma, undefined, value);
    send(res, 200, out, cors);
  }

  // 복습 큐: GET /words/review -> { due: [...], counts: { due, done, total } }
  function handleWordsReview(req, res, cors) {
    const today = dateOf(typeof now === 'function' ? now() : now);
    send(res, 200, words.reviewQueue(today), cors);
  }

  // 내 사전: GET -> { entries }, POST { op:'set'|'delete', key, ... } -> 바뀐 { entries }
  async function handleMydict(req, res, cors) {
    if (req.method === 'GET') return send(res, 200, mydict.all(), cors);
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseMydictOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    const out = mydict.apply(op);
    if (op.op === 'set') log('mydict', op.key, op.ko, value, op.url);
    send(res, 200, out, cors);
  }

  // 공부 기록 집계: GET /study?days=N(1~60, 기본 7)
  function handleStudy(req, res, cors) {
    const days = parseDays(new URL(req.url, 'http://x').searchParams.get('days') ?? undefined);
    if (days === null) return send(res, 400, { error: 'bad-request' }, cors);
    send(res, 200, study.report(days), cors);
  }

  // 스크랩: GET -> { scraps, tasks }, GET ?url= -> { scraps }, POST { op, ... } -> { scraps }
  async function handleScraps(req, res, cors) {
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://x').searchParams.get('url');
      if (u !== null && u !== undefined) {
        return send(res, 200, { scraps: scraps.forUrl(u) }, cors);
      }
      const allScraps = scraps.all();
      const learning = loadLearning(learningDir);
      const tasks = {};
      for (const s of allScraps) {
        if (s.task && !tasks[s.task]) {
          const node = learning.nodes.find((n) => n.id === s.task);
          tasks[s.task] = node ? node.card_title : s.task;
        }
      }
      return send(res, 200, { scraps: allScraps, tasks }, cors);
    }
    const { value, status } = await readJson(req, MAX_WORDS_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    if (value?.op === 'guess') {
      if (typeof value.url !== 'string' || value.url.length > 2000) return send(res, 400, { error: 'bad-request' }, cors);
      const guessed = guessTaskForUrl(value.url, typeof value.title === 'string' ? value.title.slice(0, 300) : null);
      if (!guessed) return send(res, 400, { error: 'bad-request' }, cors);
      return send(res, 200, guessed, cors);
    }
    const op = parseScrapOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    const savedId = op.op === 'save' ? scrapId(op.url, op.quote.exact, op.quote.prefix) : null;
    const isNew = op.op === 'save' && !scraps.has(savedId);
    const out = scraps.apply(op);
    if (!out) return send(res, 404, { error: 'not-found' }, cors);
    if (op.op === 'save' && isNew) {
      try {
        study.record({ kind: 'scrap', text: op.quote.exact, url: op.url });
      } catch {
        // 기록 실패는 무시
      }
    }
    // save 는 방금 저장한 한 건(scrap)을 id 로 찾아 같이 돌려준다. 호출부가 목록에서 짐작하지 않게 한다.
    if (savedId) return send(res, 200, { scrap: out.find((s) => s.id === savedId) ?? null, scraps: out }, cors);
    send(res, 200, { scraps: out }, cors);
  }

  // 개념: GET -> { concepts }, GET ?names=1 -> { terms }, POST op save|remove|link
  async function handleConcepts(req, res, cors) {
    if (!db || !concepts) return send(res, 503, { error: 'no-db' }, cors);
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      if (u.searchParams.get('names') === '1') {
        return send(res, 200, { terms: concepts.terms() }, cors);
      }
      return send(res, 200, { concepts: concepts.list() }, cors);
    }
    const { value, status } = await readJson(req, MAX_WORDS_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseConceptOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    const out = concepts.apply(op);
    if (!out) return send(res, 404, { error: 'not-found' }, cors);
    if (out.error === 'exists') return send(res, 409, { error: 'exists', id: out.id }, cors);
    if (op.op === 'save' || op.op === 'link') return send(res, 200, { concept: out }, cors);
    if (op.op === 'remove') return send(res, 200, { ok: true }, cors);
    return send(res, 200, out, cors);
  }

  // 메모: GET -> { memos }, GET ?url= -> { memos }, POST op save|edit|remove
  async function handleMemos(req, res, cors) {
    if (!db || !memos) return send(res, 503, { error: 'no-db' }, cors);
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://x').searchParams.get('url');
      if (u !== null && u !== undefined) {
        return send(res, 200, { memos: memos.forUrl(u) }, cors);
      }
      return send(res, 200, { memos: memos.list() }, cors);
    }
    const { value, status } = await readJson(req, MAX_MEMOS_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseMemoOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    const out = memos.apply(op);
    if (!out) return send(res, 404, { error: 'not-found' }, cors);
    if (op.op === 'save') {
      try {
        study.record({ kind: 'memo', text: op.text || op.quote?.exact, url: op.url });
      } catch {
        // 기록 실패는 무시
      }
      return send(res, 200, { memo: out }, cors);
    }
    if (op.op === 'edit') return send(res, 200, { memo: out }, cors);
    if (op.op === 'remove') return send(res, 200, { ok: true }, cors);
    return send(res, 200, out, cors);
  }

  // 튜터 글 찾기: POST /tutor-quote { text } -> { found: true, date, time, title } | { found: false }
  async function handleTutorQuote(req, res, cors) {
    const { value, status } = await readJson(req, MAX_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    if (typeof value?.text !== 'string') return send(res, 400, { error: 'bad-request' }, cors);
    const text = value.text.trim().replace(/\s+/g, ' ');
    if (text.length < 15 || text.length > 2000) return send(res, 400, { error: 'bad-request' }, cors);
    const result = tutorQuote.find(text);
    return send(res, 200, result, cors);
  }

  // 공부 시간: POST /study-time (op: add), GET /study-time?from=&to=
  async function handleStudyTime(req, res, cors) {
    if (!db || !studyTime) return send(res, 503, { error: 'no-db' }, cors);
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      const range = parseStudyTimeRange(from, to);
      if (!range) return send(res, 400, { error: 'bad-request' }, cors);
      const items = studyTime.list(range.from, range.to);
      return send(res, 200, { items }, cors);
    }
    const { value, status } = await readJson(req, MAX_STUDY_TIME_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseStudyTimeOp(value);
    if (!op || op.op !== 'add') return send(res, 400, { error: 'bad-request' }, cors);
    studyTime.add(op.items);
    return send(res, 200, { ok: true }, cors);
  }

  // 문장 구조 풀이: POST /explain-structure { sentence(1~600), phrase(1~60), title(<=300)? }
  async function handleExplainStructure(req, res, cors) {
    const { value, status } = await readJson(req, MAX_WIDE_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    const { sentence, phrase, title, force } = value;
    if (typeof sentence !== 'string' || sentence.length < 1 || sentence.length > 600 || !sentence.trim()) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    if (typeof phrase !== 'string' || phrase.length < 1 || phrase.length > 60 || !phrase.trim()) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    // sentence 안에 phrase 가 없으면 400(대소문자·공백 정규화 후 검사)
    const normSent = sentence.toLowerCase().replace(/\s+/g, ' ');
    const normPhrase = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normSent.includes(normPhrase)) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    if (title !== undefined && title !== null && (typeof title !== 'string' || title.length > 300)) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    try {
      const r = await structure.explain({
        sentence,
        phrase,
        title: typeof title === 'string' ? title : undefined,
        force: force === true,
      });
      send(res, 200, r, cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  // 문장 구조 통계: GET /explain-structure/stats -> { patterns: [{ pattern, opened }] }
  function handleExplainStructureStats(req, res, cors) {
    send(res, 200, structure.stats(), cors);
  }

  // 자동 자막 다듬기(28-17): POST /video/polish { id, words:[{t,w}] } -> { lines:[{from,to,text}], cached }
  // AI 결과가 낱말 번호를 빠짐·겹침 없이 덮지 않으면 그 결과를 버리고 502 bad-polish.
  async function handlePolish(req, res, cors) {
    const { value, status } = await readJson(req, MAX_POLISH_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const parsed = parsePolishRequest(value);
    if (parsed.error) return send(res, parsed.error === 'too-large' ? 413 : 400, { error: parsed.error }, cors);
    try {
      const r = await polish({ id: parsed.id, words: parsed.words });
      send(res, 200, r, cors);
    } catch (e) {
      if (e instanceof BadPolishError) send(res, 502, { error: 'bad-polish' }, cors);
      else if (e instanceof AiTimeoutError) send(res, 504, { error: 'timeout' }, cors);
      else if (e instanceof AiError || e instanceof AiParseError) send(res, 502, { error: 'ai-failed' }, cors);
      else send(res, 500, { error: 'internal' }, cors);
    }
  }

  // 지금 줄에 묻기(28-18): POST /ask { selection(1~600), question(1~200), context?{before,after,title} } -> { answer, cached }
  // 같은 (selection, question) 은 캐시에서 답한다. 검사 실패는 400.
  async function handleAsk(req, res, cors) {
    const { value, status } = await readJson(req, MAX_WIDE_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const parsed = parseAskRequest(value);
    if (parsed.error) return send(res, 400, { error: parsed.error }, cors);
    try {
      const r = await askQuestion({ selection: parsed.selection, question: parsed.question, context: parsed.context });
      send(res, 200, r, cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  async function handle(req, res) {
    // 1. Host 가 고정값이 아니면 거절. 2. Origin 이 있는데 내 확장이 아니면 거절(토큰 유무와 무관).
    if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'forbidden' });
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== mine) return send(res, 403, { error: 'forbidden' });
    const cors = origin === mine ? { 'Access-Control-Allow-Origin': mine, Vary: 'Origin' } : {};
    const path = (req.url ?? '').split('?')[0];

    if (req.method === 'OPTIONS') {
      if (origin !== mine) return send(res, 403, { error: 'forbidden' });
      return send(res, 204, undefined, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Bridge-Token, Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }
    if (path === '/pair') {
      if (origin !== mine) return send(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return send(res, 200, { token }, cors);
    }
    if (!tokenOk(req.headers['x-bridge-token'])) return send(res, 401, { error: 'unauthorized' }, cors);
    if (path === '/ping') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return send(res, 200, { ok: true }, cors);
    }
    if (path === '/lookup') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleLookup(req, res, cors);
    }
    if (path === '/mt') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleMt(req, res, cors);
    }
    if (path === '/translate-context') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleTranslateContext(req, res, cors);
    }
    if (path === '/dict') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleDict(req, res, cors);
    }
    if (path === '/annotate') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleAnnotate(req, res, cors);
    }
    if (path === '/annotate-stats') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleAnnotateStats(req, res, cors);
    }
    if (path === '/words/review') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleWordsReview(req, res, cors);
    }
    if (path === '/words') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleWords(req, res, cors);
    }
    if (path === '/mydict') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleMydict(req, res, cors);
    }
    if (path === '/study') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleStudy(req, res, cors);
    }
    if (path === '/scraps') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleScraps(req, res, cors);
    }
    if (path === '/concepts') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleConcepts(req, res, cors);
    }
    if (path === '/memos') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleMemos(req, res, cors);
    }
    if (path === '/translate') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleTranslate(req, res, cors);
    }
    if (path === '/tutor-quote') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleTutorQuote(req, res, cors);
    }
    if (path === '/study-time') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleStudyTime(req, res, cors);
    }
    if (path === '/explain-structure') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleExplainStructure(req, res, cors);
    }
    if (path === '/explain-structure/stats') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleExplainStructureStats(req, res, cors);
    }
    if (path === '/video/polish') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handlePolish(req, res, cors);
    }
    if (path === '/ask') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleAsk(req, res, cors);
    }
    return send(res, 404, { error: 'not-found' }, cors);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });

  return {
    db,
    migration,
    words,
    scoreOf,
    thresholdFor,
    annotate,
    buildSignals,
    structure,
    // 127.0.0.1 에만 바인딩한다. port 0 이면 임시 포트(테스트용). 실제 포트를 돌려준다.
    listen: (port = PORT) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        dict.close();
        mt.close();
        if (db) {
          try {
            db.close();
          } catch {}
        }
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// node bridge/server.mjs 로 직접 실행했을 때만
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = join(root, 'data');
  const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
  const extensionId = extensionIdFromKey(manifest.key);
  const client = createClaudeClient({ systemPrompt: SYSTEM_PROMPT, cwd: join(dataDir, 'claude-cwd') });
  const dict = createDict();
  const mt = createMt();
  const bridge = createBridge({
    dict,
    mt,
    ask: async (a) => (await client.ask(buildPrompt(a))).text,
    askTranslate: async (text, terms) => (await client.ask(buildTranslatePrompt(text, terms), { timeoutMs: 60_000 })).text,
    askContext: async (prompt) => (await client.ask(prompt)).text,
    askStructure: async (prompt) => (await client.ask(prompt)).text,
    askPolish: async (prompt) => (await client.ask(prompt)).text,
    askAsk: async (prompt) => (await client.ask(prompt)).text,
    cacheFile: join(dataDir, 'cache.json'),
    tokenFile: join(dataDir, 'token'),
    extensionId,
  });
  const stop = () => {
    client.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', () => client.close());
  bridge.listen().then(
    (port) => {
      console.log(`readgloss 다리: http://127.0.0.1:${port} (확장 ID ${extensionId})`);
      // 미리 깨우기: 사전·맥 번역 도우미의 첫 호출은 느리다(사전 약 1초, 번역 모델 적재 약 5초). 실패해도 첫 요청 때 다시 띄운다.
      dict.lookup('warm').catch(() => {});
      mt.translate('Hello.').catch(() => {});
    },
    (e) => {
      console.error(e.code === 'EADDRINUSE' ? `포트 ${PORT} 가 이미 쓰이고 있어요. 다리가 이미 떠 있는지 확인해 주세요.` : e.message);
      process.exit(1);
    },
  );
}
