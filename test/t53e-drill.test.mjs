// 과제 T53e(변경 기록 28-8): 리스닝 드릴 Space 판정·가리기 유형·설정 정규화·설정 탭 배타.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
await import('../extension/panel.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const C = globalThis.readglossPanelCore;
const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');

test('drillSpace: 첫 누름은 보이기, 뗀 뒤 0.28초 경계까지 토글, 그 뒤는 다시 보이기', () => {
  assert.equal(V.DRILL_DOUBLE, 0.28);
  assert.deepEqual(V.drillSpace({ now: 10, lastUp: null }), { action: 'reveal', nextLastUp: null });
  assert.deepEqual(V.drillSpace({ now: 10.28, lastUp: 10 }), { action: 'toggle', nextLastUp: null }, '정확히 0.28초까지');
  assert.deepEqual(V.drillSpace({ now: 10.281, lastUp: 10 }), { action: 'reveal', nextLastUp: null });
  assert.deepEqual(V.drillSpace({ now: 10, lastUp: 10 }), { action: 'toggle', nextLastUp: null });
  assert.deepEqual(V.drillSpace({ now: 9, lastUp: 10 }), { action: 'reveal', nextLastUp: null }, '시각이 거꾸로면 토글하지 않는다');
  for (const input of [undefined, {}, { now: 'x', lastUp: 10 }, { now: 10, lastUp: 'x' }]) {
    assert.deepEqual(V.drillSpace(input), { action: 'reveal', nextLastUp: null }, JSON.stringify(input));
  }
});

test('maskFlags word: 고른 유형(hard·done·other)의 낱말만 가린다', () => {
  const toks = V.tokenize('The exploit works well');
  const kind = (w) => (w === 'exploit' ? 'hard' : w === 'works' ? 'done' : 'other');
  assert.deepEqual(V.maskFlags(toks, 'word', kind, { hard: true, done: false, other: false }), [false, false, true, false, false, false, false]);
  assert.deepEqual(V.maskFlags(toks, 'word', kind, { hard: false, done: true, other: false }), [false, false, false, false, true, false, false]);
  assert.deepEqual(V.maskFlags(toks, 'word', kind, { hard: false, done: false, other: true }), [true, false, false, false, false, false, true]);
  assert.deepEqual(V.maskFlags(toks, 'word', kind, { hard: true, done: true, other: true }), [true, false, true, false, true, false, true]);
  assert.deepEqual(V.maskFlags(toks, 'word', kind, { hard: false, done: false, other: false }), [false, false, false, false, false, false, false], '아무 유형도 안 고르면 가리지 않는다');
});

test('maskFlags line: 고른 유형 낱말이 하나라도 있으면 줄의 낱말을 모두 가린다', () => {
  const toks = V.tokenize('The exploit works well');
  const kind = (w) => (w === 'exploit' ? 'hard' : w === 'works' ? 'done' : 'other');
  assert.deepEqual(V.maskFlags(toks, 'line', kind, { hard: true, done: false, other: false }), [true, false, true, false, true, false, true], '줄 통째로(사이 글자는 그리는 쪽이 가린다)');
  assert.deepEqual(V.maskFlags(toks, 'line', kind, { hard: false, done: true, other: false }), [true, false, true, false, true, false, true]);
  assert.deepEqual(V.maskFlags(toks, 'line', kind, { hard: false, done: false, other: false }), [false, false, false, false, false, false, false], '고른 유형이 없으면 줄도 그대로');
  assert.deepEqual(V.maskFlags([], 'line', kind, { hard: true }), []);
  assert.deepEqual(V.maskFlags(null, 'word', kind), []);
});

test('maskFlags: 끔은 유형과 상관없이 전부 보이고, hideTypes 기본값은 어려운 낱말만', () => {
  const toks = V.tokenize('the exploit works');
  const kind = (w) => (w === 'exploit' ? 'hard' : 'other');
  assert.deepEqual(V.maskFlags(toks, 'off', kind, { hard: true, done: true, other: true }), [false, false, false, false, false]);
  assert.deepEqual(V.maskFlags(toks, 'weird', kind, { hard: true }), [false, false, false, false, false]);
  assert.deepEqual(V.hideTypes({ hard: 'yes', done: true }), { hard: true, done: true, other: false });
  assert.deepEqual(V.maskFlags(toks, 'word', kind), [false, false, true, false, false], '유형을 안 주면 기본(어려운 낱말만)');
});

test('nextHide: 끔 → 낱말 → 줄 → 끔, 모르는 값은 끔', () => {
  assert.equal(V.nextHide('off'), 'word');
  assert.equal(V.nextHide('word'), 'line');
  assert.equal(V.nextHide('line'), 'off');
  assert.equal(V.nextHide('hard'), 'off', '옛 값은 순환에 없다');
  assert.equal(V.nextHide('weird'), 'off');
});

test('설정: 옛 가리기 hard·all 을 새 값과 유형으로 옮긴다', () => {
  assert.equal(S.DEFAULTS.video.hide, 'off');
  assert.deepEqual(S.DEFAULTS.video.hideTypes, { hard: true, done: false, other: false });
  assert.equal(S.normalize({}).video.hide, 'off');
  assert.deepEqual(S.normalize({}).video.hideTypes, { hard: true, done: false, other: false });

  const hard = S.normalize({ video: { hide: 'hard' } });
  assert.equal(hard.video.hide, 'word');
  assert.deepEqual(hard.video.hideTypes, { hard: true, done: false, other: false });

  const all = S.normalize({ video: { hide: 'all' } });
  assert.equal(all.video.hide, 'line');
  assert.deepEqual(all.video.hideTypes, { hard: true, done: true, other: true });

  const word = S.normalize({ video: { hide: 'word', hideTypes: { hard: false, done: true, other: 'yes' } } });
  assert.equal(word.video.hide, 'word');
  assert.deepEqual(word.video.hideTypes, { hard: false, done: true, other: false });

  const line = S.normalize({ video: { hide: 'line', hideTypes: { hard: true, done: true, other: true } } });
  assert.equal(line.video.hide, 'line');
  assert.deepEqual(line.video.hideTypes, { hard: true, done: true, other: true });

  assert.equal(S.normalize({ video: { hide: 'nope' } }).video.hide, 'off');
  assert.equal(S.merge(S.normalize({}), { video: { hide: 'all' } }).video.hide, 'line');
  assert.deepEqual(S.merge(S.normalize({}), { video: { hide: 'hard' } }).video.hideTypes, { hard: true, done: false, other: false });
});

test('설정: 줄마다 멈춤·문장 반복은 지금처럼 함께 켜지지 않는다', () => {
  const a = S.normalize({ video: { pauseEach: true, repeatLine: true } });
  assert.equal(a.video.repeatLine, true);
  assert.equal(a.video.pauseEach, false);
  const b = S.normalize({ video: { pauseEach: true, repeatLine: false } });
  assert.equal(b.video.pauseEach, true);
  assert.equal(b.video.repeatLine, false);
});

test('패널: 토글 patch 가 반대쪽을 같이 끄고, 새 가리기·유형 항목이 표에 있다', () => {
  assert.deepEqual(C.togglePatch('video.pauseEach', true), { video: { pauseEach: true, repeatLine: false } });
  assert.deepEqual(C.togglePatch('video.pauseEach', false), { video: { pauseEach: false } });
  assert.deepEqual(C.togglePatch('video.repeatLine', true), { video: { repeatLine: true, pauseEach: false } });
  assert.deepEqual(C.togglePatch('video.repeatLine', false), { video: { repeatLine: false } });
  assert.deepEqual(C.togglePatch('video.hideTypes.done', true), { video: { hideTypes: { done: true } } });

  const start = S.normalize({ video: { pauseEach: true } });
  const toRepeat = S.normalize(S.merge(start, C.togglePatch('video.repeatLine', true)));
  assert.equal(toRepeat.video.repeatLine, true);
  assert.equal(toRepeat.video.pauseEach, false, '정규화가 조용히 무시하지 않는다');
  const back = S.normalize(S.merge(toRepeat, C.togglePatch('video.pauseEach', true)));
  assert.equal(back.video.pauseEach, true);
  assert.equal(back.video.repeatLine, false);

  for (const p of ['video.hideTypes.hard', 'video.hideTypes.done', 'video.hideTypes.other']) {
    assert.ok(C.TOGGLES.some((t) => t.path === p), p);
  }
  assert.deepEqual(C.CHOICES.find((c) => c.path === 'video.hide').options.map(([v]) => v), ['off', 'word', 'line']);
});

test('자막 층 소스: 드릴 안내·알약·Space 처리·멈춤/마우스 가리기 해제', () => {
  assert.match(src, /Space 를 누르고 있으면 자막 보기 · 두 번 빠르게 누르면 재생\/정지/);
  assert.match(src, /‹ 이전 문장 A/);
  assert.match(src, /다음 문장 D ›/);
  assert.match(src, /V\.drillSpace\(\{ now: Date\.now\(\) \/ 1000, lastUp: S\.drillLastUp \}\)/);
  assert.match(src, /S\.drill = false; \/\/ 드릴은 저장하지 않는다/);
  assert.match(src, /S\.done = new Set\(Object\.entries\(r\.saved\)/);
  assert.match(src, /const hideOff = S\.revealed === i \|\| S\.drillReveal \|\| \(v\.hide !== 'off' && \(Boolean\(video\?\.paused\) \|\| S\.hovering\)\)/);
});
