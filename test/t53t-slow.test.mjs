// 과제 T53t(변경 기록 28-3): 느리게 재생 — 1 ↔ slowRate 토글, 속도 범위·정규화.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
await import('../extension/panel.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const C = globalThis.readglossPanelCore;

test('nextRate: 1 이 아니면 1, 1 이면 느린 속도', () => {
  assert.equal(V.nextRate(1, 0.75), 0.75);
  assert.equal(V.nextRate(0.75, 0.75), 1);
  assert.equal(V.nextRate(1.25, 0.75), 1);
  assert.equal(V.nextRate(0.5, 0.75), 1);
  assert.equal(V.nextRate(1, 0.72), 0.7, '느린 속도도 같은 규칙으로 고친다');
});

test('clampSlowRate: 0.5~0.9, 0.05 단위, 숫자가 아니면 0.75', () => {
  assert.equal(V.clampSlowRate(0.3), 0.5);
  assert.equal(V.clampSlowRate(0.95), 0.9);
  assert.equal(V.clampSlowRate(0.72), 0.7);
  assert.equal(V.clampSlowRate('아'), 0.75);
  assert.equal(V.clampSlowRate(0.85), 0.85);
  assert.equal(V.clampSlowRate(2), 0.9);
  assert.equal(V.clampSlowRate(-1), 0.5);
  for (const bad of [undefined, null, NaN, Infinity, '0.8', {}]) assert.equal(V.clampSlowRate(bad), 0.75, String(bad));
});

test('설정: video.slowRate 기본 0.75, 저장값도 같은 규칙으로 정규화', () => {
  assert.equal(S.DEFAULTS.video.slowRate, 0.75);
  assert.equal(S.normalize({}).video.slowRate, 0.75);
  assert.equal(S.normalize({ video: {} }).video.slowRate, 0.75);
  assert.equal(S.normalize({ video: { slowRate: 0.72 } }).video.slowRate, 0.7);
  assert.equal(S.normalize({ video: { slowRate: 0.3 } }).video.slowRate, 0.5);
  assert.equal(S.normalize({ video: { slowRate: 0.95 } }).video.slowRate, 0.9);
  assert.equal(S.normalize({ video: { slowRate: '아' } }).video.slowRate, 0.75);
  assert.equal(S.merge(S.normalize({}), { video: { slowRate: 0.85 } }).video.slowRate, 0.85);
});

test('settings-core 와 video-core 의 느린 속도 규칙이 같은 값을 낸다', () => {
  const values = [0.3, 0.45, 0.5, 0.52, 0.6, 0.72, 0.75, 0.85, 0.9, 0.93, 0.95, 1.2, -1, 0, 3, '아', '0.8', null, undefined, NaN, Infinity, {}];
  for (const v of values) assert.equal(S.clampSlowRate(v), V.clampSlowRate(v), String(v));
});

test('설정 탭 [느리게 속도]: 0.5·0.6·0.7·0.75·0.8·0.9 고르기', () => {
  const choice = C.CHOICES.find((c) => c.path === 'video.slowRate');
  assert.deepEqual(choice?.options.map(([value]) => value), [0.5, 0.6, 0.7, 0.75, 0.8, 0.9]);
  for (const [value] of choice.options) assert.equal(C.getPath(S.merge({}, C.patchFor('video.slowRate', value)), 'video.slowRate'), value);
});

test('자막 층: [느리게] 단추는 Z 키와 같은 동작, 영상이 바뀌면 1배, ratechange 는 눌림만 갱신', () => {
  const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.match(src, /slow: \{ text: '느리게', name: '느리게', key: 'Z' \}/);
  assert.match(src, /ui\.slowBtn\.setAttribute\('aria-pressed', String\(Boolean\(video && video\.playbackRate !== 1\)\)\)/);
  assert.match(src, /video\.playbackRate = V\.nextRate\(video\.playbackRate, vs\(\)\.slowRate\)/);
  assert.match(src, /v\.addEventListener\('ratechange', onRate\)/);
  assert.match(src, /if \(video\) video\.playbackRate = 1; \/\/ 새 영상은 1배로/);
  assert.match(src, /v\.playbackRate = 1; \/\/ 플레이어가 바뀌면 1배로/);
});
