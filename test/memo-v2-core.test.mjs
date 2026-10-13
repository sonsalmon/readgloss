import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';

// memo-core.js는 classic script이므로 전역에서 함수를 불러온다.
await import('../extension/selection-core.js');
await import('../extension/memo-core.js');

const {
  buildSections,
  activeSectionKey,
  shouldMoveCaret,
  padKeyV2,
  clampRect,
  canSave,
} = globalThis.readglossMemo;

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-memov2-test-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dir };
}

// ---------------------------------------------------------------------------
// 1. bridge/memos.mjs: parseMemoOp 의 quote 검증 및 저장 후 list 확인
// ---------------------------------------------------------------------------

test('parseMemoOp: quote 선택 칸 상한 및 형식 검사', () => {
  const baseValid = {
    op: 'save',
    text: '메모 내용',
    url: 'https://portswigger.net/web-security/access-control',
  };

  // 1. 정상 quote 객체
  const validQuote = {
    ...baseValid,
    quote: {
      exact: '인용된 텍스트입니다.',
      prefix: '앞 문맥 ',
      suffix: ' 뒤 문맥',
    },
  };
  const parsed1 = parseMemoOp(validQuote);
  assert.ok(parsed1);
  assert.deepEqual(parsed1.quote, {
    exact: '인용된 텍스트입니다.',
    prefix: '앞 문맥 ',
    suffix: ' 뒤 문맥',
  });

  // 2. quote가 생략되거나 null인 경우 (선택 칸)
  assert.equal(parseMemoOp({ ...baseValid, quote: null })?.quote, null);
  assert.equal(parseMemoOp({ ...baseValid, quote: undefined })?.quote, null);
  assert.equal(parseMemoOp(baseValid)?.quote, null);

  // 3. exact 경계값: 1~1000자
  assert.equal(parseMemoOp({ ...baseValid, quote: { exact: '' } }), null);
  assert.equal(parseMemoOp({ ...baseValid, quote: { exact: 'a'.repeat(1001) } }), null);
  assert.ok(parseMemoOp({ ...baseValid, quote: { exact: 'a' } }));
  assert.ok(parseMemoOp({ ...baseValid, quote: { exact: 'a'.repeat(1000) } }));

  // 4. prefix, suffix 경계값: 각 <= 64자 (생략 시 빈 문자열)
  assert.ok(parseMemoOp({ ...baseValid, quote: { exact: '본문', prefix: 'p'.repeat(64), suffix: 's'.repeat(64) } }));
  assert.equal(parseMemoOp({ ...baseValid, quote: { exact: '본문', prefix: 'p'.repeat(65) } }), null);
  assert.equal(parseMemoOp({ ...baseValid, quote: { exact: '본문', suffix: 's'.repeat(65) } }), null);
  const parsedOmittedPrefix = parseMemoOp({ ...baseValid, quote: { exact: '본문' } });
  assert.equal(parsedOmittedPrefix?.quote?.prefix, '');
  assert.equal(parsedOmittedPrefix?.quote?.suffix, '');

  // 5. quote 형식 오류 (객체 아님, 배열 등)
  assert.equal(parseMemoOp({ ...baseValid, quote: '문자열' }), null);
  assert.equal(parseMemoOp({ ...baseValid, quote: ['배열'] }), null);
  assert.equal(parseMemoOp({ ...baseValid, quote: 123 }), null);

  // 6. 옛 selection 필드도 함께 또는 단독으로 정상 수신
  const withSelection = parseMemoOp({ ...baseValid, selection: '옛 선택글', quote: { exact: '인용' } });
  assert.equal(withSelection?.selection, '옛 선택글');
  assert.equal(withSelection?.quote?.exact, '인용');
});

test('createMemos: quote 포함 메모 저장 후 list() 및 forUrl()에서 quote 반환', () => {
  const { db } = createTempDb();
  const memos = createMemos({ db, now: () => 1000 });

  const saved = memos.apply({
    op: 'save',
    text: '인용이 있는 메모',
    url: 'https://example.com/page',
    quote: {
      exact: '중요한 본문 인용',
      prefix: '앞 ',
      suffix: ' 뒤',
    },
    selection: '옛 selection',
  });

  assert.ok(saved);
  assert.deepEqual(saved.quote, {
    exact: '중요한 본문 인용',
    prefix: '앞 ',
    suffix: ' 뒤',
  });
  assert.equal(saved.selection, '옛 selection');

  // list() 확인
  const list = memos.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].quote, {
    exact: '중요한 본문 인용',
    prefix: '앞 ',
    suffix: ' 뒤',
  });

  // forUrl() 확인
  const forUrlItems = memos.forUrl('https://example.com/page');
  assert.equal(forUrlItems.length, 1);
  assert.deepEqual(forUrlItems[0].quote, {
    exact: '중요한 본문 인용',
    prefix: '앞 ',
    suffix: ' 뒤',
  });

  db.close();
});

// ---------------------------------------------------------------------------
// 2. extension/memo-core.js 순수 함수 시험
// ---------------------------------------------------------------------------

