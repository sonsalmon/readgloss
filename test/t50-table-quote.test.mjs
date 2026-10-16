import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. 순수 함수 모듈 로드
await import('../extension/memo-core.js');

const { tableQuoteFrom } = globalThis.readglossMemo;

// 2. 다리 모듈 로드
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';

// 3. export-notes 모듈 로드
import { renderMemo } from '../scripts/export-notes.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t50-test-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dbFile, dir };
}

// -----------------------------------------------------------------------------
// 1. tableQuoteFrom 순수 함수 시험
// -----------------------------------------------------------------------------
test('tableQuoteFrom: thead 머리줄, th 첫 줄 머리줄, 머리줄 없음', () => {
  // 1-1. thead 머리줄: inThead인 첫 줄이 머리줄이 되고 rows에서는 제외됨
  const rowsWithThead = [
    {
      cells: [{ text: '열 1', th: true }, { text: '열 2', th: true }],
      inThead: true,
      selected: true,
    },
    {
      cells: [{ text: '값 1', th: false }, { text: '값 2', th: false }],
      inThead: false,
      selected: true,
    },
  ];
  const res1 = tableQuoteFrom(rowsWithThead);
  assert.ok(res1);
  assert.deepEqual(res1.table.head, ['열 1', '열 2']);
  assert.deepEqual(res1.table.rows, [['값 1', '값 2']]);
  assert.equal(res1.truncated, false);

  // 1-2. th 첫 줄 머리줄: inThead는 없지만 첫 줄의 칸이 모두 th인 경우 머리줄로 인정
  const rowsWithThFirst = [
    {
      cells: [{ text: '헤더 A', th: true }, { text: '헤더 B', th: true }],
      inThead: false,
      selected: false,
    },
    {
      cells: [{ text: '본문 1', th: false }, { text: '본문 2', th: false }],
      inThead: false,
      selected: true,
    },
  ];
  const res2 = tableQuoteFrom(rowsWithThFirst);
  assert.ok(res2);
  assert.deepEqual(res2.table.head, ['헤더 A', '헤더 B']);
  assert.deepEqual(res2.table.rows, [['본문 1', '본문 2']]);
  assert.equal(res2.truncated, false);

  // 1-3. 머리줄 없음: inThead도 없고 첫 줄에 th가 아닌 칸이 포함된 경우 head는 null
  const rowsNoHead = [
    {
      cells: [{ text: '항목 1', th: false }, { text: '항목 2', th: true }],
      inThead: false,
      selected: true,
    },
    {
      cells: [{ text: '항목 3', th: false }, { text: '항목 4', th: false }],
      inThead: false,
      selected: true,
    },
  ];
  const res3 = tableQuoteFrom(rowsNoHead);
  assert.ok(res3);
  assert.equal(res3.table.head, null);
  assert.deepEqual(res3.table.rows, [
    ['항목 1', '항목 2'],
    ['항목 3', '항목 4'],
  ]);
  assert.equal(res3.truncated, false);
});

