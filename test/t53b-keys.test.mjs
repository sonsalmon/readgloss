// 과제 T53b(변경 기록 28-2): 랭플릭스 키 배정·Shift 단독 판정·처음 한 번 키 안내.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');

test('KEYS 표: 랭플릭스 배치 9개, H·P 는 없다', () => {
  assert.deepEqual(V.KEYS, {
    KeyA: 'prev', KeyS: 'repeat', KeyD: 'next',
    KeyR: 'repeatLine', KeyQ: 'loop', KeyZ: 'slow',
    KeyW: 'focusMode', KeyL: 'drill', Slash: 'panel',
  });
  assert.ok(!Object.hasOwn(V.KEYS, 'KeyH'), 'H 가리기 키는 없앴다');
  assert.ok(!Object.hasOwn(V.KEYS, 'KeyP'), 'P 줄마다 멈춤 키는 없앴다');
  assert.equal(Object.keys(V.KEYS).length, 9);
});

test('keyAction: 조합키·조합 중·반복은 거절, Slash 는 Shift 없이만 받는다', () => {
  const k = (code, extra = {}) => V.keyAction({ code, key: 'x', ...extra });
  assert.equal(k('Slash'), 'panel');
  assert.equal(k('Slash', { shiftKey: true }), null, 'Shift+/ 는 패널 키가 아니다');
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
    assert.equal(k('KeyR', extra), null, JSON.stringify(extra));
  }
  for (const code of ['KeyH', 'KeyP']) assert.equal(k(code), null, `없앤 키 ${code}`);
  assert.equal(V.keyAction(), null);
  assert.equal(V.keyAction({}), null);
});

test('shiftTapAction: 끊기지 않고 0.6초 이내면 saveLine, 경계·끊김은 null', () => {
  assert.equal(V.shiftTapAction({ downAt: 1000, upAt: 1600, interrupted: false }), 'saveLine', '정확히 0.6초까지');
  assert.equal(V.shiftTapAction({ downAt: 1000, upAt: 1601, interrupted: false }), null);
  assert.equal(V.shiftTapAction({ downAt: 1000, upAt: 1000, interrupted: false }), 'saveLine');
  assert.equal(V.shiftTapAction({ downAt: 1000, upAt: 999, interrupted: false }), null, '뗀 시각이 누른 시각보다 앞이면 안 된다');
  assert.equal(V.shiftTapAction({ downAt: 1000, upAt: 1200, interrupted: true }), null, '다른 키·마우스로 끊겼다');
  assert.equal(V.shiftTapAction({}), null);
  assert.equal(V.shiftTapAction(), null);
  assert.equal(V.shiftTapAction({ downAt: 'a', upAt: 1200, interrupted: false }), null);
});

test('설정: video.keysNoticeSeen 기본 false, 참·거짓만 받는다', () => {
  assert.equal(S.DEFAULTS.video.keysNoticeSeen, false);
  assert.equal(S.normalize({}).video.keysNoticeSeen, false);
  assert.equal(S.normalize({ video: { keysNoticeSeen: true } }).video.keysNoticeSeen, true);
  assert.equal(S.normalize({ video: { keysNoticeSeen: 'yes' } }).video.keysNoticeSeen, false);
  assert.equal(S.merge(S.normalize({}), { video: { keysNoticeSeen: true } }).video.keysNoticeSeen, true);
});

test('자막 층: 처음 한 번 카드·[알겠어요] 저장, Shift 단독은 keyup 판정, 자리만 잡은 키는 막는다', () => {
  assert.match(src, /키가 바뀌었어요/);
  assert.match(src, /keysNoticeSeen: true/);
  assert.match(src, /ui\.notice\.hidden = !\(show && !vs\(\)\.keysNoticeSeen\)/);
  assert.match(src, /V\.shiftTapAction\(\{ downAt: shiftDown\.at, upAt: Date\.now\(\), interrupted: shiftDown\.interrupted \}\)/);
  assert.match(src, /if \(tap !== 'saveLine' \|\| !visible\(\) \|\| S\.cur < 0\) return;/);
  assert.match(src, /if \(e\.key === 'Shift'\)/);
  assert.match(src, /pointerdown', \(\) => \{ if \(shiftDown\) shiftDown\.interrupted = true; \}/);
  assert.match(src, /video\.playbackRate = V\.nextRate\(video\.playbackRate, vs\(\)\.slowRate\)/, 'Z 는 느리게 재생으로 이어진다(T53t)');
  assert.match(src, /if \(act === 'drill' \|\| act === 'panel'\) return;/);
  assert.match(src, /act === 'focusMode'\) && spherical\(\)/, '360° 영상은 W 도 양보한다');
});

test('막대·두 줄 이름: 새 키만 안내하고 H·P·R 옛 안내는 지운다', () => {
  assert.match(src, /'이전 줄 \(A\)'/);
  assert.match(src, /'이 줄 처음 \(S\)'/);
  assert.match(src, /'다음 줄 \(D\)'/);
  assert.match(src, /'문장 반복 \(R\)'/);
  assert.match(src, /'구간 반복 \(Q\)'/);
  assert.match(src, /'이 줄 구·문장에 저장 \(Shift\)'/);
  assert.match(src, /A 이전 줄 · S 이 줄 처음 · D 다음 줄 · R 문장 반복 · Q 구간 반복 · Z 느리게 · Shift 줄 저장/);
  assert.doesNotMatch(src, /가리기 바꾸기 \(H\)|줄마다 멈춤 \(P\)|R 로 보기|R 가린 줄 보기/);
});
