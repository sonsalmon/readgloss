import test from 'node:test';
import assert from 'node:assert/strict';

// memo-core.js는 classic script이므로 import 후 전역에서 꺼낸다.
await import('../extension/memo-core.js');

const { toAnchored, fromAnchored } = globalThis.readglossMemo;

test('오른쪽 구석(vw 1280) 저장 → vw 900으로 줄면 보이는 left가 줄어 오른쪽 여백 유지 → vw 1280으로 돌아오면 원래 left와 같음', () => {
  const initialVw = 1280;
  const initialVh = 800;
  const rect = { left: 936, top: 416, width: 320, height: 360 }; // 오른쪽 여백 24px, 아래 여백 24px

  // 1. vw 1280에서 저장
  const saved = toAnchored(rect, { vw: initialVw, vh: initialVh });
  assert.equal(saved.ax, 'right');
  assert.equal(saved.x, 24);
  assert.equal(saved.ay, 'bottom');
  assert.equal(saved.y, 24);
  assert.equal(saved.width, 320);
  assert.equal(saved.height, 360);

  // 2. vw 900으로 줄어듦
  const shrunk = fromAnchored(saved, { vw: 900, vh: 800 });
  // 보이는 left가 936 -> 556으로 줄어들고 오른쪽 여백 24px(900 - 556 - 320 = 24) 유지
  assert.equal(shrunk.left, 556);
  assert.equal(shrunk.width, 320);
  assert.equal(900 - (shrunk.left + shrunk.width), 24);

  // 3. vw 1280으로 다시 넓어짐
  const restored = fromAnchored(saved, { vw: initialVw, vh: initialVh });
  assert.equal(restored.left, rect.left);
  assert.equal(restored.top, rect.top);
  assert.equal(restored.width, rect.width);
  assert.equal(restored.height, rect.height);
});

test('왼쪽 구석은 left 그대로', () => {
  const initialVw = 1280;
  const initialVh = 800;
  const rect = { left: 24, top: 24, width: 320, height: 360 };

  // 1. vw 1280에서 저장
  const saved = toAnchored(rect, { vw: initialVw, vh: initialVh });
  assert.equal(saved.ax, 'left');
  assert.equal(saved.x, 24);
  assert.equal(saved.ay, 'top');
  assert.equal(saved.y, 24);

  // 2. vw 900으로 줄어도 left는 24 그대로
  const shrunk = fromAnchored(saved, { vw: 900, vh: 800 });
  assert.equal(shrunk.left, 24);
  assert.equal(shrunk.top, 24);

  // 3. vw 1280으로 돌아와도 left 24 그대로
  const restored = fromAnchored(saved, { vw: initialVw, vh: initialVh });
  assert.equal(restored.left, 24);
  assert.equal(restored.top, 24);
});

test('아주 좁아지면 화면 안으로 당기되 저장값 그대로', () => {
  const initialVw = 1280;
  const initialVh = 800;
  const rect = { left: 936, top: 416, width: 320, height: 360 }; // ax: right, x: 24
  const saved = toAnchored(rect, { vw: initialVw, vh: initialVh });
  const savedBefore = JSON.parse(JSON.stringify(saved));

  // 화면 폭이 300px(메모장 폭 320보다 좁음)로 아주 좁아짐
  const clamped = fromAnchored(saved, { vw: 300, vh: 400 });

  // 1. 화면 안으로 당겨졌는지 확인 (left >= 0, left + width <= 300)
  assert.ok(clamped.left >= 0);
  assert.ok(clamped.left + clamped.width <= 300);

  // 2. 저장값 객체 자체는 변하지 않고 그대로 유지
  assert.deepEqual(saved, savedBefore);

  // 3. 다시 창이 넓어지면 원래 위치로 계산됨
  const restored = fromAnchored(saved, { vw: initialVw, vh: initialVh });
  assert.equal(restored.left, rect.left);
  assert.equal(restored.top, rect.top);
});

test('옛 모양({left, top, width, height}) 읽기', () => {
  const oldRect = { left: 936, top: 416, width: 320, height: 360 };

  // 1. 옛 모양 객체를 fromAnchored에 전달 시 toAnchored로 변환되어 읽힘
  const visible = fromAnchored(oldRect, { vw: 1280, vh: 800 });
  assert.equal(visible.left, 936);
  assert.equal(visible.top, 416);
  assert.equal(visible.width, 320);
  assert.equal(visible.height, 360);

  // 2. 옛 모양에서 왼쪽 상단 위치였던 경우
  const oldLeftRect = { left: 24, top: 24, width: 320, height: 360 };
  const visibleLeft = fromAnchored(oldLeftRect, { vw: 900, vh: 800 });
  assert.equal(visibleLeft.left, 24);
  assert.equal(visibleLeft.top, 24);
});