test('tableQuoteFrom: 고른 줄만 선택, 공백 정리, 빈 결과 null', () => {
  // 2-1. selected가 true인 줄만 rows에 들어감
  const rows = [
    {
      cells: [{ text: 'H1', th: true }, { text: 'H2', th: true }],
      inThead: true,
      selected: false,
    },
    {
      cells: [{ text: 'R1 C1', th: false }, { text: 'R1 C2', th: false }],
      inThead: false,
      selected: false, // 선택되지 않음
    },
    {
      cells: [{ text: '  R2   C1  ', th: false }, { text: 'R2\n\tC2', th: false }],
      inThead: false,
      selected: true, // 선택됨 (공백 정리 확인)
    },
    {
      cells: [{ text: 'R3 C1', th: false }, { text: 'R3 C2', th: false }],
      inThead: false,
      selected: false, // 선택되지 않음
    },
  ];
  const res = tableQuoteFrom(rows);
  assert.ok(res);
  assert.deepEqual(res.table.head, ['H1', 'H2']);
  assert.deepEqual(res.table.rows, [['R2 C1', 'R2 C2']]);

  // 2-2. rows가 비면 null
  // (1) 선택된 줄이 하나도 없는 경우
  const noneSelected = [
    { cells: [{ text: 'H1', th: true }], inThead: true, selected: false },
    { cells: [{ text: 'D1', th: false }], inThead: false, selected: false },
  ];
  assert.equal(tableQuoteFrom(noneSelected), null);

  // (2) thead 머리줄만 선택되고 본문 줄은 선택 안 된 경우 (머리줄 제외 후 rows가 비므로 null)
  const onlyHeadSelected = [
    { cells: [{ text: 'H1', th: true }], inThead: true, selected: true },
    { cells: [{ text: 'D1', th: false }], inThead: false, selected: false },
  ];
  assert.equal(tableQuoteFrom(onlyHeadSelected), null);

  // (3) 빈 배열 또는 비정상 입력
  assert.equal(tableQuoteFrom([]), null);
  assert.equal(tableQuoteFrom(null), null);
  assert.equal(tableQuoteFrom(undefined), null);
});

test('tableQuoteFrom: 상한 자르기 (8칸, 30줄, 칸 300자)와 truncated', () => {
  // 3-1. 8칸 초과 -> 8칸으로 자르고 truncated: true
  const wideRows = [
    {
      cells: Array.from({ length: 12 }, (_, i) => ({ text: `C${i + 1}`, th: false })),
      inThead: false,
      selected: true,
    },
  ];
  const resWide = tableQuoteFrom(wideRows);
  assert.ok(resWide);
  assert.equal(resWide.table.rows[0].length, 8);
  assert.deepEqual(resWide.table.rows[0], ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
  assert.equal(resWide.truncated, true);

  // 3-2. 30줄 초과 -> 30줄로 자르고 truncated: true
  const tallRows = Array.from({ length: 35 }, (_, i) => ({
    cells: [{ text: `Row ${i + 1}`, th: false }],
    inThead: false,
    selected: true,
  }));
  const resTall = tableQuoteFrom(tallRows);
  assert.ok(resTall);
  assert.equal(resTall.table.rows.length, 30);
  assert.equal(resTall.table.rows[0][0], 'Row 1');
  assert.equal(resTall.table.rows[29][0], 'Row 30');
  assert.equal(resTall.truncated, true);

  // 3-3. 칸 300자 초과 -> 300자로 자르고 truncated: true
  const longCellRows = [
    {
      cells: [{ text: 'x'.repeat(350), th: false }],
      inThead: false,
      selected: true,
    },
  ];
  const resLong = tableQuoteFrom(longCellRows);
  assert.ok(resLong);
  assert.equal(resLong.table.rows[0][0].length, 300);
  assert.equal(resLong.table.rows[0][0], 'x'.repeat(300));
  assert.equal(resLong.truncated, true);
});

test('tableQuoteFrom: 칸 수 맞추기 (짧은 줄은 빈 문자열로 채움)', () => {
  const unevenRows = [
    {
      cells: [{ text: 'H1', th: true }, { text: 'H2', th: true }, { text: 'H3', th: true }],
      inThead: true,
      selected: false,
    },
    {
      cells: [{ text: 'A1', th: false }],
      inThead: false,
      selected: true,
    },
    {
      cells: [{ text: 'B1', th: false }, { text: 'B2', th: false }],
      inThead: false,
      selected: true,
    },
    {
      cells: [{ text: 'C1', th: false }, { text: 'C2', th: false }, { text: 'C3', th: false }],
      inThead: false,
      selected: true,
    },
  ];
  const res = tableQuoteFrom(unevenRows);
  assert.ok(res);
  assert.deepEqual(res.table.head, ['H1', 'H2', 'H3']);
  assert.deepEqual(res.table.rows, [
    ['A1', '', ''],
    ['B1', 'B2', ''],
    ['C1', 'C2', 'C3'],
  ]);
  assert.equal(res.truncated, false);

  // 머리줄이 본문보다 칸이 적은 경우에도 머리줄 끝이 채워짐
  const headShorter = [
    {
      cells: [{ text: 'H1', th: true }],
      inThead: true,
      selected: false,
    },
    {
      cells: [{ text: 'A1', th: false }, { text: 'A2', th: false }],
      inThead: false,
      selected: true,
    },
  ];
  const resShorter = tableQuoteFrom(headShorter);
  assert.ok(resShorter);
  assert.deepEqual(resShorter.table.head, ['H1', '']);
  assert.deepEqual(resShorter.table.rows, [['A1', 'A2']]);
});

// -----------------------------------------------------------------------------
// 2. 다리 memos quote.table 검사 시험
// -----------------------------------------------------------------------------
test('memos quote.table 검사: 맞음 200과 재시작 뒤 남음', () => {
  const { db, dbFile } = createTempDb();
  const memos1 = createMemos({ db, now: () => 1000 });

  const op = {
    op: 'save',
    text: '표 인용 메모',
    url: 'https://example.com/table-doc',
    quote: {
      exact: 'Col1 Col2 Row1A Row1B',
      prefix: '',
      suffix: '',
      table: {
        head: ['Col1', 'Col2'],
        rows: [['Row1A', 'Row1B'], ['Row2A', 'Row2B']],
      },
    },
  };

  const parsed = parseMemoOp(op);
  assert.ok(parsed);
  assert.deepEqual(parsed.quote.table, {
    head: ['Col1', 'Col2'],
    rows: [['Row1A', 'Row1B'], ['Row2A', 'Row2B']],
  });

  const saved = memos1.apply(parsed);
  assert.ok(saved);
  assert.deepEqual(saved.quote.table, {
    head: ['Col1', 'Col2'],
    rows: [['Row1A', 'Row1B'], ['Row2A', 'Row2B']],
  });

  // DB 재시작 뒤 보존 확인
  db.close();
  const db2 = openDb(dbFile);
  const memos2 = createMemos({ db: db2 });

  const list = memos2.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].quote.table, {
    head: ['Col1', 'Col2'],
    rows: [['Row1A', 'Row1B'], ['Row2A', 'Row2B']],
  });

  const forUrl = memos2.forUrl('https://example.com/table-doc');
  assert.equal(forUrl.length, 1);
  assert.deepEqual(forUrl[0].quote.table, {
    head: ['Col1', 'Col2'],
    rows: [['Row1A', 'Row1B'], ['Row2A', 'Row2B']],
  });

  db2.close();
});

