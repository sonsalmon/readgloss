import test from 'node:test';
import assert from 'node:assert/strict';

// memo-core.js는 classic script이므로 import 후 전역에서 꺼낸다.
await import('../extension/memo-core.js');

const { shortcutAction, markPrefixOf, extractTags } = globalThis.readglossMemo;

const validCtx = { hasSelection: true, pageField: false, inOurUi: false };

// ---- 1. shortcutAction: ?·!는 Shift를 허용한다 (29-3) ----
test('shortcutAction: ?·!는 Shift를 눌러도 표시 인용 액션을 돌려준다', () => {
  assert.equal(shortcutAction({ key: '?', shiftKey: true }, validCtx), 'question-quote');
  assert.equal(shortcutAction({ key: '!', shiftKey: true }, validCtx), 'insight-quote');

  // Shift를 안 눌러도 같은 글자면 같은 액션
  assert.equal(shortcutAction({ key: '?' }, validCtx), 'question-quote');
  assert.equal(shortcutAction({ key: '!' }, validCtx), 'insight-quote');
});

test('shortcutAction: ?·!라도 Alt·Ctrl·Meta·조합 중이면 null', () => {
  assert.equal(shortcutAction({ key: '?', shiftKey: true, altKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: '!', shiftKey: true, altKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: '?', shiftKey: true, ctrlKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: '!', shiftKey: true, metaKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: '?', shiftKey: true, isComposing: true }, validCtx), null);
});

test('shortcutAction: ?·!라도 고른 글 없음·입력칸·우리 화면 안이면 null', () => {
  assert.equal(shortcutAction({ key: '?', shiftKey: true }, { ...validCtx, hasSelection: false }), null);
  assert.equal(shortcutAction({ key: '!', shiftKey: true }, { ...validCtx, pageField: true }), null);
  assert.equal(shortcutAction({ key: '?', shiftKey: true }, { ...validCtx, inOurUi: true }), null);
});

test('shortcutAction: 다른 키의 Shift 무시는 그대로다', () => {
  assert.equal(shortcutAction({ key: 'a', shiftKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: 'Tab', shiftKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: 'd', shiftKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: 'c', shiftKey: true }, validCtx), null);

  // Shift 없는 기존 단축키는 그대로
  assert.equal(shortcutAction({ key: 'Tab' }, validCtx), 'tab-quote');
  assert.equal(shortcutAction({ key: 'd' }, validCtx), 'concept');
  assert.equal(shortcutAction({ key: 'c' }, validCtx), 'code');
});

// ---- 2. markPrefixOf: 정확히 '? '·'! '일 때만 모드 ----
test('markPrefixOf: ? 다음 스페이스면 question, ! 다음 스페이스면 insight', () => {
  assert.equal(markPrefixOf('? '), 'question');
  assert.equal(markPrefixOf('! '), 'insight');
});

test('markPrefixOf: 붙여 쓰는 ?이름·!이름과 그 밖은 null', () => {
  assert.equal(markPrefixOf('?이름'), null);
  assert.equal(markPrefixOf('!이름'), null);
  assert.equal(markPrefixOf('?'), null);
  assert.equal(markPrefixOf('!'), null);
  assert.equal(markPrefixOf(' ? '), null);
  assert.equal(markPrefixOf('?  '), null);
  assert.equal(markPrefixOf(''), null);
  assert.equal(markPrefixOf(null), null);
});

// ---- 3. extractTags: #태그 뽑기 (29-4) ----
test('extractTags: 공백으로 구분한 여러 태그를 앞에서부터 뽑는다', () => {
  assert.deepEqual(extractTags('여러 #태그 #공부 #T60b'), ['태그', '공부', 'T60b']);
  assert.deepEqual(extractTags('줄 처음 #처음 그리고 #둘째'), ['처음', '둘째']);
  assert.deepEqual(extractTags('#맨앞'), ['맨앞']);
});

test('extractTags: 겹치는 태그는 하나만, 앞에서부터 5개까지', () => {
  assert.deepEqual(extractTags('#a #a #b'), ['a', 'b']);
  assert.deepEqual(extractTags('#1 #2 #3 #4 #5 #6'), ['1', '2', '3', '4', '5']);
});

test('extractTags: 1~20자만 태그, 21자 이상은 태그가 아니다', () => {
  const twenty = 'a'.repeat(20);
  const twentyOne = 'a'.repeat(21);
  assert.deepEqual(extractTags(`#${twenty}`), [twenty]);
  assert.deepEqual(extractTags(`#${twentyOne}`), []);
});

test('extractTags: 앞이 줄 처음이나 공백이 아니면 태그가 아니다', () => {
  assert.deepEqual(extractTags('a#b'), []);
  assert.deepEqual(extractTags('붙여쓴#태그'), []);
  assert.deepEqual(extractTags('#'), []);
  assert.deepEqual(extractTags('##'), []);
  assert.deepEqual(extractTags(''), []);
});
