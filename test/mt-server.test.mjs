import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { createMt } from '../bridge/mt.mjs';

// 이 파일의 테스트는 진짜 claude·진짜 맥 번역을 부르지 않는다.
const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const FAKE = new URL('../fixtures/fake-mt.mjs', import.meta.url).pathname;

async function start(mt = createMt({ bin: process.execPath, args: [FAKE], timeoutMs: 300, firstTimeoutMs: 5000 })) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-mt-'));
  const asked = [];
  const bridge = createBridge({
    ask: async (a) => (asked.push(a), '{"gloss":"뜻"}'),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    mt,
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, { headers = {}, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }));
      });
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });
  const post = (body, headers = { 'X-Bridge-Token': token, Origin: MINE }) => req('POST', '/mt', { headers, body });
  return { bridge, asked, req, post, auth: { 'X-Bridge-Token': token, Origin: MINE } };
}

test('/mt: 토큰 없으면 401, 남의 Origin 은 403, 잘못된 Host 는 403, GET 은 405', async () => {
  const s = await start();
  try {
    assert.equal((await s.post({ text: 'hello world' }, {})).status, 401);
    assert.equal((await s.post({ text: 'hello world' }, { ...s.auth, Origin: 'chrome-extension://evil' })).status, 403);
    assert.equal((await s.req('POST', '/mt', { headers: { ...s.auth, Host: 'evil.test' }, body: { text: 'hello world' } })).status, 403);
    assert.equal((await s.req('GET', '/mt', { headers: s.auth })).status, 405);
  } finally {
    await s.bridge.close();
  }
});

test('/mt: 번역을 돌려주고 engine 은 apple, AI 는 안 부른다(CORS 포함)', async () => {
  const s = await start();
  try {
    const r = await s.post({ text: '  matrix \n multiplication ' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], MINE);
    assert.deepEqual(r.json(), { translation: '번역1:matrix multiplication', engine: 'apple' }); // 공백은 한 칸으로 정리해 보낸다
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('/mt: 본문 검증 400, 1000자까지 통과 1001자는 413', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('POST', '/mt', { headers: s.auth, raw: 'not json' })).status, 400);
    for (const text of ['', '   ', 5, null, undefined, ['a']]) assert.equal((await s.post({ text })).status, 400, String(text));
    assert.equal((await s.post({ text: 'a'.repeat(1000) })).status, 200);
    assert.equal((await s.post({ text: `${'a'.repeat(1000)}b` })).status, 413);
    assert.equal((await s.post({ text: 'a '.repeat(500) })).status, 200, '정규화 뒤 길이로 잰다(끝 공백 제거)');
    assert.equal((await s.post({ text: 'a '.repeat(600) })).status, 413);
    assert.equal((await s.req('POST', '/mt', { headers: s.auth, raw: 'x'.repeat(100_000) })).status, 413);
  } finally {
    await s.bridge.close();
  }
});

test('/mt: domains 힌트가 있고 구가 구 용어집과 같으면 term, 힌트가 없거나 다르면 term 없음', async () => {
  const s = await start();
  try {
    const hit = (await s.post({ text: 'Dot Product', domains: ['math'] })).json();
    assert.deepEqual(hit.term, { ko: '내적', domain: 'math' });
    assert.equal(hit.engine, 'apple');
    assert.equal('term' in (await s.post({ text: 'dot product' })).json(), false);
    assert.equal('term' in (await s.post({ text: 'dot product', domains: ['ml'] })).json(), false);
    assert.equal('term' in (await s.post({ text: 'dot product of vectors', domains: ['math'] })).json(), false);
    assert.equal('term' in (await s.post({ text: 'dot product', domains: ['math', 'nope', 5] })).json(), true);
  } finally {
    await s.bridge.close();
  }
});

test('/mt: 도우미 없음·언어팩 없음 503 mt-unavailable, 실패·멈춤 502 mt-failed, 다음 요청에서 회복', async () => {
  const none = await start(createMt({ bin: '/nonexistent/mt' }));
  try {
    const r = await none.post({ text: 'hello world' });
    assert.equal(r.status, 503);
    assert.deepEqual(r.json(), { error: 'mt-unavailable' });
    assert.equal((await none.req('GET', '/ping', { headers: none.auth })).status, 200);
  } finally {
    await none.bridge.close();
  }
  const s = await start();
  try {
    assert.equal((await s.post({ text: 'NOT-INSTALLED x' })).status, 503);
    const bad = await s.post({ text: 'FAIL x' });
    assert.equal(bad.status, 502);
    assert.deepEqual(bad.json(), { error: 'mt-failed' });
    assert.equal((await s.post({ text: 'DIE x' })).status, 502);
    assert.equal((await s.post({ text: 'warm up' })).status, 200); // 새로 뜬 도우미의 첫 호출(시간을 넉넉히 준다)
    assert.equal((await s.post({ text: 'HANG x' })).status, 502); // 이후 호출은 300ms 제한
    assert.equal((await s.post({ text: 'fine again' })).status, 200);
  } finally {
    await s.bridge.close();
  }
});
