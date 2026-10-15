// test/concept-reopen.test.mjs
// 방금 저장한 것 다시 열기(Ctrl/⌘+Z, 15-2), 표시 클릭 판정·토글(15-3, 16-7), 상세 포커스·자동 저장(15-3) 검사 (T32c)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(rootDir, 'extension', rel), 'utf8');

// concept.js 는 IIFE 라서 node 에서 import 해도 DOM 을 건드리지 않는다. 순수 함수는 globalThis 로 꺼낸다.
await import('../extension/concept.js');
const { isReopenShortcut, shouldIgnoreReopenEvent, shouldOpenConceptOnClick } = globalThis.readglossConceptReopen;

// ---- 1. 표시 클릭 판정 (순수 함수) ----
test('shouldOpenConceptOnClick: 한 번 클릭, 선택 없음, 링크 밖이면 연다', () => {
  assert.equal(shouldOpenConceptOnClick({ clickCount: 1, selectionEmpty: true, inLink: false, altKey: false }), true);
});

test('shouldOpenConceptOnClick: 두 번째 클릭(더블클릭)이면 열지 않는다 — 사전 카드 흐름에 넘긴다', () => {
  assert.equal(shouldOpenConceptOnClick({ clickCount: 2, selectionEmpty: true, inLink: false, altKey: false }), false);
});

test('shouldOpenConceptOnClick: 드래그로 글을 골랐으면(선택 있음) 열지 않는다', () => {
  assert.equal(shouldOpenConceptOnClick({ clickCount: 1, selectionEmpty: false, inLink: false, altKey: false }), false);
});

test('shouldOpenConceptOnClick: 링크 안은 ⌥ 를 누른 때만 연다', () => {
  assert.equal(shouldOpenConceptOnClick({ clickCount: 1, selectionEmpty: true, inLink: true, altKey: false }), false);
  assert.equal(shouldOpenConceptOnClick({ clickCount: 1, selectionEmpty: true, inLink: true, altKey: true }), true);
});

// ---- 2. Ctrl/⌘+Z 판정 ----
test('isReopenShortcut: Ctrl 또는 ⌘ 하나만 누른 Z 만 받는다 (Shift 없음)', () => {
  assert.equal(isReopenShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'z' }), true);
  assert.equal(isReopenShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'z' }), true);
  assert.equal(isReopenShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'Z' }), false);
  assert.equal(isReopenShortcut({ ctrlKey: true, metaKey: true, altKey: false, shiftKey: false, key: 'z' }), false);
  assert.equal(isReopenShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 'z' }), false);
  assert.equal(isReopenShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'z' }), false);
});

test('isReopenShortcut: 한글 자판이라 key 가 달라도 물리 키(code)가 KeyZ 면 받는다', () => {
  assert.equal(isReopenShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'ㅋ', code: 'KeyZ' }), true);
});

// ---- 3. 입력칸·우리 host 경로에서는 무시 (원래 되돌리기) ----
test('shouldIgnoreReopenEvent: 입력칸·textarea·select·편집 영역·우리 host 가 경로에 있으면 무시한다', () => {
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'input' }]), true);
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'textarea' }]), true);
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'select' }]), true);
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'div', isContentEditable: true }]), true);
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'readgloss-memo-pad' }]), true);
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'readgloss-ui' }]), true);
});

test('shouldIgnoreReopenEvent: 페이지 글 위에서는 무시하지 않는다', () => {
  assert.equal(shouldIgnoreReopenEvent([{ nodeType: 1, localName: 'p' }, { nodeType: 1, localName: 'body' }]), false);
  assert.equal(shouldIgnoreReopenEvent([]), false);
  assert.equal(shouldIgnoreReopenEvent(null), false);
});

// ---- 4. 소스 검사: 마지막 저장 기억, 토글, 포커스, 자동 저장 ----
test('마지막 저장 기억: 개념(칸·나중에 볼 것·상세)과 메모 저장 성공 때 readglossLastSave 를 둔다', () => {
  const concept = read('concept.js');
  const panel = read('panel-concepts.js');
  const memo = read('memo-pad.js');
  assert.equal((concept.match(/globalThis\.readglossLastSave = \{ kind: 'concept', id \}/g) || []).length, 3, 'concept.js 칸 저장·같은 이름 합치기(FX-D)·나중에 볼 것 저장');
  assert.ok(panel.includes("globalThis.readglossLastSave = { kind: 'concept', id: concept.id }"), '패널 상세 저장');
  assert.ok(memo.includes("globalThis.readglossLastSave = { kind: 'memo', id: res.memo.id }"), '메모 저장 성공');
});

