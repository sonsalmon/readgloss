// test/fxh-study-time-fixes.test.mjs
// 과제 FX-H 검증 문제 수정 테스트.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 순수 로직 모듈 로드
import '../extension/study-time-core.js';
const core = globalThis.readglossStudyTimeCore;

// 다리 모듈 로드
import { parseStudyTimeOp, parseStudyTimeRange } from '../bridge/study-time.mjs';
import { createBridge } from '../bridge/server.mjs';

// 패널 모듈 로드
import '../extension/panel-study.js';
const studyPanel = globalThis.readglossStudy;

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';

// -------------------------------------------------------------
// 1. 과제 1번: 묶음 나누기 100KB, 400·413 버림·5xx 되돌림, 긴 주소 버림, 2000개 상한
// -------------------------------------------------------------
test('FX-H 1: cleanItem / cleanItems (주소 >2000자 버림, 제목 >300자·소제목 >200자 자름)', () => {
  assert.ok(core.cleanItem, 'cleanItem 순수 함수 존재');

  // 정상 항목
  const valid = {
    date: '2026-10-15',
    url: 'https://example.com/test',
    title: 'Good Title',
    headings: ['H1', 'Sub'],
    seconds: 30,
  };
  assert.deepEqual(core.cleanItem(valid), valid);

  // 주소 > 2000자 -> 버림 (null)
  const longUrl = {
    ...valid,
    url: `https://example.com/${'a'.repeat(2001)}`,
  };
  assert.equal(core.cleanItem(longUrl), null, '주소 > 2000자는 항목 버림');

  // 제목 > 300자 -> 300자로 자름
  const longTitle = {
    ...valid,
    title: 'T'.repeat(350),
  };
  const cleanedTitle = core.cleanItem(longTitle);
  assert.ok(cleanedTitle);
  assert.equal(cleanedTitle.title.length, 300);
  assert.equal(cleanedTitle.title, 'T'.repeat(300));

  // 소제목 > 200자 -> 200자로 자름
  const longHeading = {
    ...valid,
    headings: ['H'.repeat(250), 'Short'],
  };
  const cleanedHeading = core.cleanItem(longHeading);
  assert.ok(cleanedHeading);
  assert.equal(cleanedHeading.headings[0].length, 200);
  assert.equal(cleanedHeading.headings[0], 'H'.repeat(200));
  assert.equal(cleanedHeading.headings[1], 'Short');

  // cleanItems 배열 정리
  const list = [valid, longUrl, longTitle];
  const cleanedList = core.cleanItems(list);
  assert.equal(cleanedList.length, 2, '긴 주소 항목 1개 제외되어 2개 반환');
});

test('FX-H 1: splitBatches (JSON 길이 100KB 이하로 묶음 분할)', () => {
  assert.ok(core.splitBatches, 'splitBatches 순수 함수 존재');

  // 각 항목 약 1KB 정도의 더미 항목 생성
  const items = [];
  for (let i = 0; i < 250; i++) {
    items.push({
      date: '2026-10-15',
      url: `https://example.com/path/${i}/${'x'.repeat(400)}`,
      title: `Page Title ${i}`,
      headings: [`Heading Section ${i}`, `Subsection Detail ${i}`],
      seconds: 10,
    });
  }

  const batches = core.splitBatches(items, 100 * 1024);
  assert.ok(batches.length > 1, '전체 데이터가 100KB를 넘으므로 2개 이상의 묶음으로 나뉜다');

  let totalItemsCount = 0;
  for (const b of batches) {
    const jsonLen = JSON.stringify(b).length;
    assert.ok(jsonLen <= 100 * 1024, `각 묶음의 JSON 크기(${jsonLen}B)는 100KB 이하여야 한다`);
    totalItemsCount += b.length;
  }
  assert.equal(totalItemsCount, items.length, '모든 항목이 누락 없이 보존되어야 한다');
});

