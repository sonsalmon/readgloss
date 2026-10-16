import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// content.js, selection.js, memo-pad.js 소스 파일 읽기
const contentSrc = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const selectionSrc = readFileSync(new URL('../extension/selection.js', import.meta.url), 'utf8');
const memoPadSrc = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

// -----------------------------------------------------------------------------
// 1. 순수 함수 테스트: content.js 의 isToastTab 및 startsMemo 판정
// -----------------------------------------------------------------------------

// content.js 는 text.js 의 globalThis.readgloss 가 먼저 필요하고, 등록 호출만 받는 가짜 document·window 를 둔다.
await import('../extension/text.js');
globalThis.document = { addEventListener() {} };
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
await import('../extension/content.js');
const toast = globalThis.readglossToast;

test('순수 판정: isToastTab 은 조합키 없는 Tab 및 편집 영역 밖에서만 참이다', () => {
  assert.equal(typeof toast?.isToastTab, 'function', 'toast.isToastTab 이 공개되어야 한다');

  // 정상 Tab
  assert.equal(toast.isToastTab({ key: 'Tab' }), true, '단독 Tab 키는 참');
  assert.equal(toast.isToastTab({ key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }), true);

  // 조합키가 있으면 거짓
  assert.equal(toast.isToastTab({ key: 'Tab', shiftKey: true }), false, 'Shift+Tab 은 거짓');
  assert.equal(toast.isToastTab({ key: 'Tab', ctrlKey: true }), false, 'Ctrl+Tab 은 거짓');
  assert.equal(toast.isToastTab({ key: 'Tab', metaKey: true }), false, '⌘Tab 은 거짓');
  assert.equal(toast.isToastTab({ key: 'Tab', altKey: true }), false, '⌥Tab 은 거짓');
  assert.equal(toast.isToastTab({ key: 'Tab', isComposing: true }), false, '한글 조합 중 Tab 은 거짓');

  // Tab 키가 아닌 경우
  assert.equal(toast.isToastTab({ key: 'Enter' }), false);
  assert.equal(toast.isToastTab({ key: 'a' }), false);
  assert.equal(toast.isToastTab({ key: 'Escape' }), false);

  // 편집 영역 내부 이벤트는 거짓
  assert.equal(toast.isToastTab({ key: 'Tab' }, [{ localName: 'input' }]), false, 'input 안 Tab 은 거짓');
  assert.equal(toast.isToastTab({ key: 'Tab' }, [{ localName: 'textarea' }]), false, 'textarea 안 Tab 은 거짓');
  assert.equal(toast.isToastTab({ key: 'Tab' }, [{ isContentEditable: true }]), false, 'contentEditable 안 Tab 은 거짓');
});

test('순수 판정: startsMemo 판정 (글자 입력 시 참, 조합키·입력칸 거짓)', () => {
  assert.equal(typeof toast?.startsMemo, 'function', 'toast.startsMemo 가 함수여야 한다');

  // 단독 글자 키는 참
  assert.equal(toast.startsMemo({ key: 'a' }), true, '영문자 입력은 참');
  assert.equal(toast.startsMemo({ key: '가' }), true, '한글 입력은 참');
  assert.equal(toast.startsMemo({ key: '1' }), true, '숫자 입력은 참');
  assert.equal(toast.startsMemo({ key: 'Process' }), true, 'IME 조합 시작은 참');

  // 스페이스 및 조합키는 거짓
  assert.equal(toast.startsMemo({ key: ' ' }), false, '스페이스는 거짓');
  assert.equal(toast.startsMemo({ key: 'a', ctrlKey: true }), false, 'Ctrl+a 는 거짓');
  assert.equal(toast.startsMemo({ key: 'a', metaKey: true }), false, '⌘a 는 거짓');
  assert.equal(toast.startsMemo({ key: 'a', altKey: true }), false, '⌥a 는 거짓');

  // 입력칸 안에서는 거짓
  assert.equal(toast.startsMemo({ key: 'a' }, [{ localName: 'input' }]), false);
  assert.equal(toast.startsMemo({ key: 'a' }, [{ localName: 'textarea' }]), false);
});

// -----------------------------------------------------------------------------
// 2. 소스 검사: selection.js
// -----------------------------------------------------------------------------

