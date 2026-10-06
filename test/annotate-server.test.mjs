import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { createDict } from '../bridge/dict.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const FAKE = new URL('../fixtures/fake-dict.mjs', import.meta.url).pathname;

async function start(dict = createDict({ bin: process.execPath, args: [FAKE], timeoutMs: 1500 })) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-ann-'));
  const asked = [];
  const bridge = createBridge({
    ask: async (a) => (asked.push(a), '{"gloss":"뜻"}'),
    askTranslate: async (t) => (asked.push(t), '{"translation":"번역"}'),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict,
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
  const post = (body, headers) => req('POST', '/annotate', { headers: { ...headers }, body });
  return { bridge, asked, req, post, auth: { 'X-Bridge-Token': token, Origin: MINE } };
}

test('/annotate: 토큰 없으면 401, 남의 Origin·잘못된 Host 는 403', async () => {
  const s = await start();
  try {
    const body = { words: ['payload'] };
    assert.equal((await s.post(body)).status, 401);
    assert.equal((await s.post(body, { ...s.auth, Origin: 'chrome-extension://evil' })).status, 403);
    assert.equal((await s.post(body, { ...s.auth, Host: 'evil.test' })).status, 403);
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 메서드·본문·level 검증은 405/400', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('GET', '/annotate', { headers: s.auth })).status, 405);
    assert.equal((await s.req('POST', '/annotate', { headers: s.auth, raw: 'not json' })).status, 400);
    for (const body of [null, {}, { words: 'payload' }, { words: {} }, { words: [1] }, { words: ['payload'], level: 'A1' }, { words: ['payload'], level: 'b2' }, { words: ['payload'], level: 7 }]) {
      assert.equal((await s.post(body, s.auth)).status, 400, JSON.stringify(body));
    }
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 단어 300개까지, 301개는 413', async () => {
  const s = await start();
  try {
    const words = Array.from({ length: 301 }, (_, i) => `word${'abcdefghij'[i % 10]}${'abcdefghij'[Math.floor(i / 10) % 10]}${'abcdefghij'[Math.floor(i / 100)]}`);
    assert.equal((await s.post({ words }, s.auth)).status, 413);
    assert.equal((await s.post({ words: words.slice(0, 300) }, s.auth)).status, 200);
    assert.equal((await s.post({ words: [] }, s.auth)).status, 200);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 어려운 단어만 {lemma, level, gloss} 로 돌려준다(AI 호출 0번, WORD_RE 에 틀린 건 조용히 제외)', async () => {
  const s = await start();
  try {
    const r = await s.post({ words: ['payload', 'mitigate', 'delve', 'include', 'not a word', '1abc', 'x'.repeat(65), 'Payload', 'deserialize'] }, s.auth);
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], MINE);
    assert.deepEqual(r.json(), {
      items: {
        payload: { lemma: 'payload', level: null, gloss: '수익 하중' },
        mitigate: { lemma: 'mitigate', level: null, gloss: '완화시키다' },
        delve: { lemma: 'delve', level: null, gloss: '손으로 더듬다' },
      },
    });
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: level 기본은 B2, 올리면 B2 단어(privilege)가 빠진다', async () => {
  const s = await start();
  try {
    const keys = async (body) => Object.keys((await s.post(body, s.auth)).json().items);
    assert.ok((await keys({ words: ['privilege'] })).includes('privilege'));
    assert.ok((await keys({ words: ['privilege'], level: 'B2' })).includes('privilege'));
    assert.ok((await keys({ words: ['privilege'], level: 'B1' })).includes('privilege'));
    assert.deepEqual(await keys({ words: ['privilege'], level: 'C1' }), []);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 도우미가 없으면 503 dict-unavailable(쉬운 단어만이면 사전이 필요 없어 200)', async () => {
  const s = await start(createDict({ bin: '/nonexistent/macdict' }));
  try {
    const r = await s.post({ words: ['payload'] }, s.auth);
    assert.equal(r.status, 503);
    assert.deepEqual(r.json(), { error: 'dict-unavailable' });
    assert.equal((await s.post({ words: ['include'] }, s.auth)).status, 200);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 도우미가 멈추면 502 dict-failed, 다음 요청은 다시 떠서 동작', async () => {
  const s = await start();
  try {
    assert.equal((await s.post({ words: ['hang'], level: 'B1' }, s.auth)).status, 502); // hang 은 B1 단어라 사전이 필요한 등급으로 묻는다(timeoutMs 1500)
    assert.equal((await s.post({ words: ['payload'] }, s.auth)).status, 200);
  } finally {
    await s.bridge.close();
  }
});
