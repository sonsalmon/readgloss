// test/t40b-time-display.test.mjs
// T40b: 메모장 시간 표시·목차 분, 학습노트 minutes 및 소스 검사 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 순수 함수 로드
import '../extension/selection-core.js';
import '../extension/memo-core.js';
const memoCore = globalThis.readglossMemo;

// data-source 및 export-notes 모듈
import { loadNotesData } from '../scripts/data-source.mjs';
import { renderNoteDocs } from '../scripts/export-notes.mjs';
import { openDb } from '../bridge/db.mjs';

// ---------------------------------------------------------------------------
// 1. memo-core: formatClock 경계값 테스트
// ---------------------------------------------------------------------------
test('memo-core: formatClock 경계값 (0초, 59초, 60초, 3599초, 3600초, 3661초, 비정상값)', () => {
  assert.equal(typeof memoCore.formatClock, 'function', 'formatClock 함수가 존재해야 함');

  // 1분 미만
  assert.equal(memoCore.formatClock(0), '00:00');
  assert.equal(memoCore.formatClock(1), '00:01');
  assert.equal(memoCore.formatClock(9), '00:09');
  assert.equal(memoCore.formatClock(59), '00:59');

  // 1분 이상 ~ 1시간 미만
  assert.equal(memoCore.formatClock(60), '01:00');
  assert.equal(memoCore.formatClock(61), '01:01');
  assert.equal(memoCore.formatClock(119), '01:59');
  assert.equal(memoCore.formatClock(120), '02:00');
  assert.equal(memoCore.formatClock(1122), '18:42');
  assert.equal(memoCore.formatClock(3599), '59:59');

  // 1시간 이상 (한 시간 넘으면 h:mm:ss)
  assert.equal(memoCore.formatClock(3600), '1:00:00');
  assert.equal(memoCore.formatClock(3601), '1:00:01');
  assert.equal(memoCore.formatClock(3661), '1:01:01');
  assert.equal(memoCore.formatClock(7325), '2:02:05');
  assert.equal(memoCore.formatClock(36000), '10:00:00');

  // 비정상/음수 값 안전 처리
  assert.equal(memoCore.formatClock(-10), '00:00');
  assert.equal(memoCore.formatClock(null), '00:00');
  assert.equal(memoCore.formatClock(undefined), '00:00');
  assert.equal(memoCore.formatClock(NaN), '00:00');
  assert.equal(memoCore.formatClock('60'), '00:00');
});

// ---------------------------------------------------------------------------
// 2. memo-core: minutesLabel 경계값 테스트
// ---------------------------------------------------------------------------
test('memo-core: minutesLabel 경계값 (0초, 59초, 60초, 119초, 120초, 비정상값)', () => {
  assert.equal(typeof memoCore.minutesLabel, 'function', 'minutesLabel 함수가 존재해야 함');

  // 60초 미만은 빈 문자열
  assert.equal(memoCore.minutesLabel(0), '');
  assert.equal(memoCore.minutesLabel(30), '');
  assert.equal(memoCore.minutesLabel(59), '');

  // 60초 이상부터 분 표시 (버림 기준 1분 단위)
  assert.equal(memoCore.minutesLabel(60), '1분');
  assert.equal(memoCore.minutesLabel(61), '1분');
  assert.equal(memoCore.minutesLabel(119), '1분');
  assert.equal(memoCore.minutesLabel(120), '2분');
  assert.equal(memoCore.minutesLabel(359), '5분');
  assert.equal(memoCore.minutesLabel(3600), '60분');

  // 비정상/음수 값 안전 처리
  assert.equal(memoCore.minutesLabel(-60), '');
  assert.equal(memoCore.minutesLabel(null), '');
  assert.equal(memoCore.minutesLabel(undefined), '');
  assert.equal(memoCore.minutesLabel(NaN), '');
  assert.equal(memoCore.minutesLabel('60'), '');
});

