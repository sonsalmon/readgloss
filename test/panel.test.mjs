import test from 'node:test';
import assert from 'node:assert/strict';

// panel.js 는 classic script. node 에는 document 가 없어서 순수 함수(readglossPanelCore)만 등록하고 끝난다.
await import('../extension/settings-core.js');
await import('../extension/panel.js');
const S = globalThis.readglossSettings;
const C = globalThis.readglossPanelCore;

test('sortTabs: order 순, 같으면 등록 순, 잘못된 항목과 같은 id 중복은 버린다', () => {
  const r = () => {};
  const tabs = [
    { id: 'estimate', title: '어휘량 추정', order: 30, render: r },
    { id: 'settings', title: '설정', order: 10, render: r },
    { id: 'bad', title: '고장', order: 5 }, // render 없음
    null,
    { id: 'words', title: '내 단어', order: 20, render: r },
    { id: 'words', title: '중복', order: 1, render: r },
    { id: 'tie-a', title: 'a', order: 40, render: r },
    { id: 'tie-b', title: 'b', order: 40, render: r },
    { id: 'noorder', title: '끝', render: r },
  ];
  assert.deepEqual(C.sortTabs(tabs).map((t) => t.id), ['settings', 'words', 'estimate', 'tie-a', 'tie-b', 'noorder']);
  assert.deepEqual(C.sortTabs(undefined), []);
  assert.equal(tabs.length, 9, '원본 배열은 건드리지 않는다');
});

