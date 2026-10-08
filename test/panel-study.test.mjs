import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../extension/panel-study.js';

const S = globalThis.readglossStudy;
const today = new Date(2026, 9, 6, 15, 0); // 2026-10-06(화) 로컬
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
const days = [
  { date: '2026-10-06', counts: { dict: 5, mt: 2, save: 1 }, items: [{ ts: at(6, 9, 5), kind: 'dict', text: 'mitigate' }, { ts: at(6, 14, 30), kind: 'mt', text: 'least privilege', ko: '최소 권한', url: 'https://a.test/p' }] },
  { date: '2026-10-03', counts: { dict: 1 }, items: [{ ts: at(3, 8, 0), kind: 'dict', text: 'payload', url: 'javascript:alert(1)' }] },
  { date: '2026-09-30', counts: { known: 4 }, items: [] },
];

test('패널 탭이 id study, 이름 공부 기록, order 25 로 등록된다(내 단어 20 과 설정 10 사이 뒤)', () => {
  const tab = globalThis.readglossPanelTabs.find((t) => t.id === 'study');
  assert.deepEqual([tab.title, tab.order, typeof tab.render], ['공부 기록', 25, 'function']);
});

test('KINDS / RANGES: 계약의 여덟 종류와 7·14·30일, 기본 14일', () => {
  assert.deepEqual(S.KINDS.map((k) => k.id), ['dict', 'mt', 'context', 'aigloss', 'paragraph', 'save', 'known', 'mydict', 'scrap']);
  assert.deepEqual([S.RANGES, S.DEFAULT_RANGE], [[7, 14, 30], 14]);
});

