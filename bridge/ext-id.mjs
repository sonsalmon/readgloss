import { createHash } from 'node:crypto';

// manifest.json 의 "key"(공개키 DER 의 base64)에서 크롬이 정하는 확장 ID를 계산한다.
// sha256 앞 32 hex 글자를 0-f -> a-p 로 바꾼 값.
export function extensionIdFromKey(keyBase64) {
  const hex = createHash('sha256').update(Buffer.from(keyBase64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