test('buildSections: headings와 memos를 소제목별 칸으로 묶고 ts 오름차순 정렬', () => {
  const headings = [
    { key: 'h_1', text: 'Access control vulnerabilities', level: 2 },
    { key: 'h_2', text: 'Vertical privilege escalation', level: 3 },
  ];

  const memos = [
    {
      id: 'm_2',
      text: '수직 권한 상승 메모 2',
      headings: ['Access control vulnerabilities', 'Vertical privilege escalation'],
      ts: 200,
    },
    {
      id: 'm_1',
      text: '수직 권한 상승 메모 1 (오래된 것)',
      // 대소문자 및 공백 차이가 있어도 일치해야 함
      headings: ['ACCESS CONTROL VULNERABILITIES', '  vertical   privilege   escalation  '],
      ts: 100,
    },
    {
      id: 'm_3',
      text: '첫 번째 소제목 메모',
      headings: ['Access control vulnerabilities'],
      ts: 150,
    },
    {
      id: 'm_4',
      text: '소제목 없는 메모는 첫 칸으로',
      headings: [],
      ts: 50,
    },
    {
      id: 'm_5',
      text: '일치하지 않는 소제목 메모도 첫 칸으로',
      headings: ['Unknown Heading'],
      ts: 70,
    },
  ];

  const sections = buildSections(headings, memos, '페이지 제목');
  assert.equal(sections.length, 2);

  // 첫 번째 섹션: h_1
  assert.equal(sections[0].key, 'h_1');
  assert.equal(sections[0].text, 'Access control vulnerabilities');
  assert.equal(sections[0].level, 2);
  // ts 오름차순: m_4(50), m_5(70), m_3(150)
  assert.deepEqual(sections[0].memos.map((m) => m.id), ['m_4', 'm_5', 'm_3']);

  // 두 번째 섹션: h_2
  assert.equal(sections[1].key, 'h_2');
  assert.equal(sections[1].text, 'Vertical privilege escalation');
  // ts 오름차순: m_1(100), m_2(200)
  assert.deepEqual(sections[1].memos.map((m) => m.id), ['m_1', 'm_2']);
});

test('buildSections: headings가 비어있으면 _page 단일 칸 반환', () => {
  const memos = [
    { id: 'm_2', text: '메모 2', ts: 300 },
    { id: 'm_1', text: '메모 1', ts: 100 },
  ];

  // headings가 빈 배열인 경우
  const resEmpty = buildSections([], memos, '테스트 페이지');
  assert.equal(resEmpty.length, 1);
  assert.equal(resEmpty[0].key, '_page');
  assert.equal(resEmpty[0].text, '테스트 페이지');
  assert.equal(resEmpty[0].level, 1);
  // ts 오름차순
  assert.deepEqual(resEmpty[0].memos.map((m) => m.id), ['m_1', 'm_2']);

  // headings가 null/undefined인 경우
  const resNull = buildSections(null, [], '빈 페이지');
  assert.equal(resNull.length, 1);
  assert.equal(resNull[0].key, '_page');
  assert.deepEqual(resNull[0].memos, []);
});

test('activeSectionKey: top <= vh/3 중 마지막 key, 없으면 첫 key, 빈 배열이면 _page', () => {
  const headingTops = [
    { key: 'h_1', top: 50 },
    { key: 'h_2', top: 200 },
    { key: 'h_3', top: 500 },
  ];

  // 1. vh = 600 -> 기준선 200px. top <= 200인 [h_1, h_2] 중 마지막은 h_2
  assert.equal(activeSectionKey(headingTops, 600), 'h_2');

  // 2. vh = 300 -> 기준선 100px. top <= 100인 [h_1] 중 마지막은 h_1
  assert.equal(activeSectionKey(headingTops, 300), 'h_1');

  // 3. vh = 100 -> 기준선 33.3px. 33.3px 이하 없음 -> 첫 key인 h_1 반환
  assert.equal(activeSectionKey(headingTops, 100), 'h_1');

  // 4. 경계값: top === vh/3 정확히 일치하는 경우 포함
  assert.equal(activeSectionKey([{ key: 'k_border', top: 100 }], 300), 'k_border');

  // 5. 빈 배열이거나 유효하지 않은 입력 -> '_page'
  assert.equal(activeSectionKey([], 600), '_page');
  assert.equal(activeSectionKey(null, 600), '_page');
});

test('shouldMoveCaret: now - lastTypedAt >= 1500 판정', () => {
  // 1. 정상: 1.5초 이상 경과 시 true
  assert.equal(shouldMoveCaret(1000, 2600), true); // 1600ms >= 1500

  // 2. 경계값: 정확히 1500ms -> true, 1499ms -> false, 1501ms -> true
  assert.equal(shouldMoveCaret(1000, 2500), true);
  assert.equal(shouldMoveCaret(1000, 2499), false);
  assert.equal(shouldMoveCaret(1000, 2501), true);

  // 3. 빈 값 및 잘못된 입력: lastTypedAt이 0, null, undefined인 경우 항상 true
  assert.equal(shouldMoveCaret(0, 1000), true);
  assert.equal(shouldMoveCaret(null, 1000), true);
  assert.equal(shouldMoveCaret(undefined, 1000), true);
});