test('fillDays: 오늘로 끝나는 n 일, 빠진 날은 0건, 항목은 최신순으로 다시 정렬한다', () => {
  const f = S.fillDays(days, 7, today);
  assert.deepEqual(f.map((d) => d.date), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
  assert.deepEqual(f.map((d) => d.total), [4, 0, 0, 1, 0, 0, 8]);
  assert.deepEqual(f[6].items.map((i) => i.text), ['least privilege', 'mitigate']);
  assert.deepEqual(S.fillDays(undefined, 3, today).map((d) => d.total), [0, 0, 0]);
  assert.equal(S.fillDays(days, 30, today).length, 30);
  assert.equal(S.fillDays(days, 14, new Date(2026, 0, 3)).at(-1).date, '2026-01-03'); // 해가 바뀌는 달력
  assert.equal(S.fillDays([], 14, new Date(2026, 0, 3))[0].date, '2025-12-21');
});

test('bars: 높이는 하루 합 / 기간 최댓값(%), 0건은 0, 1건 이상은 최소 8%, 툴팁에 숫자', () => {
  const b = S.bars(S.fillDays(days, 7, today));
  assert.deepEqual(b.map((x) => x.pct), [50, 0, 0, 13, 0, 0, 100]);
  assert.equal(b[6].title, '10월 6일 8건');
  assert.equal(b[1].title, '10월 1일 0건');
  const tiny = S.bars(S.fillDays([{ date: '2026-10-06', counts: { dict: 100 } }, { date: '2026-10-05', counts: { dict: 1 } }], 2, today));
  assert.deepEqual(tiny.map((x) => x.pct), [8, 100]);
  assert.deepEqual(S.bars(S.fillDays([], 3, today)).map((x) => x.pct), [0, 0, 0]); // 최댓값 0 이어도 NaN 이 아니다
});

test('chips / periodTotal: 오늘 요약은 종류 순서 고정, 0건도 자리를 지키고, 기간 합은 누적 숫자', () => {
  const f = S.fillDays(days, 14, today);
  const c = S.chips(f.at(-1));
  assert.deepEqual(c.map((x) => x.label), ['찾은 단어', '드래그 번역', '문맥 번역', 'AI 문맥 뜻', '문단 번역', '저장', '알아요', '내 사전', '스크랩']);
  assert.deepEqual(c.map((x) => x.n), [5, 2, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(S.periodTotal(f), 13);
  assert.deepEqual(S.chips(undefined).map((x) => x.n), [0, 0, 0, 0, 0, 0, 0, 0]); // mt 는 0이면 숨긴다
});

test('chips: mt(드래그 번역) 칸은 0이면 숨기고, 옛 기록이 있으면 그대로 보여 준다(T19)', () => {
  assert.deepEqual(S.chips({ counts: { dict: 1, mt: 0 } }).map((c) => c.id).includes('mt'), false);
  assert.deepEqual(S.chips({ counts: { dict: 1, mt: 3 } }).filter((c) => c.id === 'mt').map((c) => c.n), [3]);
});

test('listDays: 기록 있는 날만 최신 날부터, 첫 날만 펼침. 날짜 제목은 월 일 (요일)', () => {
  const l = S.listDays(S.fillDays(days, 14, today));
  assert.deepEqual(l.map((d) => [d.title, d.open]), [['10월 6일 (화)', true], ['10월 3일 (토)', false], ['9월 30일 (수)', false]]);
  assert.deepEqual(S.listDays(S.fillDays([], 14, today)), []);
});

test('itemRow: 시각 HH:MM, 종류 이름, 출처는 http(s) 만 링크(호스트 이름), 나머지는 빈 문자열', () => {
  const [a, b] = S.fillDays(days, 7, today)[6].items.map(S.itemRow);
  assert.deepEqual(a, { time: '14:30', kind: 'mt', kindLabel: '드래그 번역', text: 'least privilege', ko: '최소 권한', href: 'https://a.test/p', host: 'a.test' });
  assert.deepEqual([b.time, b.ko, b.href, b.host], ['09:05', '', '', '']);
  assert.equal(S.itemRow({ ts: 1, kind: 'dict', text: 't', url: 'javascript:alert(1)' }).href, '');
  assert.equal(S.itemRow({ ts: NaN, kind: 'zzz', text: 't' }).time, '');
  assert.equal(S.itemRow({ ts: 1, kind: 'zzz', text: 't' }).kindLabel, 'zzz'); // 모르는 종류는 id 그대로
});

test('연속일·밀린 일 같은 표현이 문구에 없다(누적 숫자만)', () => {
  const src = readFileSync(new URL('../extension/panel-study.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /연속|밀린|streak|놓친/);
  assert.doesNotMatch(S.EMPTY, /연속|밀린/);
});

test('panel-study.js: import/export 없음, manifest 에서 panel-words.js 바로 뒤', () => {
  assert.doesNotMatch(readFileSync(new URL('../extension/panel-study.js', import.meta.url), 'utf8'), /^\s*(import|export)\s/m);
  const js = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')).content_scripts[0].js;
  assert.equal(js.indexOf('panel-study.js'), js.indexOf('panel-words.js') + 1);
});

// ---- 패널을 연 채 한 동작 뒤 숫자 새로고침(가짜 DOM 으로 render 를 직접 돌린다) ----
class FakeNode {
  constructor(tag) {
    Object.assign(this, { tag, children: [], attrs: {}, handlers: {}, style: {}, hidden: false, isConnected: true, className: '', textContent: '', open: false });
  }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.handlers[t] ??= []).push(f); }
  all() { return [this, ...this.children.flatMap((c) => (c instanceof FakeNode ? c.all() : []))]; }
}

async function mountStudy() {
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: (tag) => new FakeNode(tag) };
  globalThis.window = new EventTarget();
  const sent = [];
  const ctx = { send: async (m) => (sent.push(m), { days: [] }) };
  const container = new FakeNode('div');
  globalThis.readglossPanelTabs.find((t) => t.id === 'study').render(container, ctx);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await settle();
  const root = container.children[0];
  const fire = (name) => globalThis.window.dispatchEvent(new CustomEvent(name, { detail: {} }));
  const click = (label) => root.all().find((n) => n.className === 'rng' && n.textContent === label).handlers.click[0]();
  const restore = () => Object.assign(globalThis, saved);
  return { sent, root, fire, click, settle, restore };
}

test('패널 안에서 내 사전·단어가 바뀌면(readgloss:mydict·readgloss:words) 공부 기록을 다시 불러온다', async () => {
  const m = await mountStudy();
  try {
    assert.deepEqual(m.sent, [{ type: 'study', days: 14 }]);
    m.fire('readgloss:mydict');
    m.fire('readgloss:words');
    await m.settle();
    assert.equal(m.sent.length, 3);
    assert.ok(m.sent.every((s) => s.type === 'study' && s.days === 14));
  } finally {
    m.restore();
  }
});

test('같은 기간 버튼을 다시 눌러도 다시 불러온다(다른 기간이면 그 기간으로)', async () => {
  const m = await mountStudy();
  try {
    m.click('14일');
    m.click('7일');
    await m.settle();
    assert.deepEqual(m.sent.map((s) => s.days), [14, 14, 7]);
    m.fire('readgloss:words'); // 고른 기간을 유지한다
    await m.settle();
    assert.equal(m.sent.at(-1).days, 7);
  } finally {
    m.restore();
  }
});

test('패널이 새로 그려져 이 탭 노드가 떨어지면 이벤트를 더 안 듣는다', async () => {
  const m = await mountStudy();
  try {
    m.root.isConnected = false;
    m.fire('readgloss:mydict');
    m.fire('readgloss:words');
    await m.settle();
    assert.equal(m.sent.length, 1);
    m.root.isConnected = true; // 한 번 거둔 뒤에는 되살아나지 않는다
    m.fire('readgloss:words');
    await m.settle();
    assert.equal(m.sent.length, 1);
  } finally {
    m.restore();
  }
});
