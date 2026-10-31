// 과제 T53g(변경 기록 28-10): 세로 컨트롤 막대 모델·구간 손잡이 좌표·설정 정규화·화면 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
await import('../extension/panel.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const subs = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');

const ALL = S.DEFAULTS.video.barOrder;
const names = (rows) => rows.map((r) => r.name);

test('barModel: 기본 순서는 명세 그대로이고 모두 보인다', () => {
  assert.deepEqual([...ALL], ['prev', 'repeat', 'next', 'repeatLine', 'loop', 'drill', 'pauseEach', 'skipGaps', 'slow', 'focusMode', 'hide', 'ko', 'save', 'explain']);
  const rows = V.barModel(ALL, [], ALL);
  assert.deepEqual(names(rows), [...ALL]);
  assert.ok(rows.every((r) => r.hidden === false));
  assert.deepEqual(rows[0], { name: 'prev', hidden: false });
});

test('barModel: 순서를 바꾸면 앞에서부터, 모르는 이름은 빼고, 빠진 단추는 뒤에 붙인다', () => {
  assert.deepEqual(names(V.barModel(['loop', 'prev'], [], ALL)).slice(0, 2), ['loop', 'prev']);
  assert.equal(names(V.barModel(['loop', 'prev'], [], ALL)).length, ALL.length);
  assert.deepEqual(names(V.barModel(['nope', 'prev'], [], ALL)).slice(0, 2), ['prev', 'repeat']);
  assert.deepEqual(names(V.barModel(['next', 'prev'], [], ALL)).slice(0, 3), ['next', 'prev', 'repeat']);
  assert.deepEqual(V.barModel(['nope'], [], ALL).length, ALL.length, '모르는 이름뿐이면 기본 순서로 돌아간다');
  assert.deepEqual(V.barModel(['prev', 'prev', 'loop'], [], ALL).filter((r) => r.name === 'prev').length, 1, '중복은 한 번만');
  assert.deepEqual(V.barModel(null, [], ALL).map((r) => r.name), [...ALL]);
  assert.deepEqual(V.barModel(ALL, [], null), []);
});

test('barModel: 숨김을 반영하고 모르는 이름·중복은 무시한다', () => {
  const rows = V.barModel(ALL, ['hide', 'save', 'hide', 'nope'], ALL);
  assert.equal(rows.find((r) => r.name === 'hide').hidden, true);
  assert.equal(rows.find((r) => r.name === 'save').hidden, true);
  assert.equal(rows.find((r) => r.name === 'prev').hidden, false);
  assert.deepEqual(V.barModel(ALL, null, ALL).filter((r) => r.hidden).length, 0);
});

test('xToTime: 경계·음수·폭 0 을 0~duration 으로 자른다', () => {
  assert.equal(V.xToTime(0, 200, 100), 0);
  assert.equal(V.xToTime(100, 200, 100), 50);
  assert.equal(V.xToTime(200, 200, 100), 100);
  assert.equal(V.xToTime(250, 200, 100), 100, '오른쪽 밖은 끝');
  assert.equal(V.xToTime(-20, 200, 100), 0, '왼쪽 밖은 처음');
  assert.equal(V.xToTime(50, 0, 100), 0, '폭 0');
  assert.equal(V.xToTime(50, 200, 0), 0, '길이 0');
  assert.equal(V.xToTime('x', 200, 100), 0);
  assert.equal(V.xToTime(50, 'x', 100), 0);
  assert.equal(V.xToTime(50, 200, 'x'), 0);
  assert.equal(V.xToTime(50, -200, 100), 0);
});

test('설정: barOrder 기본 명세 순서, barHidden 기본 빈 배열', () => {
  assert.deepEqual([...S.DEFAULTS.video.barOrder], [...ALL]);
  assert.deepEqual(S.DEFAULTS.video.barHidden, []);
  assert.deepEqual(S.normalize({}).video.barOrder, [...ALL]);
  assert.deepEqual(S.normalize({}).video.barHidden, []);
  assert.deepEqual(S.normalize({ video: {} }).video.barOrder, [...ALL]);
});

