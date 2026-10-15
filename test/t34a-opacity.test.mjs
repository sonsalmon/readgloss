import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// classic script 들을 node 환경에서 로드
await import('../extension/settings-core.js');
await import('../extension/panel.js');
await import('../extension/opacity.js');

const S = globalThis.readglossSettings;
const C = globalThis.readglossPanelCore;
const O = globalThis.readglossOpacity;

test('settings-core: opacityInput·opacityUi·dimWhileReading 기본값', () => {
  assert.equal(S.DEFAULTS.opacityInput, 100);
  assert.equal(S.DEFAULTS.opacityUi, 100);
  assert.equal(S.DEFAULTS.dimWhileReading, true);

  const normalized = S.normalize({});
  assert.equal(normalized.opacityInput, 100);
  assert.equal(normalized.opacityUi, 100);
  assert.equal(normalized.dimWhileReading, true);
});

test('settings-core: opacityInput·opacityUi 범위 검사(40~100 정수)', () => {
  // 정상 범위
  assert.equal(S.normalize({ opacityInput: 40 }).opacityInput, 40);
  assert.equal(S.normalize({ opacityInput: 75 }).opacityInput, 75);
  assert.equal(S.normalize({ opacityInput: 100 }).opacityInput, 100);
  assert.equal(S.normalize({ opacityUi: 40 }).opacityUi, 40);
  assert.equal(S.normalize({ opacityUi: 85 }).opacityUi, 85);
  assert.equal(S.normalize({ opacityUi: 100 }).opacityUi, 100);

  // 40 미만은 40으로 클램프
  assert.equal(S.normalize({ opacityInput: 0 }).opacityInput, 40);
  assert.equal(S.normalize({ opacityInput: 39 }).opacityInput, 40);
  assert.equal(S.normalize({ opacityInput: -10 }).opacityInput, 40);
  assert.equal(S.normalize({ opacityUi: 0 }).opacityUi, 40);
  assert.equal(S.normalize({ opacityUi: 39 }).opacityUi, 40);

  // 100 초과는 100으로 클램프
  assert.equal(S.normalize({ opacityInput: 101 }).opacityInput, 100);
  assert.equal(S.normalize({ opacityInput: 200 }).opacityInput, 100);
  assert.equal(S.normalize({ opacityUi: 150 }).opacityUi, 100);

  // 소수는 정수로 반올림
  assert.equal(S.normalize({ opacityInput: 70.4 }).opacityInput, 70);
  assert.equal(S.normalize({ opacityInput: 70.6 }).opacityInput, 71);
  assert.equal(S.normalize({ opacityUi: 55.2 }).opacityUi, 55);

  // 숫자가 아니면 기본값 100
  assert.equal(S.normalize({ opacityInput: '80' }).opacityInput, 100);
  assert.equal(S.normalize({ opacityInput: null }).opacityInput, 100);
  assert.equal(S.normalize({ opacityInput: NaN }).opacityInput, 100);
  assert.equal(S.normalize({ opacityUi: undefined }).opacityUi, 100);
  assert.equal(S.normalize({ opacityUi: 'bad' }).opacityUi, 100);
});

test('settings-core: dimWhileReading 불리언 검사', () => {
  assert.equal(S.normalize({ dimWhileReading: true }).dimWhileReading, true);
  assert.equal(S.normalize({ dimWhileReading: false }).dimWhileReading, false);
  // 불리언이 아니면 기본값 true
  assert.equal(S.normalize({ dimWhileReading: 'false' }).dimWhileReading, true);
  assert.equal(S.normalize({ dimWhileReading: 0 }).dimWhileReading, true);
  assert.equal(S.normalize({ dimWhileReading: null }).dimWhileReading, true);
});

test('settings-core: merge 로 깊은 병합 및 정규화', () => {
  const merged = S.merge({}, { opacityInput: 60, dimWhileReading: false });
  assert.equal(merged.opacityInput, 60);
  assert.equal(merged.opacityUi, 100);
  assert.equal(merged.dimWhileReading, false);
});