test('FX-H 1: shouldRestore (400·413 버림, 401·5xx·연결실패 되돌림)', () => {
  assert.ok(core.shouldRestore, 'shouldRestore 순수 함수 존재');

  // 1. 400 또는 413 응답 -> 되돌리지 않고 버림 (false)
  assert.equal(core.shouldRestore({ status: 400, error: 'bad-request' }), false);
  assert.equal(core.shouldRestore({ status: 413, error: 'too-large' }), false);
  assert.equal(core.shouldRestore({ error: 'bad-request' }), false);
  assert.equal(core.shouldRestore({ error: 'too-large' }), false);

  // 2. 401 응답 -> 되돌림 (true)
  assert.equal(core.shouldRestore({ status: 401, error: 'unauthorized' }), true);
  assert.equal(core.shouldRestore({ error: 'unauthorized' }), true);

  // 3. 5xx 응답 -> 되돌림 (true)
  assert.equal(core.shouldRestore({ status: 500, error: 'internal' }), true);
  assert.equal(core.shouldRestore({ status: 502, error: 'ai-failed' }), true);
  assert.equal(core.shouldRestore({ status: 504, error: 'timeout' }), true);
  assert.equal(core.shouldRestore({ status: 503 }), true);

  // 4. 연결 실패(에러 객체 있음) -> 되돌림 (true)
  assert.equal(core.shouldRestore(null, new Error('network failed')), true);
  assert.equal(core.shouldRestore(undefined, { message: 'connection refused' }), true);

  // 5. 200 OK 성공 -> 되돌리지 않음 (false)
  assert.equal(core.shouldRestore({ ok: true, status: 200 }), false);
});

test('FX-H 1: addSecond 버킷 2000개 상한 (가장 오래된 것부터 삭제)', () => {
  const buckets = new Map();

  // 2000개 버킷 채우기
  for (let i = 0; i < 2000; i++) {
    const k = `key_${i}`;
    core.addSecond(buckets, k, { date: '2026-10-15', url: `https://example.com/${i}`, title: '', headings: [] }, 1);
  }
  assert.equal(buckets.size, 2000);
  assert.ok(buckets.has('key_0'), '첫 번째 키 존재');

  // 2001번째 버킷 추가
  core.addSecond(buckets, 'key_2000', { date: '2026-10-15', url: 'https://example.com/2000', title: '', headings: [] }, 1);

  assert.equal(buckets.size, 2000, '버킷 개수는 2000개 상한을 유지');
  assert.equal(buckets.has('key_0'), false, '가장 오래된 key_0 버킷이 버려져야 함');
  assert.ok(buckets.has('key_1'), 'key_1은 남아있음');
  assert.ok(buckets.has('key_2000'), '새로 들어온 key_2000 존재');
});

// -------------------------------------------------------------
// 2. 과제 2번: 동영상 판정 함수 isVideoCounting(video-like)
// -------------------------------------------------------------
test('FX-H 2: isVideoCounting(video-like) 판정', () => {
  assert.ok(core.isVideoCounting, 'isVideoCounting 함수 존재');

  // 정상 재생 중: !paused && !ended && !muted && volume > 0 && width >= 200
  assert.equal(
    core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 1.0, width: 300 }),
    true,
  );
  assert.equal(
    core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 0.1, width: 200 }),
    true,
    'width 200px 경계값 참',
  );

  // 일시정지 또는 종료
  assert.equal(core.isVideoCounting({ paused: true, ended: false, muted: false, volume: 1, width: 300 }), false);
  assert.equal(core.isVideoCounting({ paused: false, ended: true, muted: false, volume: 1, width: 300 }), false);

  // 음소거 또는 볼륨 0
  assert.equal(core.isVideoCounting({ paused: false, ended: false, muted: true, volume: 1, width: 300 }), false);
  assert.equal(core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 0, width: 300 }), false);
  assert.equal(core.isVideoCounting({ paused: false, ended: false, muted: false, volume: -0.5, width: 300 }), false);

  // 폭 < 200px (장식용 또는 숨은 비디오)
  assert.equal(core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 1, width: 199 }), false);
  assert.equal(core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 1, width: 0 }), false);

  // DOM 프로퍼티 (offsetWidth / clientWidth / getBoundingClientRect) 지원
  assert.equal(
    core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 1, offsetWidth: 250 }),
    true,
  );
  assert.equal(
    core.isVideoCounting({ paused: false, ended: false, muted: false, volume: 1, getBoundingClientRect: () => ({ width: 400 }) }),
    true,
  );
});

