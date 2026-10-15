import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// memo-core.js 로드 (전역 globalThis.readglossMemo)
await import('../extension/memo-core.js');

const { dockWidth, shouldReturnFocus } = globalThis.readglossMemo;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const memoPadJsPath = join(__dirname, '../extension/memo-pad.js');
const memoPadSource = readFileSync(memoPadJsPath, 'utf8');

// ---------------------------------------------------------------------------
// 1. dockWidth 경계값 테스트
// ---------------------------------------------------------------------------
test('dockWidth: 260~0.5vw로 자르고 기본값 360', () => {
  // 1. vw = 1000 (0.5vw = 500px, 범위: 260 ~ 500)
  // 정상 범위 값
  assert.equal(dockWidth(360, 1000), 360);
  assert.equal(dockWidth(400, 1000), 400);

  // 하한선 미만(260 미만) -> 260으로 잘림
  assert.equal(dockWidth(200, 1000), 260);
  assert.equal(dockWidth(0, 1000), 260);
  assert.equal(dockWidth(-50, 1000), 260);

  // 상한선 초과(500 초과) -> 500으로 잘림
  assert.equal(dockWidth(550, 1000), 500);
  assert.equal(dockWidth(800, 1000), 500);

  // 경계값 정확히 일치
  assert.equal(dockWidth(260, 1000), 260);
  assert.equal(dockWidth(500, 1000), 500);

  // 2. saved 기본값 처리 (undefined, null, NaN, 비숫자) -> 기본 360
  assert.equal(dockWidth(undefined, 1000), 360);
  assert.equal(dockWidth(null, 1000), 360);
  assert.equal(dockWidth('invalid', 1000), 360);
  assert.equal(dockWidth(NaN, 1000), 360);

  // 3. vw = 600 (0.5vw = 300px, 범위: 260 ~ 300)
  // 기본값 360이 상한 300을 넘으므로 300으로 잘림
  assert.equal(dockWidth(undefined, 600), 300);
  assert.equal(dockWidth(280, 600), 280);
  assert.equal(dockWidth(200, 600), 260);
  assert.equal(dockWidth(350, 600), 300);

  // 4. 좁은 화면 극단값 (0.5vw < 260인 경우 최소 폭 260 유지)
  assert.equal(dockWidth(360, 400), 260);
  assert.equal(dockWidth(200, 400), 260);

  // 5. 소수점 반올림 처리
  assert.equal(dockWidth(333.4, 1000), 333);
  assert.equal(dockWidth(333.6, 1000), 334);
});

// ---------------------------------------------------------------------------
// 2. shouldReturnFocus 경우별 테스트
// ---------------------------------------------------------------------------
test('shouldReturnFocus: 조건에 따른 쓰는 칸 포커스 복귀 여부 판정', () => {
  const baseValid = {
    selectionCollapsed: true,
    cardOpen: false,
    activeKind: 'none',
    padHasFocus: false,
    padOpen: true,
  };

  // 1. 모든 조건 참 -> true
  assert.equal(shouldReturnFocus(baseValid), true);

  // activeKind가 null, undefined, 'other', 'body'인 경우도 true
  assert.equal(shouldReturnFocus({ ...baseValid, activeKind: null }), true);
  assert.equal(shouldReturnFocus({ ...baseValid, activeKind: undefined }), true);
  assert.equal(shouldReturnFocus({ ...baseValid, activeKind: 'other' }), true);
  assert.equal(shouldReturnFocus({ ...baseValid, activeKind: 'body' }), true);

  // 2. 선택이 비어있지 않음 (selectionCollapsed === false) -> false
  assert.equal(shouldReturnFocus({ ...baseValid, selectionCollapsed: false }), false);

  // 3. 우리 카드가 열려 있음 (cardOpen === true) -> false
  assert.equal(shouldReturnFocus({ ...baseValid, cardOpen: true }), false);

  // 4. activeElement가 페이지 입력칸인 경우 (activeKind === 'page-field') -> false
  assert.equal(shouldReturnFocus({ ...baseValid, activeKind: 'page-field' }), false);

  // 5. activeElement가 우리 다른 host인 경우 (activeKind === 'our-host') -> false
  assert.equal(shouldReturnFocus({ ...baseValid, activeKind: 'our-host' }), false);

  // 6. 메모장이 이미 포커스를 가진 경우 (padHasFocus === true) -> false
  assert.equal(shouldReturnFocus({ ...baseValid, padHasFocus: true }), false);

  // 7. 메모장이 접혀 있는 경우 (padOpen === false) -> false
  assert.equal(shouldReturnFocus({ ...baseValid, padOpen: false }), false);

  // 8. 빈 객체나 인자 없음 -> 안전하게 false
  assert.equal(shouldReturnFocus({}), false);
  assert.equal(shouldReturnFocus(null), false);
  assert.equal(shouldReturnFocus(undefined), false);
});

// ---------------------------------------------------------------------------
// 3. 소스 검사: memoPadDock 저장, marginRight 되돌림, study-mode 이벤트 등
// ---------------------------------------------------------------------------
test('소스 검사: memoPadDock storage 저장 및 불러오기', () => {
  assert.ok(
    memoPadSource.includes('memoPadDock'),
    'memo-pad.js에 memoPadDock 스토리지 키가 포함되어야 합니다.'
  );
  assert.ok(
    /chrome\.storage\.local\.(get|set)/.test(memoPadSource),
    'memo-pad.js에 chrome.storage.local 연동이 포함되어야 합니다.'
  );
});

test('소스 검사: marginRight 본문 여백 조정 및 원래 값 복원', () => {
  assert.ok(
    memoPadSource.includes('document.documentElement.style.marginRight'),
    'memo-pad.js에서 document.documentElement.style.marginRight를 조작해야 합니다.'
  );
});

test('소스 검사: setStudyMode 및 globalThis.readglossMemoPad 구현', () => {
  assert.ok(
    memoPadSource.includes('readglossMemoPad') && memoPadSource.includes('setStudyMode'),
    'memo-pad.js에서 readglossMemoPad.setStudyMode를 구현해야 합니다.'
  );
});

test('소스 검사: [붙이기] / [띄우기] 버튼 및 토글 구현', () => {
  assert.ok(
    memoPadSource.includes('붙이기') && memoPadSource.includes('띄우기'),
    'memo-pad.js에 붙이기/띄우기 버튼 문구가 포함되어야 합니다.'
  );
});

test('소스 검사: 쓰는 칸 기본 포커스 이벤트 및 대상 카드 host 검사', () => {
  assert.ok(
    memoPadSource.includes('mouseup') &&
    memoPadSource.includes('keyup') &&
    memoPadSource.includes('selectionchange'),
    'memo-pad.js에 mouseup, keyup, selectionchange 이벤트 감지가 포함되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('readgloss-selection') &&
    memoPadSource.includes('readgloss-card') &&
    memoPadSource.includes('readgloss-concept-form'),
    'memo-pad.js에 readgloss-selection, readgloss-card, readgloss-concept-form 검사가 포함되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('preventScroll'),
    'focus({preventScroll:true}) 옵션이 사용되어야 합니다.'
  );
});