test('padKeyV2: Enter=newline, ⌘Enter/ctrl+Enter=save, Escape=fold, 그 밖 null', () => {
  // 1. Enter (⌘·ctrl 없음) -> 'newline'
  assert.equal(padKeyV2({ key: 'Enter', metaKey: false, ctrlKey: false, isComposing: false }), 'newline');
  assert.equal(padKeyV2({ key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false, isComposing: false }), 'newline');

  // 2. ⌘Enter 또는 ctrl+Enter (조합 중 아님) -> 'save'
  assert.equal(padKeyV2({ key: 'Enter', metaKey: true, ctrlKey: false, isComposing: false }), 'save');
  assert.equal(padKeyV2({ key: 'Enter', metaKey: false, ctrlKey: true, isComposing: false }), 'save');
  assert.equal(padKeyV2({ key: 'Enter', metaKey: true, ctrlKey: true, isComposing: false }), 'save');

  // 3. IME 조합 중인 경우 -> null (save/newline 방지)
  assert.equal(padKeyV2({ key: 'Enter', metaKey: true, isComposing: true }), null);
  assert.equal(padKeyV2({ key: 'Enter', metaKey: false, ctrlKey: false, isComposing: true }), null);

  // 4. Escape -> 'fold'
  assert.equal(padKeyV2({ key: 'Escape', isComposing: false }), 'fold');

  // 5. 그 밖의 키 및 null -> null
  assert.equal(padKeyV2({ key: 'a', isComposing: false }), null);
  assert.equal(padKeyV2({ key: 'Backspace', isComposing: false }), null);
  assert.equal(padKeyV2(null), null);
});

test('clampRect: width 260~640, height 200~vh-40, left·top 당김 (창 전체가 화면 안, 왼쪽위 0 이상)', () => {
  const viewport = { vw: 1000, vh: 800 };

  // 1. 정상 범위 내 값은 그대로 유지
  const normal = clampRect({ left: 100, top: 100, width: 320, height: 400 }, viewport);
  assert.deepEqual(normal, { left: 100, top: 100, width: 320, height: 400 });

  // 2. width 범위: 260 ~ 640
  assert.equal(clampRect({ width: 100 }, viewport).width, 260);
  assert.equal(clampRect({ width: 700 }, viewport).width, 640);
  assert.equal(clampRect({ width: 260 }, viewport).width, 260);
  assert.equal(clampRect({ width: 640 }, viewport).width, 640);

  // 3. height 범위: 200 ~ vh - 40 (vh=800일 때 200 ~ 760)
  assert.equal(clampRect({ height: 150 }, viewport).height, 200);
  assert.equal(clampRect({ height: 900 }, viewport).height, 760);
  assert.equal(clampRect({ height: 760 }, viewport).height, 760);
  assert.equal(clampRect({ height: 200 }, viewport).height, 200);

  // 4. 왼쪽·위 음수 -> 0 이상으로 당김
  const negative = clampRect({ left: -50, top: -20 }, viewport);
  assert.equal(negative.left, 0);
  assert.equal(negative.top, 0);

  // 5. 오른쪽·아래로 넘어가면 창 전체가 화면 안에 들어오게 당김(10-13 메인 세션: 명세 14-2 "안쪽으로 당긴다" 해석)
  // 크기를 안 주면 최소 260×200 → maxLeft = 1000-260 = 740, maxTop = 800-200 = 600
  const overflow = clampRect({ left: 990, top: 850 }, viewport);
  assert.equal(overflow.left, 740);
  assert.equal(overflow.top, 600);

  // 경계값: 창 오른쪽·아래 끝이 화면 끝과 같으면 그대로
  const border = clampRect({ left: 740, top: 600 }, viewport);
  assert.equal(border.left, 740);
  assert.equal(border.top, 600);
});

test('canSave: 글이 공백뿐이고 quote 없으면 false', () => {
  // 1. 글만 있는 경우 -> true
  assert.equal(canSave('메모 내용입니다', null), true);
  assert.equal(canSave('  공백이 있어도 글이 있으면  ', null), true);

  // 2. 인용만 있는 경우 -> true
  assert.equal(canSave('', { exact: '인용문' }), true);
  assert.equal(canSave('   ', { exact: '인용문' }), true);

  // 3. 둘 다 있는 경우 -> true
  assert.equal(canSave('메모', { exact: '인용문' }), true);

  // 4. 글이 공백뿐이거나 빈 문자열이고 quote가 없는 경우 -> false
  assert.equal(canSave('', null), false);
  assert.equal(canSave('   \n\t  ', null), false);
  assert.equal(canSave(null, null), false);
  assert.equal(canSave(undefined, undefined), false);

  // 5. quote가 있지만 exact가 비어있는 경우
  assert.equal(canSave('', { exact: '' }), false);
  assert.equal(canSave('   ', { exact: '   ' }), false);
});
