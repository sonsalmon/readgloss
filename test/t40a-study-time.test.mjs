import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 순수 로직
import '../extension/study-time-core.js';
const core = globalThis.readglossStudyTimeCore;

// 다리 모듈
import { openDb } from '../bridge/db.mjs';
import { createStudyTime, parseStudyTimeOp, parseStudyTimeRange, studyTimeId } from '../bridge/study-time.mjs';
import { createBridge } from '../bridge/server.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';

// -------------------------------------------------------------
// 1. study-time-core.js 순수 로직 테스트
// -------------------------------------------------------------
test('study-time-core: bucketKey 형식 검증', () => {
  assert.equal(
    core.bucketKey('2026-10-15', 'https://example.com/test', ['Heading 1', 'Sub 2']),
    '2026-10-15|https://example.com/test|Heading 1\u0000Sub 2',
  );
  assert.equal(
    core.bucketKey('2026-10-15', 'https://example.com/test', []),
    '2026-10-15|https://example.com/test|',
  );
  assert.equal(
    core.bucketKey('2026-10-15', 'https://example.com/test', null),
    '2026-10-15|https://example.com/test|',
  );
});

test('study-time-core: isCounting 경우별(5분 경계, 비활성, 동영상)', () => {
  // 정상 활성 상태: visible, focused, 움직임 1초 전
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 1000 }),
    true,
  );

  // 5분 경계값 검사 (idleMs = 300,000ms)
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 0 }),
    true,
    '활동 직후는 센다',
  );
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 300000 }),
    true,
    '정확히 5분(300,000ms)까지는 센다',
  );
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 300001 }),
    false,
    '5분 1ms 초과 시 멈춘다',
  );
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: -10 }),
    false,
    '음수 ms는 잘못된 값이므로 멈춘다',
  );

  // 커스텀 idleMs
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 5000, idleMs: 5000 }),
    true,
  );
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 5001, idleMs: 5000 }),
    false,
  );

  // 탭 숨김 또는 창 포커스 없음
  assert.equal(
    core.isCounting({ visible: false, focused: true, msSinceActivity: 1000 }),
    false,
    '탭이 안 보이면 멈춘다',
  );
  assert.equal(
    core.isCounting({ visible: true, focused: false, msSinceActivity: 1000 }),
    false,
    '창 포커스가 없으면 멈춘다',
  );
  assert.equal(
    core.isCounting({ visible: false, focused: false, msSinceActivity: 1000 }),
    false,
    '둘 다 아니면 멈춘다',
  );

  // 동영상 재생 중: 5분을 넘겨도 센다
  assert.equal(
    core.isCounting({ visible: true, focused: true, msSinceActivity: 600000, videoPlaying: true }),
    true,
    '동영상 재생 중이면 무활동 10분이 지나도 센다',
  );
  // 하지만 탭이 숨겨지거나 창 포커스를 잃으면 동영상이어도 센 것을 멈춘다
  assert.equal(
    core.isCounting({ visible: false, focused: true, msSinceActivity: 1000, videoPlaying: true }),
    false,
    '동영상 재생 중이어도 탭이 숨겨지면 멈춘다',
  );
  assert.equal(
    core.isCounting({ visible: true, focused: false, msSinceActivity: 1000, videoPlaying: true }),
    false,
    '동영상 재생 중이어도 창 포커스를 잃으면 멈춘다',
  );
});

test('study-time-core: addSecond 누적', () => {
  const buckets = new Map();
  const info = { date: '2026-10-15', url: 'https://example.com', title: 'Example', headings: ['H1'] };
  const key = core.bucketKey(info.date, info.url, info.headings);

  core.addSecond(buckets, key, info);
  assert.equal(buckets.get(key).seconds, 1);
  assert.equal(buckets.get(key).title, 'Example');

  core.addSecond(buckets, key, info);
  assert.equal(buckets.get(key).seconds, 2);

  core.addSecond(buckets, key, info, 10);
  assert.equal(buckets.get(key).seconds, 12);
});

test('study-time-core: drainBuckets (120초 나누기 및 buckets 비움)', () => {
  const buckets = new Map();
  const info = { date: '2026-10-15', url: 'https://example.com/p', title: 'Page', headings: ['A'] };
  const key = core.bucketKey(info.date, info.url, info.headings);

  // 250초 등록
  core.addSecond(buckets, key, info, 250);
  assert.equal(buckets.get(key).seconds, 250);

  // drain 수행
  const items = core.drainBuckets(buckets, 50, 120);

  // 250초는 120초, 120초, 10초 3개 항목으로 나뉜다
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.seconds), [120, 120, 10]);
  for (const item of items) {
    assert.equal(item.url, 'https://example.com/p');
    assert.deepEqual(item.headings, ['A']);
  }

  // 모두 꺼냈으므로 buckets는 완전히 비워진다
  assert.equal(buckets.size, 0);
});

