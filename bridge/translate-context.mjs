// 드래그 번역 2단계: 선택한 구·문장을 앞뒤 문맥·글 제목을 보고 AI 가 번역한다("문맥 번역" 버튼).
import { contextKey } from './context.mjs';
import { AiParseError } from './parse.mjs';
import { EXPRESSIONS_TASK, cleanTranslation, normalizeText, parseExpressions, parseJsonObject } from './translate.mjs';

const MAX_NOTE = 300;

const CONTEXT_TASK =
  '과제: 입력 JSON {"text": ..., "before": ..., "after": ..., "title": ..., "headings": [...]} 에서 text 는 사용자가 고른 영어 구·문장이고, before·after 는 그 앞뒤 글, title·headings 는 글의 제목·소제목이다. ' +
  '앞뒤 문맥과 주제를 참고해 text 가 이 글 안에서 갖는 뜻으로 자연스럽고 정확한 한국어로 번역한다(text 만 번역하고 before·after 는 번역하지 않는다). ' +
  'text 가 관용 표현이나 전문 용어이면 note 에 한국어 한 줄로 풀이한다. ' +
  `${EXPRESSIONS_TASK}expressions 는 text 안에서만 고른다(before·after 에서는 고르지 않는다). ` +
  '출력은 JSON {"translation": "...", "note": "...", "expressions": [{"en": "...", "ko": "..."}]} 한 줄만(note·expressions 가 필요 없으면 생략).';

// terms: ["transpose=전치(행렬)", ...] 분야 용어집에서 text 에 나온 단어. 입력 JSON 은 항상 마지막 줄. 빈 문맥 필드는 JSON 에서 뺀다.
// wide: 더 넓은 문맥(글 앞뒤와 목차)을 실은 요청이면 과제 설명에 한 줄 더한다.
const WIDE_NOTE = '이번 입력은 문맥을 넓게 실었다. 넓은 문맥(글 앞뒤와 목차)을 보고 text 의 뜻을 정한다.\n';

export function buildContextPrompt({ text, before, after, title, headings }, terms = [], wide = false) {
  const input = { text: normalizeText(text), ...(before && { before }), ...(after && { after }), ...(title && { title }), ...(headings?.length && { headings }) };
  return `${CONTEXT_TASK}\n${wide ? WIDE_NOTE : ''}${terms.length ? `용어 지정: ${terms.join(', ')}. 이 단어는 지정한 번역어를 쓴다.\n` : ''}${JSON.stringify(input)}`;
}

// AI 출력 -> { translation, note?, expressions? }. note 는 문자열일 때만 한 줄로 정리해 남긴다. 깨졌으면 AiParseError.
export function parseContextTranslation(text) {
  const obj = parseJsonObject(text);
  const note = typeof obj.note === 'string' ? normalizeText(obj.note).slice(0, MAX_NOTE) : '';
  const expressions = parseExpressions(obj.expressions);
  return { translation: cleanTranslation(obj.translation), ...(note && { note }), ...(expressions.length && { expressions }) };
}

// ask(프롬프트 문자열) -> AI 원문. 캐시 값은 JSON 문자열 하나({translation, note?}). cache.mjs 는 문자열만 담는다.
export function createContextTranslate({ cache, ask }) {
  // terms 앞쪽은 내 사전 용어 지정, 뒤쪽은 분야 용어집. mineKey 는 그중 내 사전 몫(캐시 키용: 내 사전이 바뀌면 다른 키).
  return async function translate({ text, context = null, force = false, domainsKey = '', terms = [], wide = false, mineKey = '' }) {
    const key = contextKey(text, context, domainsKey, { wide, mine: mineKey });
    if (!force) {
      try {
        const hit = JSON.parse(cache.get(key) ?? 'null');
        if (typeof hit?.translation === 'string') {
          const { expressions: rawExpressions, ...rest } = hit;
          const expressions = parseExpressions(rawExpressions);
          return { ...rest, ...(expressions.length && { expressions }), cached: true };
        }
      } catch {
        // 깨진 캐시 항목은 없는 것으로
      }
    }
    const result = parseContextTranslation(await ask(buildContextPrompt({ text, ...context }, terms, wide)));
    cache.set(key, JSON.stringify(result));
    return { ...result, cached: false };
  };
}
