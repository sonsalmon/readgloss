// 과제 T53a(변경 기록 28-1): 재생 엔진 playbackStep 의 순수 함수 시험.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;

const CUES = [
  { start: 0, end: 2, text: 'first line' },
  { start: 4, end: 6, text: 'second line' },
];
const step = (p = {}) => V.playbackStep({
  t: 1.95, prevT: 1.9, cues: CUES, cur: 0,
  settings: { repeatLine: false, pauseEach: false, skipGaps: false },
  range: null, mem: {}, ...p,
});

test('playbackStep: 기본 입력·빈 입력은 아무것도 하지 않고 mem 모양을 돌려준다', () => {
  assert.deepEqual(V.playbackStep(), { action: 'none', mem: { repeatedFor: -1, gapTo: -1 } });
  const r = step({ t: 1, settings: { repeatLine: true, pauseEach: true, skipGaps: true } });
  assert.equal(r.action, 'none');
  assert.deepEqual(r.mem, { repeatedFor: -1, gapTo: -1 });
});

test('playbackStep 우선순위: 구간 > 문장 반복 > 줄마다 멈춤 > 틈 건너뛰기', () => {
  // 구간 반복이 문장 반복보다 먼저
  const range = step({ t: 2, settings: { repeatLine: true }, range: { start: 0.5, end: 1.9 } });
  assert.deepEqual({ action: range.action, to: range.to, reason: range.reason }, { action: 'seek', to: 0.5, reason: 'range' });
  // 문장 반복이 줄마다 멈춤보다 먼저
  const repeat = step({ t: 1.95, settings: { repeatLine: true, pauseEach: true } });
  assert.deepEqual({ action: repeat.action, to: repeat.to, reason: repeat.reason }, { action: 'seek', to: 0, reason: 'repeat' });
  // 문장 반복이 틈 건너뛰기보다 먼저
  const repeatGap = step({ t: 2, settings: { repeatLine: true, skipGaps: true } });
  assert.equal(repeatGap.reason, 'repeat');
  // 줄마다 멈춤이 틈 건너뛰기보다 먼저(아직 줄 안이다)
  const pause = step({ t: 1.95, settings: { pauseEach: true, skipGaps: true } });
  assert.deepEqual({ action: pause.action, reason: pause.reason }, { action: 'pause', reason: 'pauseEach' });
  // 넷 다 켜져 있어도 구간 반복이 이긴다
  const all = step({ t: 2, settings: { repeatLine: true, pauseEach: true, skipGaps: true }, range: { start: 0.25, end: 1.5 } });
  assert.equal(all.reason, 'range');
  assert.equal(all.to, 0.25);
});

test('문장 반복: 끝 0.15초 전에 한 번 되감고, 0.30초 앞으로 돌아오면 다시 되감을 수 있다', () => {
  const cue = { start: 10, end: 12, text: 'line' };
  const base = { cues: [cue], cur: 0, settings: { repeatLine: true }, mem: {} };
  const first = V.playbackStep({ ...base, t: 11.85, prevT: 11.8 });
  assert.deepEqual({ action: first.action, to: first.to, reason: first.reason }, { action: 'seek', to: 10, reason: 'repeat' });
  assert.equal(first.mem.repeatedFor, 0);
  // 되감은 직후 같은 틱이 다시 와도 두 번 튀지 않는다
  const again = V.playbackStep({ ...base, t: 11.86, mem: first.mem });
  assert.equal(again.action, 'none');
  assert.equal(again.mem.repeatedFor, 0);
  // 줄 시작으로 되감긴 뒤(끝 − 0.30 보다 앞)에는 표시를 지운다
  const rewound = V.playbackStep({ ...base, t: 11.6, mem: again.mem });
  assert.equal(rewound.action, 'none');
  assert.equal(rewound.mem.repeatedFor, -1);
  // 다음 번 줄 끝에서 다시 한 번 되감는다
  const second = V.playbackStep({ ...base, t: 11.85, mem: rewound.mem });
  assert.deepEqual({ action: second.action, to: second.to }, { action: 'seek', to: 10 });
  // 아직 끝 0.15초 앞이 아니면 되감지 않는다
  assert.equal(V.playbackStep({ ...base, t: 11.84, mem: {} }).action, 'none');
});

