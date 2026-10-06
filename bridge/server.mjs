import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiError, AiTimeoutError, createClaudeClient } from './claude-client.mjs';
import { createCache } from './cache.mjs';
import { extensionIdFromKey } from './ext-id.mjs';
import { AiParseError } from './parse.mjs';
import { SYSTEM_PROMPT, WORD_RE, buildPrompt, createLookup } from './lookup.mjs';
import { DictUnavailableError, createDict } from './dict.mjs';
import { MtUnavailableError, createMt } from './mt.mjs';
import { ANNOTATE_LEVELS, DEFAULT_LEVEL, createAnnotate, isCommon, loadWordLevels, pickEntry, pickSense, shortGloss, taggedGlosses } from './annotate.mjs';
import { createWords, parseWordsOp } from './words.mjs';
import { MAX_TERMS, createGlossary } from './glossary.mjs';
import { MAX_TEXT, buildTranslatePrompt, createTranslate, normalizeText } from './translate.mjs';
import { LIMITS, parseContext, parseWide } from './context.mjs';
import { createContextTranslate } from './translate-context.mjs';
import { createMydict, parseMydictOp } from './mydict.mjs';
import { createStudy, parseDays } from './study.mjs';

const PORT = 47831;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]); // DNS 리바인딩 차단
const MAX_BODY = 16 * 1024;
const MAX_WORDS_BODY = 24 * 1024;
const MAX_WIDE_BODY = 64 * 1024; // /translate-context·/lookup 은 "더 넓은 문맥"을 실을 수 있어 본문 상한이 크다
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
export function createBridge({ ask, askTranslate, askContext, cacheFile, translationsFile = join(dirname(cacheFile), 'translations.json'), contextFile = join(dirname(cacheFile), 'context-translations.json'), wordsFile = join(dirname(cacheFile), 'words.json'), mydictFile = join(dirname(cacheFile), 'mydict.json'), studyFile = join(dirname(cacheFile), 'study-log.jsonl'), now = Date.now, tokenFile, extensionId, dict = createDict(), mt = createMt() }) {
  const token = loadOrCreateToken(tokenFile);
  const tokenBuf = Buffer.from(token);
  const lookup = createLookup({ cache: createCache(cacheFile), ask });
  const translate = createTranslate({ cache: createCache(translationsFile), ask: askTranslate });
  const contextTranslate = createContextTranslate({ cache: createCache(contextFile), ask: askContext });
  const words = createWords({ file: wordsFile });
  const glossary = createGlossary();
  const mydict = createMydict({ file: mydictFile, now });
  const study = createStudy({ file: studyFile, now });
  const levels = loadWordLevels();
  const annotate = createAnnotate({ dict, levels, isKnown: words.isKnown, glossary, mydict });
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
      log('paragraph', norm.slice(0, 200), r.translation, value);
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
      log('mt', text, mine?.ko ?? translation, value);
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
      if (r.found || mine || t || acronym) log('dict', word, mine?.ko || t?.ko || sense?.ko || (e && shortGloss(e.senses?.[0]?.text)) || acronym?.ko, value);
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
    const { words, level = DEFAULT_LEVEL, acronyms = [] } = value ?? {};
    if (!Array.isArray(words) || words.some((w) => typeof w !== 'string') || !ANNOTATE_LEVELS.includes(level)) return send(res, 400, { error: 'bad-request' }, cors);
    if (!Array.isArray(acronyms) || acronyms.some((a) => typeof a !== 'string')) return send(res, 400, { error: 'bad-request' }, cors);
    if (words.length > MAX_ANNOTATE_WORDS || acronyms.length > MAX_ACRONYMS) return send(res, 413, { error: 'too-large' }, cors);
    try {
      send(res, 200, { items: await annotate(words.map((w) => w.toLowerCase()).filter((w) => WORD_RE.test(w)), level, glossary.domains(value), acronyms.filter((a) => ACRONYM_RE.test(a))) }, cors);
    } catch (e) {
      if (e instanceof DictUnavailableError) send(res, 503, { error: 'dict-unavailable' }, cors);
      else send(res, 502, { error: 'dict-failed' }, cors);
    }
  }

  // 내 단어: GET -> { known, saved, history }, POST { op, lemma, ... } -> 바뀐 같은 모양의 상태
  async function handleWords(req, res, cors) {
    if (req.method === 'GET') return send(res, 200, words.all(), cors);
    const { value, status } = await readJson(req, MAX_WORDS_BODY);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseWordsOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    const out = words.apply(op);
    if (op.op === 'save') log('save', op.word, op.gloss, value, op.url);
    else if (op.op === 'save-phrase') log('save', op.text, op.translation, value, op.url);
    else if (op.op === 'known') log('known', op.lemma, undefined, value);
    send(res, 200, out, cors);
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
    if (path === '/translate') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleTranslate(req, res, cors);
    }
    return send(res, 404, { error: 'not-found' }, cors);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });

  return {
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