test('memos quote.table 검사: head가 null인 경우도 허용 및 재시작 뒤 유지', () => {
  const { db, dbFile } = createTempDb();
  const memos1 = createMemos({ db, now: () => 2000 });

  const op = {
    op: 'save',
    text: '머리줄 없는 표 인용',
    url: 'https://example.com/no-head',
    quote: {
      exact: 'A B C D',
      prefix: '',
      suffix: '',
      table: {
        head: null,
        rows: [['A', 'B'], ['C', 'D']],
      },
    },
  };

  const parsed = parseMemoOp(op);
  assert.ok(parsed);
  assert.equal(parsed.quote.table.head, null);
  assert.deepEqual(parsed.quote.table.rows, [['A', 'B'], ['C', 'D']]);

  const saved = memos1.apply(parsed);
  assert.ok(saved);
  assert.equal(saved.quote.table.head, null);

  db.close();
  const db2 = openDb(dbFile);
  const memos2 = createMemos({ db: db2 });
  const list = memos2.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].quote.table.head, null);
  assert.deepEqual(list[0].quote.table.rows, [['A', 'B'], ['C', 'D']]);
  db2.close();
});

test('memos quote.table 검사: 틀린 모양 400', () => {
  const base = {
    op: 'save',
    text: '검사 메모',
    url: 'https://example.com/invalid',
    quote: {
      exact: 'dummy quote',
      prefix: '',
      suffix: '',
    },
  };

  // 1. table이 객체가 아닌 경우
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: 'string' } }), null);
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: 123 } }), null);
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: [] } }), null);

  // 2. head 유효성 위반
  // head가 문자열이나 숫자인 경우
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: { head: 'H1', rows: [['A']] } } }), null);
  // head 배열이 빈 경우 (0개)
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: { head: [], rows: [['A']] } } }), null);
  // head 칸 수가 8 초과인 경우 (9개)
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: Array(9).fill('h'), rows: [['A']] } },
  }), null);
  // head 칸이 300자 초과인 경우
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: ['x'.repeat(301)], rows: [['A']] } },
  }), null);
  // head 칸이 문자열이 아닌 경우
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: [123], rows: [['A']] } },
  }), null);

  // 3. rows 유효성 위반
  // rows가 배열이 아닌 경우
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: { head: null, rows: 'invalid' } } }), null);
  // rows가 비어있는 경우 (0개)
  assert.equal(parseMemoOp({ ...base, quote: { ...base.quote, table: { head: null, rows: [] } } }), null);
  // rows 줄 수가 30 초과인 경우 (31개)
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: null, rows: Array(31).fill(['A']) } },
  }), null);
  // row가 배열이 아닌 경우
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: null, rows: ['not-an-array'] } },
  }), null);
  // row 칸 수가 0개이거나 8 초과인 경우
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: null, rows: [[]] } },
  }), null);
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: null, rows: [Array(9).fill('v')] } },
  }), null);
  // row 칸이 300자 초과인 경우
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: null, rows: [['y'.repeat(301)]] } },
  }), null);
  // row 칸이 문자열이 아닌 경우
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, table: { head: null, rows: [[123]] } },
  }), null);
});

