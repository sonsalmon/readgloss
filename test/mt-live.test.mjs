import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createMt, MtUnavailableError } from '../bridge/mt.mjs';

// 맥 번역 실연동(진짜 native/mt). darwin + 바이너리가 있을 때만 돌고, 영어->한국어 언어팩이 없으면 건너뛴다. AI 는 안 부른다.
const bin = new URL('../native/mt', import.meta.url).pathname;
const skip = process.platform !== 'darwin' || !existsSync(bin) ? '맥이 아니거나 npm run build:mt 를 안 했어요' : false;

test('실연동: "matrix multiplication" 은 곱셈으로 번역되고, 두 번째(다른 글) 호출은 1.5초 안', { skip }, async (t) => {
  const mt = createMt();
  try {
    let first;
    // 첫 호출은 번역 모델 적재로 수 초(가끔 20초 제한을 넘는다: 맥 번역 데몬이 식었을 때). 한 번은 다시 시도한다.
    for (let i = 0; !first; i++) {
      try {
        first = await mt.translate('matrix multiplication');
      } catch (e) {
        if (e instanceof MtUnavailableError) return t.skip('영어->한국어 언어팩이 없어요(시스템 설정의 번역 언어)');
        if (i > 0) throw e;
      }
    }
    console.log(`mt 실측: "matrix multiplication" -> "${first}"`);
    assert.match(first, /곱셈/);
    const t0 = performance.now();
    const second = await mt.translate('matrix addition');
    const ms = performance.now() - t0;
    console.log(`mt 두 번째 호출 ${ms.toFixed(0)}ms: "${second}"`);
    assert.ok(second.length > 0 && /[가-힣]/.test(second));
    assert.ok(ms < 1500, `${ms.toFixed(0)}ms`);
  } finally {
    mt.close();
  }
});
