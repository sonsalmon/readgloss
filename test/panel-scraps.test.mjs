import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl as bridgeNormalizeUrl } from '../bridge/scraps.mjs';

// 순수 함수 및 탭 등록 모듈 import
await import('../extension/vendor/approx-string-match.js');
await import('../extension/selection-core.js'); // scrap-core 의 normalizeUrl 은 여기 것을 쓴다
await import('../extension/scrap-core.js');
await import('../extension/panel-scraps.js');

const { buildTree, orderInTask, pageDepth, checkPendingScrap } = globalThis.readglossScrap;
const { isNotFound } = globalThis.readglossScrapPanel;

test('buildTree: 할 일→페이지→소제목, 인박스 마지막', () => {
  const scraps = [
    { id: 's1', task: 'S1-04', url: 'https://example.com/p1', title: 'P1', headings: ['Intro', 'Sec1'], quote: { exact: 'Text 1' }, ts: 100 },
    { id: 's2', task: 'S1-04', url: 'https://example.com/p1', title: 'P1', headings: ['Intro', 'Sec1'], quote: { exact: 'Text 2' }, ts: 200 },
    { id: 's3', task: 'S1-04', url: 'https://example.com/p1', title: 'P1', headings: ['Intro', 'Sec2'], quote: { exact: 'Text 3' }, ts: 150 },
    { id: 's4', task: 'S1-03', url: 'https://example.com/p2', title: 'P2', headings: ['Overview'], quote: { exact: 'Text 4' }, ts: 50 },
    { id: 's5', task: null, url: 'https://example.com/inbox', title: 'Inbox Page', headings: [], quote: { exact: 'Inbox text' }, ts: 300 },
  ];
  const tasks = { 'S1-03': '기초 보안', 'S1-04': '접근 통제' };
  const tree = buildTree(scraps, tasks);

  assert.equal(tree.length, 3);
  // task 순서 (S1-03, S1-04), 인박스는 마지막 (task: null)
  assert.equal(tree[0].task, 'S1-03');
  assert.equal(tree[0].title, '기초 보안');
  assert.equal(tree[0].count, 1);

  assert.equal(tree[1].task, 'S1-04');
  assert.equal(tree[1].title, '접근 통제');
  assert.equal(tree[1].count, 3);

  assert.equal(tree[2].task, null);
  assert.equal(tree[2].title, '인박스');
  assert.equal(tree[2].count, 1);

  // S1-04 내부 구조 확인: 페이지 -> 소제목 -> items
  const s104Pages = tree[1].pages;
  assert.equal(s104Pages.length, 1);
  assert.equal(s104Pages[0].url, 'https://example.com/p1');
  assert.equal(s104Pages[0].title, 'P1');
  assert.equal(s104Pages[0].sections.length, 2);
  assert.deepEqual(s104Pages[0].sections[0].headings, ['Intro', 'Sec1']);
  assert.equal(s104Pages[0].sections[0].items.length, 2);
  assert.deepEqual(s104Pages[0].sections[1].headings, ['Intro', 'Sec2']);
  assert.equal(s104Pages[0].sections[1].items.length, 1);
});

test('IDOR 페이지는 access-control 페이지 아래 depth 1', () => {
  const urls = [
    'https://portswigger.net/web-security/access-control',
    'https://portswigger.net/web-security/access-control/idor',
  ];
  assert.equal(pageDepth('https://portswigger.net/web-security/access-control', urls), 0);
  assert.equal(pageDepth('https://portswigger.net/web-security/access-control/idor', urls), 1);

  const urls3 = [
    ...urls,
    'https://portswigger.net/web-security/access-control/idor/lab-1',
  ];
  assert.equal(pageDepth('https://portswigger.net/web-security/access-control/idor/lab-1', urls3), 2);
});

test('orderInTask: 같은 할 일, 저장 순서', () => {
  const scraps = [
    { id: 'a', task: 'S1-04', ts: 300 },
    { id: 'b', task: 'S1-04', ts: 100 },
    { id: 'c', task: 'S1-03', ts: 50 },
    { id: 'd', task: 'S1-04', ts: 200 },
    { id: 'e', task: null, ts: 10 },
  ];
  const ordered = orderInTask(scraps, 'S1-04');
  assert.deepEqual(ordered.map((s) => s.id), ['b', 'd', 'a']);

  const inbox = orderInTask(scraps, null);
  assert.deepEqual(inbox.map((s) => s.id), ['e']);
});

test('탭 등록 order 22, 제목 "스크랩북"', () => {
  const tab = (globalThis.readglossPanelTabs || []).find((t) => t.id === 'scraps');
  assert.ok(tab, 'scraps 탭이 등록되어 있어야 함');
  assert.deepEqual([tab.title, tab.order, typeof tab.render], ['스크랩북', 22, 'function']);
});

test('못 찾은 스크랩은 "페이지에서 못 찾음" 표시', () => {
  const currentUrl = 'https://example.com/p1';
  const foundSet = new Set(['s1']);
  const s1 = { id: 's1', url: 'https://example.com/p1' };
  const s2 = { id: 's2', url: 'https://example.com/p1' };
  const sOther = { id: 's3', url: 'https://example.com/other' };

  // 현재 페이지의 스크랩 중 found에 없으면 못 찾음 표시 대상
  assert.equal(isNotFound(s1, currentUrl, foundSet), false);
  assert.equal(isNotFound(s2, currentUrl, foundSet), true);
  // 다른 페이지 스크랩은 현재 페이지가 아니므로 표시 대상 아님
  assert.equal(isNotFound(sOther, currentUrl, foundSet), false);
});

test('pendingScrap은 주소가 다르면 쓰지 않음', () => {
  const pending = { id: 's1', url: 'https://portswigger.net/web-security/access-control', task: 'S1-04' };

  // 같은 주소 (정규화 후 동일)면 사용
  assert.deepEqual(checkPendingScrap(pending, 'https://portswigger.net/web-security/access-control'), pending);
  assert.deepEqual(checkPendingScrap(pending, 'https://portswigger.net/web-security/access-control#section'), pending);

  // 다른 주소면 쓰지 않음 (null 반환)
  assert.equal(checkPendingScrap(pending, 'https://portswigger.net/web-security/logic-flaws'), null);
  assert.equal(checkPendingScrap(null, 'https://portswigger.net/web-security/access-control'), null);
  assert.equal(checkPendingScrap(pending, ''), null);
});

test('normalizeUrl: 확장(selection-core)과 다리(bridge/scraps.mjs)가 같은 규칙', () => {
  const sel = globalThis.readglossSelection.normalizeUrl;
  for (const u of ['https://a.com/x/?utm_source=t&q=1#h', 'https://a.com/', 'http://b.test/p/?flag&utm_x=1', 'file:///etc/passwd', '  https://a.com/y/  ', null]) {
    assert.equal(sel(u), bridgeNormalizeUrl(u), String(u));
  }
});