test('Ctrl/⌘+Z 는 document keydown(캡처 아님)에 달고, 마지막 저장을 다시 연다', () => {
  const concept = read('concept.js');
  assert.match(concept, /document\.addEventListener\('keydown', onDocumentKeyDown\);/, '캡처 아닌 keydown');
  assert.ok(concept.includes("readglossMemoPadUi?.reopen?.(last.id)"), '메모는 메모장 reopen 을 부른다');
  assert.ok(concept.includes("detail: { tab: 'concepts', conceptId: last.id, focusNew: true }"), '개념은 focusNew 로 연다');
});

test('메모장 reopen: 메모 글을 소제목 칸으로 가져오고 ⌘Enter 는 edit 요청으로 보낸다', () => {
  const memo = read('memo-pad.js');
  assert.ok(memo.includes('reopen: (id) => reopenMemo(id)'), 'reopen 공개');
  assert.ok(memo.includes("op: 'edit', id, text"), 'edit 요청');
  assert.match(memo, /if \(editingMemo && editingMemo\.sectionKey === sectionKey\) return performEdit\(sectionKey, ta\);/);
});

test('표시 클릭: 250ms 기다렸다가 열고, 두 번째 클릭이면 취소하며, 드래그 선택은 mouseup 때 잡는다', () => {
  const concept = read('concept.js');
  assert.match(concept, /conceptOpenTimer = setTimeout\([\s\S]*?\}, 250\);/, '250ms 대기');
  assert.ok(concept.includes('if (e.detail >= 2)'), '두 번째 클릭이면 대기 취소');
  assert.ok(concept.includes("window.addEventListener('mouseup', onWindowMouseUp, true)"), 'mouseup 에서 선택 기록');
  assert.ok(concept.includes("window.addEventListener('mousedown', onWindowMouseDown, true)"), 'mousedown 에서 패널 상태 기록');
});

test('토글(16-7): 같은 개념이 열려 있었는지는 mousedown 때 잡고, 현재 상세 id 는 패널이 알려 준다', () => {
  const concept = read('concept.js');
  const panel = read('panel-concepts.js');
  assert.ok(concept.includes('const wasSameOpen = pressedWasOpen && pressedConceptId === hit.id;'), 'mousedown 시점 상태로 판정');
  assert.ok(panel.includes('getCurrentConceptId: () => (currentView'), '패널이 현재 상세 id 를 노출');
  assert.ok(!concept.includes("'readgloss:close-panel'"), '닫기 이벤트가 없으므로 보내지 않는다');
  assert.ok(concept.includes("button.close')?.click()"), '패널 ✕ 버튼으로 닫는다');
});

test('상세 포커스(15-3): focusNew 때 appendNewItem 결과를 넣고 커서를 새 - 뒤에 둔다', () => {
  const panel = read('panel-concepts.js');
  assert.match(panel, /function applyDetailFocusNew[\s\S]*?appendNewItem\(ta\.value\)[\s\S]*?setSelectionRange\(caret, caret\)[\s\S]*?ta\.focus\(\{ preventScroll: true \}\)/);
});

test('상세 자동 저장(15-3): 0.8초 디바운스, 진행 중이면 다음으로 미룸, Esc·⌘Enter 처리', () => {
  const panel = read('panel-concepts.js');
  assert.ok(panel.includes('const AUTO_SAVE_DELAY = 800;'), '0.8초');
  assert.match(panel, /autoSaveTimer = setTimeout\(\(\) => \{\s*doSave\(\);\s*\}, AUTO_SAVE_DELAY\);/);
  assert.ok(panel.includes('pendingSaveAgain = true'), '진행 중이면 다음으로 미룸');
  assert.ok(panel.includes("e.key === 'Escape'"), 'Esc');
  assert.ok(panel.includes("e.key === 'Enter' && (e.metaKey || e.ctrlKey)"), '⌘Enter');
  assert.ok(panel.includes('doSave({ closePanelOnSuccess: true })'), '⌘Enter 는 저장 뒤 패널을 접는다');
  assert.ok(panel.includes("saveIndicator.textContent = '저장 중…'") && panel.includes("saveIndicator.textContent = '저장됨'"), '저장 중·저장됨 표시');
});

test('상세 자동 저장은 목록을 다시 그리지 않는다(입력 중인 칸 보호)', () => {
  const panel = read('panel-concepts.js');
  assert.ok(panel.includes("if (e.detail?.fromDetail) return;"), '자동 저장 신호는 목록 재그림을 건너뛴다');
  assert.ok(panel.includes("{ detail: { id: concept.id, fromDetail: true } }"), '상세 저장이 fromDetail 로 알린다');
});
