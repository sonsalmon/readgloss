// 과제 T53d(변경 기록 28-7): 키보드 저장 모드 — 시작 자리·앞뒤 돌기·자동 포커스 판정·설정 기본값.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');

test('focusStart: 그 줄의 첫 어려운 낱말 자리, 어려운 낱말이 없으면 첫 낱말', () => {
  const tokens = V.tokenize('The running fox jumps');
  assert.equal(V.focusStart(tokens, new Set(['fox'])), tokens.findIndex((tk) => tk.lower === 'fox'));
  assert.equal(V.focusStart(tokens, new Set()), 0, 'hardSet 이 비면 첫 낱말');
  assert.equal(V.focusStart(tokens, new Map([['fox', { gloss: '여우' }]])), tokens.findIndex((tk) => tk.lower === 'fox'), 'S.hard Map 도 받는다');
});

test('focusStart: 앞 문장부호는 건너뛰고 낱말 자리만 센다', () => {
  const tokens = V.tokenize('"Hello world"');
  assert.equal(tokens[0].w, false);
  assert.equal(V.focusStart(tokens, new Set()), 1);
  assert.equal(V.focusStart(tokens, new Set(['world'])), 3);
});

test('focusStart: 낱말이 없는 줄은 -1', () => {
  assert.equal(V.focusStart(V.tokenize('... 42 --'), new Set()), -1);
  assert.equal(V.focusStart([], new Set()), -1);
  assert.equal(V.focusStart(null, new Set()), -1);
});

test('focusStep: 앞뒤로 한 칸, 끝에서 처음으로 돈다', () => {
  assert.equal(V.focusStep([1, 3, 5], 3, 1), 5);
  assert.equal(V.focusStep([1, 3, 5], 5, 1), 1, '마지막 다음은 처음');
  assert.equal(V.focusStep([1, 3, 5], 1, -1), 5, '처음 이전은 마지막');
  assert.equal(V.focusStep([1, 3, 5], 3, -1), 1);
  assert.equal(V.focusStep([1, 3, 5], -1, 1), 1, '자리가 없으면 오른쪽은 처음');
  assert.equal(V.focusStep([1, 3, 5], -1, -1), 5, '자리가 없으면 왼쪽은 마지막');
});

test('focusStep: 빈 목록·한 낱말·이상한 입력', () => {
  assert.equal(V.focusStep([], 0, 1), -1);
  assert.equal(V.focusStep(null, 0, 1), -1);
  assert.equal(V.focusStep([7], 7, 1), 7, '하나뿐이면 제자리');
  assert.equal(V.focusStep([1, 3, 5], 2, 1), 1, '목록에 없는 자리에서 오른쪽은 처음');
  assert.equal(V.focusStep([1, 3, 5], 2, -1), 5, '목록에 없는 자리에서 왼쪽은 마지막');
});

test('shouldAutoFocus: 켜져 있고 사용자가 멈췄을 때만', () => {
  assert.equal(V.shouldAutoFocus({ on: true, pauseReason: 'user' }), true);
  assert.equal(V.shouldAutoFocus({ on: false, pauseReason: 'user' }), false, '모드가 꺼져 있다');
  for (const reason of ['pauseEach', 'clip', 'card', 'hold']) {
    assert.equal(V.shouldAutoFocus({ on: true, pauseReason: reason }), false, reason);
  }
  assert.equal(V.shouldAutoFocus({ on: true }), false, '이유를 모르면 포커스하지 않는다');
  assert.equal(V.shouldAutoFocus(), false);
});

test('설정: video.focusMode 기본값 false, 참·거짓만 받는다', () => {
  assert.equal(S.DEFAULTS.video.focusMode, false);
  assert.equal(S.normalize({}).video.focusMode, false);
  assert.equal(S.normalize({ video: {} }).video.focusMode, false);
  assert.equal(S.normalize({ video: { focusMode: true } }).video.focusMode, true);
  assert.equal(S.normalize({ video: { focusMode: 'yes' } }).video.focusMode, false);
  assert.equal(S.merge(S.normalize({}), { video: { focusMode: true } }).video.focusMode, true);
});

test('자막 층: W 토글·상태 줄·0.3초 뒤 포커스·안내 알약·두 줄 키', () => {
  assert.match(src, /const FOCUS_DELAY_MS = 300;/);
  assert.match(src, /키보드 저장 모드 켜짐/);
  assert.match(src, /키보드 저장 모드 꺼짐/);
  assert.match(src, /V\.shouldAutoFocus\(\{ on: vs\(\)\.focusMode, pauseReason/);
  assert.match(src, /V\.focusStart\(ui\.tokens, S\.hard\)/);
  assert.match(src, /V\.focusStep\(words, ui\.wcur/);
  assert.match(src, /←→ 표현 · Enter 저장 · Shift 줄 저장 · ↓ 자세히 · Esc 재생/);
});

test('자막 층: 멈춘 이유를 가르고 사용자 멈춤만 포커스한다', () => {
  assert.match(src, /function pauseReasonNow\(\)/);
  assert.match(src, /hold\.reasons\.has\('card'\) \? 'card' : 'hold'/);
  assert.match(src, /if \(S\.clipPause\) return 'clip';/);
  assert.match(src, /S\.eachPause\) return 'pauseEach'/);
  assert.match(src, /return 'user';/);
  assert.match(src, /scheduleFocus\(pauseReasonNow\(\)\)/);
});

test('자막 층: Enter 는 말풍선 저장과 같은 함수, ↓ 는 사전 카드, Esc 는 사용자 멈춤만 재생', () => {
  assert.match(src, /function toggleWordAt\(k\)/);
  assert.match(src, /await toggleWordSave\(i, lower, tk\.t, m, sp \|\| ui\.box\)/);
  assert.match(src, /if \(e\.key === 'ArrowDown' \|\| !vs\(\)\.focusMode\) pickWord\(sp\)/);
  assert.match(src, /e\.key === 'Escape' && vs\(\)\.focusMode/);
  assert.match(src, /if \(!userPaused\(\)\) return;/);
  assert.match(src, /ui\.lines\.blur\(\);\s*\n\s*video\.play\(\)/);
  // Shift 단독 줄 저장은 T53b 전역 keyup 이 그대로 맡는다(두 줄 안에서도 keyBlocked 가 막지 않는다)
  assert.match(src, /if \(tap !== 'saveLine' \|\| !visible\(\) \|\| S\.cur < 0\) return;/);
});
