import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rememberedTask, guessTask, COMMON_HOSTS } from '../bridge/task-guess.mjs';
import { createBridge } from '../bridge/server.mjs';

// ---------------------------------------------------------------------------
// 1. rememberedTask 단위 시험
// ---------------------------------------------------------------------------

test('rememberedTask: ① 정규화 주소가 같은 기록 중 가장 최근(ts 큰) task', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726';
  const records = [
    // 오래된 기록
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: 'S1-01', ts: 1000 },
    // 가장 최근 기록
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: 'S1-02', ts: 3000 },
    // 중간 기록
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: 'S1-03', ts: 2000 },
  ];
  assert.equal(rememberedTask(target, records), 'S1-02');
});

test('rememberedTask: ① 주소 정규화(#, query utm, 끝 /) 후 일치하면 동일 페이지로 처리', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726/#heading-1';
  const records = [
    { url: 'https://academy.hackthebox.com/module/77/section/726?utm_source=slack/', task: 'S1-04', ts: 100 },
  ];
  assert.equal(rememberedTask(target, records), 'S1-04');
});

test('rememberedTask: ② 경로 앞 조각이 2개 이상 같은 기록 중 겹친 조각 수가 가장 많은 것', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726';
  const records = [
    // 겹친 조각 1개: /module (2개 미만이므로 제외)
    { url: 'https://academy.hackthebox.com/module/88/section/100', task: 'S1-08', ts: 5000 },
    // 겹친 조각 2개: /module/77
    { url: 'https://academy.hackthebox.com/module/77/summary', task: 'S1-09', ts: 4000 },
    // 겹친 조각 3개: /module/77/section
    { url: 'https://academy.hackthebox.com/module/77/section/725', task: 'S1-10', ts: 3000 },
  ];
  // 조각 수 3개 일치한 S1-10 선택
  assert.equal(rememberedTask(target, records), 'S1-10');
});

test('rememberedTask: ② 겹친 조각 수가 같으면 가장 최근(ts 큰) task', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726';
  const records = [
    // 겹친 조각 3개, ts 100
    { url: 'https://academy.hackthebox.com/module/77/section/724', task: 'S1-01', ts: 100 },
    // 겹친 조각 3개, ts 300
    { url: 'https://academy.hackthebox.com/module/77/section/725', task: 'S1-02', ts: 300 },
    // 겹친 조각 3개, ts 200
    { url: 'https://academy.hackthebox.com/module/77/section/723', task: 'S1-03', ts: 200 },
  ];
  assert.equal(rememberedTask(target, records), 'S1-02');
});

test('rememberedTask: ①이 ②보다 우선 (②의 ts가 더 커도 ① 선택)', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726';
  const records = [
    // ① 정확 일치, 작은 ts
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: 'S1-01', ts: 100 },
    // ② 3개 일치, 훨씬 큰 ts
    { url: 'https://academy.hackthebox.com/module/77/section/725', task: 'S1-02', ts: 9999 },
  ];
  assert.equal(rememberedTask(target, records), 'S1-01');
});

test('rememberedTask: host가 COMMON_HOSTS면 ②는 쓰지 않는다', () => {
  assert.ok(COMMON_HOSTS.has('github.com'));
  const target = 'https://github.com/facebook/react/issues/100';
  const records = [
    // github.com 이지만 조각 3개 같음
    { url: 'https://github.com/facebook/react/issues/99', task: 'S1-05', ts: 1000 },
  ];
  // COMMON_HOSTS 이므로 ②는 적용하지 않아 null 반환
  assert.equal(rememberedTask(target, records), null);

  // 단, 정규화 주소가 완전히 같은 ①은 COMMON_HOSTS여도 동작
  const exactRecords = [
    { url: 'https://github.com/facebook/react/issues/100', task: 'S1-05', ts: 1000 },
  ];
  assert.equal(rememberedTask(target, exactRecords), 'S1-05');
});

test('rememberedTask: task는 TASK_RE를 만족해야 한다 (불만족 시 거름)', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726';
  const records = [
    // TASK_RE 형식 위반 (공백, 한글, 특수문자 등)
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: '잘못된 할일', ts: 9000 },
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: 'invalid task @@', ts: 8000 },
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: '', ts: 7000 },
    // 유효한 task
    { url: 'https://academy.hackthebox.com/module/77/section/726', task: 'S1-07', ts: 1000 },
  ];
  assert.equal(rememberedTask(target, records), 'S1-07');
});

test('rememberedTask: 일치하는 기록이 없으면 null', () => {
  const target = 'https://academy.hackthebox.com/module/77/section/726';
  // 빈 기록
  assert.equal(rememberedTask(target, []), null);
  // 다른 호스트
  assert.equal(
    rememberedTask(target, [{ url: 'https://other-site.com/module/77/section/726', task: 'S1-01', ts: 100 }]),
    null,
  );
  // 같은 호스트이나 겹친 조각이 1개뿐
  assert.equal(
    rememberedTask(target, [{ url: 'https://academy.hackthebox.com/dashboard', task: 'S1-01', ts: 100 }]),
    null,
  );
  // 잘못된 target url
  assert.equal(rememberedTask('not-a-url', [{ url: target, task: 'S1-01', ts: 100 }]), null);
});

// ---------------------------------------------------------------------------
// 2. guessTask remembered 인자 시험
// ---------------------------------------------------------------------------

