import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// T18 수정 배선 시험: (1) 링크 안 표현 [☆]/[★] 버튼이 링크로 이동하던 문제, (2) 카드 저장 뒤 패널 숫자·목록이 안 바뀌던 문제,
// (3) 카드 [내 사전에 추가] 출처가 지금 페이지로 남던 문제. 순수 로직(단어 이벤트 detail)은 여기서, DOM 접착은 t17b-wiring.test.mjs 처럼 소스 정규식으로 고정한다.
await import('../extension/text.js');
await import('../extension/panel-words.js');
const W = globalThis.readglossWords;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('T18-1: 표현 [☆]/[★] 버튼이 자기 click 에서 링크 기본 동작(이동)을 막는다', () => {
  const src = read('selection.js');
  assert.match(src, /e\.stopPropagation\(\);[^}]*e\.preventDefault\(\);[^}]*toggle\(it\);/s, '별 버튼 click 이 preventDefault 로 링크 이동을 막는다');
  // 페이지의 다른 요소·링크 클릭은 여전히 막지 않는다: selection.js 의 preventDefault 는 이 한 곳뿐이다.
  assert.equal((src.match(/\.preventDefault\(/g) ?? []).length, 1, 'preventDefault 는 표현 버튼 click 한 곳에서만');
  // 문단 번역 블록의 표현 [☆] 도 같은 createExpressions 목록이라 함께 고쳐진다(paragraph.js 는 preventDefault 를 들이지 않는다).
  assert.match(read('paragraph.js'), /E\?\.create\(expressions, \{ sentence, inline: true \}\)/, '문단 블록의 표현도 공용 목록');
  assert.doesNotMatch(read('paragraph.js'), /\.preventDefault\(/, '문단 버튼은 페이지 기본 동작을 막지 않는다');
});

test('T18-2 로직: wordEventDetail 은 알아요·취소는 기존 계약, 저장·빼기는 saved·unsaved 키를 더한다', () => {
  assert.deepEqual(W.wordEventDetail('known', 'delve'), { known: ['delve'], unknown: [] });
  assert.deepEqual(W.wordEventDetail('unknown', 'delve'), { known: [], unknown: ['delve'] });
  assert.deepEqual(W.wordEventDetail('save', 'delve'), { known: [], unknown: [], saved: ['delve'] });
  assert.deepEqual(W.wordEventDetail('unsave', 'delve'), { known: [], unknown: [], unsaved: ['delve'] });
  assert.equal(W.wordEventDetail('history', 'delve'), null);
  // annotate.js 가 보는 기존 계약(eventDetail: known·unknown 만)은 그대로다.
  assert.deepEqual(W.eventDetail('known', 'delve'), { known: ['delve'], unknown: [] });
  assert.equal(W.eventDetail('save', 'delve'), null);
});

test('T18-2 접착: 카드 toggleWord 가 저장·알아요 성공 뒤 readgloss:words 를 보낸다', () => {
  const src = read('content.js');
  assert.match(src, /const detail = W\.wordEventDetail\(op, current\.lemma\)/, '단어장 저장도 이벤트 detail 을 만든다');
  assert.match(src, /window\.dispatchEvent\(new CustomEvent\('readgloss:words', \{ detail \}\)\)/);
  // annotate.js 의 기존 readgloss:words 처리는 known·unknown 만 보므로 saved·unsaved 키가 섞여도 깨지지 않는다.
  assert.match(read('annotate-core.js'), /list\(detail\?\.known\)/, 'annotate 는 known·unknown 만 읽는다');
  assert.match(read('annotate-core.js'), /list\(detail\?\.unknown\)/);
});

test('T18-2 접착: 패널 내 단어 탭이 readgloss:words·readgloss:mydict 를 듣고 GET words 로 다시 읽는다', () => {
  const src = read('panel-words.js');
  assert.match(src, /window\.addEventListener\('readgloss:words', onWords\)/);
  assert.match(src, /window\.addEventListener\('readgloss:mydict', onMine\)/);
  assert.match(src, /if \(!root\.isConnected\) return window\.removeEventListener\('readgloss:words', onWords\)/, '패널이 새로 그려지면 스스로 거둔다');
  assert.match(src, /async function loadWords\(\)/);
  assert.match(src, /ctx\.send\(\{ type: 'words', op: 'get' \}\)/, 'GET words 로 숫자·목록을 다시 불러온다');
  assert.match(src, /draft/, '고치는 중인 draft 를 살린다');
});

test('T18-3: createMydict 가 source() 로 출처를 받고, 카드가 sourceUrl()·저장 출처 제목을 넘긴다', () => {
  const sel = read('selection.js');
  assert.match(sel, /source = \(\) => \(\{ url: location\.href, title: document\.title \}\)/, '드래그 카드처럼 source 가 없으면 지금 페이지');
  assert.match(sel, /const src = source\(\);/);
  assert.match(sel, /url: src\.url, title: src\.title/, '내 사전 저장에 그 출처를 싣는다');
  const content = read('content.js');
  assert.match(content, /source: \(\) => \(\{ url: sourceUrl\(\)/, '카드가 sourceUrl() 을 넘긴다');
  assert.match(content, /current\.source\?\.title/, 'lookup detail.source 의 제목을 쓴다');
});
