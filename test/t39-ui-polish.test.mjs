import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 모듈 불러오기 (node 환경)
await import('../extension/settings-core.js');
await import('../extension/panel.js');
await import('../extension/opacity.js');

const O = globalThis.readglossOpacity;
const C = globalThis.readglossPanelCore;

test('opacity: hostOpacity 경우별 판정', () => {
  assert.equal(typeof O.hostOpacity, 'function', 'hostOpacity 함수 존재');

  // 1. hovered 만 true -> 1
  assert.equal(O.hostOpacity({ hovered: true, typing: false, base: 0.6 }), 1);
  assert.equal(O.hostOpacity({ hovered: true, typing: false, base: 0.4 }), 1);

  // 2. typing 만 true -> 1
  assert.equal(O.hostOpacity({ hovered: false, typing: true, base: 0.6 }), 1);
  assert.equal(O.hostOpacity({ hovered: false, typing: true, base: 0.8 }), 1);

  // 3. 둘 다 true -> 1
  assert.equal(O.hostOpacity({ hovered: true, typing: true, base: 0.5 }), 1);

  // 4. 둘 다 false -> base 반환
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.6 }), 0.6);
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.4 }), 0.4);
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 1.0 }), 1.0);

  // 5. 기본값 및 인자 처리
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.75 }), 0.75);
  assert.equal(O.hostOpacity({ hovered: false, typing: false }), 1);
});

test('panel: menuShouldClose 경계값 검사 (350ms)', () => {
  assert.equal(typeof C.menuShouldClose, 'function', 'menuShouldClose 함수 존재');

  // dock 위에 마우스가 있으면 닫지 않음
  assert.equal(C.menuShouldClose({ overDock: true, overMenu: false, msSinceLeave: 500 }), false);
  assert.equal(C.menuShouldClose({ overDock: true, overMenu: false, msSinceLeave: 0 }), false);

  // menu 위에 마우스가 있으면 닫지 않음
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: true, msSinceLeave: 500 }), false);
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: true, msSinceLeave: 0 }), false);

  // 둘 다 위에 있으면 닫지 않음
  assert.equal(C.menuShouldClose({ overDock: true, overMenu: true, msSinceLeave: 500 }), false);

  // 둘 다 벗어났을 때의 시간 경계 (350ms)
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: 0 }), false);
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: 200 }), false);
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: 349 }), false, '350ms 미만은 닫지 않음');
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: 350 }), true, '350ms 이상은 닫음');
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: 351 }), true);
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: 1000 }), true);

  // 잘못된 시간값 처리
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: -10 }), false);
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: undefined }), false);
  assert.equal(C.menuShouldClose({ overDock: false, overMenu: false, msSinceLeave: NaN }), false);
});

test('소스 검사: content.js 저장 완료 확인 메시지(toast) Esc 처리와 readglossCardClosed', () => {
  const code = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

  // toast Esc 처리 확인: toastHost 가 있고 !toastMemo 일 때 hideToast 호출
  assert.match(code, /toastHost\s*&&\s*!toastMemo/, '메모 칸 입력 중이 아닐 때 토스트 닫기 조건');
  assert.match(code, /hideToast\(\)/, '토스트 닫기 호출');

  // readglossCardClosed 로 패널·메모장 닫힘 방지 확인
  assert.match(code, /e\.readglossCardClosed\s*=\s*true/, '이벤트에 readglossCardClosed 표시 설정');
});

test('소스 검사: content.js 사전 카드 Esc 닫기 시 getSelection().removeAllRanges()', () => {
  const code = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

  // 사전 카드 Esc 시 removeAllRanges 호출 확인
  assert.match(code, /removeAllRanges\(\)/, '사전 카드 Esc 닫기 시 선택 해제 호출');
  assert.match(code, /getSelection\(\)/, 'getSelection 호출');
});

test('소스 검사: panel.js .dock:hover .menu 제거 및 JS 여닫기·패딩', () => {
  const code = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');

  // CSS 에서 .dock:hover .menu 가 제거되었는지 확인
  assert.equal(code.includes('.dock:hover .menu'), false, '.dock:hover .menu CSS 규칙이 없어야 함');

  // 키보드 포커스(:focus-visible) 지원 유지 확인
  assert.match(code, /:focus-visible/, '키보드 포커스 유지');

  // JS 로 여닫기 로직 확인
  assert.match(code, /menuShouldClose/, 'menuShouldClose 사용');
  assert.match(code, /350/, '350ms 타이머 지연 사용');

  // .menu 패딩 여백 확인
  assert.match(code, /\.menu\s*\{[^}]*padding[^}]*\}/s, '.menu 에 투명 여백 패딩 적용');
});