test('panel: RANGES·TOGGLES 에 화면 투명도 및 읽는 동안 흐리게 항목 등록', () => {
  const rInput = C.RANGES.find((r) => r.path === 'opacityInput');
  const rUi = C.RANGES.find((r) => r.path === 'opacityUi');
  const tDim = C.TOGGLES.find((t) => t.path === 'dimWhileReading');

  assert.ok(rInput, 'opacityInput 슬라이더 범위 등록');
  assert.equal(rInput.min, 40);
  assert.equal(rInput.max, 100);

  assert.ok(rUi, 'opacityUi 슬라이더 범위 등록');
  assert.equal(rUi.min, 40);
  assert.equal(rUi.max, 100);

  assert.ok(tDim, 'dimWhileReading 스위치 토글 등록');

  // sliderPatch 동작 확인
  assert.deepEqual(C.sliderPatch(rInput, '65'), { opacityInput: 65 });
  assert.deepEqual(C.sliderPatch(rUi, '80'), { opacityUi: 80 });
  assert.deepEqual(C.sliderPatch(rInput, '20'), { opacityInput: 40 }, '하한 40 클램프');
  assert.deepEqual(C.sliderPatch(rUi, '120'), { opacityUi: 100 }, '상한 100 클램프');

  // settings-core 연계 확인
  const merged = S.merge({}, C.sliderPatch(rInput, 50));
  assert.equal(merged.opacityInput, 50);
});

test('panel: 공부 모드 순수 함수 및 문구 판정', () => {
  assert.equal(C.studyModeText(false), '공부 모드');
  assert.equal(C.studyModeText(true), '공부 모드 끄기');
  assert.equal(C.studyModeToggle(false), true);
  assert.equal(C.studyModeToggle(true), false);
});

test('opacity: 초기 상태 및 기본값', () => {
  const st = O.createInitialState({ dimWhileReading: true, now: 1000 });
  assert.equal(st.dimWhileReading, true);
  assert.equal(st.solid, false);
  assert.equal(st.isSolid, false);
  assert.equal(st.mouseInMemo, false);
  assert.equal(st.lastInputAt, 1000);
});

test('opacity: 메모장 열림 직후 진함(100%)', () => {
  const init = O.createInitialState({ dimWhileReading: true, now: 1000 });
  const next = O.stateAfter(init, { type: 'memo-open' }, 1000);
  assert.equal(next.solid, true);
  assert.equal(next.isSolid, true);
});

test('opacity: 메모장 마우스 진입 시 진함(100%)', () => {
  const init = O.createInitialState({ dimWhileReading: true, now: 1000 });
  const next = O.stateAfter(init, { type: 'memo-enter' }, 1100);
  assert.equal(next.mouseInMemo, true);
  assert.equal(next.solid, true);
});

test('opacity: 메모장 쓰는 칸 input 이벤트 시 진함(100%) 및 lastInputAt 갱신', () => {
  const init = O.createInitialState({ dimWhileReading: true, now: 1000 });
  const next = O.stateAfter(init, { type: 'memo-input' }, 2000);
  assert.equal(next.lastInputAt, 2000);
  assert.equal(next.solid, true);
});

test('opacity: 메모장 밖으로 나가고 1.5초 흐름(1.5초 전엔 진함, 1.5초 후 흐림)', () => {
  // 마지막 입력이 1000ms 에 있었음
  const inMemo = {
    dimWhileReading: true,
    solid: true,
    isSolid: true,
    mouseInMemo: true,
    lastInputAt: 1000,
  };

  // 마우스가 밖으로 나감 (now = 1500, 입력 후 500ms 경과) -> 아직 1.5초 안 지났으므로 진함 유지
  const leftEarly = O.stateAfter(inMemo, { type: 'memo-leave' }, 1500);
  assert.equal(leftEarly.mouseInMemo, false);
  assert.equal(leftEarly.solid, true);

  // 1.5초 타이머 경과 시점 (now = 2500, 입력 후 1500ms 경과) -> 흐림으로 복귀
  const timedOut = O.stateAfter(leftEarly, { type: 'timer' }, 2500);
  assert.equal(timedOut.solid, false);
  assert.equal(timedOut.isSolid, false);

  // 마우스가 나가는 시점에 이미 마지막 입력 후 1.5초 이상 지났으면 즉시 흐림
  const leftLate = O.stateAfter(inMemo, { type: 'memo-leave' }, 3000);
  assert.equal(leftLate.mouseInMemo, false);
  assert.equal(leftLate.solid, false);

  // 마우스가 메모장 안에 계속 있으면 타이머가 와도 흐려지지 않음
  const stillIn = O.stateAfter(inMemo, { type: 'timer' }, 3000);
  assert.equal(stillIn.solid, true);
});