// -------------------------------------------------------------
// 3. 과제 3번: 기준값+탭 카운터 순수 함수 todayTotal(base, local) 및 날짜 바뀜
// -------------------------------------------------------------
test('FX-H 3: todayTotal(base, local) 순수 함수', () => {
  assert.ok(core.todayTotal, 'todayTotal 함수 존재');

  assert.equal(core.todayTotal(100, 50), 150);
  assert.equal(core.todayTotal(0, 30), 30);
  assert.equal(core.todayTotal(40, 0), 40);
  assert.equal(core.todayTotal(0, 0), 0);

  // 비정상/누락 값 방어
  assert.equal(core.todayTotal(undefined, 20), 20);
  assert.equal(core.todayTotal(50, null), 50);
  assert.equal(core.todayTotal('100', 50), 150);
  assert.equal(core.todayTotal(-10, -5), 0, '음수는 0 이상으로 clamp');
});

// -------------------------------------------------------------
// 4. 과제 4번: 사슬 열쇠 및 패널 같은 이름 둘 처리
// -------------------------------------------------------------
test('FX-H 4: panel-study groupTime 사슬 열쇠 및 같은 이름 둘(상위 › 이름)', () => {
  assert.ok(studyPanel.groupTime, 'groupTime 함수 존재');

  const items = [
    {
      url: 'https://example.com/p1',
      title: 'Page 1',
      headings: ['Chapter A', 'Overview'],
      seconds: 50,
    },
    {
      url: 'https://example.com/p1',
      title: 'Page 1',
      headings: ['Chapter B', 'Overview'],
      seconds: 30,
    },
    {
      url: 'https://example.com/p1',
      title: 'Page 1',
      headings: ['Chapter C', 'Detail'],
      seconds: 20,
    },
  ];

  const tree = studyPanel.groupTime(items);
  assert.equal(tree.length, 1);
  const p1 = tree[0].pages[0];
  assert.equal(p1.sections.length, 3, '소제목 이름이 같아도(Overview) 사슬이 다르면 합쳐지지 않고 3개 섹션');

  // Overview는 2개 존재하므로 "상위 › 이름" 표시
  const s0 = p1.sections.find((s) => s.seconds === 50);
  const s1 = p1.sections.find((s) => s.seconds === 30);
  const s2 = p1.sections.find((s) => s.seconds === 20);

  assert.equal(s0.title, 'Chapter A › Overview', '중복 이름은 상위 › 이름');
  assert.equal(s1.title, 'Chapter B › Overview', '중복 이름은 상위 › 이름');
  assert.equal(s2.title, 'Detail', '유일한 이름은 그대로 마지막 소제목');
});

test('FX-H 4: panel-study topSections 사슬 열쇠 및 중복 이름 처리', () => {
  assert.ok(studyPanel.topSections, 'topSections 함수 존재');

  const items = [
    {
      url: 'https://example.com/p1',
      title: 'Page 1',
      headings: ['Part 1', 'Summary'],
      seconds: 200,
    },
    {
      url: 'https://example.com/p1',
      title: 'Page 1',
      headings: ['Part 2', 'Summary'],
      seconds: 150,
    },
  ];

  const top = studyPanel.topSections(items, 3);
  assert.equal(top.length, 2);
  assert.equal(top[0].sectionTitle, 'Part 1 › Summary', '같은 이름 Summary가 둘이면 상위 › 이름');
  assert.equal(top[1].sectionTitle, 'Part 2 › Summary');
});

