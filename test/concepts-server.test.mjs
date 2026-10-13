import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';

async function startServer(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-concepts-'));
  const learningDir = join(dir, 'learning');
  const bridge = createBridge({
    ask: async () => '',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    learningDir,
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

test('토큰 없으면 401', async () => {
  const s = await startServer();
  try {
    // 토큰 없이 GET
    const r1 = await s.req('GET', '/concepts');
    assert.equal(r1.status, 401);

    // 토큰 없이 GET ?names=1
    const r2 = await s.req('GET', '/concepts?names=1');
    assert.equal(r2.status, 401);

    // 토큰 없이 POST
    const r3 = await s.req('POST', '/concepts', {
      body: { op: 'save', name: 'Test', definition: 'Def' },
    });
    assert.equal(r3.status, 401);

    // 잘못된 토큰
    const r4 = await s.req('GET', '/concepts', {
      headers: { 'X-Bridge-Token': 'wrong-token' },
    });
    assert.equal(r4.status, 401);
  } finally {
    await s.bridge.close();
  }
});

test('409 응답 모양 {error:\'exists\', id}', async () => {
  const s = await startServer();
  try {
    // 1. 처음 생성
    const r1 = await s.req('POST', '/concepts', {
      headers: s.auth,
      body: {
        op: 'save',
        name: 'Access Control',
        aliases: ['AC'],
        definition: '자원 접근 제어',
      },
    });
    assert.equal(r1.status, 200);
    const createdId = r1.json().concept.id;
    assert.ok(createdId);

    // 2. 같은 이름(대소문자·공백 차이)으로 중복 생성 시 409
    const r2 = await s.req('POST', '/concepts', {
      headers: s.auth,
      body: {
        op: 'save',
        name: '  access    control  ',
        definition: '중복 정의 시도',
      },
    });
    assert.equal(r2.status, 409);
    assert.deepEqual(r2.json(), { error: 'exists', id: createdId });
  } finally {
    await s.bridge.close();
  }
});

test('remove 없는 id 404', async () => {
  const s = await startServer();
  try {
    const r = await s.req('POST', '/concepts', {
      headers: s.auth,
      body: { op: 'remove', id: 'c_000000000000' },
    });
    assert.equal(r.status, 404);
    assert.deepEqual(r.json(), { error: 'not-found' });
  } finally {
    await s.bridge.close();
  }
});

test('GET ?names=1 모양', async () => {
  const s = await startServer();
  try {
    // 개념 2개 추가
    await s.req('POST', '/concepts', {
      headers: s.auth,
      body: { op: 'save', name: 'SQL Injection', aliases: ['SQLi'], definition: 'SQL 주입 공격' },
    });
    await s.req('POST', '/concepts', {
      headers: s.auth,
      body: { op: 'save', name: 'Cross-Site Scripting', aliases: ['XSS'], definition: '스크립트 삽입' },
    });

    const res = await s.req('GET', '/concepts?names=1', { headers: s.auth });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.terms));

    // terms 항목 모양: { id, term }
    for (const t of body.terms) {
      assert.ok(typeof t.id === 'string');
      assert.ok(typeof t.term === 'string');
    }

    // 긴 것 먼저 정렬 확인
    const terms = body.terms.map((t) => t.term);
    assert.equal(terms[0], 'Cross-Site Scripting');
    assert.ok(terms.includes('SQL Injection'));
    assert.ok(terms.includes('SQLi'));
    assert.ok(terms.includes('XSS'));
  } finally {
    await s.bridge.close();
  }
});

test('GET /concepts 모양', async () => {
  const s = await startServer();
  try {
    await s.req('POST', '/concepts', {
      headers: s.auth,
      body: { op: 'save', name: 'Privilege Escalation', aliases: ['PE'], definition: '권한 상승 공격' },
    });

    const res = await s.req('GET', '/concepts', { headers: s.auth });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.concepts));
    assert.equal(body.concepts.length, 1);

    const c = body.concepts[0];
    assert.equal(c.name, 'Privilege Escalation');
    assert.deepEqual(c.aliases, ['PE']);
    assert.equal(c.definition, '권한 상승 공격');
    assert.ok(Array.isArray(c.related));
    assert.ok(Array.isArray(c.appears));
  } finally {
    await s.bridge.close();
  }
});

test('db가 없을 때는 503', async () => {
  // db 를 못 여는 상황: dbFile 이 보통 파일 아래 경로라 열 수 없다 → JSON 모드로 돈다
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-nodb-'));
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
    const resGet = await req('GET', '/concepts');
    assert.equal(resGet.status, 503);
    assert.deepEqual(resGet.json(), { error: 'no-db' });

    const resPost = await req('POST', '/concepts', { op: 'save', name: 'Test', definition: 'Def' });
    assert.equal(resPost.status, 503);
    assert.deepEqual(resPost.json(), { error: 'no-db' });
  } finally {
    await bridge.close();
  }
});
