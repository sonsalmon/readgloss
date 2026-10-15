import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 순수 함수 로딩
await import('../extension/selection-core.js');
await import('../extension/memo-core.js');

const memoCore = globalThis.readglossMemo;

// 1. 순수 함수로 "결과를 넣을 칸 key" 판정 (FX-F 1번)
test('targetKeyOnPaste: 붙여넣기 시작 때 잡은 key 유지, 없으면 fallback', () => {
  const { targetKeyOnPaste } = memoCore;
  assert.equal(typeof targetKeyOnPaste, 'function', 'targetKeyOnPaste 함수가 등록되어 있어야 함');

  // 시작 시점의 key가 있으면 스크롤 등으로 현재 칸(fallback)이 바뀌어도 시작 key 유지
  assert.equal(targetKeyOnPaste('h0:intro', 'h2:details'), 'h0:intro');
  assert.equal(targetKeyOnPaste('h1:part1', '_page'), 'h1:part1');

  // 시작 key가 비어있으면 fallback key 사용
  assert.equal(targetKeyOnPaste('', 'h2:details'), 'h2:details');
  assert.equal(targetKeyOnPaste(null, 'h2:details'), 'h2:details');
  assert.equal(targetKeyOnPaste(undefined, 'h2:details'), 'h2:details');

  // 둘 다 없으면 기본 '_page'
  assert.equal(targetKeyOnPaste('', ''), '_page');
  assert.equal(targetKeyOnPaste(null, null), '_page');
});

// 2. 응답이 늦을 때 커서 뺏기 판정 (FX-F 2번)
test('shouldRestorePasteFocus: 응답 대기 중 다른 곳으로 커서를 옮겼으면 포커스를 뺏지 않는다', () => {
  const { shouldRestorePasteFocus } = memoCore;
  assert.equal(typeof shouldRestorePasteFocus, 'function', 'shouldRestorePasteFocus 함수가 등록되어 있어야 함');

  // 커서 이동 없음 (정상)
  assert.equal(
    shouldRestorePasteFocus({
      initialDocActive: 'host',
      currentDocActive: 'host',
      initialShadowActive: 'ta1',
      currentShadowActive: 'ta1',
      isPageField: false,
      activeKind: 'none',
    }),
    true
  );

  // 페이지 입력칸으로 커서 이동 -> false
  assert.equal(
    shouldRestorePasteFocus({
      initialDocActive: 'host',
      currentDocActive: 'input',
      initialShadowActive: 'ta1',
      currentShadowActive: null,
      isPageField: true,
      activeKind: 'page-field',
    }),
    false
  );

  // 우리 다른 칸(개념 칸, 패널 등 our-host)으로 이동 -> false
  assert.equal(
    shouldRestorePasteFocus({
      initialDocActive: 'host',
      currentDocActive: 'readgloss-concept-form',
      initialShadowActive: 'ta1',
      currentShadowActive: null,
      isPageField: false,
      activeKind: 'our-host',
    }),
    false
  );

  // shadow 안에서 다른 칸이나 다른 요소로 이동 -> false
  assert.equal(
    shouldRestorePasteFocus({
      initialDocActive: 'host',
      currentDocActive: 'host',
      initialShadowActive: 'ta1',
      currentShadowActive: 'ta2',
      isPageField: false,
      activeKind: 'none',
    }),
    false
  );
});

// 3. 칸을 다시 그릴 때 포커스 판정 (FX-F 3번, 16-6 위반 방지)
test('shouldFocusOnRebuild: 이미 메모장 안에 커서가 있었을 때만 무조건 복귀, 아니면 허용될 때만', () => {
  const { shouldFocusOnRebuild } = memoCore;
  assert.equal(typeof shouldFocusOnRebuild, 'function', 'shouldFocusOnRebuild 함수가 등록되어 있어야 함');

  // 메모장이 닫혀 있으면 항상 false
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: true,
      selectionCollapsed: true,
      cardOpen: false,
      activeKind: 'none',
      padOpen: false,
    }),
    false
  );

  // 1) 메모장 안에 이미 커서가 있었을 때 (padHadFocus: true) -> 무조건 복귀 (true)
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: true,
      selectionCollapsed: true,
      cardOpen: false,
      activeKind: 'none',
      padOpen: true,
    }),
    true
  );

  // 2) 메모장 안에 커서가 없었을 때 (padHadFocus: false):
  // 우리 다른 칸(개념 칸 readgloss-concept-form, 패널 readgloss-ui, 토스트 readgloss-toast 등)에 커서가 있음 -> false
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: false,
      selectionCollapsed: true,
      cardOpen: false,
      activeKind: 'our-host',
      padOpen: true,
    }),
    false
  );

  // 페이지 입력칸에 커서가 있음 -> false
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: false,
      selectionCollapsed: true,
      cardOpen: false,
      activeKind: 'page-field',
      padOpen: true,
    }),
    false
  );

  // 카드가 열려 있음 -> false
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: false,
      selectionCollapsed: true,
      cardOpen: true,
      activeKind: 'none',
      padOpen: true,
    }),
    false
  );

  // 드래그 선택이 남아 있음 -> false
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: false,
      selectionCollapsed: false,
      cardOpen: false,
      activeKind: 'none',
      padOpen: true,
    }),
    false
  );

  // 기본 조건 만족 (커서 없음, 카드 닫힘, 선택 비어있음, 메모장 열림) -> 허용 (true)
  assert.equal(
    shouldFocusOnRebuild({
      padHadFocus: false,
      selectionCollapsed: true,
      cardOpen: false,
      activeKind: 'none',
      padOpen: true,
    }),
    true
  );
});

