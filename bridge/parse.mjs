export class AiParseError extends Error {
  name = 'AiParseError';
}

const MAX_GLOSS = 80;

// AI 출력(펜스로 감싸져 오기도 함)에서 gloss 문자열 하나를 꺼낸다. 깨졌으면 AiParseError.
export function parseGloss(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1];
  // 앞뒤 잡담 대비: 첫 { 부터 마지막 } 까지만 본다
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    throw new AiParseError('parse: not JSON');
  }
  const gloss = typeof obj?.gloss === 'string' ? obj.gloss.trim() : '';
  if (!gloss || gloss.length > MAX_GLOSS) throw new AiParseError('parse: bad gloss');
  return gloss;
}