test('memos quote.table 검사: table 있을 때 exact 4000 허용, table 없을 때 기존 상한(1000) 유지', () => {
  const baseTable = {
    op: 'save',
    text: '표 메모',
    url: 'https://example.com/exact-test',
    quote: {
      exact: 'a'.repeat(4000),
      prefix: '',
      suffix: '',
      table: {
        head: ['H1'],
        rows: [['D1']],
      },
    },
  };

  // table 있을 때 exact 4000 허용
  assert.ok(parseMemoOp(baseTable));
  // 4001자는 거절
  assert.equal(parseMemoOp({
    ...baseTable,
    quote: { ...baseTable.quote, exact: 'a'.repeat(4001) },
  }), null);

  // table 없을 때: 1000자 허용, 1001자는 거절
  const baseNoTable = {
    op: 'save',
    text: '일반 메모',
    url: 'https://example.com/exact-test-plain',
    quote: {
      exact: 'b'.repeat(1000),
      prefix: '',
      suffix: '',
    },
  };
  assert.ok(parseMemoOp(baseNoTable));
  assert.equal(parseMemoOp({
    ...baseNoTable,
    quote: { ...baseNoTable.quote, exact: 'b'.repeat(1001) },
  }), null);
});

// -----------------------------------------------------------------------------
// 3. export-notes 표 모양 시험
// -----------------------------------------------------------------------------
test('export-notes 표 모양: | 이스케이프, 줄바꿈 공백 치환, 원문 링크, 메모 글', () => {
  const memoWithTable = {
    url: 'https://example.com/spec',
    quote: {
      exact: '명령어 | 옵션 기능 요약',
      table: {
        head: ['명령 | 키', '설명\n(줄바꿈)'],
        rows: [
          ['ls | grep', '목록 | 검색'],
          ['cat', '내용\r\n출력'],
        ],
      },
    },
    text: '셸 명령어 표 정리',
  };

  const rendered = renderMemo(memoWithTable);

  // 기대 출력:
  // | 명령 \| 키 | 설명 (줄바꿈) |
  // | --- | --- |
  // | ls \| grep | 목록 \| 검색 |
  // | cat | 내용 출력 |
  // [↗](링크)
  //
  // 셸 명령어 표 정리
  assert.ok(rendered.includes('| 명령 \\| 키 | 설명 (줄바꿈) |'));
  assert.ok(rendered.includes('| --- | --- |'));
  assert.ok(rendered.includes('| ls \\| grep | 목록 \\| 검색 |'));
  assert.ok(rendered.includes('| cat | 내용 출력 |'));
  assert.match(rendered, /\[↗\]\(https:\/\/example\.com\/spec#:~:text=/);
  assert.match(rendered, /\n\n셸 명령어 표 정리$/);
});

test('export-notes 표 모양: 머리줄(head) 없음 -> 첫 줄을 머리줄로 씀', () => {
  const memoNoHead = {
    url: 'https://example.com/no-head-table',
    quote: {
      exact: '항목 설명 값 10',
      table: {
        head: null,
        rows: [
          ['항목', '설명'],
          ['값', '10'],
        ],
      },
    },
    text: '첫 줄이 헤더가 됨',
  };

  const rendered = renderMemo(memoNoHead);
  // 첫 줄 ['항목', '설명']이 머리줄이 되고 구분선 후 두 번째 줄이 데이터가 됨
  assert.ok(rendered.startsWith('| 항목 | 설명 |\n| --- | --- |\n| 값 | 10 |'));
  assert.ok(rendered.includes('[↗]('));
  assert.ok(rendered.endsWith('\n\n첫 줄이 헤더가 됨'));
});

test('export-notes 표 모양: 링크가 없는 경우 링크 줄 없음', () => {
  const memoNoUrl = {
    url: '',
    quote: {
      exact: 'A B 1 2',
      table: {
        head: ['A', 'B'],
        rows: [['1', '2']],
      },
    },
    text: '로컬 표 메모',
  };

  const rendered = renderMemo(memoNoUrl);
  assert.equal(rendered, '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n로컬 표 메모');
});

// -----------------------------------------------------------------------------
// 4. 소스 코드 정적 검사
// -----------------------------------------------------------------------------
test('소스 정적 검사: handleMemoOpen에서 closest("table")과 intersectsNode 사용, createMemoLine 표 그리기에 innerHTML 없음', () => {
  const padCode = readFileSync(join(fileURLToPath(import.meta.url), '../../extension/memo-pad.js'), 'utf8');

  // 1. handleMemoOpen에서 closest('table') 사용 확인
  assert.match(
    padCode,
    /closest\(['"]table['"]\)/,
    'handleMemoOpen에서 closest("table")을 사용하여 표 범위를 확인해야 합니다.'
  );

  // 2. range.intersectsNode(tr) 사용 확인
  assert.match(
    padCode,
    /intersectsNode\s*\(/,
    'tr 선택 여부 판정에 intersectsNode를 사용해야 합니다.'
  );

  // 3. createMemoLine 구현 영역에서 innerHTML이 사용되지 않음 확인
  const memoLineStart = padCode.indexOf('function createMemoLine(');
  assert.ok(memoLineStart !== -1, 'createMemoLine 함수가 존재해야 합니다.');
  const memoLineEnd = padCode.indexOf('function flushPendingConceptSave(', memoLineStart);
  const memoLineSection = padCode.slice(memoLineStart, memoLineEnd !== -1 ? memoLineEnd : memoLineStart + 2000);

  assert.doesNotMatch(
    memoLineSection,
    /innerHTML/,
    'createMemoLine 구현부에서 innerHTML을 사용해서는 안 됩니다.'
  );

  // 4. renderTableElement (표 그리기 헬퍼) 함수에서도 innerHTML 없음 확인
  assert.doesNotMatch(
    padCode,
    /function\s+renderTableElement[\s\S]*?innerHTML/,
    '표 그리기 함수 내부에서 innerHTML을 사용해서는 안 됩니다.'
  );
});
