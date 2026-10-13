import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';

async function startServer(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-memos-'));
  const bridge = createBridge({
    ask: async () => '',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    studyFile: join(dir, 'study-log.jsonl'),
    extensionId: EXT,
    ...options,
  });

  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');

  const req = (method, path, { headers = {}, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }));
        },
      );
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });

  return { bridge, dir, port, token, req, auth: { 'X-Bridge-Token': token } };
}

test('토큰 없으면 401, 잘못된 토큰 401', async () => {
  const s = await startServer();
  try {
    const r1 = await s.req('GET', '/memos');
    assert.equal(r1.status, 401);

    const r2 = await s.req('GET', '/memos?url=https://example.com');
    assert.equal(r2.status, 401);

    const r3 = await s.req('POST', '/memos', {
      body: { op: 'save', text: '메모', url: 'https://example.com' },
    });
    assert.equal(r3.status, 401);

    const r4 = await s.req('GET', '/memos', {
      headers: { 'X-Bridge-Token': 'wrong-token' },
    });
    assert.equal(r4.status, 401);
  } finally {
    await s.bridge.close();
  }
});

test('db가 없을 때(JSON 모드)는 503 {error: "no-db"}', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-memos-nodb-'));
  writeFileSync(join(dir, 'not-a-dir'), 'x');

  const bridge = createBridge({
    ask: async () => '',
    cacheFile: join(dir, 'cache.json'),
    dbFile: join(dir, 'not-a-dir', 'readgloss.db'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
  });

  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, body) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, 'X-Bridge-Token': token } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(t) }));
        },
      );
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });

  try {
    const resGet = await req('GET', '/memos');
    assert.equal(resGet.status, 503);
    assert.deepEqual(resGet.json(), { error: 'no-db' });

    const resPost = await req('POST', '/memos', { op: 'save', text: '테스트', url: 'https://example.com' });
    assert.equal(resPost.status, 503);
    assert.deepEqual(resPost.json(), { error: 'no-db' });
  } finally {
    await bridge.close();
  }
});

test('POST /memos save -> {memo} 및 study-log에 kind: "memo" 한 줄 기록', async () => {
  const s = await startServer();
  try {
    const res = await s.req('POST', '/memos', {
      headers: s.auth,
      body: {
        op: 'save',
        text: '첫 메모',
        url: 'https://portswigger.net/web-security/access-control',
        title: 'Access Control',
        headings: ['Heading 1'],
        para: { exact: 'para text', prefix: '', suffix: '' },
        pos: 100,
        selection: '선택 글',
        task: 'S1-04',
      },
    });

    assert.equal(res.status, 200);
    const body = res.json();
    assert.ok(body.memo);
    assert.ok(body.memo.id.startsWith('m_'));
    assert.equal(body.memo.text, '첫 메모');
    assert.equal(body.memo.url, 'https://portswigger.net/web-security/access-control');
    assert.equal(body.memo.task, 'S1-04');

    // study-log.jsonl 에 기록 확인
    const studyLogPath = join(s.dir, 'study-log.jsonl');
    const logContent = readFileSync(studyLogPath, 'utf8');
    const lines = logContent.trim().split('\n').map((l) => JSON.parse(l));
    const memoLog = lines.find((l) => l.kind === 'memo');
    assert.ok(memoLog);
    assert.equal(memoLog.text, '첫 메모');
    assert.equal(memoLog.url, 'https://portswigger.net/web-security/access-control');
  } finally {
    await s.bridge.close();
  }
});

test('GET /memos (최근 것 먼저) 및 GET /memos?url= (해당 페이지 메모만)', async () => {
  const s = await startServer();
  try {
    // 1. page1 첫 메모
    const r1 = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'save', text: 'page1 - 1', url: 'https://example.com/p1' },
    });
    assert.equal(r1.status, 200);
    const id1 = r1.json().memo.id;

    // 약간의 시간 차를 위해 딜레이
    await new Promise((r) => setTimeout(r, 10));

    // 2. page2 메모
    const r2 = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'save', text: 'page2', url: 'https://example.com/p2' },
    });
    assert.equal(r2.status, 200);
    const id2 = r2.json().memo.id;

    await new Promise((r) => setTimeout(r, 10));

    // 3. page1 둘째 메모
    const r3 = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'save', text: 'page1 - 2', url: 'https://example.com/p1' },
    });
    assert.equal(r3.status, 200);
    const id3 = r3.json().memo.id;

    // 전체 GET
    const listRes = await s.req('GET', '/memos', { headers: s.auth });
    assert.equal(listRes.status, 200);
    const listBody = listRes.json();
    assert.ok(Array.isArray(listBody.memos));
    assert.equal(listBody.memos.length, 3);
    // 최근 것 먼저 (id3, id2, id1)
    assert.deepEqual(listBody.memos.map((m) => m.id), [id3, id2, id1]);

    // ?url=page1
    const p1Res = await s.req('GET', '/memos?url=https://example.com/p1', { headers: s.auth });
    assert.equal(p1Res.status, 200);
    const p1Body = p1Res.json();
    assert.equal(p1Body.memos.length, 2);
    assert.deepEqual(p1Body.memos.map((m) => m.id), [id3, id1]);

    // ?url=page2
    const p2Res = await s.req('GET', '/memos?url=https://example.com/p2', { headers: s.auth });
    assert.equal(p2Res.status, 200);
    const p2Body = p2Res.json();
    assert.equal(p2Body.memos.length, 1);
    assert.deepEqual(p2Body.memos.map((m) => m.id), [id2]);
  } finally {
    await s.bridge.close();
  }
});

test('POST /memos edit -> {memo} 및 remove -> {ok: true}, 없는 id 404', async () => {
  const s = await startServer();
  try {
    const saveRes = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'save', text: '원문', url: 'https://example.com/item' },
    });
    const memoId = saveRes.json().memo.id;
    const origTs = saveRes.json().memo.ts;

    // 1. edit
    const editRes = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'edit', id: memoId, text: '수정문' },
    });
    assert.equal(editRes.status, 200);
    const editBody = editRes.json();
    assert.equal(editBody.memo.id, memoId);
    assert.equal(editBody.memo.text, '수정문');
    assert.equal(editBody.memo.ts, origTs);

    // 2. 없는 id edit -> 404
    const editNotFound = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'edit', id: 'm_000000000000', text: '수정' },
    });
    assert.equal(editNotFound.status, 404);
    assert.deepEqual(editNotFound.json(), { error: 'not-found' });

    // 3. remove
    const removeRes = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'remove', id: memoId },
    });
    assert.equal(removeRes.status, 200);
    assert.deepEqual(removeRes.json(), { ok: true });

    // 4. 삭제 후 목록 확인
    const listRes = await s.req('GET', '/memos', { headers: s.auth });
    assert.equal(listRes.json().memos.length, 0);

    // 5. 없는 id remove -> 404
    const removeNotFound = await s.req('POST', '/memos', {
      headers: s.auth,
      body: { op: 'remove', id: memoId },
    });
    assert.equal(removeNotFound.status, 404);
    assert.deepEqual(removeNotFound.json(), { error: 'not-found' });
  } finally {
    await s.bridge.close();
  }
});
