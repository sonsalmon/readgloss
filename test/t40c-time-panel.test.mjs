import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../extension/panel-study.js';

const S = globalThis.readglossStudy;

// ============================================================
// 1. formatDuration(seconds)
// ============================================================
test('formatDuration: 1분 미만은 <1분', () => {
  assert.equal(S.formatDuration(0), '<1분');
  assert.equal(S.formatDuration(15), '<1분');
  assert.equal(S.formatDuration(59), '<1분');
  assert.equal(S.formatDuration(-10), '<1분');
  assert.equal(S.formatDuration(NaN), '<1분');
});

test('formatDuration: 1분 이상 60분 미만은 M분', () => {
  assert.equal(S.formatDuration(60), '1분');
  assert.equal(S.formatDuration(61), '1분');
  assert.equal(S.formatDuration(119), '1분');
  assert.equal(S.formatDuration(120), '2분');
  assert.equal(S.formatDuration(3599), '59분');
});

test('formatDuration: 60분 이상은 N시간 M분', () => {
  assert.equal(S.formatDuration(3600), '1시간 0분');
  assert.equal(S.formatDuration(3660), '1시간 1분');
  assert.equal(S.formatDuration(7200), '2시간 0분');
  assert.equal(S.formatDuration(7325), '2시간 2분');
  assert.equal(S.formatDuration(36000), '10시간 0분');
});

// ============================================================
// 2. weekRange(todayStr) - 주 시작 월요일
// ============================================================
test('weekRange: 월요일 기준 주 시작일(from)부터 오늘(to)까지', () => {
  // 2026-10-15는 목요일 -> 월요일은 2026-10-12
  assert.deepEqual(S.weekRange('2026-10-15'), {
    from: '2026-10-12',
    to: '2026-10-15',
  });

  // 2026-10-12는 월요일 -> from과 to가 동일
  assert.deepEqual(S.weekRange('2026-10-12'), {
    from: '2026-10-12',
    to: '2026-10-12',
  });

  // 2026-10-18은 일요일 -> 월요일은 6일 전인 2026-10-12
  assert.deepEqual(S.weekRange('2026-10-18'), {
    from: '2026-10-12',
    to: '2026-10-18',
  });

  // 2026-10-13은 화요일 -> 월요일은 2026-10-12
  assert.deepEqual(S.weekRange('2026-10-13'), {
    from: '2026-10-12',
    to: '2026-10-13',
  });
});

test('weekRange: 월 경계 및 연도 경계에서도 올바른 월요일 계산', () => {
  // 2026-11-01은 일요일 -> 월요일은 10월 26일
  assert.deepEqual(S.weekRange('2026-11-01'), {
    from: '2026-10-26',
    to: '2026-11-01',
  });

  // 2026-10-01은 목요일 -> 월요일은 9월 28일
  assert.deepEqual(S.weekRange('2026-10-01'), {
    from: '2026-09-28',
    to: '2026-10-01',
  });

  // 2026-01-01은 목요일 -> 월요일은 2025-12-29
  assert.deepEqual(S.weekRange('2026-01-01'), {
    from: '2025-12-29',
    to: '2026-01-01',
  });

  // 2026-01-04는 일요일 -> 월요일은 2025-12-29
  assert.deepEqual(S.weekRange('2026-01-04'), {
    from: '2025-12-29',
    to: '2026-01-04',
  });
});

// ============================================================
// 3. topSections(items, n)
// ============================================================
test('topSections: 소제목 단위 상위 n개(기본 3개) 추출 및 합산', () => {
  const items = [
    { url: 'https://a.test/1', title: 'Naive Bayes', headings: ['Intro', 'How Naive Bayes Works'], seconds: 2460 },
    { url: 'https://a.test/2', title: 'Decision Trees', headings: ['Tree Intro', 'Gini Impurity'], seconds: 1620 },
    { url: 'https://a.test/3', title: 'Logistic Regression', headings: ['Math', 'Sigmoid'], seconds: 660 },
    { url: 'https://a.test/1', title: 'Naive Bayes', headings: ['Intro', 'Bayes Theorem'], seconds: 360 },
    { url: 'https://a.test/1', title: 'Naive Bayes', headings: ['Intro', 'How Naive Bayes Works'], seconds: 60 }, // 누적 합산
  ];

  const top = S.topSections(items, 3);
  assert.equal(top.length, 3);
  assert.equal(top[0].pageTitle, 'Naive Bayes');
  assert.equal(top[0].sectionTitle, 'How Naive Bayes Works');
  assert.equal(top[0].seconds, 2520); // 2460 + 60
  assert.equal(top[0].formattedDuration, '42분');

  assert.equal(top[1].pageTitle, 'Decision Trees');
  assert.equal(top[1].sectionTitle, 'Gini Impurity');
  assert.equal(top[1].seconds, 1620);
  assert.equal(top[1].formattedDuration, '27분');

  assert.equal(top[2].pageTitle, 'Logistic Regression');
  assert.equal(top[2].sectionTitle, 'Sigmoid');
  assert.equal(top[2].seconds, 660);
  assert.equal(top[2].formattedDuration, '11분');
});