test('설정 정규화: 아는 이름만, 중복 제거, 배열이 아니면 기본값', () => {
  const n = S.normalize({ video: { barOrder: ['loop', 'nope', 'loop', 'prev'], barHidden: ['hide', 'nope', 'hide', 3] } });
  assert.deepEqual(n.video.barOrder, ['loop', 'prev']);
  assert.deepEqual(n.video.barHidden, ['hide']);
  assert.deepEqual(S.normalize({ video: { barOrder: 'loop', barHidden: 'hide' } }).video.barOrder, [...ALL]);
  assert.deepEqual(S.normalize({ video: { barOrder: 'loop', barHidden: 'hide' } }).video.barHidden, []);
  assert.deepEqual(S.normalize({ video: { barOrder: [], barHidden: [] } }).video.barOrder, [], '빈 배열도 그대로(빠진 단추는 화면이 뒤에 붙인다)');
  assert.deepEqual(S.normalize({ video: { barHidden: ['save'] } }).video.barHidden, ['save']);
});

test('설정 병합: 순서·숨김 배열은 patch 가 통째로 덮는다', () => {
  const base = S.normalize({});
  const a = S.merge(base, { video: { barOrder: ['explain', 'prev'], barHidden: ['ko'] } });
  assert.deepEqual(a.video.barOrder, ['explain', 'prev']);
  assert.deepEqual(a.video.barHidden, ['ko']);
  const b = S.merge(a, { video: { barHidden: [] } });
  assert.deepEqual(b.video.barHidden, []);
  assert.deepEqual(b.video.barOrder, ['explain', 'prev']);
});

test('자막 층: 세로 막대는 barModel 순서로 다시 늘어놓고, 28px·주황 눌림·이름+키 툴팁', () => {
  assert.match(subs, /V\.barModel\(vs\(\)\.barOrder, vs\(\)\.barHidden, SET\.DEFAULTS\.video\.barOrder\)/);
  assert.match(subs, /ui\.bar\.replaceChildren\(\.\.\.rows\.filter/);
  assert.match(subs, /const barLabel = \(b\) => \(b\.key \? `\$\{b\.name\} \(\$\{b\.key\}\)` : b\.name\);/);
  assert.match(subs, /prev: \{ text: '‹', name: '이전 줄', key: 'A' \}/);
  assert.match(subs, /drill: \{ text: '드릴', name: '리스닝 드릴', key: 'L' \}/);
  assert.match(subs, /focusMode: \{ text: '키보드', name: '키보드 저장 모드', key: 'W' \}/);
  assert.match(subs, /min-width: 28px; min-height: 28px/);
  assert.match(subs, /button\[aria-pressed="true"\], button\[aria-expanded="true"\] \{[^}]*border-color: #f59e0b;/);
  assert.match(subs, /\.bar \{ position: fixed;/);
});

test('자막 층: 구간 손잡이는 진행 막대 rect 위에 A·B, 끌기 판정은 xToTime', () => {
  assert.match(subs, /player\?\.querySelector\('\.ytp-progress-bar'\)/);
  assert.match(subs, /V\.xToTime\(ev\.clientX - rect\.left, rect\.width, duration\)/);
  assert.match(subs, /if \(Number\.isFinite\(r\.end\) && t >= r\.end\) return;/, '시작이 끝 이상이면 받지 않는다');
  assert.match(subs, /if \(t <= r\.start\) return;/, '끝이 시작 이하면 받지 않는다');
  assert.match(subs, /rangeEl\.append\(rangeA, rangeB\)/);
  assert.match(subs, /rangeA\.dataset\.k = 'A'/);
  assert.match(subs, /rangeB\.dataset\.k = 'B'/);
  assert.match(subs, /addEventListener\('fullscreenchange', \(\) => layout\(\)\)/);
  assert.match(subs, /window\.addEventListener\('resize', \(\) => layout\(\)\)/);
  assert.match(subs, /ui\.range\.hidden = true;/, '진행 막대를 못 찾으면 눈금 없이');
});

test('설정 탭: [컨트롤 편집] — 단추 줄마다 ↑·↓·보이기, [기본값으로], 키보드 초점 유지', () => {
  assert.match(panel, /text: '컨트롤 편집'/);
  assert.match(panel, /text: '기본값으로'/);
  assert.match(panel, /'aria-label': `\$\{label\} 위로`/);
  assert.match(panel, /'aria-label': `\$\{label\} 아래로`/);
  assert.match(panel, /'data-bar-show': row\.name/);
  assert.match(panel, /target\?\.focus\(\)/);
});
