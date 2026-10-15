import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// FX-G 과제 검증 시험: overlay 버그 수정 검증
await import('../extension/settings-core.js');
await import('../extension/opacity.js');

const O = globalThis.readglossOpacity;

// 1. hostOpacity dimWhileReading 경우별 검사
test('opacity: hostOpacity dimWhileReading 경우별 판정', () => {
  assert.equal(typeof O.hostOpacity, 'function', 'hostOpacity 함수 존재');

  // 1) dimWhileReading: false 이면 마우스·입력에도 진해지지 않고 항상 base 값
  assert.equal(O.hostOpacity({ hovered: true, typing: false, base: 0.6, dimWhileReading: false }), 0.6);
  assert.equal(O.hostOpacity({ hovered: false, typing: true, base: 0.6, dimWhileReading: false }), 0.6);
  assert.equal(O.hostOpacity({ hovered: true, typing: true, base: 0.5, dimWhileReading: false }), 0.5);
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.4, dimWhileReading: false }), 0.4);
  assert.equal(O.hostOpacity({ hovered: true, typing: true, dimWhileReading: false }), 1); // base 기본값 1

  // 2) dimWhileReading: true 이면 마우스 올린 host·입력 중인 host 만 1, 아니면 base
  assert.equal(O.hostOpacity({ hovered: true, typing: false, base: 0.6, dimWhileReading: true }), 1);
  assert.equal(O.hostOpacity({ hovered: false, typing: true, base: 0.6, dimWhileReading: true }), 1);
  assert.equal(O.hostOpacity({ hovered: true, typing: true, base: 0.5, dimWhileReading: true }), 1);
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.6, dimWhileReading: true }), 0.6);
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.4, dimWhileReading: true }), 0.4);

  // 3) dimWhileReading 생략 시 기본값 true (기존 호환)
  assert.equal(O.hostOpacity({ hovered: true, typing: false, base: 0.6 }), 1);
  assert.equal(O.hostOpacity({ hovered: false, typing: false, base: 0.6 }), 0.6);
});

// 2. 소스 검사: retrack (unobserve 뒤 observe, 네 경로 사용, pageSeen.delete, updateHighlights, 연결 끊김 unobserve)
test('소스 검사: annotate.js retrack 및 연결 끊김 처리', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // retrack 함수 정의 확인 (unobserve 뒤 observe)
  assert.match(
    src,
    /function\s+retrack\s*\([^)]*\)\s*\{[\s\S]*?\.unobserve\([^)]+\)[\s\S]*?\.observe\([^)]+\)/,
    'retrack 함수에서 unobserve 뒤 observe 를 호출한다'
  );

  // 네 경로에서 retrack 사용 확인
  // 1) request/flush 실패 재시도 경로
  assert.match(src, /setTimeout\(\(\) => jobs\.forEach\(\(j\) => retrack\(j\.block\)\)/, 'flush 재시도 경로에서 retrack 사용');
  // 2) updatePositions changed 경로
  assert.match(src, /if\s*\(\s*changed\s*\)\s*\{[\s\S]*?retrack\s*\(\s*block\s*\)/, 'updatePositions 변경 감지 시 retrack 사용');
  // 3) collect mutationTimer 경로
  assert.match(src, /for\s*\(\s*const\s+b\s+of\s+dirty\s*\)\s*\{[\s\S]*?retrack\s*\(\s*b\s*\)/, 'collect dirty 타이머에서 retrack 사용');
  // 4) mydict 이벤트 경로
  assert.match(src, /readgloss:mydict[\s\S]*?querySelectorAll\s*\([^)]+\)\.forEach\s*\(\s*retrack\s*\)/, 'mydict 변경 리스너에서 retrack 사용');

  // 블록 entry 버릴 때 pageSeen.delete 및 updateHighlights 호출 확인
  assert.match(src, /state\.pageSeen\.delete/, 'entry 버릴 때 state.pageSeen 에서 원형을 삭제한다');
  assert.match(
    /function\s+clearBlockEntries[\s\S]*?state\.pageSeen\.delete[\s\S]*?updateHighlights\(\)/.exec(src)?.[0] ?? '',
    /updateHighlights\(\)/,
    'clearBlockEntries 에서 pageSeen.delete 후 updateHighlights() 를 호출한다'
  );

  // 문서에서 떨어진 블록 unobserve 확인
  assert.match(src, /!block\.isConnected[\s\S]*?io\?\.unobserve\s*\(\s*block\s*\)[\s\S]*?ro\?\.unobserve\s*\(\s*block\s*\)/, '연결 끊긴 블록은 io와 ro에서 unobserve 한다');
});

