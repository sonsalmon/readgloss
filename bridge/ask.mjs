// 지금 줄에 묻기(변경 기록 28-18): 고른 글·영상 자막 줄과 질문을 AI 에 보내 한국어 1~3문장 답을 받는다.
// 캐시 키는 (selection, question) 만 쓴다. 문맥은 답의 근거로만 싣고, 같은 질문·같은 글은 다시 묻지 않는다.
import { createHash } from 'node:crypto';
import { parseContext } from './context.mjs';
import { AiParseError } from './parse.mjs';
import { normalizeText } from './translate.mjs';

export const MAX_ASK_SELECTION = 600;
export const MAX_ASK_QUESTION = 200;
export const MAX_ASK_ANSWER = 2000;

const ASK_TASK =
  '과제: 입력 JSON {"selection": ..., "question": ..., "before": ..., "after": ..., "title": ...} 에서 selection 은 사용자가 고른 글이나 지금 영상 자막 줄, question 은 그 글에 대한 사용자의 질문이다. ' +
  '질문에 한국어로 1~3문장, 질문을 되풀이하지 말 것. ' +
  'selection·앞뒤 문맥(before·after)·title 을 참고해 답한다. ' +
  '출력은 답 글만 쓴다(JSON·머리말 없이).';

// 요청 { selection(1~600), question(1~200), context?{before,after,title} } 검사.
// 틀리면 { error:'bad-request' }, 맞으면 { selection, question, context }.
export function parseAskRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'bad-request' };
  const selection = normalizeText(value.selection);
  const question = normalizeText(value.question);
  if (!selection || selection.length > MAX_ASK_SELECTION) return { error: 'bad-request' };
  if (!question || question.length > MAX_ASK_QUESTION) return { error: 'bad-request' };
  const parsed = parseContext(value.context);
  if (parsed.status) return { error: 'bad-request' };
  return { selection, question, context: parsed.context };
}

// 문맥 필드가 빈 것은 JSON 에서 뺀다. 입력 JSON 은 항상 마지막 줄.
export function buildAskPrompt({ selection, question, before, after, title }) {
  const input = {
    selection: normalizeText(selection),
    question: normalizeText(question),
    ...(before && { before }),
    ...(after && { after }),
    ...(title && { title }),
  };
  return `${ASK_TASK}\n${JSON.stringify(input)}`;
}

// AI 출력 -> 답 한 덩어리. 비었으면 AiParseError. 너무 길면 상한에서 자른다.
export function parseAskOutput(text) {
  const answer = normalizeText(text);
  if (!answer) throw new AiParseError('parse: bad answer');
  return answer.slice(0, MAX_ASK_ANSWER);
}

// (selection, question) -> 캐시 키. 공백만 다른 같은 질문은 같은 키.
export const askKey = (selection, question) =>
  createHash('sha256').update(JSON.stringify([normalizeText(selection), normalizeText(question)])).digest('hex');

// ask(프롬프트 문자열) -> AI 원문. 캐시 값은 JSON 문자열 {answer}.
export function createAsk({ cache, ask }) {
  return async function askQuestion({ selection, question, context = null }) {
    const key = askKey(selection, question);
    try {
      const hit = JSON.parse(cache.get(key) ?? 'null');
      if (typeof hit?.answer === 'string' && hit.answer) return { answer: hit.answer, cached: true };
    } catch {
      // 깨진 캐시 항목은 없는 것으로
    }
    const answer = parseAskOutput(await ask(buildAskPrompt({ selection, question, ...context })));
    cache.set(key, JSON.stringify({ answer }));
    return { answer, cached: false };
  };
}
