import { createHash } from 'node:crypto';
import { AiParseError } from './parse.mjs';

export const MAX_TEXT = 4000; // 정규화한 문단 글자 수 상한(넘으면 413). 확장의 paragraph-core.js 와 맞춘다.
const MAX_TRANSLATION = 16_000;
const MAX_EXPRESSIONS = 6;
const EXPR_EN = [2, 60];
const EXPR_KO = [1, 60];

export const normalizeText = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

// 캐시 키 = 정규화한 문단의 sha256. 공백만 다른 같은 문단은 같은 키. 분야 용어집이 켜졌으면(domainsKey) 그 조합도 키에 넣는다(용어 지정이 달라 번역이 달라질 수 있다).
export const textKey = (text, domainsKey = '') => createHash('sha256').update(normalizeText(text) + (domainsKey ? `\0${domainsKey}` : '')).digest('hex');

// 번역·문맥 번역 과제가 함께 쓰는 "기억할 표현" 요구. 입력 text 안에서만 고른다.
export const EXPRESSIONS_TASK =
  '학습자가 기억할 만한 구·관용 표현·전문 용어·어려운 단어는 expressions 에 0~6개 담는다(en: 원문에 나온 영어 구 2~60자 — 동사 활용은 원형으로 적어도 된다, ko: 이 글에서의 뜻을 한국어 1~60자). ' +
  '쉬운 단어는 넣지 않는다. ';

const TRANSLATE_TASK =
  '과제: 입력 JSON {"text": ...} 의 정보보안 영어 문서를 한국어로 자연스럽게 번역한다. ' +
  '코드 식별자·명령·고유명사는 원문 유지, 굳어진 보안 용어는 관용 번역을 쓴다. ' +
  EXPRESSIONS_TASK +
  '출력은 JSON {"translation": "...", "expressions": [{"en": "...", "ko": "..."}]} 한 줄만(expressions 가 필요 없으면 생략).';

// terms: ["transpose=전치(행렬)", ...] 분야 용어집에서 이 문단에 나온 단어. 있으면 과제 설명 뒤에 한 줄 더한다(입력 JSON 은 항상 마지막 줄).
export const buildTranslatePrompt = (text, terms = []) =>
  `${TRANSLATE_TASK}\n${terms.length ? `용어 지정: ${terms.join(', ')}. 이 단어는 지정한 번역어를 쓴다.\n` : ''}${JSON.stringify({ text: normalizeText(text) })}`;

// AI 출력(펜스·앞뒤 잡담 가능)에서 JSON 객체 하나를 꺼낸다. 깨졌으면 AiParseError.
// ponytail: parse.mjs 의 parseGloss 와 펜스 벗기기가 겹친다. parse.mjs 는 다른 티켓과 공유라 건드리지 않았다. 합칠 때 공용 함수로 뽑는다.
export function parseJsonObject(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1];
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const obj = JSON.parse(s);
    if (obj !== null && typeof obj === 'object') return obj;
  } catch {
    // 아래에서 같은 오류로
  }
  throw new AiParseError('parse: not JSON');
}

// translation 값 하나를 검사해 돌려준다. 비었거나 문자열이 아니거나 너무 길면 AiParseError.
export function cleanTranslation(v) {
  const translation = typeof v === 'string' ? v.trim() : '';
  if (!translation || translation.length > MAX_TRANSLATION) throw new AiParseError('parse: bad translation');
  return translation;
}

const inRange = (s, [min, max]) => s.length >= min && s.length <= max;

// expressions 값 -> [{en, ko}]. 모양이 틀린 항목은 그것만 버리고(전체 실패 아님), 대소문자만 다른 중복·6개 초과는 뺀다.
export function parseExpressions(v) {
  const out = [];
  for (const e of Array.isArray(v) ? v : []) {
    const en = normalizeText(e?.en);
    const ko = normalizeText(e?.ko);
    if (inRange(en, EXPR_EN) && /[A-Za-z]/.test(en) && inRange(ko, EXPR_KO) && !out.some((x) => x.en.toLowerCase() === en.toLowerCase())) out.push({ en, ko });
    if (out.length === MAX_EXPRESSIONS) break;
  }
  return out;
}

// AI 출력 -> { translation, expressions? }. expressions 가 비면 키를 두지 않는다.
export function parseTranslation(text) {
  const obj = parseJsonObject(text);
  const expressions = parseExpressions(obj.expressions);
  return { translation: cleanTranslation(obj.translation), ...(expressions.length && { expressions }) };
}

// 캐시 값: 새 값은 JSON 문자열 {translation, expressions?}, 옛 값은 번역 평문. 옛 평문도 읽는다.
function readHit(hit) {
  try {
    const v = JSON.parse(hit);
    if (typeof v?.translation === 'string') {
      const expressions = parseExpressions(v.expressions);
      return { translation: v.translation, ...(expressions.length && { expressions }) };
    }
  } catch {
    // 평문
  }
  return { translation: hit };
}

// ask(정규화한 문단, 용어 지정 목록) -> AI 원문. 캐시 -> AI 순서. 깨진 출력은 캐시에 넣지 않고 에러로 올린다.
export function createTranslate({ cache, ask }) {
  return async function translate({ text, force = false, domainsKey = '', terms = [] }) {
    const norm = normalizeText(text);
    const key = textKey(norm, domainsKey);
    if (!force) {
      const hit = cache.get(key);
      if (hit !== undefined) return { ...readHit(hit), cached: true };
    }
    const result = parseTranslation(await ask(norm, terms));
    cache.set(key, JSON.stringify(result));
    return { ...result, cached: false };
  };
}
