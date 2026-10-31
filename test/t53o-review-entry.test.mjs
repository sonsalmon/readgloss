// 과제 T53o(변경 기록 28-21): 오늘의 복습 입구 줄과 툴바 배지 글자(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/settings-core.js');
await import('../extension/panel.js');
const C = globalThis.readglossPanelCore;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('badgeText: 0 은 지우고 1~99 는 숫자, 100 이상은 "99+"', () => {
  assert.equal(C.badgeText(0), '');
  assert.equal(C.badgeText(1), '1');
  assert.equal(C.badgeText(99), '99');
  assert.equal(C.badgeText(100), '99+');
  assert.equal(C.badgeText(250), '99+');
});

test('badgeText: 없는 값·음수·소수는 안전하게 다룬다', () => {
  assert.equal(C.badgeText(undefined), '');
  assert.equal(C.badgeText(null), '');
  assert.equal(C.badgeText(-3), '');
  assert.equal(C.badgeText(Number.NaN), '');
  assert.equal(C.badgeText(7.9), '7', '배지는 정수 칸');
});

test('reviewLine: 0장이면 "오늘 복습 끝"', () => {
  assert.equal(C.reviewLine({ due: 0, done: 3, total: 10 }), '오늘 복습 끝');
  assert.equal(C.reviewLine({ due: 0, done: 0, total: 0 }), '오늘 복습 끝');
  assert.equal(C.reviewLine(undefined), '오늘 복습 끝');
});

test('reviewLine: 남은 장수와 완료 퍼센트(반올림)', () => {
  assert.equal(C.reviewLine({ due: 12, done: 3, total: 12 }), '오늘의 복습 12장 · 완료 25%');
  assert.equal(C.reviewLine({ due: 5, done: 1, total: 3 }), '오늘의 복습 5장 · 완료 33%');
  assert.equal(C.reviewLine({ due: 4, done: 2, total: 3 }), '오늘의 복습 4장 · 완료 67%');
  assert.equal(C.reviewLine({ due: 6, done: 8, total: 8 }), '오늘의 복습 6장 · 완료 100%');
});

test('reviewLine: total 이 0 이어도 NaN 없이 0%', () => {
  assert.equal(C.reviewLine({ due: 5, done: 0, total: 0 }), '오늘의 복습 5장 · 완료 0%');
  assert.equal(C.reviewLine({ due: 5, done: 3, total: 0 }), '오늘의 복습 5장 · 완료 0%');
});

test('배선: manifest 의 action 은 있고 권한은 늘지 않았으며 background 가 배지를 맞춘다', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.action, '툴바 action 이 있어야 배지를 쓸 수 있다');
  assert.deepEqual(manifest.permissions, ['storage'], '새 권한 없음');
  const bg = read('background.js');
  assert.match(bg, /setBadgeText/);
  assert.match(bg, /refreshReviewBadge/);
  assert.match(bg, /tabs\.onUpdated/);
  assert.match(bg, /review-queue/);
});
