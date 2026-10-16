import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// extension/memo-core.js 불러오기
await import('../extension/memo-core.js');

const { shortcutAction, shouldTabQuote } = globalThis.readglossMemo;

const __dirname = dirname(fileURLToPath(import.meta.url));
const memoPadSrc = readFileSync(join(__dirname, '../extension/memo-pad.js'), 'utf8');
const conceptSrc = readFileSync(join(__dirname, '../extension/concept.js'), 'utf8');

// ---- 1. shortcutAction: d·D·ㅇ·KeyD -> concept ----
test('shortcutAction: d, D, ㅇ, KeyD 키 입력 시 concept을 반환한다', () => {
  const ctx = { hasSelection: true, pageField: false, inOurUi: false };

  assert.equal(shortcutAction({ key: 'd' }, ctx), 'concept');
  assert.equal(shortcutAction({ key: 'D' }, ctx), 'concept');
  assert.equal(shortcutAction({ key: 'ㅇ' }, ctx), 'concept');
  assert.equal(shortcutAction({ key: 'Unidentified', code: 'KeyD' }, ctx), 'concept');
  assert.equal(shortcutAction({ code: 'KeyD' }, ctx), 'concept');

  // 단일 인자(객체 하나로 넘김) 형태도 지원
  assert.equal(shortcutAction({ key: 'd', hasSelection: true }), 'concept');
  assert.equal(shortcutAction({ key: 'ㅇ', hasSelection: true }), 'concept');
});

// ---- 2. shortcutAction: c·C·ㅊ·KeyC -> code ----
test('shortcutAction: c, C, ㅊ, KeyC 키 입력 시 code를 반환한다', () => {
  const ctx = { hasSelection: true, pageField: false, inOurUi: false };

  assert.equal(shortcutAction({ key: 'c' }, ctx), 'code');
  assert.equal(shortcutAction({ key: 'C' }, ctx), 'code');
  assert.equal(shortcutAction({ key: 'ㅊ' }, ctx), 'code');
  assert.equal(shortcutAction({ key: 'Unidentified', code: 'KeyC' }, ctx), 'code');
  assert.equal(shortcutAction({ code: 'KeyC' }, ctx), 'code');

  // 단일 인자 형태 지원
  assert.equal(shortcutAction({ key: 'c', hasSelection: true }), 'code');
  assert.equal(shortcutAction({ key: 'ㅊ', hasSelection: true }), 'code');
});

// ---- 3. shortcutAction: Tab -> tab-quote ----
test('shortcutAction: Tab 키 입력 시 tab-quote를 반환한다', () => {
  const ctx = { hasSelection: true, pageField: false, inOurUi: false };

  assert.equal(shortcutAction({ key: 'Tab' }, ctx), 'tab-quote');
  assert.equal(shortcutAction({ key: 'Tab', hasSelection: true }), 'tab-quote');
});

// ---- 4. shortcutAction: 조건 불만족 시 null ----
test('shortcutAction: 고른 글 없음·입력칸·우리 화면 안·조합키·조합 중이면 null을 반환한다', () => {
  const validKey = { key: 'd' };

  // 고른 글 없음
  assert.equal(shortcutAction(validKey, { hasSelection: false, pageField: false, inOurUi: false }), null);
  assert.equal(shortcutAction({ key: 'Tab' }, { hasSelection: false }), null);

  // 페이지 입력칸
  assert.equal(shortcutAction(validKey, { hasSelection: true, pageField: true }), null);
  assert.equal(shortcutAction({ key: 'Tab' }, { hasSelection: true, pageField: true }), null);

  // 우리 화면 안
  assert.equal(shortcutAction(validKey, { hasSelection: true, inOurUi: true }), null);
  assert.equal(shortcutAction({ key: 'Tab' }, { hasSelection: true, inOurUi: true }), null);

  // 조합키 (shift, alt, ctrl, meta)
  assert.equal(shortcutAction({ key: 'd', shiftKey: true }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'd', altKey: true }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'd', ctrlKey: true }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'd', metaKey: true }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'Tab', shiftKey: true }, { hasSelection: true }), null);

  // 한글 조합 중
  assert.equal(shortcutAction({ key: 'd', isComposing: true }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'ㅇ', isComposing: true }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'd' }, { hasSelection: true, isComposing: true }), null);
  assert.equal(shortcutAction({ key: 'd' }, { hasSelection: true, composing: true }), null);

  // 무관한 키
  assert.equal(shortcutAction({ key: 'x' }, { hasSelection: true }), null);
  assert.equal(shortcutAction({ key: 'Enter' }, { hasSelection: true }), null);
});

