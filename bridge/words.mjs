// 내 단어: 아는 단어(known)·단어장(saved)·최근 찾은 단어(history). 원형(lemma)이 키다. 파일 하나(JSON), 쓸 때마다 임시 파일 -> rename.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WORD_RE } from './lookup.mjs';
import { normalizeText } from './translate.mjs';

export const MAX_HISTORY = 200;
export const MEMO_MAX = 1000;
const MAX_GLOSS = 200;
const MAX_SENTENCE = 1000;
const MAX_URL = 2000;
const OPS = ['known', 'unknown', 'save', 'unsave', 'history'];
const PHRASE = { text: 1000, translation: 2000, ctxTranslation: 2000, note: 400, url: 2000, title: 200, sentence: MAX_SENTENCE };
const KINDS = ['expression', 'sentence']; // 구·문장 항목의 종류. expression = 문장·문단에서 뽑은 기억할 표현, 기본은 sentence

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

// 구·문장 id = 공백 정리한 글의 sha1 앞 12자
export const phraseId = (text) => createHash('sha1').update(normalizeText(text)).digest('hex').slice(0, 12);
const PHRASE_ID = /^[0-9a-f]{12}$/;

// 문자열 칸 하나: 없으면 '', 문자열이 아니거나 상한을 넘으면 null(자르지 않고 거절)
const field = (v, max) => (v === undefined || v === null ? '' : typeof v === 'string' && v.length <= max ? v : null);