test('study-time-core: drainBuckets (50개 상한)', () => {
  const buckets = new Map();

  // 60개의 버킷 생성 (각각 10초)
  for (let i = 0; i < 60; i++) {
    const key = `k_${i}`;
    core.addSecond(buckets, key, { date: '2026-10-15', url: `https://example.com/${i}`, title: `T${i}`, headings: [] }, 10);
  }
  assert.equal(buckets.size, 60);

  // maxItems = 50으로 drain
  const items = core.drainBuckets(buckets, 50, 120);
  assert.equal(items.length, 50, '최대 50개까지만 꺼낸다');

  // 남은 10개는 버킷에 보존되어야 한다
  assert.equal(buckets.size, 10, '50개 상한으로 다 못 꺼낸 10개 버킷은 남아있다');
});

// -------------------------------------------------------------
// 2. bridge/study-time.mjs 파싱 및 거절 검사
// -------------------------------------------------------------
test('parseStudyTimeOp: op add 정상 및 거절 검사', () => {
  const validItem = {
    date: '2026-10-15',
    url: 'https://example.com/article',
    title: 'Good Article',
    headings: ['Section 1', 'Subsection A'],
    seconds: 60,
  };

  // 정상
  const ok = parseStudyTimeOp({ op: 'add', items: [validItem] });
  assert.ok(ok);
  assert.equal(ok.op, 'add');
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].seconds, 60);
  assert.equal(ok.items[0].url, 'https://example.com/article');

  // 거절 경우들:
  // 1. 잘못된 op
  assert.equal(parseStudyTimeOp({ op: 'unknown', items: [validItem] }), null);
  assert.equal(parseStudyTimeOp(null), null);
  assert.equal(parseStudyTimeOp('string'), null);

  // 2. items 개수: 1~50개
  assert.equal(parseStudyTimeOp({ op: 'add', items: [] }), null, '0개 거절');
  const tooMany = Array.from({ length: 51 }, () => ({ ...validItem }));
  assert.equal(parseStudyTimeOp({ op: 'add', items: tooMany }), null, '51개 거절');
  const exact50 = Array.from({ length: 50 }, () => ({ ...validItem }));
  assert.ok(parseStudyTimeOp({ op: 'add', items: exact50 }), '50개 허용');

  // 3. date 형식 YYYY-MM-DD
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, date: '2026/10/15' }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, date: '2026-1-1' }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, date: 12345 }] }), null);

  // 4. url http(s) 및 길이 <= 2000
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, url: 'ftp://example.com' }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, url: 'javascript:alert(1)' }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, url: `https://example.com/${'a'.repeat(2000)}` }] }), null);

  // 5. title <= 300자
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, title: 'a'.repeat(301) }] }), null);
  assert.ok(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, title: 'a'.repeat(300) }] }));

  // 6. headings <= 3개, 각 <= 200자
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, headings: ['1', '2', '3', '4'] }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, headings: ['a'.repeat(201)] }] }), null);
  assert.ok(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, headings: ['a'.repeat(200)] }] }));
  assert.ok(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, headings: [] }] }));

  // 7. seconds: 정수 1~120
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: 0 }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: -5 }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: 121 }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: 12.5 }] }), null);
  assert.equal(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: '60' }] }), null);
  assert.ok(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: 1 }] }));
  assert.ok(parseStudyTimeOp({ op: 'add', items: [{ ...validItem, seconds: 120 }] }));
});

test('parseStudyTimeRange: 날짜 범위 검사 (최대 62일)', () => {
  // 정상 범위
  assert.deepEqual(parseStudyTimeRange('2026-10-01', '2026-10-15'), { from: '2026-10-01', to: '2026-10-15' });
  assert.deepEqual(parseStudyTimeRange('2026-10-01', '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' });

  // 62일 한도 테스트
  // 2026-01-01부터 62일차 = 2026-03-03
  assert.ok(parseStudyTimeRange('2026-01-01', '2026-03-03'));
  // 63일 이상은 거절
  assert.equal(parseStudyTimeRange('2026-01-01', '2026-03-04'), null, '63일 거절');
  assert.equal(parseStudyTimeRange('2026-01-01', '2026-04-01'), null, '3달 거절');

  // 역전된 날짜
  assert.equal(parseStudyTimeRange('2026-10-15', '2026-10-01'), null);

  // 잘못된 날짜 형식
  assert.equal(parseStudyTimeRange('invalid', '2026-10-15'), null);
  assert.equal(parseStudyTimeRange('2026-10-01', 'invalid'), null);
});