// ---- 5. shouldTabQuote 호환성 ----
test('shouldTabQuote: shortcutAction과 합쳐져 기존 Tab 판정과 호환된다', () => {
  assert.equal(shouldTabQuote({
    key: 'Tab', shift: false, alt: false, ctrl: false, meta: false, composing: false,
    hasSelection: true, pageField: false, inOurUi: false,
  }), true);

  assert.equal(shouldTabQuote({
    key: 'd', shift: false, alt: false, ctrl: false, meta: false, composing: false,
    hasSelection: true, pageField: false, inOurUi: false,
  }), false);

  assert.equal(shouldTabQuote({
    key: 'Tab', shift: true, alt: false, ctrl: false, meta: false, composing: false,
    hasSelection: true, pageField: false, inOurUi: false,
  }), false);

  assert.equal(shouldTabQuote({
    key: 'Tab', shift: false, alt: false, ctrl: false, meta: false, composing: false,
    hasSelection: false, pageField: false, inOurUi: false,
  }), false);
});

// ---- 6. 소스 검사: memo-pad.js ----
test('소스 검사: memo-pad.js에 openForm 호출, 카드 닫기, concepts-updated 리스너가 있다', () => {
  // 1. openForm 호출
  assert.ok(
    memoPadSrc.includes('readglossConceptPage.openForm') ||
    memoPadSrc.includes('readglossConceptPage?.openForm'),
    'readglossConceptPage.openForm 호출이 있어야 한다',
  );

  // 2. 드래그 카드 닫기
  assert.ok(
    memoPadSrc.includes('readglossSelectionUi?.close?.()') ||
    memoPadSrc.includes('readglossSelectionUi.close()'),
    'readglossSelectionUi 닫기가 있어야 한다',
  );

  // 3. 사전 카드 닫기
  assert.ok(
    memoPadSrc.includes('readglossDictCardUi?.close?.()') ||
    memoPadSrc.includes('readglossDictCardUi.close()'),
    'readglossDictCardUi 닫기가 있어야 한다',
  );

  // 4. concepts-updated 이벤트 리스너
  assert.ok(
    memoPadSrc.includes("'readgloss:concepts-updated'") ||
    memoPadSrc.includes('"readgloss:concepts-updated"'),
    'readgloss:concepts-updated 이벤트 리스너가 있어야 한다',
  );
});

// ---- 7. 소스 검사: concept.js ----
test('소스 검사: concept.js openForm에 처음 커서 이름 칸과 칸 Tab 순서가 구현되어 있다', () => {
  // 1. 처음 커서: 이름 칸(글 끝)
  assert.ok(
    conceptSrc.includes('nameIn.focus()') &&
    (conceptSrc.includes('setSelectionRange') || conceptSrc.includes('nameIn.value.length')),
    '처음 커서는 이름 칸(글 끝)이어야 한다',
  );

  // 2. 이름 칸에서 Tab -> 다른 이름 칸
  assert.ok(
    conceptSrc.includes('aliasIn.focus()'),
    '이름 칸에서 Tab을 누르면 다른 이름 칸(aliasIn)으로 포커스가 이동해야 한다',
  );

  // 3. 정의 칸에서 Shift+Tab 시 맨 바깥 줄일 때 다른 이름 칸으로
  assert.ok(
    conceptSrc.includes('aliasIn.focus') &&
    conceptSrc.includes("e.key === 'Tab'") &&
    conceptSrc.includes('shiftKey'),
    '정의 칸에서 Shift+Tab 처리 및 다른 이름 칸 포커스 이동 로직이 있어야 한다',
  );
});