test('topSections: 경계 조건 - 소제목 없음, 제목 없음, 빈 항목, 적은 항목', () => {
  assert.deepEqual(S.topSections([], 3), []);
  assert.deepEqual(S.topSections(null, 3), []);

  const items = [
    { url: 'https://a.test/page1', title: '', headings: [], seconds: 500 },
    { url: 'https://a.test/page2', title: '페이지 2', headings: null, seconds: 300 },
  ];

  const top = S.topSections(items, 3);
  assert.equal(top.length, 2);
  assert.equal(top[0].pageTitle, 'https://a.test/page1');
  assert.equal(top[0].sectionTitle, '(소제목 없음)');
  assert.equal(top[0].seconds, 500);

  assert.equal(top[1].pageTitle, '페이지 2');
  assert.equal(top[1].sectionTitle, '(소제목 없음)');
  assert.equal(top[1].seconds, 300);
});

// ============================================================
// 4. groupTime(items, tasks)
// ============================================================
test('groupTime: 할 일 -> 페이지 -> 소제목 3단계 나무 구성 및 정렬', () => {
  const items = [
    { date: '2026-10-15', url: 'https://a.test/1', title: '페이지 A', headings: ['H1', '소제목 1'], seconds: 120, task: 'T1' },
    { date: '2026-10-15', url: 'https://a.test/1', title: '페이지 A', headings: ['H1', '소제목 2'], seconds: 300, task: 'T1' },
    { date: '2026-10-15', url: 'https://a.test/2', title: '페이지 B', headings: ['소제목 3'], seconds: 600, task: 'T1' },
    { date: '2026-10-15', url: 'https://a.test/3', title: '페이지 C', headings: [], seconds: 50, task: 'T2' },
    { date: '2026-10-15', url: 'https://a.test/4', title: '', headings: ['인박스 소제목'], seconds: 80, task: null },
  ];

  const tasks = {
    T1: '할 일 1번',
  };

  const tree = S.groupTime(items, tasks);

  // 1단계: 할 일 큰 순서
  // T1: 120 + 300 + 600 = 1020초
  // null(인박스): 80초
  // T2: 50초
  assert.equal(tree.length, 3);

  // 첫 번째 할 일: T1
  assert.equal(tree[0].task, 'T1');
  assert.equal(tree[0].title, '할 일 1번'); // tasks 매핑 적용
  assert.equal(tree[0].seconds, 1020);
  assert.equal(tree[0].pct, 100);

  // T1 내부 페이지 정렬 (큰 순서): 페이지 B (600초) > 페이지 A (420초)
  assert.equal(tree[0].pages.length, 2);
  assert.equal(tree[0].pages[0].title, '페이지 B');
  assert.equal(tree[0].pages[0].seconds, 600);
  assert.equal(tree[0].pages[0].pct, 100); // 600 대비 100%

  assert.equal(tree[0].pages[1].title, '페이지 A');
  assert.equal(tree[0].pages[1].seconds, 420);
  assert.equal(tree[0].pages[1].pct, 70); // 420 / 600 = 70%

  // 페이지 A 내부 소제목 정렬 (큰 순서): 소제목 2 (300초) > 소제목 1 (120초)
  assert.equal(tree[0].pages[1].sections.length, 2);
  assert.equal(tree[0].pages[1].sections[0].title, '소제목 2');
  assert.equal(tree[0].pages[1].sections[0].seconds, 300);
  assert.equal(tree[0].pages[1].sections[0].pct, 100); // 300 대비 100%

  assert.equal(tree[0].pages[1].sections[1].title, '소제목 1');
  assert.equal(tree[0].pages[1].sections[1].seconds, 120);
  assert.equal(tree[0].pages[1].sections[1].pct, 40); // 120 / 300 = 40%

  // 두 번째 할 일: 인박스 (80초)
  assert.equal(tree[1].task, null);
  assert.equal(tree[1].title, '인박스');
  assert.equal(tree[1].seconds, 80);
  assert.equal(tree[1].pct, 8); // 80 / 1020 = 7.84% -> round 8%
  assert.equal(tree[1].pages[0].title, 'https://a.test/4'); // title 없으면 url

  // 세 번째 할 일: T2 (tasks 매핑 없으면 id 그대로)
  assert.equal(tree[2].task, 'T2');
  assert.equal(tree[2].title, 'T2');
  assert.equal(tree[2].seconds, 50);
  assert.equal(tree[2].pages[0].sections[0].title, '(소제목 없음)'); // headings 없으면 (소제목 없음)
});