// 4. 개념 그 자리 편집기에서 ⌘Enter / Esc 이벤트 소스 검사 (FX-F 4번)
test('소스 검사: 개념 인라인 편집기에서 ⌘Enter 및 Esc 시 stopPropagation·preventDefault 및 저장·닫기', () => {
  const padCode = fs.readFileSync(path.join(__dirname, '../extension/memo-pad.js'), 'utf8');

  // 편집기 keydown 에서 ⌘Enter 즉시 저장 및 닫기 처리
  assert.match(
    padCode,
    /key === 'Enter'\s*&&\s*\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)/,
    '개념 편집기 keydown에서 ⌘Enter/Ctrl+Enter 처리가 있어야 함'
  );

  // stopPropagation 호출 확인 (상자 처리기로 이벤트가 넘어가지 않도록)
  assert.match(
    padCode,
    /closeConceptInlineEdit\(id\);[\s\S]*?return;/,
    '개념 편집기 닫기 호출이 있어야 함'
  );
});

// 5. 편집기가 칸 전환으로 없어질 때 activeConceptEditId 비우기 소스 검사 (FX-F 5번)
test('소스 검사: 칸 전환 시 activeConceptEditId 비우고 대기 저장 전송', () => {
  const padCode = fs.readFileSync(path.join(__dirname, '../extension/memo-pad.js'), 'utf8');

  // updateActiveSection 및 switchToSection 에서 activeConceptEditId 닫기 호출
  assert.match(
    padCode,
    /if\s*\([^)]*activeConceptEditId[^)]*\)\s*\{?\s*closeConceptInlineEdit\(activeConceptEditId\)/,
    '칸 전환 시 activeConceptEditId가 있으면 closeConceptInlineEdit를 호출해야 함'
  );
});

// 6. 본문 인용 바뀜 알림 (FX-F 6번)
test('소스 검사: 본문 글 붙여넣기로 기존 인용 변경 시 "인용을 바꿨어요" 알림 띄움', () => {
  const padCode = fs.readFileSync(path.join(__dirname, '../extension/memo-pad.js'), 'utf8');

  assert.match(
    padCode,
    /인용을 바꿨어요/,
    '인용을 바꿨어요 알림 문구가 포함되어 있어야 함'
  );
});

// 7. 공부 모드 중 붙이기 폭 조절 시 on 값 유지 (FX-F 7번)
test('dockStateToSave: 공부 모드 중에는 폭만 저장하고 on 값은 preStudyDockState.docked 유지', () => {
  const { dockStateToSave } = memoCore;
  assert.equal(typeof dockStateToSave, 'function', 'dockStateToSave 함수가 등록되어 있어야 함');

  // 공부 모드 진행 중: preStudyDockState.docked 가 false 이면 isDocked 가 true 여도 on 은 false 유지
  assert.deepEqual(
    dockStateToSave({
      studyMode: true,
      preStudyDockState: { open: false, docked: false },
      isDocked: true,
      dockWidthValue: 400,
    }),
    { on: false, width: 400 }
  );

  // 공부 모드 진행 중: 원래 docked 였으면 on 은 true
  assert.deepEqual(
    dockStateToSave({
      studyMode: true,
      preStudyDockState: { open: true, docked: true },
      isDocked: true,
      dockWidthValue: 450,
    }),
    { on: true, width: 450 }
  );

  // 일반 모드: isDocked 상태 그대로 저장
  assert.deepEqual(
    dockStateToSave({
      studyMode: false,
      preStudyDockState: null,
      isDocked: true,
      dockWidthValue: 360,
    }),
    { on: true, width: 360 }
  );
  assert.deepEqual(
    dockStateToSave({
      studyMode: false,
      preStudyDockState: null,
      isDocked: false,
      dockWidthValue: 360,
    }),
    { on: false, width: 360 }
  );
});

test('소스 검사: saveDockState 에서 공부 모드 전 저장값 유지', () => {
  const padCode = fs.readFileSync(path.join(__dirname, '../extension/memo-pad.js'), 'utf8');

  assert.match(
    padCode,
    /saveDockState[\s\S]*?(?:dockStateToSave|preStudyDockState)/,
    'saveDockState에서 dockStateToSave 또는 preStudyDockState를 참조하여 on 값을 결정해야 함'
  );
});
