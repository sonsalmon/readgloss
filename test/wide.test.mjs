import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, WIDE_LIMITS, contextKey, parseContext, parseWide } from '../bridge/context.mjs';
import { buildContextPrompt } from '../bridge/translate-context.mjs';
import { buildPrompt } from '../bridge/lookup.mjs';
import { start } from '../fixtures/bridge-harness.mjs';

const withBridge = (fn) => async () => {
  const s = await start();
  try {
    await fn(s);
  } finally {
    await s.close();
  }
};

test('WIDE_LIMITS: 앞뒤 글 6000자·목차 20개×200자, 나머지는 기존과 같고 LIMITS 는 그대로', () => {
  assert.deepEqual(WIDE_LIMITS, { text: 1000, before: 6000, after: 6000, title: 200, headings: 20, heading: 200 });
  assert.deepEqual(LIMITS, { text: 1000, before: 1500, after: 1500, title: 200, headings: 5, heading: 200 });
});

test('parseContext(wide): 6000자·목차 20개까지 통과, 넘으면 413, 보통 모드는 예전 상한 그대로', () => {
  assert.equal(parseContext({ before: 'a'.repeat(6000), after: 'a'.repeat(6000) }, true).context.before.length, 6000);
  assert.equal(parseContext({ headings: Array(20).fill('h') }, true).context.headings.length, 20);
  assert.deepEqual(parseContext({ before: 'a'.repeat(6001) }, true), { status: 413 });
  assert.deepEqual(parseContext({ after: 'a'.repeat(6001) }, true), { status: 413 });
  assert.deepEqual(parseContext({ headings: Array(21).fill('h') }, true), { status: 413 });
  assert.deepEqual(parseContext({ headings: ['a'.repeat(201)] }, true), { status: 413 });
  assert.deepEqual(parseContext({ title: 'a'.repeat(201) }, true), { status: 413 });
  assert.deepEqual(parseContext({ before: 'a'.repeat(1501) }), { status: 413 });
  assert.deepEqual(parseContext({ before: 'a'.repeat(1501) }, false), { status: 413 });
  assert.deepEqual(parseContext({ headings: Array(6).fill('h') }), { status: 413 });
});

test('parseWide: 없으면 false, boolean 만, 나머지는 null', () => {
  assert.equal(parseWide(undefined), false);
  assert.equal(parseWide(null), false);
  assert.equal(parseWide(true), true);
  assert.equal(parseWide(false), false);
  for (const bad of [1, 'true', {}, []]) assert.equal(parseWide(bad), null);
});

test('contextKey: wide·내 사전 용어가 있으면 다른 키, 없으면 예전 키 그대로', () => {
  const ctx = { before: 'b', after: 'a', title: 't', headings: ['h'] };
  const k = contextKey('x', ctx, 'math');
  assert.equal(contextKey('x', ctx, 'math', {}), k);
  assert.equal(contextKey('x', ctx, 'math', { wide: false, mine: '' }), k);
  const w = contextKey('x', ctx, 'math', { wide: true });
  const m = contextKey('x', ctx, 'math', { mine: 'pca=주성분' });
  assert.equal(new Set([k, w, m, contextKey('x', ctx, 'math', { wide: true, mine: 'pca=주성분' }), contextKey('x', ctx, 'math', { mine: 'pca=다른' })]).size, 5);
  assert.match(k, /^[0-9a-f]{64}$/);
});

test('프롬프트: wide 이면 "넓은 문맥(글 앞뒤와 목차)을 보고" 한 줄이 더해지고, 아니면 예전 그대로. 입력 JSON 은 마지막 줄', () => {
  const ctx = { before: 'b', after: 'a', title: 't', headings: ['h'] };
  const plain = buildContextPrompt({ text: 'x', ...ctx });
  const wide = buildContextPrompt({ text: 'x', ...ctx }, [], true);
  assert.doesNotMatch(plain, /넓은 문맥/);
  assert.match(wide, /넓은 문맥\(글 앞뒤와 목차\)을 보고/);
  assert.equal(wide.split('\n').length, plain.split('\n').length + 1);
  assert.equal(wide.slice(wide.lastIndexOf('\n') + 1), plain.slice(plain.lastIndexOf('\n') + 1));
  const lp = buildPrompt({ word: 'w', sentence: 's', context: ctx });
  const lw = buildPrompt({ word: 'w', sentence: 's', context: ctx, wide: true });
  assert.doesNotMatch(lp, /넓은 문맥/);
  assert.match(lw, /넓은 문맥\(글 앞뒤와 목차\)/);
  assert.equal(buildPrompt({ word: 'w', sentence: 's' }), buildPrompt({ word: 'w', sentence: 's', wide: true })); // 문맥이 없으면 wide 는 의미 없다
  assert.equal(lw.slice(lw.lastIndexOf('\n') + 1), JSON.stringify({ word: 'w', sentence: 's', context: ctx }));
});

const CTX_BIG = { before: '가'.repeat(6000), after: '나'.repeat(6000), title: 'T', headings: Array.from({ length: 20 }, (_, i) => `H${i}`) };

