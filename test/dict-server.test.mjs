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

async function start(dict = createDict({ bin: process.execPath, args: [FAKE], timeoutMs: 300 })) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-dict-'));
  const asked = [];
  const bridge = createBridge({
    ask: async (a) => (asked.push(a), '{"gloss":"뜻"}'),
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
  return { bridge, asked, req, auth: { 'X-Bridge-Token': token } };
}

test('/dict: 토큰 없으면 401, 남의 Origin 은 403, 잘못된 Host 는 403', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('POST', '/dict', { body: { word: 'exploit' } })).status, 401);
    assert.equal((await s.req('POST', '/dict', { headers: { ...s.auth, Origin: 'chrome-extension://evil' }, body: { word: 'exploit' } })).status, 403);
    assert.equal((await s.req('POST', '/dict', { headers: { ...s.auth, Host: 'evil.test' }, body: { word: 'exploit' } })).status, 403);
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 검증(메서드·본문·단어) 실패는 405/400', async () => {
  const s = await start();
  try {
    const h = { ...s.auth, Origin: MINE };
    assert.equal((await s.req('GET', '/dict', { headers: h })).status, 405);
    assert.equal((await s.req('POST', '/dict', { headers: h, raw: 'not json' })).status, 400);
    for (const word of ['', 'a b', '1abc', 'x'.repeat(65), 42, null, undefined]) {
      assert.equal((await s.req('POST', '/dict', { headers: h, body: { word } })).status, 400, String(word));
    }
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 같은 철자 표제어 여럿을 구조로 돌려준다(AI 호출 0번)', async () => {
  const s = await start();
  try {
    const r = await s.req('POST', '/dict', { headers: { ...s.auth, Origin: MINE }, body: { word: 'exploit' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], MINE);
    const j = r.json();
    assert.equal(j.found, true);
    assert.deepEqual(j.entries.map((e) => e.homograph), [1, 2]);
    assert.equal(j.entries[1].senses[0].num, 1);
    assert.match(j.entries[1].raw, /이용\[활용\]/);
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 사전에 없으면 found:false', async () => {
  const s = await start();
  try {
    const r = await s.req('POST', '/dict', { headers: s.auth, body: { word: 'deserialize' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { found: false, lemma: 'deserialize' });
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 도우미가 없으면 503 dict-unavailable, 다른 라우트는 그대로 동작', async () => {
  const s = await start(createDict({ bin: '/nonexistent/macdict' }));
  try {
    const r = await s.req('POST', '/dict', { headers: s.auth, body: { word: 'exploit' } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.json(), { error: 'dict-unavailable' });
    assert.equal((await s.req('GET', '/ping', { headers: s.auth })).status, 200);
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 도우미가 죽거나 멈추면 502, 다음 요청에서 다시 떠서 동작', async () => {
  const s = await start();
  try {
    const post = (word) => s.req('POST', '/dict', { headers: s.auth, body: { word } });
    const died = await post('die');
    assert.equal(died.status, 502);
    assert.deepEqual(died.json(), { error: 'dict-failed' });
    assert.equal((await post('exploit')).status, 200);
    assert.equal((await post('hang')).status, 502); // timeoutMs 300
    const again = await post('exploit');
    assert.equal(again.status, 200);
    assert.equal(again.json().entries.length, 2);
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 동시 요청도 한 줄씩 직렬로 맞는 답을 받는다', async () => {
  const s = await start();
  try {
    const words = ['exploit', 'mitigate', 'delve', 'payload', 'privilege', 'deserialize'];
    const rs = await Promise.all(words.map((word) => s.req('POST', '/dict', { headers: s.auth, body: { word } })));
    assert.deepEqual(
      rs.map((r) => r.json().entries?.[0]?.headword ?? null),
      ['exploit', 'mitigate', 'delve', 'páylòad', 'privilege', null],
    );
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 용어집에 없으면 활성 분야 표시 뜻을 sense:{ko, tag} 로 덧붙인다. 힌트가 없거나 용어가 있으면 안 붙인다', async () => {
  const s = await start();
  try {
    const post = (word, domains) => s.req('POST', '/dict', { headers: s.auth, body: { word, ...(domains ? { domains } : {}) } }).then((r) => r.json());
    const a = await post('algorithm', ['math']);
    assert.deepEqual(a.sense, { ko: '알고리듬', tag: '수학' });
    assert.equal(a.term, undefined);
    assert.equal((await post('average', ['math', 'security'])).sense, undefined, 'average 는 A2 낱말이라 첫 뜻(평균)을 쓴다');
    assert.equal((await post('iterative', ['math'])).sense, undefined, '〈…이〉 쓰임 제한이 붙은 표시 뜻은 안 쓴다');
    assert.deepEqual((await post('algorithm', ['security', 'math'])).sense, { ko: '알고리듬', tag: '컴퓨터' });
    assert.equal((await post('algorithm')).sense, undefined, '힌트 없음');
    const t = await post('subtraction', ['math']); // 용어집에 있다
    assert.deepEqual(t.term, { ko: '뺄셈', domain: 'math' });
    assert.equal(t.sense, undefined);
    assert.equal((await post('exploit', ['math'])).sense, undefined);
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});
