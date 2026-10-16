import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// T17b 접착(배선) 시험: 계약 6~10 이 실제 파일에서 어떻게 이어지는지 확인한다.
// 순수 로직(표현 목록·주 번역 고르기·낱말 뽑기)은 expressions.test.mjs·panel-words.test.mjs 가 본다.
await import('../extension/text.js');
await import('../extension/selection-core.js');
const S = globalThis.readglossSelection;

const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('계약 6 접착: 드래그 카드가 문맥·넓은 문맥 결과의 expressions 를 그리고 note 숨김 규칙·★ 토글을 쓴다', () => {
  const src = read('selection.js');
  assert.match(src, /createExpressions\(r\.expressions, \{ sentence: current\.text, onChange: place \}\)/);
  assert.match(src, /if \(list\.el\) sec\.exps\.append\(list\.el\)/);
  assert.match(src, /sec\.note\.textContent = core\.noteText\(r\.note, list\.rows\)/, 'note 는 표현이 없을 때만');
  assert.match(src, /it\.row\.id = saved \? null : \(r\.id \?\? core\.findPhrase\(r\.phrases, it\.row\.en\)\)/, '☆↔★ 토글');
  assert.match(src, /globalThis\.readglossExpressions = \{ CSS: EXPR_CSS, create: createExpressions \}/);
  assert.match(src, /e\.stopPropagation\(\)/);
});

test('계약 7 접착: 문단 번역 블록이 번역문 안(data-readgloss=translation)에 표현을 넣고 1000자 문장을 싣는다', () => {
  const src = read('paragraph.js');
  assert.match(src, /const MAX_SENTENCE = 1000/);
  assert.match(src, /const list = E\?\.create\(expressions, \{ sentence, inline: true \}\)/);
  assert.match(src, /eh\.setAttribute\('data-readgloss', 'translation'\)/);
  assert.match(src, /eh\.attachShadow\(\{ mode: 'closed' \}\)\.append\(style, list\.el\)/);
  assert.match(src, /insert\(block, r\.translation, r\.expressions, text\.slice\(0, MAX_SENTENCE\)\)/);
  assert.match(src, /e\.composedPath\(\)\.some\(\(n\) => n\.localName === 'readgloss-expressions'\)/, '문단 클릭 처리로 번지지 않는다');
});

