import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderScrapDocs, pageFileNames, pageKey } from '../scripts/export-scraps.mjs';
import { exportPending, pendingDays } from '../scripts/export-pending.mjs';
import { openDb } from '../bridge/db.mjs';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'readgloss-export-memos-test-'));
}

test('export-scraps: 메모가 있는 페이지 문서에 ## 메모 절과 소제목별 ### <소제목> - <글> (<YYYY-MM-DD>) 생성', () => {
  const scraps = [
    {
      id: 's1',
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control Vulnerabilities',
      headings: ['Introduction'],
      quote: { exact: 'Broken access control is a risk.' },
      translation: '취약한 접근 제어는 위험합니다.',
      memo: '스크랩 메모',
      ts: 1000,
    },
  ];

  const memos = [
    {
      id: 'm1',
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control Vulnerabilities',
      headings: ['Introduction', 'Vertical privilege escalation'],
      text: '관리자 권한 상승 메모',
      ts: 1791443403464, // 2026-10-13 (로컬 기준 날짜)
    },
    {
      id: 'm2',
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control Vulnerabilities',
      headings: ['Introduction', 'Vertical privilege escalation'],
      text: '둘째 권한 상승 메모',
      ts: 1791443403464,
    },
  ];

  const tasks = { 'S1-04': '접근 통제' };
  const docs = renderScrapDocs(scraps, tasks, memos);

  assert.ok(docs.has('S1-04.md'));
  assert.ok(docs.has('S1-04/access-control-vulnerabilities.md'));

  const pageDoc = docs.get('S1-04/access-control-vulnerabilities.md');
  // 스크랩 내용 존재 확인
  assert.match(pageDoc, /> Broken access control is a risk\./);
  assert.match(pageDoc, /번역: 취약한 접근 제어는 위험합니다\./);
  assert.match(pageDoc, /메모: 스크랩 메모/);

  // ## 메모 절 확인
  assert.match(pageDoc, /## 메모/);
  // 소제목 확인
  assert.match(pageDoc, /### Vertical privilege escalation/);
  // 글과 날짜 형식 확인: - <글> (<YYYY-MM-DD>)
  assert.match(pageDoc, /- 관리자 권한 상승 메모 \(\d{4}-\d{2}-\d{2}\)/);
  assert.match(pageDoc, /- 둘째 권한 상승 메모 \(\d{4}-\d{2}-\d{2}\)/);
});

test('export-scraps: 스크랩 없이 메모만 있는 페이지도 문서가 생기고, 메모만 있는 할 일도 할 일 문서에 나옴', () => {
  const scraps = []; // 스크랩 없음!
  const memos = [
    {
      id: 'm1',
      task: 'S1-04',
      url: 'https://example.com/only-memo',
      title: 'Only Memo Page',
      headings: ['Section Memo'],
      text: '스크랩 없는 페이지의 메모',
      ts: 1791443403464,
    },
  ];

  const tasks = { 'S1-04': '접근 통제' };
  const docs = renderScrapDocs(scraps, tasks, memos);

  // 1. 메모만 있어도 할 일 문서가 생겨야 함
  assert.ok(docs.has('S1-04.md'), 'S1-04.md가 생성되어야 함');
  const taskDoc = docs.get('S1-04.md');
  assert.match(taskDoc, /# 접근 통제/);
  assert.match(taskDoc, /- \[\[S1-04\/only-memo-page\]\]/);

  // 2. 스크랩 없는 메모 페이지 문서가 생겨야 함
  assert.ok(docs.has('S1-04/only-memo-page.md'), '페이지 문서가 생성되어야 함');
  const pageDoc = docs.get('S1-04/only-memo-page.md');
  assert.match(pageDoc, /# Only Memo Page/);
  assert.match(pageDoc, /https:\/\/example\.com\/only-memo/);
  assert.match(pageDoc, /## 메모/);
  assert.match(pageDoc, /### Section Memo/);
  assert.match(pageDoc, /- 스크랩 없는 페이지의 메모 \(\d{4}-\d{2}-\d{2}\)/);
});

test('export-scraps: 스크랩과 메모가 같은 페이지면 같은 파일 (pageFileNames 그대로 활용)', () => {
  const scraps = [
    {
      id: 's1',
      task: 'S1-04',
      url: 'https://example.com/same-page',
      title: 'Same Page Title',
      headings: [],
      quote: { exact: '스크랩 내용' },
      ts: 100,
    },
  ];

  const memos = [
    {
      id: 'm1',
      task: 'S1-04',
      url: 'https://example.com/same-page#anchor', // 앵커가 있어도 정규화되어 같은 페이지
      title: 'Same Page Title',
      headings: ['Notes'],
      text: '메모 내용',
      ts: 200,
    },
  ];

  const fileMap = pageFileNames(scraps, memos);
  const key = pageKey('S1-04', 'https://example.com/same-page');
  assert.ok(fileMap.has(key));
  assert.equal(fileMap.get(key), 'S1-04/same-page-title');

  const docs = renderScrapDocs(scraps, { 'S1-04': '접근 통제' }, memos);
  // 같은 파일 하나로 렌더링됨
  assert.ok(docs.has('S1-04/same-page-title.md'));
  assert.ok(!docs.has('S1-04/same-page-title-2.md'));

  const doc = docs.get('S1-04/same-page-title.md');
  assert.match(doc, /> 스크랩 내용/);
  assert.match(doc, /## 메모/);
  assert.match(doc, /### Notes/);
  assert.match(doc, /- 메모 내용 \(\d{4}-\d{2}-\d{2}\)/);
});

test('export-pending: 메모가 있는 날 "메모 N개" 한 줄, 메모만 있는 날도 그 날이 나옴', () => {
  const dir = createTempDir();
  const dbFile = join(dir, 'readgloss.db');
  const db = openDb(dbFile);

  // meta 테이블에 migrated_at 설정
  db.raw.prepare("INSERT INTO meta (key, value) VALUES ('migrated_at', '1')").run();

  // export-state.json 생성 (lastDay: 2026-10-10)
  writeFileSync(join(dir, 'export-state.json'), JSON.stringify({ lastDay: '2026-10-10' }));

  // 2026-10-12에 메모 2건 추가 (스크랩/단어/사전 없음)
  const d1012 = new Date('2026-10-12T12:00:00Z').getTime();
  db.put({
    id: 'm_111111111111',
    kind: 'memo',
    key: 'https://example.com/p1',
    data: { text: '10-12 메모 1', url: 'https://example.com/p1', title: 'P1', headings: [], ts: d1012 },
    ts: d1012,
  });
  db.put({
    id: 'm_222222222222',
    kind: 'memo',
    key: 'https://example.com/p1',
    data: { text: '10-12 메모 2', url: 'https://example.com/p1', title: 'P1', headings: [], ts: d1012 },
    ts: d1012,
  });

  // 2026-10-13에 스크랩 1건과 메모 1건 추가
  const d1013 = new Date('2026-10-13T12:00:00Z').getTime();
  db.put({
    id: 's_111111111111',
    kind: 'scrap',
    key: 'https://example.com/p2',
    data: {
      id: 's_111111111111',
      task: 'S1-04',
      url: 'https://example.com/p2',
      title: 'P2',
      headings: [],
      quote: { exact: 'scrap text' },
      ts: d1013,
    },
    ts: d1013,
  });
  db.put({
    id: 'm_333333333333',
    kind: 'memo',
    key: 'https://example.com/p2',
    data: { text: '10-13 메모', url: 'https://example.com/p2', title: 'P2', headings: [], ts: d1013 },
    ts: d1013,
  });

  db.close();

  // 1. pendingDays 검사: 메모만 있는 10-12도 포함되어야 함
  const days = pendingDays(dir, '2026-10-14');
  assert.ok(days.includes('2026-10-12'), '메모만 있는 2026-10-12가 포함되어야 함');
  assert.ok(days.includes('2026-10-13'), '2026-10-13이 포함되어야 함');

  // 2. exportPending 검사
  const pendingOut = exportPending(dir, '2026-10-14');

  // 10-12 섹션에 "메모 2개" 포함 확인
  assert.match(pendingOut, /### 2026-10-12/);
  assert.match(pendingOut, /메모 2개/);

  // 10-13 섹션에 스크랩과 "메모 1개" 포함 확인
  assert.match(pendingOut, /### 2026-10-13/);
  assert.match(pendingOut, /스크랩 1개 → scraps\/S1-04\.md/);
  assert.match(pendingOut, /메모 1개/);
});