// ---------------------------------------------------------------------------
// 3. memo-core: tocLabel minutes 순서 테스트 (제목 · N분 · 메모 N · 쓰는 중)
// ---------------------------------------------------------------------------
test('memo-core: tocLabel minutes 순서 (제목 · N분 · 메모 N · 쓰는 중, 0이면 생략)', () => {
  // 1. minutes가 0이면 생략 (기존 동작 호환)
  assert.equal(
    memoCore.tocLabel({ title: '소제목', memoCount: 2, hasDraft: false }),
    '소제목 · 메모 2',
  );
  assert.equal(
    memoCore.tocLabel({ title: '소제목', minutes: 0, memoCount: 2, hasDraft: false }),
    '소제목 · 메모 2',
  );

  // 2. minutes만 있을 때
  assert.equal(
    memoCore.tocLabel({ title: '소제목', minutes: 6 }),
    '소제목 · 6분',
  );

  // 3. minutes + memoCount (순서: 제목 · N분 · 메모 N)
  assert.equal(
    memoCore.tocLabel({ title: 'How Naive Bayes Works', minutes: 9, memoCount: 2 }),
    'How Naive Bayes Works · 9분 · 메모 2',
  );

  // 4. minutes + hasDraft (순서: 제목 · N분 · 쓰는 중)
  assert.equal(
    memoCore.tocLabel({ title: 'Bayes Theorem', minutes: 3, hasDraft: true }),
    'Bayes Theorem · 3분 · 쓰는 중',
  );

  // 5. minutes + memoCount + hasDraft (순서: 제목 · N분 · 메모 N · 쓰는 중)
  assert.equal(
    memoCore.tocLabel({ title: 'Data Assumptions', minutes: 1, memoCount: 4, hasDraft: true }),
    'Data Assumptions · 1분 · 메모 4 · 쓰는 중',
  );

  // 6. minutes 비정상값 안전 처리
  assert.equal(
    memoCore.tocLabel({ title: '소제목', minutes: -5, memoCount: 1 }),
    '소제목 · 메모 1',
  );
  assert.equal(
    memoCore.tocLabel({ title: '소제목', minutes: null, memoCount: 1 }),
    '소제목 · 메모 1',
  );
});

// ---------------------------------------------------------------------------
// 4. data-source: loadNotesData dwell 읽기 및 JSON 모드 fallback
// ---------------------------------------------------------------------------
test('data-source: loadNotesData dwell 읽기 및 JSON fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t40b-ds-'));

  // 1. SQLite DB에 dwell 점 생성
  const db = openDb(join(dir, 'readgloss.db'));
  db.put({
    id: 'dw_001',
    kind: 'dwell',
    key: 'https://example.com/study',
    data: {
      date: '2026-10-15',
      url: 'https://example.com/study',
      title: 'Study Page',
      headings: ['Section 1', 'Sub A'],
      seconds: 120,
      task: 'S1-04',
    },
    ts: 1000,
  });
  // 옮김을 마친 db 로 보이게(openReadDb 는 migrated_at 이 있어야 db 를 쓴다)
  db.raw.prepare("INSERT INTO meta (key, value) VALUES ('migrated_at', '1')").run();
  db.close();

  const dataWithDb = loadNotesData(dir);
  assert.ok(Array.isArray(dataWithDb.dwell), 'dwell 배열이 존재해야 함');
  assert.equal(dataWithDb.dwell.length, 1);
  assert.equal(dataWithDb.dwell[0].date, '2026-10-15');
  assert.equal(dataWithDb.dwell[0].url, 'https://example.com/study');
  assert.equal(dataWithDb.dwell[0].title, 'Study Page');
  assert.deepEqual(dataWithDb.dwell[0].headings, ['Section 1', 'Sub A']);
  assert.equal(dataWithDb.dwell[0].seconds, 120);
  assert.equal(dataWithDb.dwell[0].task, 'S1-04');

  // 2. DB가 없는 JSON 경로면 dwell 빈 배열
  const emptyDir = mkdtempSync(join(tmpdir(), 'rg-t40b-ds-empty-'));
  const dataFromEmpty = loadNotesData(emptyDir);
  assert.ok(Array.isArray(dataFromEmpty.dwell), 'JSON 모드에서도 dwell 배열 존재');
  assert.equal(dataFromEmpty.dwell.length, 0, 'JSON 모드면 dwell은 빈 배열');
});