test('틈 건너뛰기: 다음 줄까지 0.39초면 그대로, 0.40초면 다음 줄 시작으로', () => {
  const short = [{ start: 0, end: 5, text: 'a' }, { start: 5.39, end: 6, text: 'b' }];
  const no = V.playbackStep({ t: 5, prevT: 4.9, cues: short, cur: 0, settings: { skipGaps: true }, mem: {} });
  assert.equal(no.action, 'none');
  assert.equal(no.mem.gapTo, -1);

  const exact = [{ start: 0, end: 5, text: 'a' }, { start: 5.4, end: 6, text: 'b' }];
  const yes = V.playbackStep({ t: 5, prevT: 4.9, cues: exact, cur: 0, settings: { skipGaps: true }, mem: {} });
  assert.deepEqual({ action: yes.action, to: yes.to, reason: yes.reason }, { action: 'seek', to: 5.4, reason: 'gap' });
  assert.equal(yes.mem.gapTo, 1);
  // 같은 틈에서 또 부르면 같은 곳으로 계속 튀지 않는다
  const once = V.playbackStep({ t: 5, cues: exact, cur: 0, settings: { skipGaps: true }, mem: yes.mem });
  assert.equal(once.action, 'none');
  // 줄 안에서는 틈이 아니다
  assert.equal(V.playbackStep({ t: 4.9, cues: exact, cur: 0, settings: { skipGaps: true }, mem: {} }).action, 'none');
});

test('구간 반복: 끝에 닿으면 시작으로, 틈에서 다음 줄이 구간 밖이면 시작으로', () => {
  const end = V.playbackStep({ t: 2, prevT: 1.9, cues: CUES, cur: 0, settings: {}, range: { start: 0.5, end: 1.5 }, mem: {} });
  assert.deepEqual({ action: end.action, to: end.to, reason: end.reason }, { action: 'seek', to: 0.5, reason: 'range' });

  const gapCues = [{ start: 0, end: 2, text: 'a' }, { start: 3, end: 5, text: 'b' }];
  const outside = V.playbackStep({ t: 2, cues: gapCues, cur: 0, settings: { skipGaps: true }, range: { start: 0.5, end: 2.5 }, mem: {} });
  assert.deepEqual({ action: outside.action, to: outside.to, reason: outside.reason }, { action: 'seek', to: 0.5, reason: 'gap' });
  const inside = V.playbackStep({ t: 2, cues: gapCues, cur: 0, settings: { skipGaps: true }, range: { start: 0.5, end: 4 }, mem: {} });
  assert.deepEqual({ action: inside.action, to: inside.to }, { action: 'seek', to: 3 });
});

test('구간 반복: end ≤ start 면 구간을 무시한다', () => {
  assert.equal(V.playbackStep({ t: 6, cues: CUES, cur: 1, settings: {}, range: { start: 5, end: 5 }, mem: {} }).action, 'none');
  assert.equal(V.playbackStep({ t: 6, cues: CUES, cur: 1, settings: {}, range: { start: 6, end: 5 }, mem: {} }).action, 'none');
  // 잘못된 구간은 다음 규칙(문장 반복)을 막지 않는다
  const r = V.playbackStep({ t: 5.9, cues: CUES, cur: 1, settings: { repeatLine: true }, range: { start: 5, end: 5 }, mem: {} });
  assert.deepEqual({ action: r.action, to: r.to }, { action: 'seek', to: 4 });
});

test('줄마다 멈춤: 끝 0.08초 전부터 0.5초 뒤까지, 한 줄에 한 번', () => {
  const pause = (t, extra = {}) => step({ t, settings: { pauseEach: true }, ...extra });
  assert.equal(pause(1.91).action, 'none');
  assert.deepEqual(pause(1.92).action, 'pause');
  assert.equal(pause(2.4).action, 'pause');
  assert.equal(pause(2.6).action, 'none');
  assert.equal(pause(1.95, { pausedFor: 0 }).action, 'none');
});

test('빈 cues·cur = -1: 아무것도 하지 않는다', () => {
  const empty = V.playbackStep({ t: 1, cues: [], cur: -1, settings: { repeatLine: true, pauseEach: true, skipGaps: true }, mem: {} });
  assert.deepEqual(empty, { action: 'none', mem: { repeatedFor: -1, gapTo: -1 } });
  const before = V.playbackStep({ t: 0.5, cues: CUES, cur: -1, settings: { repeatLine: true, pauseEach: true, skipGaps: true }, mem: {} });
  assert.equal(before.action, 'none');
});