// save-phrase / unsave-phrase 요청 -> 정규화한 요청 | null
function parsePhraseOp(v) {
  if (v.op === 'unsave-phrase') return typeof v.id === 'string' && PHRASE_ID.test(v.id) ? { op: 'unsave-phrase', id: v.id } : null;
  const text = typeof v.text === 'string' ? normalizeText(v.text) : '';
  const translation = field(v.translation, PHRASE.translation);
  const url = field(v.url, PHRASE.url);
  const title = field(v.title, PHRASE.title);
  const sentence = field(v.sentence, PHRASE.sentence);
  const kind = v.kind ?? 'sentence';
  if (!text || text.length > PHRASE.text || translation === null || url === null || title === null || sentence === null || !KINDS.includes(kind) || (url && !/^https?:\/\//i.test(url))) return null;
  let context;
  if (v.context !== undefined && v.context !== null) {
    const c = v.context;
    if (typeof c !== 'object' || Array.isArray(c) || (c.wide !== undefined && typeof c.wide !== 'boolean')) return null;
    const ct = field(c.translation, PHRASE.ctxTranslation);
    const note = field(c.note, PHRASE.note);
    if (ct === null || note === null) return null;
    context = { translation: ct, ...(note && { note }), ...(c.wide && { wide: true }) };
  }
  return { op: 'save-phrase', text, translation, ...(context && { context }), url, title, kind, sentence };
}

// memo: {op:'memo', lemma, memo} 또는 {op:'memo', id, memo} 중 정확히 하나. memo 는 0~1000자('' 이면 지움).
function parseMemoOp(v) {
  const hasLemma = v.lemma !== undefined && v.lemma !== null;
  const hasId = v.id !== undefined && v.id !== null;
  if (hasLemma === hasId) return null; // 둘 다이거나 둘 다 아니다
  if (typeof v.memo !== 'string' || v.memo.length > MEMO_MAX) return null; // 넘치면 자르지 않고 거절
  if (hasLemma) return typeof v.lemma === 'string' && WORD_RE.test(v.lemma) ? { op: 'memo', lemma: v.lemma.toLowerCase(), memo: v.memo } : null;
  return typeof v.id === 'string' && PHRASE_ID.test(v.id) ? { op: 'memo', id: v.id, memo: v.memo } : null;
}

// 요청 본문 -> 정규화된 { op, lemma[, word, gloss, sentence, url] }. 틀리면 null. 문장·주소는 상한에서 자른다.
export function parseWordsOp(v) {
  if (v && typeof v === 'object' && v.op === 'memo') return parseMemoOp(v);
  if (v && typeof v === 'object' && (v.op === 'save-phrase' || v.op === 'unsave-phrase')) return parsePhraseOp(v);
  if (!v || typeof v !== 'object' || !OPS.includes(v.op) || typeof v.lemma !== 'string' || !WORD_RE.test(v.lemma)) return null;
  const lemma = v.lemma.toLowerCase();
  if (v.op !== 'save' && v.op !== 'history') return { op: v.op, lemma };
  const word = v.word === undefined ? lemma : v.word;
  const gloss = str(v.gloss ?? '', MAX_GLOSS);
  const sentence = str(v.sentence ?? '', MAX_SENTENCE);
  const url = str(v.url ?? '', MAX_URL);
  if (typeof word !== 'string' || !WORD_RE.test(word) || gloss === null || sentence === null || url === null) return null;
  if (url && !/^https?:\/\//i.test(url)) return null; // 패널이 주소를 링크로 쓸 수 있으니 http(s) 만
  return { op: v.op, lemma, word, gloss, sentence, url };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isLemma = (k) => typeof k === 'string' && WORD_RE.test(k) && k === k.toLowerCase();
const ts = (v) => (Number.isFinite(v?.ts) ? v.ts : 0);
const info = (v) => ({ word: str(v.word, 64) ?? '', gloss: str(v.gloss, MAX_GLOSS) ?? '', sentence: str(v.sentence, MAX_SENTENCE) ?? '', url: str(v.url, MAX_URL) ?? '' });
// memo 는 문자열 1000자 이하만 살린다(넘으면 버림). 빈 문자열은 칸이 없는 것으로 본다.
const memoOf = (v) => (typeof v.memo === 'string' && v.memo.length <= MEMO_MAX ? v.memo : '');
const withMemo = (m) => (m ? { memo: m } : {});

// 파일이 깨졌으면 빈 상태로 시작하되 원본은 .broken 으로 남긴다(다음 저장이 덮어써서 잃지 않게).
function load(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {}; // 없음
  }
  try {
    const v = JSON.parse(raw);
    if (isObj(v)) return v;
  } catch {
    // 아래에서 처리
  }
  try {
    copyFileSync(file, `${file}.broken`);
  } catch {
    // 백업 실패는 무시
  }
  return {};
}

export function createWords({ file, db, now = Date.now }) {
  const known = new Map();
  const saved = new Map();
  let history = [];
  const phrases = new Map();

  if (db) {
    const wordNodes = db.byKind('word');
    for (const w of wordNodes) {
      const d = w.data;
      if (isObj(d)) {
        if (isObj(d.known)) known.set(w.key, { ts: ts(d.known) });
        if (isObj(d.saved)) saved.set(w.key, { ...info(d.saved), ...withMemo(memoOf(d.saved)), ts: ts(d.saved) });
        if (isObj(d.history) && isLemma(d.history.lemma)) {
          history.push({ lemma: d.history.lemma, ...info(d.history), ts: ts(d.history) });
        }
      }
    }
    history.sort((a, b) => b.ts - a.ts);
    history = history.filter((h, i, a) => a.findIndex((x) => x.lemma === h.lemma) === i).slice(0, MAX_HISTORY);

    const phraseNodes = db.byKind('phrase');
    for (const p of phraseNodes) {
      const v = p.data;
      if (PHRASE_ID.test(p.id) && isObj(v) && typeof v.text === 'string' && v.text) {
        phrases.set(p.id, {
          text: str(v.text, PHRASE.text),
          translation: str(v.translation, PHRASE.translation) ?? '',
          kind: KINDS.includes(v.kind) ? v.kind : 'sentence',
          ...(typeof v.sentence === 'string' && v.sentence && { sentence: v.sentence.slice(0, PHRASE.sentence) }),
          ...(isObj(v.context) && { context: v.context }),
          ...(v.url && { url: str(v.url, PHRASE.url) }),
          ...(v.title && { title: str(v.title, PHRASE.title) }),
          ...withMemo(memoOf(v)),
          ts: ts(v),
        });
      }
    }
  } else {
    const raw = load(file);
    for (const [k, v] of Object.entries(isObj(raw.known) ? raw.known : {})) {
      if (isLemma(k) && isObj(v)) known.set(k, { ts: ts(v) });
    }
    for (const [k, v] of Object.entries(isObj(raw.saved) ? raw.saved : {})) {
      if (isLemma(k) && isObj(v)) saved.set(k, { ...info(v), ...withMemo(memoOf(v)), ts: ts(v) });
    }
    history = (Array.isArray(raw.history) ? raw.history : [])
      .filter((h) => isObj(h) && isLemma(h.lemma))
      .map((h) => ({ lemma: h.lemma, ...info(h), ts: ts(h) }))
      .filter((h, i, a) => a.findIndex((x) => x.lemma === h.lemma) === i)
      .slice(0, MAX_HISTORY);
    for (const [k, v] of Object.entries(isObj(raw.phrases) ? raw.phrases : {})) {
      if (PHRASE_ID.test(k) && isObj(v) && typeof v.text === 'string' && v.text) {
        phrases.set(k, {
          text: str(v.text, PHRASE.text),
          translation: str(v.translation, PHRASE.translation) ?? '',
          kind: KINDS.includes(v.kind) ? v.kind : 'sentence',
          ...(typeof v.sentence === 'string' && v.sentence && { sentence: v.sentence.slice(0, PHRASE.sentence) }),
          ...(isObj(v.context) && { context: v.context }),
          ...(v.url && { url: str(v.url, PHRASE.url) }),
          ...(v.title && { title: str(v.title, PHRASE.title) }),
          ...withMemo(memoOf(v)),
          ts: ts(v),
        });
      }
    }
  }

  const all = () => ({ known: Object.fromEntries(known), saved: Object.fromEntries(saved), history: history.map((h) => ({ ...h })), phrases: Object.fromEntries(phrases) });

  function persistWord(lemma) {
    if (!db) return;
    const s = saved.get(lemma) || null;
    const k = known.get(lemma) || null;
    const h = history.find((x) => x.lemma === lemma) || null;
    const id = `word:${lemma}`;
    if (!s && !k && !h) {
      db.del(id);
    } else {
      const tsMax = Math.max(s?.ts || 0, k?.ts || 0, h?.ts || 0);
      db.put({
        id,
        kind: 'word',
        key: lemma,
        data: {
          ...(s && { saved: s }),
          ...(k && { known: k }),
          ...(h && { history: h }),
        },
        ts: tsMax,
      });
    }
  }

  function persistPhrase(id) {
    if (!db) return;
    const p = phrases.get(id);
    if (!p) {
      db.del(id);
    } else {
      db.put({
        id,
        kind: 'phrase',
        key: p.text,
        data: p,
        ts: p.ts,
      });
    }
  }

  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all()));
    renameSync(tmp, file); // 원자적 교체
  }

  return {
    all,
    isKnown: (lemma) => known.has(lemma),
    // parseWordsOp 를 통과한 요청만 받는다. 바뀐 전체 상태를 돌려준다. memo 대상이 없으면 null(404).
    // ponytail: 메모리를 먼저 바꾸고 쓴다. 디스크 쓰기가 실패하면 이 실행 동안만 메모리와 파일이 어긋난다(파일 자체는 rename 으로 안 깨진다).
    apply({ op, lemma, word, gloss, sentence, url, id, text, translation, context, title, kind, memo }) {
      if (op === 'memo') {
        // memo 대상이 없으면 404. memo '' 이면 칸을 지운다. ts 는 건드리지 않는다.
        const target = lemma !== undefined ? saved : phrases;
        const key = lemma !== undefined ? lemma : id;
        const cur = target.get(key);
        if (!cur) return null;
        const next = { ...cur };
        if (memo) next.memo = memo;
        else delete next.memo;
        target.set(key, next);
        if (db) {
          if (lemma !== undefined) persistWord(lemma);
          else persistPhrase(id);
        } else {
          persist();
        }
        return lemma !== undefined ? all() : { id, phrases: Object.fromEntries(phrases) };
      }
      if (op === 'save-phrase' || op === 'unsave-phrase') {
        const key = op === 'save-phrase' ? phraseId(text) : id;
        if (op === 'save-phrase') phrases.set(key, { text, translation, kind, ...(sentence && { sentence }), ...(context && { context }), ...(url && { url }), ...(title && { title }), ...withMemo(phrases.get(key)?.memo), ts: now() }); // 다시 저장해도 메모는 남긴다
        else phrases.delete(key);
        if (db) persistPhrase(key);
        else persist();
        return { id: key, phrases: Object.fromEntries(phrases) };
      }
      if (op === 'known') {
        known.set(lemma, { ts: now() });
        if (db) persistWord(lemma);
        else persist();
      } else if (op === 'unknown') {
        known.delete(lemma);
        if (db) persistWord(lemma);
        else persist();
      } else if (op === 'save') {
        saved.set(lemma, { word, gloss, sentence, url, ...withMemo(saved.get(lemma)?.memo), ts: now() }); // 다시 저장해도 메모는 남긴다
        if (db) persistWord(lemma);
        else persist();
      } else if (op === 'unsave') {
        saved.delete(lemma);
        if (db) persistWord(lemma);
        else persist();
      } else {
        const oldHistory = history;
        history = [{ lemma, word, gloss, sentence, url, ts: now() }, ...history.filter((h) => h.lemma !== lemma)].slice(0, MAX_HISTORY);
        if (db) {
          persistWord(lemma);
          for (const old of oldHistory) {
            if (!history.some((h) => h.lemma === old.lemma)) {
              persistWord(old.lemma);
            }
          }
        } else {
          persist();
        }
      }
      return all();
    },
  };
}