// ---------------------------------------------------------------------------
// 5. export-notes: minutes 앞머리 (합 ÷ 60 반올림, 0이면 생략)
// ---------------------------------------------------------------------------
test('export-notes: 앞머리 minutes (합 ÷ 60 반올림, 0이면 생략)', () => {
  const url = 'https://example.com/page';

  // 1. seconds = 90초 -> 90 / 60 = 1.5 -> 반올림 2분
  const data1 = {
    scraps: {
      v: 1,
      scraps: {
        s1: {
          id: 's1',
          url,
          title: 'Page Title',
          headings: ['H1'],
          quote: { exact: 'Important sentence' },
          ts: 1000,
        },
      },
    },
    dwell: [
      {
        date: '2026-10-15',
        url,
        title: 'Page Title',
        headings: ['H1'],
        seconds: 90,
      },
    ],
  };

  const docs1 = renderNoteDocs(data1);
  const content1 = [...docs1.values()][0];
  assert.match(content1, /minutes:\s*2/, '90초는 반올림 2분');

  // 2. seconds = 25초 -> 25 / 60 = 0.42 -> 반올림 0분 -> minutes 줄 생략
  const data2 = {
    scraps: {
      v: 1,
      scraps: {
        s1: {
          id: 's1',
          url,
          title: 'Page Title',
          headings: ['H1'],
          quote: { exact: 'Another sentence' },
          ts: 1000,
        },
      },
    },
    dwell: [
      {
        date: '2026-10-15',
        url,
        title: 'Page Title',
        headings: ['H1'],
        seconds: 25,
      },
    ],
  };

  const docs2 = renderNoteDocs(data2);
  const content2 = [...docs2.values()][0];
  assert.doesNotMatch(content2, /minutes:/, '0분이면 minutes 줄 생략');

  // 3. 여러 날짜 seconds 합산 (30초 + 30초 = 60초 -> 1분)
  const data3 = {
    scraps: {
      v: 1,
      scraps: {
        s1: {
          id: 's1',
          url,
          title: 'Page Title',
          headings: ['H1'],
          quote: { exact: 'Sentence' },
          ts: 1000,
        },
      },
    },
    dwell: [
      { date: '2026-10-14', url, title: 'T', headings: ['H1'], seconds: 30 },
      { date: '2026-10-15', url, title: 'T', headings: ['H1'], seconds: 30 },
    ],
  };

  const docs3 = renderNoteDocs(data3);
  const content3 = [...docs3.values()][0];
  assert.match(content3, /minutes:\s*1/, '30초 + 30초 = 60초 -> 1분');
});