test('수준 슬라이더: 0~4 와 LEVELS 가 서로 오간다', () => {
  assert.deepEqual(S.LEVELS.map(C.levelIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual([0, 1, 2, 3, 4].map(C.levelAt), S.LEVELS);
  assert.equal(C.levelIndex('?'), 3, '모르는 값은 기본 C1');
  assert.equal(C.levelAt(99), 'C2');
  assert.equal(C.levelAt(-3), 'A2');
});

test('patchFor: 점으로 이은 경로를 중첩 patch 로', () => {
  assert.deepEqual(C.patchFor('level', 'B2'), { level: 'B2' });
  assert.deepEqual(C.patchFor('annotation.sizePct', 70), { annotation: { sizePct: 70 } });
  assert.deepEqual(C.patchFor('floatingButton.top', 100), { floatingButton: { top: 100 } });
});

test('sliderPatch: 값을 범위로 고치고 설정 patch 로 바꾼다', () => {
  const R = (path) => C.RANGES.find((r) => r.path === path);
  assert.deepEqual(C.sliderPatch(R('level'), '2'), { level: 'B2' });
  assert.deepEqual(C.sliderPatch(R('maxPerParagraph'), '0'), { maxPerParagraph: 0 });
  assert.deepEqual(C.sliderPatch(R('maxPerParagraph'), 99), { maxPerParagraph: 10 });
  assert.deepEqual(C.sliderPatch(R('annotation.sizePct'), '73'), { annotation: { sizePct: 75 } }, '5 단위로 맞춘다');
  assert.deepEqual(C.sliderPatch(R('annotation.opacityPct'), 0), { annotation: { opacityPct: 30 } });
  assert.deepEqual(C.sliderPatch(R('annotation.gapEm'), '3'), { annotation: { gapEm: 0.15 } }, '정수 단계 0~6 → 0.05em');
  assert.deepEqual(C.sliderPatch(R('annotation.gapEm'), 6), { annotation: { gapEm: 0.3 } });
  assert.equal(C.sliderPatch(R('level'), 'abc'), null, '숫자가 아니면 바꾸지 않는다');
});

test('sliderValue: 설정 값 → 슬라이더 위치', () => {
  const R = (path) => C.RANGES.find((r) => r.path === path);
  const s = S.merge({}, { level: 'B2', annotation: { gapEm: 0.15, sizePct: 80 } });
  assert.equal(C.sliderValue(R('level'), s), 2);
  assert.equal(C.sliderValue(R('annotation.gapEm'), s), 3);
  assert.equal(C.sliderValue(R('annotation.sizePct'), s), 80);
  assert.equal(C.sliderValue(R('maxPerParagraph'), S.DEFAULTS), 3);
});

test('표(RANGES·CHOICES)는 settings-core 가 받아 주는 값과 같다', () => {
  for (const r of C.RANGES) {
    for (const raw of [r.min, r.max]) {
      const patch = C.sliderPatch(r, raw);
      const merged = S.merge({}, patch);
      assert.deepEqual(C.patchFor(r.path, C.getPath(merged, r.path)), patch, `${r.path} ${raw}`);
    }
  }
  for (const c of C.CHOICES) {
    assert.ok(c.options.length >= 2);
    for (const [value] of c.options) assert.equal(C.getPath(S.merge({}, C.patchFor(c.path, value)), c.path), value, `${c.path}=${value}`);
  }
  for (const t of C.TOGGLES) {
    for (const v of [true, false]) assert.equal(C.getPath(S.merge({}, C.patchFor(t.path, v)), t.path), v, t.path);
  }
});

test('cleanSite: 앞뒤 공백·프로토콜·경로·포트를 걷고 소문자로', () => {
  assert.equal(C.cleanSite('  https://Foo.com/x?y=1#z  '), 'foo.com');
  assert.equal(C.cleanSite('HTTP://Docs.Example.COM'), 'docs.example.com');
  assert.equal(C.cleanSite('localhost:3000/a'), 'localhost');
  assert.equal(C.cleanSite('*.example.com'), '*.example.com');
  assert.equal(C.cleanSite('example.com'), 'example.com');
  assert.equal(C.cleanSite('user@example.com'), '', '글자가 아닌 것이 섞이면 버린다');
  assert.equal(C.cleanSite('exa mple.com'), '');
  assert.equal(C.cleanSite('   '), '');
  assert.equal(C.cleanSite(42), '');
  assert.equal(C.cleanSite('https://'), '');
});

test('addSite·removeSite: 정리해서 넣고, 중복·빈 값·200개 넘김은 막는다', () => {
  assert.deepEqual(C.addSite([], ' https://A.com/x '), ['a.com']);
  assert.deepEqual(C.addSite(['a.com'], 'A.com'), ['a.com']);
  assert.deepEqual(C.addSite(['a.com'], ''), ['a.com']);
  assert.deepEqual(C.addSite(['a.com'], 'b.com'), ['a.com', 'b.com']);
  const full = Array.from({ length: 200 }, (_, i) => `s${i}.com`);
  assert.equal(C.addSite(full, 'new.com').length, 200);
  assert.deepEqual(C.removeSite(['a.com', 'b.com'], 'a.com'), ['b.com']);
  assert.deepEqual(C.removeSite(['a.com'], 'z.com'), ['a.com']);
});

test('clampTop: 40 이상, (창 높이-40) 이하로 고친다', () => {
  assert.equal(C.clampTop(60, 800), 60);
  assert.equal(C.clampTop(5, 800), 40);
  assert.equal(C.clampTop(9999, 800), 760);
  assert.equal(C.clampTop(100.6, 800), 101);
  assert.equal(C.clampTop(60, 50), 40, '창이 너무 낮아도 40 밑으로는 안 간다');
  assert.equal(C.clampTop(NaN, 800), 60, '숫자가 아니면 기본 60');
});

test('dragTop: 시작 위치 + 움직인 만큼, 범위로 고친 값', () => {
  assert.equal(C.dragTop({ startTop: 60, startY: 100, y: 160, vh: 800 }), 120);
  assert.equal(C.dragTop({ startTop: 60, startY: 100, y: 0, vh: 800 }), 40);
  assert.equal(C.dragTop({ startTop: 700, startY: 100, y: 900, vh: 800 }), 760);
});

test('mergePatch: 객체는 키별로 합치고 배열·값은 덮는다', () => {
  assert.deepEqual(C.mergePatch(null, { a: 1 }), { a: 1 });
  assert.deepEqual(C.mergePatch({ annotation: { sizePct: 60 }, level: 'B1' }, { annotation: { gapEm: 0.1 }, level: 'C2' }), { annotation: { sizePct: 60, gapEm: 0.1 }, level: 'C2' });
  assert.deepEqual(C.mergePatch({ sites: ['a'] }, { sites: ['b'] }), { sites: ['b'] });
});

test('themeAttr: auto 는 속성을 없애고 light·dark 는 그대로', () => {
  assert.equal(C.themeAttr('auto'), null);
  assert.equal(C.themeAttr('dark'), 'dark');
  assert.equal(C.themeAttr('light'), 'light');
  assert.equal(C.themeAttr('x'), null);
});

test('manifest: panel.js 는 annotate.js 뒤, 탭 파일(panel-words.js)보다 앞(계약 G), action 있음, 권한은 storage 하나', async () => {
  const { readFileSync } = await import('node:fs');
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const js = m.content_scripts[0].js;
  assert.ok(js.indexOf('panel.js') > js.indexOf('annotate.js'), js.join());
  if (js.includes('panel-words.js')) assert.ok(js.indexOf('panel.js') < js.indexOf('panel-words.js'), js.join());
  assert.ok(js.indexOf('settings-core.js') < js.indexOf('panel.js'));
  assert.deepEqual(m.action, { default_title: 'readgloss' });
  assert.deepEqual(m.permissions, ['storage']); // tabs 권한 없이 툴바 아이콘 -> sendMessage
  assert.doesNotMatch(readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8'), /^\s*(import|export)\s/m);
});

test('mountPane: 탭 render 가 불릴 때 pane 은 이미 문서에 붙어 있다(미리보기가 isConnected 로 후보를 거르므로). 실패하면 안내 문구', () => {
  const body = { kids: [], append(n) { this.kids.push(n); n.isConnected = true; } };
  const seen = [];
  const pane = { isConnected: false, replaceChildren(...a) { this.fallback = a; } };
  C.mountPane(body, pane, () => seen.push(pane.isConnected), () => 'x');
  assert.deepEqual(seen, [true]);
  assert.deepEqual(body.kids, [pane]);
  const bad = { isConnected: false, replaceChildren(...a) { this.fallback = a; } };
  C.mountPane(body, bad, () => { throw new Error('boom'); }, () => 'msg');
  assert.deepEqual(bad.fallback, ['msg'], 'render 가 던지면 fallback() 이 만든 노드로 바꾼다');
  assert.equal(body.kids.length, 2);
});

test('resetPatch: 기본값 복원은 끌 사이트(sites)만 빼고 모두 기본값 — 용어집을 켤 사이트(glossarySites)는 기본 목록으로', () => {
  const patch = C.resetPatch(S.DEFAULTS);
  assert.equal('sites' in patch, false);
  assert.deepEqual(patch.glossarySites, S.DEFAULTS.glossarySites);
  assert.equal(patch.level, 'C1');
  const cur = S.merge({}, { sites: ['keep.com'], glossarySites: [], level: 'A2' });
  const next = S.merge(cur, patch);
  assert.deepEqual(next.sites, ['keep.com']);
  assert.deepEqual(next.glossarySites, S.DEFAULTS.glossarySites, '지웠던 목록도 기본값으로 돌아온다');
  assert.equal(next.level, 'C1');
  patch.glossarySites.push('x.com');
  assert.ok(!S.DEFAULTS.glossarySites.includes('x.com'), '복사본이라 DEFAULTS 는 그대로');
});

test('목록 입력 정리: 용어집 사이트에도 같은 규칙(와일드카드·중복·경로 걷기)', () => {
  let list = [...S.DEFAULTS.glossarySites];
  list = C.addSite(list, 'https://Docs.Python.org/3/');
  list = C.addSite(list, '*.PortSwigger.net');
  list = C.addSite(list, 'owasp.org');
  assert.deepEqual(list.slice(-2), ['docs.python.org', '*.portswigger.net']);
  assert.equal(list.length, 21);
  assert.deepEqual(C.removeSite(list, 'arxiv.org').includes('arxiv.org'), false);
  assert.equal(S.siteMatches(list, 'docs.python.org'), true);
});

test('TOGGLES: 드래그 번역 스위치가 있다', () => {
  assert.ok(C.TOGGLES.some((t) => t.path === 'selectionTranslate'));
});
