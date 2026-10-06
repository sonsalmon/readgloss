// 내 단어: 아는 단어(known)·단어장(saved)·최근 찾은 단어(history). 원형(lemma)이 키다. 파일 하나(JSON), 쓸 때마다 임시 파일 -> rename.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WORD_RE } from './lookup.mjs';
import { normalizeText } from './translate.mjs';

export const MAX_HISTORY = 200;
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

// 요청 본문 -> 정규화된 { op, lemma[, word, gloss, sentence, url] }. 틀리면 null. 문장·주소는 상한에서 자른다.
export function parseWordsOp(v) {
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

export function createWords({ file, now = Date.now }) {
  const raw = load(file);
  // Map 을 써서 constructor 같은 이름도 평범한 키로 다룬다.
  const known = new Map(Object.entries(isObj(raw.known) ? raw.known : {}).filter(([k, v]) => isLemma(k) && isObj(v)).map(([k, v]) => [k, { ts: ts(v) }]));
  const saved = new Map(Object.entries(isObj(raw.saved) ? raw.saved : {}).filter(([k, v]) => isLemma(k) && isObj(v)).map(([k, v]) => [k, { ...info(v), ts: ts(v) }]));
  let history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((h) => isObj(h) && isLemma(h.lemma))
    .map((h) => ({ lemma: h.lemma, ...info(h), ts: ts(h) }))
    .filter((h, i, a) => a.findIndex((x) => x.lemma === h.lemma) === i)
    .slice(0, MAX_HISTORY);

  // 구·문장 단어장: id -> { text, translation, kind, sentence?, context?, url?, title?, ts }. 옛 항목은 kind 가 없어 sentence 로 읽는다.
  const phrases = new Map(
    Object.entries(isObj(raw.phrases) ? raw.phrases : {})
      .filter(([k, v]) => PHRASE_ID.test(k) && isObj(v) && typeof v.text === 'string' && v.text)
      .map(([k, v]) => [k, { text: str(v.text, PHRASE.text), translation: str(v.translation, PHRASE.translation) ?? '', kind: KINDS.includes(v.kind) ? v.kind : 'sentence', ...(typeof v.sentence === 'string' && v.sentence && { sentence: v.sentence.slice(0, PHRASE.sentence) }), ...(isObj(v.context) && { context: v.context }), ...(v.url && { url: str(v.url, PHRASE.url) }), ...(v.title && { title: str(v.title, PHRASE.title) }), ts: ts(v) }]),
  );

  const all = () => ({ known: Object.fromEntries(known), saved: Object.fromEntries(saved), history: history.map((h) => ({ ...h })), phrases: Object.fromEntries(phrases) });

  function persist() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all()));
    renameSync(tmp, file); // 원자적 교체
  }

  return {
    all,
    isKnown: (lemma) => known.has(lemma),
    // parseWordsOp 를 통과한 요청만 받는다. 바뀐 전체 상태를 돌려준다.
    // ponytail: 메모리를 먼저 바꾸고 쓴다. 디스크 쓰기가 실패하면 이 실행 동안만 메모리와 파일이 어긋난다(파일 자체는 rename 으로 안 깨진다).
    apply({ op, lemma, word, gloss, sentence, url, id, text, translation, context, title, kind }) {
      if (op === 'save-phrase' || op === 'unsave-phrase') {
        const key = op === 'save-phrase' ? phraseId(text) : id;
        if (op === 'save-phrase') phrases.set(key, { text, translation, kind, ...(sentence && { sentence }), ...(context && { context }), ...(url && { url }), ...(title && { title }), ts: now() });
        else phrases.delete(key);
        persist();
        return { id: key, phrases: Object.fromEntries(phrases) };
      }
      if (op === 'known') known.set(lemma, { ts: now() });
      else if (op === 'unknown') known.delete(lemma);
      else if (op === 'save') saved.set(lemma, { word, gloss, sentence, url, ts: now() });
      else if (op === 'unsave') saved.delete(lemma);
      else history = [{ lemma, word, gloss, sentence, url, ts: now() }, ...history.filter((h) => h.lemma !== lemma)].slice(0, MAX_HISTORY);
      persist();
      return all();
    },
  };
}
