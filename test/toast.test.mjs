import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/panel-words.js';

// 확인 메시지(T20) [메모] 의 순수 판단. panel-words.js 는 순수 로직을 globalThis.readglossWords 로 올린다.
const W = globalThis.readglossWords;

test('memoKey: Enter=저장, Shift+Enter=줄바꿈, 한글 조합 중 Enter=무시, 그 밖=null', () => {
  assert.equal(W.memoKey({ key: 'Enter' }), 'save');
  assert.equal(W.memoKey({ key: 'Enter', shiftKey: true }), 'newline');
  assert.equal(W.memoKey({ key: 'Enter', isComposing: true }), null, '한글 조합 중 Enter 는 저장하지 않는다');
  assert.equal(W.memoKey({ key: 'Enter', shiftKey: true, isComposing: true }), null);
  assert.equal(W.memoKey({ key: 'a' }), null);
  assert.equal(W.memoKey({ key: 'Escape' }), null, 'Esc 는 keydown 쪽에서 따로 취소 처리');
  assert.equal(W.memoKey({}), null);
  assert.equal(W.memoKey(), null);
});

test('memoOk: error 칸이 없는 객체만 성공(404 not-found 도 실패)', () => {
  assert.equal(W.memoOk({ saved: {}, known: {}, history: [], phrases: {} }), true, '단어 메모 성공 = 전체 상태');
  assert.equal(W.memoOk({ id: 'p1', phrases: {} }), true, '구 메모 성공 = {id, phrases}');
  assert.equal(W.memoOk({ error: 'not-found' }), false);
  assert.equal(W.memoOk({ error: 'bridge-off' }), false);
  assert.equal(W.memoOk(null), false);
  assert.equal(W.memoOk(undefined), false);
  assert.equal(W.memoOk(''), false);
  assert.equal(W.memoOk('ok'), false);
  assert.equal(W.memoOk(0), false);
});

test('memoErrorText: not-found 는 따로 알리고 나머지는 같은 문구', () => {
  assert.equal(W.memoErrorText({ error: 'not-found' }), '단어장에서 찾지 못했어요');
  assert.equal(W.memoErrorText({ error: 'bridge-off' }), '메모를 저장하지 못했어요');
  assert.equal(W.memoErrorText({ error: 'ext-reloaded' }), '메모를 저장하지 못했어요');
  assert.equal(W.memoErrorText(null), '메모를 저장하지 못했어요');
});