// ---------------------------------------------------------------------------
// 6. export-notes: 소제목 제목 줄 끝 · N분 (1분 이상만, 사슬 매칭)
// ---------------------------------------------------------------------------
test('export-notes: 소제목 제목 줄 끝 · N분 (1분 이상만, 사슬 매칭)', () => {
  const url = 'https://example.com/article';

  const data = {
    scraps: {
      v: 1,
      scraps: {
        s1: {
          id: 's1',
          url,
          title: 'Article',
          headings: ['Chapter 1', 'Section A'],
          quote: { exact: 'Content under Section A' },
          ts: 1000,
        },
        s2: {
          id: 's2',
          url,
          title: 'Article',
          headings: ['Chapter 1', 'Section B'],
          quote: { exact: 'Content under Section B' },
          ts: 2000,
        },
        s3: {
          id: 's3',
          url,
          title: 'Article',
          headings: ['Chapter 2'],
          quote: { exact: 'Content under Chapter 2' },
          ts: 3000,
        },
      },
    },
    dwell: [
      // Section A: 130초 -> 2분
      {
        date: '2026-10-15',
        url,
        title: 'Article',
        headings: ['Chapter 1', 'Section A'],
        seconds: 130,
      },
      // Section B: 45초 -> 60초 미만 (1분 미만)이므로 분 표시 생략
      {
        date: '2026-10-15',
        url,
        title: 'Article',
        headings: ['Chapter 1', 'Section B'],
        seconds: 45,
      },
      // Chapter 2: 70초 -> 1분
      {
        date: '2026-10-15',
        url,
        title: 'Article',
        headings: ['Chapter 2'],
        seconds: 70,
      },
      // 사슬이 다른 dwell (Chapter 99)은 Section A나 Chapter 2에 더해지지 않음
      {
        date: '2026-10-15',
        url,
        title: 'Article',
        headings: ['Chapter 99', 'Section A'],
        seconds: 500,
      },
    ],
  };

  const docs = renderNoteDocs(data);
  const content = [...docs.values()][0];

  // Section A 줄 끝에 ' · 2분'
  assert.match(content, /### Section A · 2분/, '사슬 일치 및 130초는 2분 표시');

  // Section B는 45초로 1분 미만이므로 분 표시 없음
  assert.match(content, /### Section B(?:\n|$)/, '1분 미만이면 분 표시 생략');
  assert.doesNotMatch(content, /### Section B ·/, 'Section B에 분 라벨이 없어야 함');

  // Chapter 2 줄 끝에 ' · 1분'
  assert.match(content, /## Chapter 2 · 1분/, '70초는 1분 표시');
});

// ---------------------------------------------------------------------------
// 7. export-notes: dwell만 있고 다른 항목 없는 페이지는 노트를 만들지 않음
// ---------------------------------------------------------------------------
test('export-notes: dwell만 있고 다른 항목 없는 페이지는 노트를 만들지 않음', () => {
  const data = {
    scraps: {
      v: 1,
      scraps: {
        s1: {
          id: 's1',
          url: 'https://example.com/has-notes',
          title: 'Has Notes',
          headings: ['H1'],
          quote: { exact: 'Important sentence' },
          ts: 1000,
        },
      },
    },
    dwell: [
      // 노트를 만드는 페이지의 dwell
      {
        date: '2026-10-15',
        url: 'https://example.com/has-notes',
        title: 'Has Notes',
        headings: ['H1'],
        seconds: 120,
      },
      // 다른 항목(메모, 스크랩, 개념 등)이 전혀 없는 페이지만의 dwell
      {
        date: '2026-10-15',
        url: 'https://example.com/dwell-only',
        title: 'Dwell Only Page',
        headings: ['Intro'],
        seconds: 600,
      },
    ],
  };

  const docs = renderNoteDocs(data);
  assert.equal(docs.size, 1, 'dwell만 있는 페이지는 노트를 만들지 않아 1개만 생성되어야 함');

  const keys = [...docs.keys()];
  assert.ok(keys.some((k) => k.includes('has-notes')), 'has-notes 문서는 생성');
  assert.ok(!keys.some((k) => k.includes('dwell-only')), 'dwell-only 문서는 생성되지 않아야 함');
});

// ---------------------------------------------------------------------------
// 8. memo-pad.js 소스 검사: 메모장 타이머는 열려 있을 때만
// ---------------------------------------------------------------------------
test('memo-pad.js 소스 검사: 메모장 타이머는 열려 있을 때만 갱신 및 닫힐 때 해제', () => {
  const code = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

  // 1. 타이머 인터벌 생성 (1초 주기)
  assert.match(
    code,
    /setInterval\s*\(\s*(?:updateStudyTimeUI|[a-zA-Z0-9_$]+)\s*,\s*1000\s*\)/,
    '1초마다 갱신하는 setInterval 이 존재해야 함',
  );

  // 2. 타이머 해제 (clearInterval)
  assert.match(
    code,
    /clearInterval\s*\(\s*(?:studyTimeTimer|[a-zA-Z0-9_$]+Timer)\s*\)/,
    '타이머를 clearInterval 로 해제하는 코드가 있어야 함',
  );

  // 3. closePad 안에서 타이머 해제 호출 확인
  const closePadMatch = code.match(/function\s+closePad\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}\n/);
  assert.ok(closePadMatch, 'closePad 함수가 존재해야 함');
  const closePadBody = closePadMatch[1];
  assert.match(
    closePadBody,
    /(?:clearInterval|stopStudyTimeTimer)/,
    'closePad 안에서 타이머를 멈추거나 stopStudyTimeTimer를 호출해야 함',
  );

  // 4. openPad 안에서 타이머 시작 확인
  const openPadMatch = code.match(/function\s+openPad\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}\n/);
  assert.ok(openPadMatch, 'openPad 함수가 존재해야 함');
  const openPadBody = openPadMatch[1];
  assert.match(
    openPadBody,
    /(?:startStudyTimeTimer|updateStudyTimeUI)/,
    'openPad 안에서 타이머 시작 또는 UI 갱신을 호출해야 함',
  );
});

// ---------------------------------------------------------------------------
// 9. memo-pad.js 소스 검사: readglossStudyTime 연동 및 tocLabel 분 처리
// ---------------------------------------------------------------------------
test('memo-pad.js 소스 검사: readglossStudyTime 연동 및 tocLabel 분 처리', () => {
  const code = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

  // pageSecondsToday, isCounting, sectionSeconds 연동
  assert.match(code, /globalThis\.readglossStudyTime/);
  assert.match(code, /\.pageSecondsToday\(\)/);
  assert.match(code, /\.isCounting\b/);
  assert.match(code, /\.sectionSeconds\b/);

  // ⏱, ⏸ 이모지 사용
  assert.match(code, /⏱/);
  assert.match(code, /⏸/);

  // tocLabel 호출 시 minutes 인자 전달
  assert.match(code, /tocLabel\s*\(\s*\{[\s\S]*?minutes[\s\S]*?\}\s*\)/);
});
