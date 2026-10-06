import { createHash } from 'node:crypto';
import { AiParseError } from './parse.mjs';

export const MAX_TEXT = 4000; // 정규화한 문단 글자 수 상한(넘으면 413). 확장의 paragraph-core.js 와 맞춘다.
const MAX_TRANSLATION = 16_000;

export const normalizeText = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

// 캐시 키 = 정규화한 문단의 sha256. 공백만 다른 같은 문단은 같은 키. 분야 용어집이 켜졌으면(domainsKey) 그 조합도 키에 넣는다(용어 지정이 달라 번역이 달라질 수 있다).
export const textKey = (text, domainsKey = '') => createHash('sha256').update(normalizeText(text) + (domainsKey ? `\0${domainsKey}` : '')).digest('hex');

const TRANSLATE_TASK =
  '과제: 입력 JSON {"text": ...} 의 정보보안 영어 문서를 한국어로 자연스럽게 번역한다. ' +
  '코드 식별자·명령·고유명사는 원문 유지, 굳어진 보안 용어는 관용 번역을 쓴다. ' +
  '출력은 JSON {"translation": "..."} 한 줄만.';

// terms: ["transpose=전치(행렬)", ...] 분야 용어집에서 이 문단에 나온 단어. 있으면 과제 설명 뒤에 한 줄 더한다(입력 JSON 은 항상 마지막 줄).
export const buildTranslatePrompt = (text, terms = []) =>
  `${TRANSLATE_TASK}\n${terms.length ? `용어 지정: ${terms.join(', ')}. 이 단어는 지정한 번역어를 쓴다.\n` : ''}${JSON.stringify({ text: normalizeText(text) })}`;

// AI 출력(펜스·앞뒤 잡담 가능)에서 translation 문자열 하나를 꺼낸다. 깨졌으면 AiParseError.
// ponytail: parse.mjs 의 parseGloss 와 펜스 벗기기가 겹친다. parse.mjs 는 다른 티켓과 공유라 건드리지 않았다. 합칠 때 공용 함수로 뽑는다.
export function parseTranslation(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1];
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    throw new AiParseError('parse: not JSON');
  }
  const translation = typeof obj?.translation === 'string' ? obj.translation.trim() : '';
  if (!translation || translation.length > MAX_TRANSLATION) throw new AiParseError('parse: bad translation');
  return translation;
}

// ask(정규화한 문단, 용어 지정 목록) -> AI 원문. 캐시 -> AI 순서. 깨진 출력은 캐시에 넣지 않고 에러로 올린다.
export function createTranslate({ cache, ask }) {
  return async function translate({ text, force = false, domainsKey = '', terms = [] }) {
    const norm = normalizeText(text);
    const key = textKey(norm, domainsKey);
    if (!force) {
      const hit = cache.get(key);
      if (hit !== undefined) return { translation: hit, cached: true };
    }
    const translation = parseTranslation(await ask(norm, terms));
    cache.set(key, translation);
    return { translation, cached: false };
  };
}