// -------------------------------------------------------------
// 3. createStudyTime add 누적·task 처음만, list 범위 검사
// -------------------------------------------------------------
test('createStudyTime: add 누적 및 task 처음만 부여', () => {
  const db = openDb(':memory:');
  let guessCalls = 0;
  const guessTaskFor = (url) => {
    guessCalls++;
    return 'S1-04';
  };

  const st = createStudyTime({ db, guessTaskFor, now: () => 1000 });

  const item1 = {
    date: '2026-10-15',
    url: 'https://portswigger.net/web-security/access-control',
    title: 'Access Control',
    headings: ['Intro'],
    seconds: 40,
  };

  // 1. 처음 add: 새 dwell 노드 생성 및 guessTaskFor 호출
  const res1 = st.add([item1]);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].seconds, 40);
  assert.equal(res1[0].task, 'S1-04');
  assert.equal(guessCalls, 1, '첫 생성 시 guessTaskFor 호출');

  // id 형식 검사
  const expectedId = studyTimeId(item1.date, 'https://portswigger.net/web-security/access-control', item1.headings);
  assert.equal(res1[0].id, expectedId);
  assert.ok(expectedId.startsWith('dw_'));
  assert.equal(expectedId.length, 19); // 'dw_' (3) + 16 = 19

  // in_task edge 생성 확인
  const edges = db.out(expectedId, 'in_task');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].dst, 'task:S1-04');

  // 2. 같은 key로 다시 add: seconds 누적, guessTaskFor 호출 안 됨(task 처음만)
  const item2 = {
    ...item1,
    seconds: 50,
  };
  const res2 = st.add([item2]);
  assert.equal(res2.length, 1);
  assert.equal(res2[0].seconds, 90, '40 + 50 = 90 누적');
  assert.equal(res2[0].task, 'S1-04', '기존 task 유지');
  assert.equal(guessCalls, 1, '이미 존재하는 항목에 add할 때는 guessTaskFor를 다시 호출하지 않는다');

  // 3. 다른 소제목으로 add: 새 항목 생성
  const item3 = {
    ...item1,
    headings: ['Other Section'],
    seconds: 30,
  };
  const res3 = st.add([item3]);
  assert.equal(res3.length, 1);
  assert.equal(res3[0].seconds, 30);
  assert.notEqual(res3[0].id, expectedId);
  assert.equal(guessCalls, 2, '새 항목이므로 guessTaskFor 호출');

  db.close();
});

test('createStudyTime: list 범위 필터링', () => {
  const db = openDb(':memory:');
  const st = createStudyTime({ db });

  st.add([
    { date: '2026-10-01', url: 'https://example.com/a', title: 'A', headings: [], seconds: 10 },
    { date: '2026-10-10', url: 'https://example.com/b', title: 'B', headings: [], seconds: 20 },
    { date: '2026-10-15', url: 'https://example.com/c', title: 'C', headings: [], seconds: 30 },
    { date: '2026-10-25', url: 'https://example.com/d', title: 'D', headings: [], seconds: 40 },
  ]);

  // 10-05 ~ 10-20 범위 조회
  const items = st.list('2026-10-05', '2026-10-20');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.date), ['2026-10-10', '2026-10-15']);
  assert.deepEqual(items.map((i) => i.seconds), [20, 30]);

  // 범위 밖
  const empty = st.list('2026-11-01', '2026-11-05');
  assert.equal(empty.length, 0);

  // 잘못된 범위(역전)
  const bad = st.list('2026-10-20', '2026-10-05');
  assert.equal(bad.length, 0);

  db.close();
});

// -------------------------------------------------------------
// 4. 서버 HTTP 응답 (401, 400, 200) 및 guessTaskFor 연동 검사
// -------------------------------------------------------------
async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-studytime-srv-'));
  const learningDir = join(dir, 'learning');
  mkdirSync(learningDir, { recursive: true });
  mkdirSync(join(learningDir, 'curriculum'), { recursive: true });

  // roadmap.json mock
  writeFileSync(
    join(learningDir, 'curriculum', 'roadmap.json'),
    JSON.stringify([
      {
        id: 'S1-04',
        card_title: 'Access Control',
        resources: [{ url: 'https://portswigger.net/web-security/access-control' }],
      },
    ]),
  );

  const bridge = createBridge({
    ask: async () => '{}',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    dbFile: join(dir, 'readgloss.db'),
    learningDir,
    extensionId: EXT,
  });

  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');

  const req = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, Origin: MINE, ...headers } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => (t ? JSON.parse(t) : {}) }));
        },
      );
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });

  return { bridge, dir, port, token, req, auth: { 'X-Bridge-Token': token } };
}

