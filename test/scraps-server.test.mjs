import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const FIXTURES_DIR = join(new URL('..', import.meta.url).pathname, 'fixtures', 'learning');

async function start({ learningDir = FIXTURES_DIR } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-scraps-srv-'));
  const bridge = createBridge({
    ask: async () => '{}',
    askTranslate: async () => '{}',
    askContext: async () => '{}',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    learningDir,
    extensionId: EXT,
    dict: { lookup: async () => ({ found: false }), close: () => {} },
    mt: { translate: async () => '', close: () => {} },
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
  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  return {
    bridge,
    dir,
    req,
    auth,
    scraps: (body) => req('POST', '/scraps', { headers: auth, body }),
  };
}

test('/scraps: 토큰 없으면 401, 남의 Origin·잘못된 Host 는 403, 메서드는 GET·POST 만', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('GET', '/scraps')).status, 401);
    assert.equal((await s.req('POST', '/scraps', { body: { op: 'save' } })).status, 401);
    assert.equal((await s.req('GET', '/scraps', { headers: { ...s.auth, Origin: 'chrome-extension://evil' } })).status, 403);
    assert.equal((await s.req('POST', '/scraps', { headers: { ...s.auth, Host: 'evil.test' }, body: { op: 'save' } })).status, 403);
    assert.equal((await s.req('DELETE', '/scraps', { headers: s.auth })).status, 405);
    assert.equal((await s.req('PUT', '/scraps', { headers: s.auth, body: {} })).status, 405);
    assert.equal(existsSync(join(s.dir, 'scraps.json')), false);
  } finally {
    await s.bridge.close();
  }
});

test('/scraps: 깨진 본문·유효하지 않은 guess·상한 초과는 400', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('POST', '/scraps', { headers: s.auth, raw: 'not json' })).status, 400);
    // guess op 잘못된 url
    assert.equal((await s.scraps({ op: 'guess' })).status, 400);
    assert.equal((await s.scraps({ op: 'guess', url: '' })).status, 400);
    assert.equal((await s.scraps({ op: 'guess', url: 'not-url' })).status, 400);
    // 잘못된 본문
    assert.equal((await s.scraps({ op: 'save' })).status, 400);
    assert.equal((await s.scraps({ op: 'save', task: 'S1-4', url: 'https://a.test', quote: { exact: 'ok' } })).status, 400);
    assert.equal((await s.scraps({ op: 'save', task: 'S1-01', url: 'https://a.test', quote: { exact: 'x'.repeat(1001) } })).status, 400);
    assert.deepEqual((await s.req('GET', '/scraps', { headers: s.auth })).json(), { scraps: [], tasks: {} });
  } finally {
    await s.bridge.close();
  }
});

test('/scraps: save -> GET ?url= 에 1건, GET tasks 는 스크랩에 나온 할 일만, study-log 에 kind:scrap 한 줄, 이미 있던 id 재저장 시 기록 안 남김', async () => {
  const s = await start();
  try {
    const url = 'https://portswigger.net/web-security/access-control';
    const initial = await s.req('GET', '/scraps', { headers: s.auth });
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.json(), { scraps: [], tasks: {} });

    const saveRes = await s.scraps({
      op: 'save',
      task: 'S1-04',
      url,
      title: 'Access Control',
      headings: ['Vulnerabilities', 'IDOR'],
      quote: { exact: 'Broken access control is a common vulnerability.', prefix: 'Intro: ', suffix: ' Read more.' },
      pos: 120,
      translation: '접근 통제 취약점은 흔한 취약점이다.',
      memo: '중요 메모',
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.headers['access-control-allow-origin'], MINE);
    assert.equal(saveRes.json().scraps.length, 1);
    const scrap = saveRes.json().scraps[0];
    assert.equal(scrap.task, 'S1-04');
    assert.equal(scrap.quote.exact, 'Broken access control is a common vulnerability.');

    // GET /scraps?url= 로 조회 시 1건
    const byUrl = await s.req('GET', `/scraps?url=${encodeURIComponent(url)}`, { headers: s.auth });
    assert.equal(byUrl.status, 200);
    assert.equal(byUrl.json().scraps.length, 1);
    assert.equal(byUrl.json().scraps[0].id, scrap.id);

    // 다른 URL 로 조회 시 0건
    const emptyUrl = await s.req('GET', '/scraps?url=https://other.test', { headers: s.auth });
    assert.equal(emptyUrl.status, 200);
    assert.deepEqual(emptyUrl.json().scraps, []);

    // GET /scraps (tasks 는 스크랩에 나온 할 일만 매핑)
    const all = await s.req('GET', '/scraps', { headers: s.auth });
    assert.equal(all.status, 200);
    assert.equal(all.json().scraps.length, 1);
    assert.deepEqual(all.json().tasks, { 'S1-04': '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면' });

    // study-log.jsonl 확인: kind: 'scrap', text: exact, url 확인
    const studyLogPath = join(s.dir, 'study-log.jsonl');
    assert.equal(existsSync(studyLogPath), true);
    const lines = readFileSync(studyLogPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].kind, 'scrap');
    assert.equal(lines[0].text, 'Broken access control is a common vulnerability.');
    assert.equal(lines[0].url, url);

    // 이미 있던 id를 다시 save해도 공부 기록을 남기지 않는다(새 스크랩일 때만 kind:'scrap' 한 줄)
    const reSaveRes = await s.scraps({
      op: 'save',
      task: 'S1-04',
      url,
      title: 'Updated Title',
      quote: { exact: 'Broken access control is a common vulnerability.', prefix: 'Intro: ', suffix: ' Read more.' },
      memo: '수정 메모',
    });
    assert.equal(reSaveRes.status, 200);
    const linesAfterResave = readFileSync(studyLogPath, 'utf8').trim().split('\n');
    assert.equal(linesAfterResave.length, 1); // 여전히 1줄이어야 함
  } finally {
    await s.bridge.close();
  }
});