test('guessTask: remembered가 있으면 최우선 반환 (task: remembered, ask: false)', () => {
  const nodes = [
    {
      id: 'S1-04',
      card_title: '웹 보안: 접근 통제',
      urls: ['https://portswigger.net/web-security/access-control'],
    },
  ];
  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-03',
    lastToday: 'S1-04',
    remembered: 'S1-99',
  });
  // remembered 가 최우선
  assert.equal(r.task, 'S1-99');
  assert.equal(r.ask, false);
  // candidates, matches 는 기존처럼 계산된 값 그대로 유지
  assert.deepEqual(r.matches, ['S1-04']);
  assert.ok(r.candidates.some((c) => c.id === 'S1-04'));
});

test('guessTask: remembered가 없거나 null이면 기존 규칙 그대로 동작', () => {
  const nodes = [
    {
      id: 'S1-04',
      card_title: '웹 보안: 접근 통제',
      urls: ['https://portswigger.net/web-security/access-control'],
    },
  ];
  // 1) remembered: null
  const r1 = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-03',
    lastToday: null,
    remembered: null,
  });
  assert.equal(r1.task, 'S1-04');
  assert.equal(r1.ask, false);

  // 2) remembered 인자 생략 (기본 null)
  const r2 = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-03',
    lastToday: null,
  });
  assert.deepEqual(r1, r2);

  // 3) 커리큘럼 밖 페이지 ask: true
  const r3 = guessTask({
    url: 'https://developer.mozilla.org/en-US/docs/Web',
    nodes,
    next: 'S1-03',
    lastToday: 'S1-04',
  });
  assert.equal(r3.task, 'S1-04');
  assert.equal(r3.ask, true);
});

// ---------------------------------------------------------------------------
// 3. server.mjs op:'guess' 통합 시험 (스크랩·메모·개념의 기억)
// ---------------------------------------------------------------------------

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-t35-'));
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    learningDir: join(dir, 'learning'),
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) }));
        },
      );
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });
  return { bridge, dir, req, auth: { 'X-Bridge-Token': token } };
}

test('server.mjs: 스크랩에 저장된 task를 다음 섹션 페이지 guess에서 기억한다', async () => {
  const s = await startServer();
  try {
    // 1. HTB 섹션 725 페이지에 task 'S1-20' 으로 스크랩 저장
    const saveRes = await s.req('POST', '/scraps', {
      headers: s.auth,
      body: {
        op: 'save',
        url: 'https://academy.hackthebox.com/module/77/section/725',
        task: 'S1-20',
        title: 'HTB Section 725',
        quote: { exact: 'Important sentence' },
      },
    });
    assert.equal(saveRes.status, 200);

    // 2. 같은 모듈의 다음 섹션 726 페이지에 대해 op:'guess' 호출
    const guessRes = await s.req('POST', '/scraps', {
      headers: s.auth,
      body: {
        op: 'guess',
        url: 'https://academy.hackthebox.com/module/77/section/726',
      },
    });
    assert.equal(guessRes.status, 200);
    const data = guessRes.json();
    // 스크랩의 이전 섹션 기록(경로 조각 3개 일치)에 의해 S1-20 이 기억되어야 함
    assert.equal(data.task, 'S1-20');
    assert.equal(data.ask, false);
  } finally {
    await s.bridge.close();
  }
});

test('server.mjs: 메모에 저장된 task도 guess에서 기억한다', async () => {
  const s = await startServer();
  try {
    // 메모에 task 'S1-21' 저장
    const memoRes = await s.req('POST', '/memos', {
      headers: s.auth,
      body: {
        op: 'save',
        url: 'https://academy.hackthebox.com/module/80/section/801',
        text: '모듈 80 메모',
        task: 'S1-21',
      },
    });
    assert.equal(memoRes.status, 200);

    // 같은 모듈 섹션 802 guess
    const guessRes = await s.req('POST', '/scraps', {
      headers: s.auth,
      body: {
        op: 'guess',
        url: 'https://academy.hackthebox.com/module/80/section/802',
      },
    });
    assert.equal(guessRes.status, 200);
    const data = guessRes.json();
    assert.equal(data.task, 'S1-21');
    assert.equal(data.ask, false);
  } finally {
    await s.bridge.close();
  }
});

test('server.mjs: 개념(seen / firstTask)에 저장된 task도 guess에서 기억한다', async () => {
  const s = await startServer();
  try {
    // 개념 저장 (나중에 볼 것 / seen.url 과 task)
    const conceptRes = await s.req('POST', '/concepts', {
      headers: s.auth,
      body: {
        op: 'save',
        name: 'test-concept',
        definition: '',
        task: 'S1-22',
        seen: {
          url: 'https://academy.hackthebox.com/module/90/section/901',
          title: 'Section 901',
          sentence: 'Concept context sentence',
        },
      },
    });
    assert.equal(conceptRes.status, 200);

    // 같은 모듈 섹션 902 guess
    const guessRes = await s.req('POST', '/scraps', {
      headers: s.auth,
      body: {
        op: 'guess',
        url: 'https://academy.hackthebox.com/module/90/section/902',
      },
    });
    assert.equal(guessRes.status, 200);
    const data = guessRes.json();
    assert.equal(data.task, 'S1-22');
    assert.equal(data.ask, false);
  } finally {
    await s.bridge.close();
  }
});
