// 대화 + 빈칸 타이핑 복습(변경 기록 28-20): 카드 하나로 짧은 대화와 새 예문을 AI 에게 한 번만 만든다.
// 응답은 { dialogue:[{en,ko}], ko, en, answer } 이고 answer 는 en 안에 그대로 들어 있어야 한다.
import { AiParseError } from './parse.mjs';
import { normalizeText, parseJsonObject } from './translate.mjs';
import { WORD_RE } from './lookup.mjs';

export const MAX_DRILL_KEY = 200;
export const MAX_DRILL_LEMMA = 64;
export const MAX_DRILL_TEXT = 1000;
export const MAX_DRILL_GLOSS = 300;
export const MAX_DRILL_SENTENCE = 1000;
export const MAX_DRILL_LINE = 500; // 대화 한 줄·예문 한 문장의 상한
export const MAX_DRILL_ANSWER = 100;
export const MIN_DRILL_LINES = 2;
export const MAX_DRILL_LINES = 3;

export class BadDrillError extends Error {
  name = 'BadDrillError';
  code = 'bad-drill';
}

const DRILL_TASK =
  '과제: 입력 JSON {"key":..., "lemma":... 또는 "text":..., "gloss":..., "sentence":...} 는 학습자가 복습할 표현 카드다. ' +
  '그 표현(lemma 또는 text)을 쓴 짧은 두 사람 대화 2~3줄과, 그 표현이 들어간 새 예문 한 문장을 만든다. ' +
  'dialogue 의 각 줄은 {"en": 영어, "ko": 한국어} 이고, ko 는 예문의 한국어 번역, en 은 새 영어 예문, answer 는 en 안에 그대로 들어간 학습 표현이다. ' +
  'sentence 는 참고만 하고 그대로 옮기지 않는다. ' +
  '출력은 JSON {"dialogue":[{"en":"...","ko":"..."}, ...],"ko":"...","en":"...","answer":"..."} 한 줄만 쓴다(설명·머리말 없이).';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 요청 { key, lemma?|text?, gloss, sentence? } 검사. 틀리면 { error:'bad-request' }, 맞으면 정리한 값.
export function parseDrillRequest(value) {
  if (!isObject(value)) return { error: 'bad-request' };
  const key = normalizeText(value.key);
  if (!key || key.length > MAX_DRILL_KEY) return { error: 'bad-request' };
  const hasLemma = value.lemma !== undefined && value.lemma !== null;
  const hasText = value.text !== undefined && value.text !== null;
  if (hasLemma === hasText) return { error: 'bad-request' }; // 정확히 하나
  const lemma = hasLemma ? normalizeText(value.lemma) : '';
  const text = hasText ? normalizeText(value.text) : '';
  if (hasLemma && (!lemma || lemma.length > MAX_DRILL_LEMMA || !WORD_RE.test(lemma))) return { error: 'bad-request' };
  if (hasText && (!text || text.length > MAX_DRILL_TEXT)) return { error: 'bad-request' };
  const gloss = normalizeText(value.gloss);
  if (!gloss || gloss.length > MAX_DRILL_GLOSS) return { error: 'bad-request' };
  const sentence = normalizeText(value.sentence);
  if (sentence.length > MAX_DRILL_SENTENCE) return { error: 'bad-request' };
  return { key, ...(hasLemma ? { lemma } : { text }), gloss, ...(sentence && { sentence }) };
}

export function buildDrillPrompt({ lemma, text, gloss, sentence }) {
  const input = {
    ...(lemma ? { lemma } : { text }),
    gloss,
    ...(sentence && { sentence }),
  };
  return `${DRILL_TASK}\n${JSON.stringify(input)}`;
}

// AI 출력 -> { dialogue, ko, en, answer }. 모양이 틀리거나 en 에 answer 가 없으면 BadDrillError(502 bad-drill).
export function parseDrillOutput(text) {
  let obj;
  try {
    obj = parseJsonObject(text);
  } catch (e) {
    if (e instanceof AiParseError) throw e;
    throw new AiParseError('parse: not JSON');
  }
  if (!isObject(obj)) throw new BadDrillError('bad-drill');
  const lines = obj.dialogue;
  if (!Array.isArray(lines) || lines.length < MIN_DRILL_LINES || lines.length > MAX_DRILL_LINES) throw new BadDrillError('bad-drill');
  const dialogue = [];
  for (const line of lines) {
    if (!isObject(line)) throw new BadDrillError('bad-drill');
    const en = normalizeText(line.en);
    const ko = normalizeText(line.ko);
    if (!en || !ko || en.length > MAX_DRILL_LINE || ko.length > MAX_DRILL_LINE) throw new BadDrillError('bad-drill');
    dialogue.push({ en, ko });
  }
  const ko = normalizeText(obj.ko);
  const en = normalizeText(obj.en);
  const answer = normalizeText(obj.answer);
  if (!ko || !en || !answer) throw new BadDrillError('bad-drill');
  if (ko.length > MAX_DRILL_LINE || en.length > MAX_DRILL_LINE || answer.length > MAX_DRILL_ANSWER) throw new BadDrillError('bad-drill');
  if (!hasWholeWord(en, answer)) throw new BadDrillError('bad-drill');
  return { dialogue, ko, en, answer };
}

// 예문에 정답이 낱말 경계를 지켜 들어 있는가(다른 낱말의 일부는 안 센다). 화면의 blankParts 와 같은 기준.
function hasWholeWord(text, answer) {
  const w = String(answer ?? '').trim();
  if (!w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(String(text ?? ''));
}

// 캐시에 든 값이 지금도 쓸 수 있는 모양인지(깨진 항목은 버리고 다시 묻는다).
export function isDrillResult(v) {
  if (!isObject(v) || !Array.isArray(v.dialogue) || v.dialogue.length < MIN_DRILL_LINES || v.dialogue.length > MAX_DRILL_LINES) return false;
  if (!v.dialogue.every((l) => isObject(l) && typeof l.en === 'string' && l.en && typeof l.ko === 'string' && l.ko)) return false;
  if (typeof v.ko !== 'string' || !v.ko || typeof v.en !== 'string' || !v.en || typeof v.answer !== 'string' || !v.answer) return false;
  return hasWholeWord(v.en, v.answer);
}

// ask(프롬프트) -> AI 원문. 카드 key 별로 한 번만 묻는다. 같은 카드는 저장한 결과를 다시 쓴다.
export function createDrill({ cache, ask }) {
  return async function drill(request) {
    try {
      const hit = JSON.parse(cache.get(request.key) ?? 'null');
      if (isDrillResult(hit)) return { ...hit, cached: true };
    } catch {
      // 깨진 캐시 항목은 없는 것으로
    }
    const result = parseDrillOutput(await ask(buildDrillPrompt(request)));
    cache.set(request.key, JSON.stringify(result));
    return { ...result, cached: false };
  };
}
