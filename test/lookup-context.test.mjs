import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { buildPrompt, createLookup } from '../bridge/lookup.mjs';
import { createCache } from '../bridge/cache.mjs';

// 이 파일의 테스트는 진짜 claude 를 부르지 않는다.
const CTX = { before: 'Matrices can be combined.', after: 'The result is a new matrix.', title: 'Matrix basics', headings: ['Linear algebra'] };

test('buildPrompt: 문맥이 없으면 예전과 바이트까지 같고, 있으면 입력 JSON 에 context 가 실린다', () => {
  const old = buildPrompt({ word: 'multiplication', sentence: 'Matrix multiplication is fun.' });
  assert.equal(buildPrompt({ word: 'multiplication', sentence: 'Matrix multiplication is fun.', context: undefined }), old);
  assert.equal(buildPrompt({ word: 'multiplication', sentence: 'Matrix multiplication is fun.', context: null }), old);
  const p = buildPrompt({ word: 'multiplication', sentence: 'Matrix multiplication is fun.', context: CTX });
  assert.match(p, /\{"gloss": "\.\.\."\}/);
  assert.match(p, /앞뒤 문맥/);
  assert.deepEqual(JSON.parse(p.slice(p.lastIndexOf('\n') + 1)), { word: 'multiplication', sentence: 'Matrix multiplication is fun.', context: CTX });
});

test('createLookup: 문맥이 다르면 캐시 키가 갈리고, 문맥 없는 키는 예전 그대로(소문자 단어)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-lk-'));
  const cache = createCache(join(dir, 'c.json'));
  let n = 0;
  const asked = [];
  const lookup = createLookup({ cache, ask: async (a) => (asked.push(a), `{"gloss":"뜻${++n}"}`) });
  assert.deepEqual(await lookup({ word: 'Multiplication', sentence: 's' }), { gloss: '뜻1', cached: false });
  assert.equal(cache.get('multiplication'), '뜻1', '문맥 없는 키는 그대로');
  assert.deepEqual(await lookup({ word: 'multiplication', sentence: 'other sentence' }), { gloss: '뜻1', cached: true });
  assert.deepEqual(await lookup({ word: 'multiplication', sentence: 's', context: CTX }), { gloss: '뜻2', cached: false });
  assert.deepEqual(await lookup({ word: 'multiplication', sentence: 's', context: CTX }), { gloss: '뜻2', cached: true });
  assert.deepEqual(await lookup({ word: 'multiplication', sentence: 's', context: { ...CTX, title: 'Other' } }), { gloss: '뜻3', cached: false });
  assert.deepEqual(await lookup({ word: 'increase', sentence: 's', context: CTX }), { gloss: '뜻4', cached: false });
  assert.deepEqual(asked[0], { word: 'Multiplication', sentence: 's' });
  assert.equal('context' in asked[0], false, '문맥이 없을 때 context 키가 붙지 않는다');
  assert.deepEqual(asked[1].context, CTX);
});

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';
async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-lks-'));
  const calls = [];
  const bridge = createBridge({ ask: async (a) => (calls.push(a), '{"gloss":"곱셈"}'), cacheFile: join(dir, 'cache.json'), tokenFile: join(dir, 'token'), extensionId: EXT });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const post = (body, raw) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/lookup', headers: { Host: HOST, 'X-Bridge-Token': token } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(t) }));
      });
      r.on('error', reject);
      r.end(raw ?? JSON.stringify(body));
    });
  return { bridge, calls, post };
}

test('/lookup: context 가 AI 에 전달되고, 문맥 없는 요청은 예전과 같다', async () => {
  const s = await start();
  try {
    const a = await s.post({ word: 'multiplication', sentence: 'Matrix multiplication is fun.', context: CTX });
    assert.deepEqual(a.json(), { gloss: '곱셈', cached: false });
    assert.deepEqual(s.calls[0], { word: 'multiplication', sentence: 'Matrix multiplication is fun.', context: CTX });
    await s.post({ word: 'multiplication', sentence: 'x' });
    assert.deepEqual(s.calls[1], { word: 'multiplication', sentence: 'x' });
    assert.deepEqual((await s.post({ word: 'multiplication', sentence: 'x', context: {} })).json(), { gloss: '곱셈', cached: true }, '빈 context 는 문맥 없음');
  } finally {
    await s.bridge.close();
  }
});

test('/lookup: context 모양 오류 400, 상한 초과 413(AI 0번)', async () => {
  const s = await start();
  try {
    const w = { word: 'multiplication', sentence: 'x' };
    assert.equal((await s.post({ ...w, context: 'x' })).status, 400);
    assert.equal((await s.post({ ...w, context: { before: 5 } })).status, 400);
    assert.equal((await s.post({ ...w, context: { before: 'a'.repeat(1501) } })).status, 413);
    assert.equal((await s.post({ ...w, context: { headings: Array(6).fill('h') } })).status, 413);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.bridge.close();
  }
});
