// 자동 생성 자막 다듬기(변경 기록 28-17): 낱말 시각은 그대로 두고 AI 가 문장 단위로 줄을 다시 나눈다.
// 응답은 { lines:[{from,to,text}] } 이고 from·to 는 0..n-1 을 빠짐·겹침 없이 덮어야 한다. 다리 캐시는 영상 id 별.
import { AiParseError } from './parse.mjs';
import { parseJsonObject } from './translate.mjs';

export const MAX_POLISH_WORDS = 6000;
export const MAX_POLISH_WORD_CHARS = 100;
export const MAX_POLISH_TIME = 86_400;
export const POLISH_ID_RE = /^[A-Za-z0-9_-]{11}$/; // 유튜브 영상 id

export class BadPolishError extends Error {
  name = 'BadPolishError';
  code = 'bad-polish';
}

const POLISH_TASK =
  '과제: 입력 JSON {"words":[{"i":0,"t":0.0,"w":"..."}, ...]} 은 자동 생성 자막의 낱말과 시작 시각(초)이다. ' +
  '낱말을 바꾸거나 빼지 말고, 문장 단위로 줄을 나누고 문장 부호를 넣는다. ' +
  '출력은 JSON {"lines":[{"from":0,"to":3,"text":"..."}]} 한 줄만. from·to 는 그 줄의 첫·끝 낱말 번호(0부터)이고 ' +
  '모든 번호를 겹치거나 빠짐없이 덮어야 한다. text 는 그 낱말들을 그대로 이어 쓴 문장이다.';

// 요청 { id, words:[{t,w}] } 검사. 틀리면 { error }, 맞으면 { id, words }.
export function parsePolishRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'bad-request' };
  const { id, words } = value;
  if (typeof id !== 'string' || !POLISH_ID_RE.test(id)) return { error: 'bad-request' };
  if (!Array.isArray(words) || !words.length) return { error: 'bad-request' };
  if (words.length > MAX_POLISH_WORDS) return { error: 'too-large' };
  const out = [];
  for (const w of words) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return { error: 'bad-request' };
    const t = w.t;
    const text = typeof w.w === 'string' ? w.w.replace(/\s+/g, ' ').trim() : '';
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > MAX_POLISH_TIME || !text || text.length > MAX_POLISH_WORD_CHARS) {
      return { error: 'bad-request' };
    }
    out.push({ t, w: text });
  }
  return { id, words: out };
}

// 다리와 확장이 같은 규칙: 줄마다 from = 앞 줄 to + 1, 마지막 to = n - 1.
export function validPolishLines(lines, n) {
  if (!Array.isArray(lines) || !lines.length || !Number.isInteger(n) || n <= 0) return false;
  let next = 0;
  for (const l of lines) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
    if (!Number.isInteger(l.from) || !Number.isInteger(l.to)) return false;
    if (l.from !== next || l.to < l.from || l.to >= n) return false;
    if (typeof l.text !== 'string' || !l.text.trim()) return false;
    next = l.to + 1;
  }
  return next === n;
}

export function buildPolishPrompt(words) {
  const input = { words: words.map((w, i) => ({ i, t: w.t, w: w.w })) };
  return `${POLISH_TASK}\n${JSON.stringify(input)}`;
}

// AI 출력 -> [{from,to,text}]. 번호가 어긋나면 BadPolishError(결과를 버리고 502 bad-polish).
export function parsePolishOutput(text, n) {
  let obj;
  try {
    obj = parseJsonObject(text);
  } catch (e) {
    if (e instanceof AiParseError) throw e;
    throw new AiParseError('parse: not JSON');
  }
  const lines = obj?.lines;
  if (!validPolishLines(lines, n)) throw new BadPolishError('bad-polish');
  return lines.map((l) => ({ from: l.from, to: l.to, text: l.text.replace(/\s+/g, ' ').trim() }));
}

// ask(프롬프트) -> AI 원문. 캐시 값은 줄 목록 JSON 문자열. 영상 id 별로 한 번만 묻는다.
export function createPolish({ cache, ask }) {
  return async function polish({ id, words }) {
    const n = words.length;
    try {
      const hit = JSON.parse(cache.get(id) ?? 'null');
      if (validPolishLines(hit, n)) {
        return { lines: hit.map((l) => ({ from: l.from, to: l.to, text: l.text })), cached: true };
      }
    } catch {
      // 깨진 캐시 항목은 없는 것으로
    }
    const lines = parsePolishOutput(await ask(buildPolishPrompt(words)), n);
    cache.set(id, JSON.stringify(lines));
    return { lines, cached: false };
  };
}