test('opacity: 본문 mousedown 시 즉시 흐림으로 복귀', () => {
  const solidState = {
    dimWhileReading: true,
    solid: true,
    isSolid: true,
    mouseInMemo: true,
    lastInputAt: 1000,
  };
  const next = O.stateAfter(solidState, { type: 'page-mousedown' }, 1200);
  assert.equal(next.solid, false);
  assert.equal(next.isSolid, false);
  assert.equal(next.mouseInMemo, false);
});

test('opacity: dimWhileReading 이 꺼져 있으면 항상 설정값(흐림) 유지', () => {
  const offState = O.createInitialState({ dimWhileReading: false, now: 1000 });
  assert.equal(O.stateAfter(offState, { type: 'memo-open' }, 1100).solid, false);
  assert.equal(O.stateAfter(offState, { type: 'memo-enter' }, 1200).solid, false);
  assert.equal(O.stateAfter(offState, { type: 'memo-input' }, 1300).solid, false);
});

test('opacity: 2인자 호출 지원 globalThis.readglossOpacity.stateAfter(event, now)', () => {
  O.resetInternalState({ dimWhileReading: true, now: 1000 });
  const st1 = O.stateAfter({ type: 'memo-enter' }, 1100);
  assert.equal(st1.solid, true);
  assert.equal(st1.mouseInMemo, true);

  const st2 = O.stateAfter({ type: 'page-mousedown' }, 1200);
  assert.equal(st2.solid, false);
});

test('opacity: computeAlpha 계산(진함 100%, 흐림 설정값)', () => {
  const s = { opacityInput: 80, opacityUi: 60, dimWhileReading: true };

  // 흐림 상태 (solid: false)
  const dimAlpha = O.computeAlpha(s, { solid: false, dimWhileReading: true });
  assert.equal(dimAlpha.uiAlpha, 0.6);
  assert.equal(dimAlpha.inputAlpha, 0.8);
  assert.equal(dimAlpha.isSolid, false);

  // 진함 상태 (solid: true)
  const solidAlpha = O.computeAlpha(s, { solid: true, dimWhileReading: true });
  assert.equal(solidAlpha.uiAlpha, 1.0);
  assert.equal(solidAlpha.inputAlpha, 1.0);
  assert.equal(solidAlpha.isSolid, true);

  // dimWhileReading = false 일 때: solid 상태여도 설정값 그대로
  const noDimAlpha = O.computeAlpha({ ...s, dimWhileReading: false }, { solid: true, dimWhileReading: false });
  assert.equal(noDimAlpha.uiAlpha, 0.6);
  assert.equal(noDimAlpha.inputAlpha, 0.8);
  assert.equal(noDimAlpha.isSolid, false);
});

test('opacity: 대상 화면 host 태그 목록 검증', () => {
  const expected = [
    'readgloss-memo-pad',
    'readgloss-selection',
    'readgloss-card',
    'readgloss-ui',
    'readgloss-panel',
    'readgloss-concept-card',
    'readgloss-concept-form',
    'readgloss-toast',
  ];
  for (const tag of expected) {
    assert.ok(O.HOST_TAGS.includes(tag), `호스트 태그 목록에 ${tag} 포함`);
    assert.equal(O.isOurHostTag(tag), true);
  }
  assert.equal(O.isOurHostTag('div'), false);
  assert.equal(O.isOurHostTag('body'), false);

  // 경로 판정 헬퍼
  assert.equal(O.hasOurHostInPath([{ localName: 'div' }, { localName: 'readgloss-card' }]), true);
  assert.equal(O.hasOurHostInPath([{ localName: 'div' }, { localName: 'span' }]), false);
  assert.equal(O.hasMemoHostInPath([{ localName: 'textarea' }, { localName: 'readgloss-memo-pad' }]), true);
  assert.equal(O.hasMemoHostInPath([{ localName: 'readgloss-card' }]), false);
});

test('manifest: opacity.js 등록 및 순서', () => {
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const js = m.content_scripts[0].js;

  assert.ok(js.includes('opacity.js'), 'content_scripts 에 opacity.js 포함');
  assert.ok(js.indexOf('opacity.js') > js.indexOf('settings-core.js'), 'settings-core.js 뒤에 위치');
  assert.ok(js.indexOf('opacity.js') > js.indexOf('panel.js'), 'panel.js 뒤에 위치');
});