test('groupTime: 빈 목록 및 빈 배열 처리', () => {
  assert.deepEqual(S.groupTime([]), []);
  assert.deepEqual(S.groupTime(null), []);
});

// ============================================================
// 5. DOM 렌더링 및 인터랙션 테스트
// ============================================================
class FakeNode {
  constructor(tag) {
    Object.assign(this, {
      tag,
      children: [],
      attrs: {},
      handlers: {},
      style: {},
      hidden: false,
      isConnected: true,
      className: '',
      textContent: '',
      open: false,
    });
  }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.handlers[t] ??= []).push(f); }
  all() { return [this, ...this.children.flatMap((c) => (c instanceof FakeNode ? c.all() : []))]; }
}

async function mountStudyPanel(customResponses = {}) {
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: (tag) => new FakeNode(tag) };
  globalThis.window = new EventTarget();

  const sent = [];
  const ctx = {
    send: async (m) => {
      sent.push(m);
      if (customResponses[m.type]) {
        return typeof customResponses[m.type] === 'function' ? customResponses[m.type](m) : customResponses[m.type];
      }
      if (m.type === 'study') return { days: [] };
      if (m.type === 'study-time') {
        return {
          items: [
            { date: '2026-10-15', url: 'https://a.test/p1', title: '페이지 1', headings: ['H1', '소제목 1'], seconds: 2460, task: 'S1-04' },
            { date: '2026-10-15', url: 'https://a.test/p2', title: '페이지 2', headings: ['소제목 2'], seconds: 120, task: null },
          ],
        };
      }
      if (m.type === 'scraps') {
        return {
          scraps: [],
          tasks: { 'S1-04': '접근 통제' },
        };
      }
      return {};
    },
  };

  const container = new FakeNode('div');
  globalThis.readglossPanelTabs.find((t) => t.id === 'study').render(container, ctx);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await settle();

  const root = container.children[0];
  const restore = () => Object.assign(globalThis, saved);

  return { sent, root, settle, restore };
}

test('패널 상단에 [기록] [시간] 보기 전환이 있고 기본은 [기록]', async () => {
  const m = await mountStudyPanel();
  try {
    const tabs = m.root.all().filter((n) => n.className?.includes('rg-view-tab'));
    assert.equal(tabs.length, 2);
    assert.equal(tabs[0].textContent, '기록');
    assert.equal(tabs[1].textContent, '시간');
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    assert.equal(tabs[1].getAttribute('aria-selected'), 'false');
  } finally {
    m.restore();
  }
});

test('[시간] 보기 전환 시 study-time과 scraps 데이터를 가져오고 화면에 표시', async () => {
  const m = await mountStudyPanel();
  try {
    const timeTab = m.root.all().find((n) => n.className?.includes('rg-view-tab') && n.textContent === '시간');
    assert.ok(timeTab);
    timeTab.handlers.click[0]();
    await m.settle();

    // study-time 요청 확인
    const studyTimeReq = m.sent.find((s) => s.type === 'study-time');
    assert.ok(studyTimeReq);
    assert.equal(studyTimeReq.op, 'get');
    assert.ok(studyTimeReq.from);
    assert.ok(studyTimeReq.to);

    // scraps 요청 확인 (tasks 획득용)
    const scrapsReq = m.sent.find((s) => s.type === 'scraps');
    assert.ok(scrapsReq);
    assert.equal(scrapsReq.op, 'get');

    // 시간 보기 화면 요소 확인
    const topSectionsHeader = m.root.all().find((n) => n.textContent?.includes('오래 머문 소제목 3개'));
    assert.ok(topSectionsHeader);

    // 할 일 제목 매핑 ('접근 통제') 확인
    const taskTitleEl = m.root.all().find((n) => n.textContent?.includes('접근 통제'));
    assert.ok(taskTitleEl);

    // 인박스 확인
    const inboxEl = m.root.all().find((n) => n.textContent?.includes('인박스'));
    assert.ok(inboxEl);
  } finally {
    m.restore();
  }
});

test('[시간] 보기: 다리 꺼짐이면 MESSAGES 의 다리 꺼짐 안내 표시(FX-H 6)', async () => {
  const m = await mountStudyPanel({
    'study-time': () => ({ error: 'bridge-off' }),
  });
  try {
    const timeTab = m.root.all().find((n) => n.className?.includes('rg-view-tab') && n.textContent === '시간');
    timeTab.handlers.click[0]();
    await m.settle();

    const errorEl = m.root.all().find((n) => n.textContent?.includes('다리가 꺼져 있어요'));
    assert.ok(errorEl);
  } finally {
    m.restore();
  }
});