test('계약 8 접착: 구·문장 탭이 종류 필터를 rows 에 넘기고 표현 배지·출처 문장(두 줄)을 그린다', () => {
  const src = read('panel-words.js');
  assert.match(src, /W\.phraseRows\(state\.phrases, query, phraseKind\)/);
  assert.match(src, /el\('span', 'badge', '표현'\)/);
  assert.match(src, /lookable\(el\('div', 'psent', p\.sentence\)/);
  assert.match(src, /\.psent \{[^}]*-webkit-line-clamp: 2/);
  assert.match(src, /String\(f\.id === phraseKind\)/);
  assert.match(src, /kinds\.hidden = isReview \|\| list !== 'phrases'/, 'T44c: 복습 보기에서도 종류 칩을 숨긴다');
});

test('계약 9 접착: 패널 저장 문장 더블클릭이 shadow 선택으로 낱말을 뽑아 readgloss:lookup 을 보낸다', () => {
  const src = read('panel-words.js');
  assert.match(src, /root\.getRootNode\(\)\.getSelection\?\.\(\) \?\? getSelection\(\)/);
  assert.match(src, /W\.pickWord\(sel\?\.toString\(\)\)/);
  assert.match(src, /const src = sources\.get\(e\.target\?\.closest\?\.\('\.lk'\)\)/);
  assert.match(src, /new CustomEvent\('readgloss:lookup', \{ detail: W\.lookupDetail\(/);
  assert.match(src, /lookable\(el\('div', 'sent', r\.sentence\)/, '단어장 탭 예문');
  assert.match(src, /lookable\(el\('div', 'ptext', p\.preview\)/, '구·문장 탭 원문');
  assert.match(src, /lookable\(el\('div', 'psent', p\.sentence\)/, '표현의 출처 문장');
});

test('계약 9 접착: 사전 카드가 저장 문맥·출처를 쓰고, 패널 위에 뜨며, 카드 클릭으로 패널이 닫히지 않는다', () => {
  const content = read('content.js');
  assert.match(content, /current\.context \?\? \(current\.range && globalThis\.readglossContextFor\?\.\(current\.range, wide\)\)/, '[AI 문맥 뜻]에 저장 문장을 쓴다');
  assert.match(content, /const sourceUrl = \(\) => current\.source\?\.url \?\? location\.href\.slice\(0, 2000\)/, '[☆ 단어장] 저장 출처');
  assert.match(content, /globalThis\.readglossSelection\.lookupExtras\(d\)/);
  assert.match(content, /document\.documentElement\.append\(host\)/, '카드 호스트를 문서 끝(패널 뒤)에 붙인다');
  const panel = read('panel.js');
  assert.match(panel, /const isCardPath = \(path\) => Array\.isArray\(path\) && path\.some\(\(n\) => n\?\.localName === 'readgloss-card'( \|\| n\?\.localName === 'readgloss-struct-card')?\)/); // T42: 문장 구조 카드도
  assert.match(panel, /!path\.includes\(host\) && !C\.isCardPath\(path\)/);
  assert.match(panel, /!e\.readglossCardClosed/);
});

// panel-words.js 의 preventDefault: 메모 입력칸 Enter 1곳 + T44c 복습 단축키(Space·1·2) 3곳.
// 복습 단축키는 패널 shadow 안, [복습] 보기, 입력칸 밖, 수정키 없음일 때만 동작해야 한다(페이지 키를 막지 않는다).
function assertPanelPreventDefaults(pw) {
  assert.equal((pw.match(/\.preventDefault\(/g) ?? []).length, 4, 'panel-words.js 의 preventDefault 는 메모 입력칸 Enter 1 + 복습 단축키 3');
  const i = pw.indexOf("root.addEventListener('keydown'");
  const block = pw.slice(i, pw.indexOf('const chipBtns', i));
  assert.equal((block.match(/\.preventDefault\(/g) ?? []).length, 3, '복습 단축키 블록에 preventDefault 3곳(Space·1·2)');
  assert.match(block, /if \(list !== 'review'\) return/);
  assert.match(block, /if \(isInput \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return/);
}

test('계약 10: 바뀐 확장 코드는 textContent 만 쓰고, preventDefault 는 우리 버튼·메모 입력칸에서만, chrome.storage 는 들이지 않는다', () => {
  for (const f of ['selection.js', 'paragraph.js', 'panel-words.js', 'content.js', 'selection-core.js', 'background.js']) {
    assert.doesNotMatch(read(f), /\.innerHTML\s*=/, `${f}: innerHTML 금지`);
  }
  for (const f of ['paragraph.js', 'selection-core.js']) {
    assert.doesNotMatch(read(f), /\.preventDefault\(/, `${f}: 페이지 기본 동작을 막지 않는다`);
  }
  // 정밀 예외(T19): panel-words.js 의 메모 입력칸 Enter 저장에서만(줄바꿈은 Shift+Enter). 페이지 클릭·링크는 막지 않는다.
  const pw = read('panel-words.js');
  assertPanelPreventDefaults(pw);
  // 정밀 예외(T18): selection.js 의 표현 [☆]/[★] 버튼 click 한 곳에서만 링크 이동을 막는다. 페이지의 다른 요소·링크 클릭은 막지 않는다.
  const sel = read('selection.js');
  assert.equal((sel.match(/\.preventDefault\(/g) ?? []).length, 1, 'preventDefault 는 표현 버튼 click 한 곳뿐');
  // 정밀 예외(T20): content.js 의 확인 메시지 메모 입력칸에서만 Enter 저장·Esc 취소의 기본 동작을 막는다(우리 textarea 안).
  const content = read('content.js');
  assert.equal((content.match(/\.preventDefault\(/g) ?? []).length, 2, 'preventDefault 는 메모 입력칸(Enter 저장·Esc 취소)뿐');
  assert.match(content, /globalThis\.readglossWords\.memoKey\(e\)/, '메모 입력칸 판정은 순수 함수 memoKey 가 한다');
  for (const f of ['selection.js', 'paragraph.js', 'panel-words.js', 'content.js', 'selection-core.js']) {
    assert.doesNotMatch(read(f), /chrome\.storage/, `${f}: storage 를 새로 쓰지 않는다`);
  }
});

test('계약 10·배선: background.js 가 번역 expressions 와 words kind 를 다리로 전달한다', () => {
  const bg = read('background.js');
  assert.match(bg, /expressions: data\.expressions/);
  assert.match(bg, /const \{[^}]*\bkind\b[^}]*\} = msg/);
  assert.match(bg, /JSON\.stringify\(\{ op,[^}]*\bkind\b/);
  assert.match(bg, /'translate-context': \([^)]*\) => relay\('\/translate-context'/, '문맥 번역은 relay 가 응답을 그대로 돌려준다');
});

test('표현 경계: en·ko 60자는 통과, 61자·영문 없음은 버린다', () => {
  const rows = S.expressionRows([
    { en: 'a'.repeat(60), ko: '가' },
    { en: 'ok', ko: '나'.repeat(60) },
    { en: 'ok', ko: '다'.repeat(61) },
    { en: '1234', ko: '라' },
  ]);
  assert.deepEqual(rows.map((r) => [r.en.length, r.ko.length]), [[60, 1], [2, 60]]);
});