test('/translate-context wide: 넓은 상한·64KB 본문을 받고, 프롬프트에 넓은 문맥 줄이 들어간다', withBridge(async (s) => {
  const body = { text: 'the transpose', context: CTX_BIG, wide: true };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 16 * 1024, '16KB 를 넘는 본문');
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 64 * 1024);
  const r = await s.post('/translate-context', body);
  assert.equal(r.status, 200);
  assert.match(s.asked.context[0], /넓은 문맥\(글 앞뒤와 목차\)을 보고/);
  const payload = JSON.parse(s.asked.context[0].slice(s.asked.context[0].lastIndexOf('\n') + 1));
  assert.equal(payload.before.length, 6000);
  assert.equal(payload.headings.length, 20);
}));

test('/translate-context: wide 가 아니면 예전 상한(413), wide 라도 6000자 초과·21개는 413, wide 가 boolean 이 아니면 400', withBridge(async (s) => {
  const t = 'a b';
  assert.equal((await s.post('/translate-context', { text: t, context: { before: 'a'.repeat(1501) } })).status, 413);
  assert.equal((await s.post('/translate-context', { text: t, context: { before: 'a'.repeat(1501) }, wide: false })).status, 413);
  assert.equal((await s.post('/translate-context', { text: t, context: { before: 'a'.repeat(1501) }, wide: true })).status, 200);
  assert.equal((await s.post('/translate-context', { text: t, context: { before: 'a'.repeat(6001) }, wide: true })).status, 413);
  assert.equal((await s.post('/translate-context', { text: t, context: { headings: Array(21).fill('h') }, wide: true })).status, 413);
  assert.equal((await s.post('/translate-context', { text: t, context: { headings: Array(20).fill('h') }, wide: true })).status, 200);
  for (const wide of [1, 'true', {}]) assert.equal((await s.post('/translate-context', { text: t, wide })).status, 400);
  assert.equal((await s.post('/translate-context', { text: 'a'.repeat(1001), wide: true })).status, 413); // 선택한 글 상한은 그대로
  assert.equal((await s.req('POST', '/translate-context', { raw: 'x'.repeat(70_000) })).status, 413); // 64KB 넘는 본문
  assert.equal(s.asked.context.length, 2); // 통과한 두 번만 AI 까지 갔다
}));

test('본문 상한: /words 는 24KB, /translate-context·/lookup 은 64KB, 나머지 라우트는 16KB', withBridge(async (s) => {
  const filler = `{"text":"a b","word":"kernel","pad":"${'x'.repeat(20_000)}"}`; // 20KB: 16KB 는 넘고 24KB·64KB 는 안 넘는다
  for (const path of ['/translate', '/mt', '/dict', '/annotate', '/mydict']) assert.equal((await s.req('POST', path, { raw: filler })).status, 413, path);
  for (const path of ['/translate-context', '/lookup']) assert.equal((await s.req('POST', path, { raw: filler })).status, 200, path);
  // /words 만 24KB: 16~24KB 는 본문을 받고(모르는 op -> 400), 24KB 를 넘으면 413
  assert.equal((await s.req('POST', '/words', { raw: filler })).status, 400);
  assert.equal((await s.req('POST', '/words', { raw: 'x'.repeat(24 * 1024 + 1) })).status, 413);
  assert.equal((await s.req('POST', '/lookup', { raw: 'x'.repeat(65 * 1024) })).status, 413);
}));

test('/lookup wide: 넓은 문맥을 받고 AI 에 wide 로 묻는다, wide 가 boolean 이 아니면 400, 문맥 없이 wide 면 그냥 일반 질문', withBridge(async (s) => {
  const body = { word: 'kernel', sentence: 'The kernel is small.', context: CTX_BIG, wide: true };
  assert.equal((await s.post('/lookup', body)).status, 200);
  assert.equal(s.asked.lookup[0].wide, true);
  assert.equal(s.asked.lookup[0].context.before.length, 6000);
  assert.equal((await s.post('/lookup', { ...body, wide: false })).status, 413); // 보통 상한
  assert.equal((await s.post('/lookup', { ...body, wide: 'yes' })).status, 400);
  assert.equal((await s.post('/lookup', { word: 'kernel', sentence: 's', wide: true })).status, 200);
  assert.equal('wide' in s.asked.lookup[1], false);
}));

test('캐시 키: 같은 글·문맥도 wide 가 다르면 따로 묻고, 같은 wide 는 캐시에서', withBridge(async (s) => {
  const ctx = { before: 'the matrix', after: 'is square', title: 'T' };
  const ctxCall = (wide) => s.post('/translate-context', { text: 'transpose', context: ctx, ...(wide === undefined ? {} : { wide }) });
  assert.equal((await ctxCall()).json().cached, false);
  assert.equal((await ctxCall(false)).json().cached, true); // wide:false 는 안 보낸 것과 같다
  assert.equal((await ctxCall(true)).json().cached, false);
  assert.equal((await ctxCall(true)).json().cached, true);
  assert.equal(s.asked.context.length, 2);
  const look = (wide) => s.post('/lookup', { word: 'kernel', sentence: 'The kernel.', context: ctx, ...(wide === undefined ? {} : { wide }) });
  assert.equal((await look()).json().cached, false);
  assert.equal((await look(true)).json().cached, false);
  assert.equal((await look(true)).json().cached, true);
  assert.equal((await look(false)).json().cached, true);
  assert.equal(s.asked.lookup.length, 2);
}));