test('서버 /study-time: 401(인증 실패), 400(잘못된 요청), 200(성공)', async () => {
  const s = await startServer();
  try {
    // 1. 토큰 없음 -> 401
    const noToken = await s.req('POST', '/study-time', { body: { op: 'add', items: [] } });
    assert.equal(noToken.status, 401);

    const getNoToken = await s.req('GET', '/study-time?from=2026-10-01&to=2026-10-15');
    assert.equal(getNoToken.status, 401);

    // 2. 400 Bad Request 경우들
    // POST: items 빈 배열
    const badPostEmpty = await s.req('POST', '/study-time', {
      headers: s.auth,
      body: { op: 'add', items: [] },
    });
    assert.equal(badPostEmpty.status, 400);

    // POST: 잘못된 초 (130초)
    const badPostSec = await s.req('POST', '/study-time', {
      headers: s.auth,
      body: {
        op: 'add',
        items: [{ date: '2026-10-15', url: 'https://example.com', title: 'T', headings: [], seconds: 130 }],
      },
    });
    assert.equal(badPostSec.status, 400);

    // GET: 쿼리 누락
    const badGetNoQuery = await s.req('GET', '/study-time', { headers: s.auth });
    assert.equal(badGetNoQuery.status, 400);

    // GET: 62일 초과
    const badGetTooLong = await s.req('GET', '/study-time?from=2026-01-01&to=2026-05-01', { headers: s.auth });
    assert.equal(badGetTooLong.status, 400);

    // 3. 200 OK 성공: POST add
    const postRes = await s.req('POST', '/study-time', {
      headers: s.auth,
      body: {
        op: 'add',
        items: [
          {
            date: '2026-10-15',
            url: 'https://portswigger.net/web-security/access-control',
            title: 'PortSwigger Access Control',
            headings: ['Introduction'],
            seconds: 60,
          },
        ],
      },
    });
    assert.equal(postRes.status, 200);
    assert.deepEqual(postRes.json(), { ok: true });

    // 4. 200 OK 성공: GET list 및 guessTaskFor 연동 확인
    const getRes = await s.req('GET', '/study-time?from=2026-10-01&to=2026-10-31', { headers: s.auth });
    assert.equal(getRes.status, 200);
    const data = getRes.json();
    assert.ok(Array.isArray(data.items));
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].date, '2026-10-15');
    assert.equal(data.items[0].seconds, 60);
    assert.equal(data.items[0].task, 'S1-04', 'guessTaskFor로 짐작된 task가 기록되어 있어야 함');

    // scraps guess 와의 결과 일치 확인 (guessTaskFor 재사용 검증)
    const guessRes = await s.req('POST', '/scraps', {
      headers: s.auth,
      body: { op: 'guess', url: 'https://portswigger.net/web-security/access-control' },
    });
    assert.equal(guessRes.status, 200);
    assert.equal(guessRes.json().task, 'S1-04');
  } finally {
    await s.bridge.close();
  }
});

// -------------------------------------------------------------
// 5. background.js 중계 소스 검사
// -------------------------------------------------------------
test('background.js: study-time 중계 소스 검사', () => {
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

  // /study-time 경로 호출 확인
  assert.match(bg, /bridgeFetch\(path,\s*init\)/);
  assert.match(bg, /path\s*=\s*['"]\/study-time['"]/);

  // 메시지 타입 및 sender 검사
  assert.match(bg, /msg\?\.type\s*!==?\s*['"]study-time['"]/);
  assert.match(bg, /sender\.id\s*!==?\s*chrome\.runtime\.id/);

  // op 에 따른 GET / POST 분기
  assert.match(bg, /op\s*===?\s*['"]get['"]/);
  assert.match(bg, /from/);
  assert.match(bg, /to/);

  // 401 재시도
  assert.match(bg, /res\.status\s*===?\s*401\s*&&\s*!retried/);
});

// -------------------------------------------------------------
// 6. manifest.json 등록 검사
// -------------------------------------------------------------
test('manifest.json: memo-core.js 뒤에 study-time-core.js, study-time.js 순서 등록', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const js = manifest.content_scripts[0].js;

  const memoCoreIdx = js.indexOf('memo-core.js');
  const studyCoreIdx = js.indexOf('study-time-core.js');
  const studyIdx = js.indexOf('study-time.js');
  const memoPadIdx = js.indexOf('memo-pad.js');

  assert.ok(memoCoreIdx !== -1, 'memo-core.js 존재');
  assert.equal(studyCoreIdx, memoCoreIdx + 1, 'study-time-core.js는 memo-core.js 바로 뒤');
  assert.equal(studyIdx, memoCoreIdx + 2, 'study-time.js는 study-time-core.js 바로 뒤');
  assert.equal(memoPadIdx, memoCoreIdx + 3, 'memo-pad.js는 study-time.js 뒤');
});