// 3. 소스 검사: MutationObserver attributeFilter 와 load 이벤트
test('소스 검사: annotate.js attributeFilter 와 document capture load 이벤트', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // MutationObserver attributeFilter 옵션
  assert.match(src, /attributes:\s*true/, 'MutationObserver 에 attributes: true 설정');
  assert.match(src, /attributeFilter:\s*\[['"`]style['"`],\s*['"`]class['"`],\s*['"`]hidden['"`],\s*['"`]open['"`]\]/, 'attributeFilter 에 style, class, hidden, open 지정');

  // attributes 변경 시 블록 다시 처리가 아니라 scheduleUpdate() 만 호출
  assert.match(src, /r\.type\s*===\s*['"`]attributes['"`]/, 'attributes 변경 레코드 분기');

  // document capture load 이벤트 리스너 등록 및 해제
  assert.match(src, /addEventListener\s*\(\s*['"`]load['"`]\s*,\s*scheduleUpdate\s*,\s*\{\s*capture:\s*true/, 'load 이벤트 capture: true 로 scheduleUpdate 등록');
  assert.match(src, /removeEventListener\s*\(\s*['"`]load['"`]\s*,\s*scheduleUpdate\s*,\s*\{\s*capture:\s*true\s*\}/, 'stop 시 load 이벤트 capture: true 제거');
});

// 4. 소스 검사: updatePositions 읽기 루프 뒤 쓰기 루프 (순서 검사)
test('소스 검사: annotate.js updatePositions 읽기 루프 뒤 쓰기 루프 분리', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // updatePositions 함수 내용 추출
  const fnMatch = /function\s+updatePositions\s*\(\)\s*\{([\s\S]*?)\n\s*function\s+onIntersect/.exec(src);
  assert.ok(fnMatch, 'updatePositions 함수가 존재한다');
  const fnBody = fnMatch[1];

  // 1단계 읽기 루프와 2단계 쓰기 루프 확인
  const readIdx = fnBody.indexOf('getClientRects()');
  const hitIdx = fnBody.indexOf('elementFromPoint');
  const writeLeftIdx = fnBody.indexOf('.style.left');
  const writeTopIdx = fnBody.indexOf('.style.top');

  assert.ok(readIdx !== -1, 'getClientRects() 호출이 존재한다');
  assert.ok(hitIdx !== -1, 'elementFromPoint 호출이 존재한다');
  assert.ok(writeLeftIdx !== -1, 'style.left 쓰기가 존재한다');
  assert.ok(writeTopIdx !== -1, 'style.top 쓰기가 존재한다');

  // getClientRects 와 elementFromPoint 가 style.left / style.top 쓰기보다 먼저 나타남
  assert.ok(readIdx < writeLeftIdx, 'getClientRects() 읽기가 style.left 쓰기보다 앞서야 한다');
  assert.ok(hitIdx < writeLeftIdx, 'elementFromPoint 읽기가 style.left 쓰기보다 앞서야 한다');
  assert.ok(readIdx < writeTopIdx, 'getClientRects() 읽기가 style.top 쓰기보다 앞서야 한다');
  assert.ok(hitIdx < writeTopIdx, 'elementFromPoint 읽기가 style.top 쓰기보다 앞서야 한다');

  // updatePositions 안에서 getComputedStyle 매번 호출하지 않고 entry 생성 시 계산
  assert.equal(
    fnBody.includes('getComputedStyle('),
    false,
    'updatePositions 루프 안에서 getComputedStyle 을 호출하지 않는다'
  );

  // 라벨 폭/높이 캐싱 (labelWidth/labelHeight) 확인
  assert.match(src, /labelWidth/, 'labelWidth 캐시 필드 사용');
  assert.match(src, /labelHeight/, 'labelHeight 캐시 필드 사용');
});

// 5. 소스 검사: memo-pad.js 와 concept.js 의 readglossCardClosed 확인
test('소스 검사: memo-pad.js 및 concept.js Esc 처리 시 readglossCardClosed 확인', () => {
  const memoSrc = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');
  const conceptSrc = readFileSync(new URL('../extension/concept.js', import.meta.url), 'utf8');

  // memo-pad.js 키 처리에서 readglossCardClosed 무시 확인
  assert.match(memoSrc, /readglossCardClosed/, 'memo-pad.js 에 readglossCardClosed 확인 로직이 있다');

  // concept.js 키 처리에서 readglossCardClosed 무시 확인
  assert.match(conceptSrc, /readglossCardClosed/, 'concept.js 에 readglossCardClosed 확인 로직이 있다');
});
