import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/scrap-core.js';
import '../extension/panel-marks.js';

const S = globalThis.readglossScrap;
const P = globalThis.readglossPanelMarks;

// 2026-11-02 15:00 로컬 기준
const now = new Date(2026, 10, 2, 15, 0);
const at = (dayOffset, h = 12, m = 0) => new Date(2026, 10, 2 + dayOffset, h, m).getTime();

const memos = [
  { id: 'm1', mark: 'question', tags: ['security'], text: '질문', url: 'https://a.test/1', title: 'A', ts: at(0, 10, 0),
    quote: { exact: '\n첫 인용 줄\n둘째 줄' } },
  { id: 'm2', mark: 'insight', tags: ['security', 'http'], text: '깨달음', url: 'https://a.test/2', title: 'B', ts: at(0, 9, 0) },
  { id: 'm3', tags: ['security'], text: '표시 없음', url: 'https://a.test/3', title: 'C', ts: at(0, 8, 0) },
  { id: 'm4', mark: 'question', tags: ['http'], text: '사흘 전', url: 'https://a.test/4', title: 'D', ts: at(-3, 11, 0) },
  { id: 'm5', tags: ['old'], text: '열흘 전', url: 'https://a.test/5', title: 'E', ts: at(-10, 11, 0) },
  { id: 'm6', mark: 'insight', tags: [], text: '어제', url: 'https://a.test/6', title: 'F', ts: at(-1, 20, 0) },
];

const ids = (list) => list.map((m) => m.id);

test('(가) highlightNameFor: 표시에 따라 형광펜 Highlight 이름을 고른다', () => {
  assert.equal(S.highlightNameFor('question'), 'readgloss-scrap-question');
  assert.equal(S.highlightNameFor('insight'), 'readgloss-scrap-insight');
  // 표시 없음·모르는 값·빈 값은 지금 노랑 스크랩 그대로
  for (const mark of [undefined, null, '', 'none', 'other', 0]) {
    assert.equal(S.highlightNameFor(mark), 'readgloss-scrap');
  }
  assert.deepEqual(S.HIGHLIGHT_NAMES, {
    question: 'readgloss-scrap-question',
    insight: 'readgloss-scrap-insight',
  });
});

test('(나) filterMemos: 태그가 없으면 표시가 있는 메모만, 최신순', () => {
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'all', period: 'all' }, now)), ['m1', 'm2', 'm6', 'm4']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'question', period: 'all' }, now)), ['m1', 'm4']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'insight', period: 'all' }, now)), ['m2', 'm6']);
  // 잘못된 값은 기본(전체·전부)으로
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'x', period: 'x' }, now)), ['m1', 'm2', 'm6', 'm4']);
  assert.deepEqual(P.filterMemos(undefined, {}, now), []);
});

test('(나) filterMemos: 기간 거르기(오늘·7일·전부)', () => {
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'all', period: 'today' }, now)), ['m1', 'm2']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'all', period: '7d' }, now)), ['m1', 'm2', 'm6', 'm4']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'all', period: 'all' }, now)), ['m1', 'm2', 'm6', 'm4']);
  // 6일 전 0시는 7일 안, 7일 전 0시는 밖
  const edge = [
    { id: 'in', mark: 'question', ts: new Date(2026, 9, 27, 0, 0).getTime() },
    { id: 'out', mark: 'question', ts: new Date(2026, 9, 26, 23, 59).getTime() },
  ];
  assert.deepEqual(ids(P.filterMemos(edge, { period: '7d' }, now)), ['in']);
});

test('(나) filterMemos: 태그를 고르면 표시 없는 메모도 함께, 표시 칩은 그 안에서 다시 거른다', () => {
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'all', period: 'all', tag: 'security' }, now)), ['m1', 'm2', 'm3']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'question', period: 'all', tag: 'security' }, now)), ['m1']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'insight', period: 'all', tag: 'security' }, now)), ['m2']);
  assert.deepEqual(ids(P.filterMemos(memos, { mark: 'all', period: 'today', tag: 'security' }, now)), ['m1', 'm2', 'm3']);
  // 없는 태그
  assert.deepEqual(P.filterMemos(memos, { mark: 'all', period: 'all', tag: 'nope' }, now), []);
});

test('(나) tagCounts: 기간 안 메모의 태그를 세고, 많은 것부터', () => {
  assert.deepEqual(P.tagCounts(memos, { period: 'all' }, now), [
    { tag: 'security', n: 3 },
    { tag: 'http', n: 2 },
    { tag: 'old', n: 1 },
  ]);
  assert.deepEqual(P.tagCounts(memos, { period: 'today' }, now), [
    { tag: 'security', n: 3 },
    { tag: 'http', n: 1 },
  ]);
  assert.deepEqual(P.tagCounts(memos, { period: '7d' }, now), [
    { tag: 'security', n: 3 },
    { tag: 'http', n: 2 },
  ]);
  assert.deepEqual(P.tagCounts(undefined, {}, now), []);
});

test('(나) 표시 도우미: 아이콘·인용 첫 줄·날짜·안전한 주소', () => {
  assert.equal(P.markOf({ mark: 'question' }), 'question');
  assert.equal(P.markOf({ mark: 'x' }), null);
  assert.equal(P.MARK_ICONS[P.markOf({ mark: 'insight' })], '💡');
  assert.equal(P.MARK_ICONS.none, '✎');
  assert.equal(P.firstQuoteLine(memos[0]), '첫 인용 줄');
  assert.equal(P.firstQuoteLine({ quote: { exact: '한 줄' } }), '한 줄');
  assert.equal(P.firstQuoteLine({}), '');
  assert.equal(P.formatDate(at(0, 9, 5)), '11/2 09:05');
  assert.equal(P.formatDate('nope'), '');
  assert.equal(P.safeUrl('https://a.test/x'), 'https://a.test/x');
  assert.equal(P.safeUrl('javascript:alert(1)'), null);
});

test('패널 탭이 id marks, 이름 다시 볼 것, order 24 로 등록된다', () => {
  const tab = globalThis.readglossPanelTabs.find((t) => t.id === 'marks');
  assert.deepEqual([tab.title, tab.order, typeof tab.render], ['다시 볼 것', 24, 'function']);
});