test('/scraps POST guess op: 포트스위거 페이지 짐작 및 밖 페이지 질문', async () => {
  const s = await start();
  try {
    const guessPortSwigger = await s.scraps({
      op: 'guess',
      url: 'https://portswigger.net/web-security/access-control',
    });
    assert.equal(guessPortSwigger.status, 200);
    const d1 = guessPortSwigger.json();
    assert.equal(d1.task, 'S1-04');
    assert.equal(d1.ask, false);
    assert.ok(d1.matches.includes('S1-04'));
    assert.ok(d1.candidates.some((c) => c.id === 'S1-04' && c.title.includes('접근 통제')));

    // 스크랩을 하나 저장하여 lastToday 가 생기게 함
    await s.scraps({
      op: 'save',
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control',
      quote: { exact: 'Test quote' },
    });

    // 커리큘럼 밖 페이지 guess -> lastToday 가 S1-04 이므로 ask: true, task: S1-04
    const guessExternal = await s.scraps({
      op: 'guess',
      url: 'https://developer.mozilla.org/en-US/docs/Web',
    });
    assert.equal(guessExternal.status, 200);
    const d2 = guessExternal.json();
    assert.equal(d2.task, 'S1-04');
    assert.equal(d2.ask, true);
    assert.deepEqual(d2.matches, []);
  } finally {
    await s.bridge.close();
  }
});

test('/scraps: memo, move, remove op 및 없는 id 404', async () => {
  const s = await start();
  try {
    const url = 'https://portswigger.net/web-security/access-control';
    const saveRes = await s.scraps({
      op: 'save',
      task: 'S1-04',
      url,
      title: 'AC',
      quote: { exact: 'Sample text.' },
    });
    const id = saveRes.json().scraps[0].id;

    // memo
    const memoRes = await s.scraps({ op: 'memo', id, memo: '새 메모' });
    assert.equal(memoRes.status, 200);
    assert.equal(memoRes.json().scraps.find((x) => x.id === id).memo, '새 메모');

    // memo 로는 study-log 에 추가되지 않음
    const studyLogPath = join(s.dir, 'study-log.jsonl');
    const linesAfterMemo = readFileSync(studyLogPath, 'utf8').trim().split('\n');
    assert.equal(linesAfterMemo.length, 1);

    // move
    const moveRes = await s.scraps({ op: 'move', id, task: 'S1-08' });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.json().scraps.find((x) => x.id === id).task, 'S1-08');

    // move to inbox (null)
    const moveInbox = await s.scraps({ op: 'move', id, task: null });
    assert.equal(moveInbox.status, 200);
    assert.equal(moveInbox.json().scraps.find((x) => x.id === id).task, null);

    // 없는 id 404
    assert.equal((await s.scraps({ op: 'memo', id: 'ffffffffffff', memo: 'x' })).status, 404);
    assert.equal((await s.scraps({ op: 'move', id: 'ffffffffffff', task: 'S1-01' })).status, 404);
    assert.equal((await s.scraps({ op: 'remove', id: 'ffffffffffff' })).status, 404);

    // remove
    const removeRes = await s.scraps({ op: 'remove', id });
    assert.equal(removeRes.status, 200);
    assert.equal(removeRes.json().scraps.length, 0);

    // 삭제 후 GET
    const all = await s.req('GET', '/scraps', { headers: s.auth });
    assert.equal(all.json().scraps.length, 0);
  } finally {
    await s.bridge.close();
  }
});