// -------------------------------------------------------------
// 6. 과제 6번: 패널 오류 문구
// -------------------------------------------------------------
test('FX-H 6: 패널 loadTime 오류 문구 처리 및 MESSAGES 정의 검증', () => {
  assert.ok(studyPanel.MESSAGES, 'MESSAGES 정의 존재');
  assert.equal(studyPanel.MESSAGES['http-404'], '다리가 이 기능을 아직 몰라요. 다리를 다시 시작해 주세요');
  assert.equal(studyPanel.MESSAGES['bridge-off'], '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요');

  // fallback 동작 테스트
  const getErrorMessage = (errKey) => studyPanel.MESSAGES[errKey] ?? '다리에 연결하지 못했어요';
  assert.equal(getErrorMessage('http-404'), '다리가 이 기능을 아직 몰라요. 다리를 다시 시작해 주세요');
  assert.equal(getErrorMessage('unknown-err'), '다리에 연결하지 못했어요');
  assert.equal(getErrorMessage(undefined), '다리에 연결하지 못했어요');

  const code = readFileSync(new URL('../extension/panel-study.js', import.meta.url), 'utf8');
  assert.match(code, /MESSAGES\[.*error.*\]\s*\?\?\s*['"]다리에 연결하지 못했어요['"]/);
});

// -------------------------------------------------------------
// 7. 과제 7번: 다리 add 날짜 실제 달력 검사 (2026-13-45 거절, GET 검사 함수 재사용)
// -------------------------------------------------------------
test('FX-H 7: parseStudyTimeOp / parseStudyTimeRange 실제 달력 날짜 검사', () => {
  // 정상 날짜
  assert.ok(parseStudyTimeRange('2026-10-15', '2026-10-15'));

  // 가짜 달력 날짜: 13월 45일 거절
  assert.equal(parseStudyTimeRange('2026-13-45', '2026-13-45'), null);
  assert.equal(parseStudyTimeRange('2026-02-31', '2026-02-31'), null);

  // op add 에서도 거절되는지 확인
  const badAdd = parseStudyTimeOp({
    op: 'add',
    items: [
      {
        date: '2026-13-45',
        url: 'https://example.com',
        title: 'Title',
        headings: [],
        seconds: 10,
      },
    ],
  });
  assert.equal(badAdd, null, '2026-13-45는 parseStudyTimeOp에서 거절되어야 함');

  const feb31Add = parseStudyTimeOp({
    op: 'add',
    items: [
      {
        date: '2026-02-31',
        url: 'https://example.com',
        title: 'Title',
        headings: [],
        seconds: 10,
      },
    ],
  });
  assert.equal(feb31Add, null, '2026-02-31은 parseStudyTimeOp에서 거절되어야 함');
});

// -------------------------------------------------------------
// 1 & 다리 본문 상한 256KB 테스트
// -------------------------------------------------------------
test('FX-H 1: 다리 /study-time POST 본문 상한 256KB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-studytime-256k-'));
  const bridge = createBridge({
    ask: async () => '{}',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    dbFile: join(dir, 'readgloss.db'),
    learningDir: dir,
    extensionId: EXT,
  });

  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');

  try {
    // 50KB 크기의 정상 add 요청 생성 (기존 MAX_WORDS_BODY 24KB 초과)
    const items = [];
    for (let i = 0; i < 50; i++) {
      items.push({
        date: '2026-10-15',
        url: `https://example.com/page/${i}/${'p'.repeat(500)}`,
        title: `Title ${i} ${'t'.repeat(100)}`,
        headings: [`Heading 1 ${'h'.repeat(50)}`, `Heading 2 ${'h'.repeat(50)}`],
        seconds: 30,
      });
    }

    const payload = { op: 'add', items };
    const bodyStr = JSON.stringify(payload);
    assert.ok(bodyStr.length > 30 * 1024, `페이로드 크기(${bodyStr.length}B)는 30KB 이상이어야 함`);
    assert.ok(bodyStr.length < 256 * 1024, `페이로드 크기는 256KB 미만이어야 함`);

    const res = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/study-time',
          headers: {
            Host: HOST,
            Origin: MINE,
            'X-Bridge-Token': token,
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, body: t }));
        },
      );
      r.on('error', reject);
      r.end(bodyStr);
    });

    assert.equal(res.status, 200, '24KB 초과 50KB 본문이 413 없이 200 OK로 수락되어야 함');
  } finally {
    await bridge.close();
  }
});

// -------------------------------------------------------------
// 8. 과제 8번: 소스 검사 (다리 guessTaskFor 10분 캐시 Map 500개, 확장 소제목 MutationObserver)
// -------------------------------------------------------------
test('FX-H 8: 소스 검사 (guessTaskFor 캐시, MutationObserver 소제목 수집, settings onChange)', () => {
  const serverCode = readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
  // guessTaskForUrl 캐시 Map, 10분(600000ms), 500개 검사
  assert.match(serverCode, /Map\(\)/);
  assert.match(serverCode, /500/);
  assert.match(serverCode, /600000|10\s*\*\s*60\s*\*\s*1000/);

  const studyCode = readFileSync(new URL('../extension/study-time.js', import.meta.url), 'utf8');
  // MutationObserver childList, subtree
  assert.match(studyCode, /MutationObserver/);
  assert.match(studyCode, /childList/);
  assert.match(studyCode, /subtree/);

  // settings onChange 감지
  assert.match(studyCode, /settingsCore.*onChange|onChange/);

  // memo-pad 목차 사슬 호출 검사
  const memoPadCode = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');
  assert.match(memoPadCode, /getHeadingChain\([\s\S]{0,200}sectionSeconds\(headingChain\)/);
});
