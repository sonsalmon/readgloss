import test from 'node:test';
import assert from 'node:assert/strict';
import { createMt, MtError, MtUnavailableError, MAX_CACHE } from '../bridge/mt.mjs';

const FAKE = new URL('../fixtures/fake-mt.mjs', import.meta.url).pathname;
const fake = (o = {}) => createMt({ bin: process.execPath, args: [FAKE], ...o });

test('mt: 한 줄 JSON 으로 주고받고, 같은 글은 캐시에서(도우미를 다시 안 부른다)', async () => {
  const mt = fake();
  try {
    assert.equal(await mt.translate('matrix multiplication'), '번역1:matrix multiplication');
    assert.equal(await mt.translate('matrix multiplication'), '번역1:matrix multiplication'); // 캐시: 호출 번호가 그대로
    assert.equal(await mt.translate('hello'), '번역2:hello');
  } finally {
    mt.close();
  }
});

test('mt: 동시 요청도 직렬로 맞는 답을 받는다', async () => {
  const mt = fake();
  try {
    const out = await Promise.all(['a one', 'b two', 'c three'].map((t) => mt.translate(t)));
    assert.deepEqual(out, ['번역1:a one', '번역2:b two', '번역3:c three']);
  } finally {
    mt.close();
  }
});

test('mt: 도우미가 없으면 MtUnavailableError, 언어팩이 없으면(not-installed) 같은 오류, 실패 응답은 MtError(캐시 안 함)', async () => {
  await assert.rejects(createMt({ bin: '/nonexistent/mt' }).translate('hello there'), MtUnavailableError);
  const mt = fake();
  try {
    await assert.rejects(mt.translate('NOT-INSTALLED x'), MtUnavailableError);
    await assert.rejects(mt.translate('FAIL x'), MtError);
    await assert.rejects(mt.translate('FAIL x'), MtError); // 실패는 캐시에 안 들어가 다시 묻는다
    assert.equal(await mt.translate('fine'), '번역4:fine');
  } finally {
    mt.close();
  }
});

test('mt: 죽거나 멈추면 MtError 로 올리고 다음 요청 때 다시 띄운다', async () => {
  const mt = fake({ firstTimeoutMs: 300, timeoutMs: 300 });
  try {
    await assert.rejects(mt.translate('DIE now'), MtError);
    assert.equal(await mt.translate('after die'), '번역1:after die'); // 새 도우미
    await assert.rejects(mt.translate('HANG now'), MtError); // 300ms 뒤 버린다
    assert.equal(await mt.translate('after hang'), '번역1:after hang');
  } finally {
    mt.close();
  }
});

test('mt: 도우미를 새로 띄운 뒤 첫 호출만 시간을 길게 준다(모델 적재)', async () => {
  const mt = fake({ firstTimeoutMs: 1000, timeoutMs: 150 });
  try {
    assert.equal(await mt.translate('SLOW300 first'), '번역1:SLOW300 first'); // 첫 호출: 300ms 걸려도 통과
    await assert.rejects(mt.translate('SLOW300 second'), MtError); // 이후는 150ms 제한
    assert.equal(await mt.translate('SLOW300 third'), '번역1:SLOW300 third'); // 다시 띄운 도우미의 첫 호출
  } finally {
    mt.close();
  }
});

test('mt: 캐시는 2000개까지, 넘으면 가장 오래된 것부터 버린다', async () => {
  assert.equal(MAX_CACHE, 2000);
  const mt = fake({ cacheMax: 3 });
  try {
    for (const t of ['t1', 't2', 't3', 't4']) await mt.translate(t); // t1 이 밀려난다
    assert.equal(await mt.translate('t4'), '번역4:t4'); // 캐시
    assert.equal(await mt.translate('t1'), '번역5:t1'); // 다시 호출
  } finally {
    mt.close();
  }
});