test('소스 검사: selection.js 에 globalThis.readglossSelectionUi.scrapRange 공개', () => {
  assert.match(
    selectionSrc,
    /scrapRange\s*[:(]/,
    'selection.js 에 scrapRange 함수가 정의되어 있어야 한다',
  );
  assert.match(
    selectionSrc,
    /globalThis\.readglossSelectionUi\s*=[\s\S]*?scrapRange/,
    'globalThis.readglossSelectionUi 에 scrapRange 가 공개되어야 한다',
  );
});

test('소스 검사: saveScrap 과 scrapRange 가 공통 저장 함수를 나눠 쓰고 cloneRange 로 range 를 보존한다', () => {
  // 공통 저장 전송 및 페인트 함수 확인
  assert.match(
    selectionSrc,
    /async\s+function\s+(?:submitScrap|sendScrap|executeScrap|saveScrapData)\s*\(/,
    'saveScrap 과 scrapRange 의 공통 저장 함수가 정의되어야 한다',
  );

  // saveScrap 시작 시 current.range.cloneRange() 로 range 복제
  assert.match(
    selectionSrc,
    /async\s+function\s+saveScrap\s*\(\)\s*\{[\s\S]*?cloneRange\s*\(\)/,
    'saveScrap 시작 때 cloneRange 로 범위를 보존해야 한다',
  );

  // scrapRange 에서 공통 함수 호출
  assert.match(
    selectionSrc,
    /async\s+function\s+scrapRange\s*\([^)]*\)\s*\{[\s\S]*?(?:submitScrap|sendScrap|executeScrap|saveScrapData)\s*\(/,
    'scrapRange 에서 공통 저장 함수를 호출해야 한다',
  );
});

test('소스 검사: 스크랩 확인 메시지가 onQuote 를 넘기고 onMemo scraps memo 를 안 넘김', () => {
  // onQuote 옵션을 넘기는지 확인
  assert.match(
    selectionSrc,
    /readglossToast\?\.show\s*\(\{[\s\S]*?onQuote\s*:\s*\(\)\s*=>[\s\S]*?attachQuote\s*(?:\?\.)?\s*\(/,
    'saveScrap 성공 뒤 readglossToast.show 에 onQuote: () => attachQuote(...) 를 넘겨야 한다',
  );

  // 기존 onMemo (scraps op memo)는 없어야 함
  assert.doesNotMatch(
    selectionSrc,
    /readglossToast\?\.show\s*\(\{[\s\S]*?onMemo\s*:\s*\([^)]*\)\s*=>[\s\S]*?type:\s*['"]scraps['"][\s\S]*?op:\s*['"]memo['"]/,
    '스크랩 확인 메시지에 onMemo (scraps op memo) 를 넘기지 않아야 한다',
  );
});

// -----------------------------------------------------------------------------
// 3. 소스 검사: memo-pad.js (Tab 경로 vs ⌥M 경로)
// -----------------------------------------------------------------------------

test('소스 검사: Tab 경로에서는 scrapRange 를 호출하고 인용은 바로 붙인다', () => {
  // Tab keydown 에서 scrapRange 호출로 이어지는 경로 (handleMemoOpen({ scrap: true }))
  assert.match(
    memoPadSrc,
    /['"]tab-quote['"][\s\S]*?handleMemoOpen\s*\(\s*\{[\s\S]*?scrap\s*:\s*true[\s\S]*?\}\s*\)/,
    'Tab keydown 시 handleMemoOpen({ scrap: true }) 를 호출해야 한다',
  );

  // handleMemoOpen 에서 scrap 일 때 scrapRange 호출
  assert.match(
    memoPadSrc,
    /readglossSelectionUi\?\.scrapRange\?\.[\s\S]*?showPadToastNotice\s*\(\s*['"]스크랩은 못 했어요\(인용은 붙음\)['"]/,
    'scrapRange 호출 및 실패 시 "스크랩은 못 했어요(인용은 붙음)" 알림이 있어야 한다',
  );

  // attachQuote 는 기다리지 않고 바로 불림
  assert.match(
    memoPadSrc,
    /attachQuote\s*\(\s*extracted\s*,\s*range\.startContainer\s*\)/,
    '인용은 attachQuote 로 바로 붙어야 한다',
  );
});

test('소스 검사: ⌥M (memo-open 커맨드) 경로는 scrapRange 를 부르지 않는다', () => {
  // memo-open 커맨드 리스너는 scrap 인자 없이 handleMemoOpen() 호출
  assert.match(
    memoPadSrc,
    /cmd\s*===\s*['"]memo-open['"]\s*\)\s*\{[\s\S]*?handleMemoOpen\s*\(\s*\)/,
    'memo-open 커맨드는 scrap 인자 없이 handleMemoOpen() 을 호출해야 한다',
  );
});

// -----------------------------------------------------------------------------
// 4. 소스 검사: content.js showToast 및 단어장 확인 메시지
// -----------------------------------------------------------------------------

test('소스 검사: showToast 에서 onQuote 가 있으면 글자·Tab·[메모] 가 메시지 닫고 onQuote() 호출', () => {
  // showToast 인자에 onQuote 수신
  assert.match(
    contentSrc,
    /function\s+showToast\s*\(\s*\{[\s\S]*?onQuote[\s\S]*?\}\s*=\s*\{\}\s*\)/,
    'showToast 가 onQuote 매개변수를 받아야 한다',
  );

  // [메모] 버튼 클릭 시 hideToast() 및 onQuote()
  assert.match(
    contentSrc,
    /memoBtn[\s\S]*?hideToast\s*\(\s*\)[\s\S]*?onQuote\s*\(\s*\)/,
    '[메모] 버튼 클릭 시 메시지를 닫고 onQuote() 를 호출해야 한다',
  );

  // Tab 입력 시 preventDefault 후 hideToast() 및 onQuote()
  assert.match(
    contentSrc,
    /isToastTab[\s\S]*?preventDefault\s*\(\s*\)[\s\S]*?hideToast\s*\(\s*\)[\s\S]*?onQuote\s*\(\s*\)/,
    'Tab 입력 시 preventDefault() 후 메시지를 닫고 onQuote() 를 호출해야 한다',
  );

  // 글자 입력(startsMemo) 시 preventDefault 없이 hideToast() 및 onQuote()
  assert.match(
    contentSrc,
    /startsMemo[\s\S]*?hideToast\s*\(\s*\)[\s\S]*?onQuote\s*\(\s*\)/,
    '글자 입력(startsMemo) 시 메시지를 닫고 onQuote() 를 호출해야 한다',
  );
});

test('소스 검사: 단어장 저장 확인 메시지는 onMemo (words memo) 를 그대로 유지한다', () => {
  assert.match(
    contentSrc,
    /toggleWord[\s\S]*?globalThis\.readglossToast\?\.show\s*\(\{[\s\S]*?text:\s*['"]단어장에 추가됐어요!['"][\s\S]*?onMemo:\s*\(memo\)\s*=>[\s\S]*?type:\s*['"]words['"][\s\S]*?op:\s*['"]memo['"]/,
    '단어장 저장 확인 메시지의 onMemo 는 그대로 유지되어야 한다',
  );
});
