import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const selectionPath = join(__dirname, '../extension/selection.js');
const contentPath = join(__dirname, '../extension/content.js');
const memoPadPath = join(__dirname, '../extension/memo-pad.js');

const selectionSrc = readFileSync(selectionPath, 'utf8');
const contentSrc = readFileSync(contentPath, 'utf8');
const memoPadSrc = readFileSync(memoPadPath, 'utf8');

test('1. selection.js: readglossSelectionUi에 close 내보내기 존재', () => {
  // readglossSelectionUi 객체 안에 close 가 포함되어 있는지 검사
  const uiExportRe = /globalThis\.readglossSelectionUi\s*=\s*\{[\s\S]*?close[\s\S]*?\};/;
  assert.ok(uiExportRe.test(selectionSrc), 'globalThis.readglossSelectionUi에 close가 포함되어야 합니다.');
});

test('2. content.js: readglossDictCardUi 존재 및 close 포함', () => {
  // readglossDictCardUi = { close } 형태로 내보내지는지 검사
  const cardUiRe = /globalThis\.readglossDictCardUi\s*=\s*\{[\s\S]*?close[\s\S]*?\};/;
  assert.ok(cardUiRe.test(contentSrc), 'globalThis.readglossDictCardUi = { close } 가 존재해야 합니다.');
});

test('3. memo-pad.js: memo-open 처리에 선택 검사와 두 카드 close 호출', () => {
  // memo-open 명령 수신 및 처리
  assert.ok(memoPadSrc.includes("'memo-open'"), "memo-pad.js에 'memo-open' 처리가 있어야 합니다.");

  // window.getSelection() 선택 검사
  assert.ok(memoPadSrc.includes('getSelection()'), 'memo-pad.js에 getSelection() 선택 검사가 있어야 합니다.');

  // 두 카드의 close() 호출 검사
  assert.ok(
    /globalThis\.readglossSelectionUi\??\.close\??\.?\(/.test(memoPadSrc),
    'memo-pad.js에서 readglossSelectionUi의 close()를 호출해야 합니다.'
  );
  assert.ok(
    /globalThis\.readglossDictCardUi\??\.close\??\.?\(/.test(memoPadSrc),
    'memo-pad.js에서 readglossDictCardUi의 close()를 호출해야 합니다.'
  );

  // quoteForRange 호출 검사 (?.( 와 .( 둘 다 같은 호출)
  assert.ok(
    /globalThis\.readglossScrapPage\??\.quoteForRange\??\.?\(/.test(memoPadSrc),
    'memo-pad.js에서 quoteForRange를 호출해야 합니다.'
  );
});

test('4. memo-pad.js: save 요청에 quote 포함', () => {
  // performSave 에서 memos save 요청을 보낼 때 quote 가 포함되어 있는지 검사
  const saveCallRe = /chrome\.runtime\.sendMessage\s*\(\s*\{[\s\S]*?op:\s*['"]save['"][\s\S]*?quote[\s\S]*?\}\s*,\s*resolve\s*\)/;
  assert.ok(saveCallRe.test(memoPadSrc), 'memos save 요청에 quote 가 포함되어 있어야 합니다.');
});

test('5. memo-pad.js: savedSelection 사용 없음 (완전히 제거됨)', () => {
  assert.equal(memoPadSrc.includes('savedSelection'), false, 'memo-pad.js에 savedSelection이 남아있지 않아야 합니다.');
});

test('6. memo-pad.js: 인용 줄 스타일 및 펼침/접힘/제거 지원', () => {
  // 인용 줄 색상 (#FAEEDA, #633806, 다크 모드 #412402, #FAC775)
  assert.ok(memoPadSrc.includes('#FAEEDA'), '인용 배경색 #FAEEDA 가 포함되어야 합니다.');
  assert.ok(memoPadSrc.includes('#633806'), '인용 글자색 #633806 이 포함되어야 합니다.');
  assert.ok(memoPadSrc.includes('#412402'), '다크모드 인용 배경색 #412402 가 포함되어야 합니다.');
  assert.ok(memoPadSrc.includes('#FAC775'), '다크모드 인용 글자색 #FAC775 가 포함되어야 합니다.');

  // -webkit-line-clamp: 2
  assert.ok(memoPadSrc.includes('-webkit-line-clamp: 2'), '두 줄 말줄임(-webkit-line-clamp: 2)이 포함되어야 합니다.');

  // 인용 UI 요소 생성 (.sec-quote 및 삭제 버튼 ✕)
  assert.ok(memoPadSrc.includes('sec-quote'), 'sec-quote 클래스가 생성되어야 합니다.');
  assert.ok(memoPadSrc.includes('✕'), '인용 삭제 ✕ 버튼이 있어야 합니다.');
});

test('7. memo-pad.js: 저장된 메모의 인용 줄 표시 및 jumpToMemo', () => {
  // 저장된 메모 줄에 인용이 있으면 인용 줄을 표시하고 jumpToMemo 호출
  assert.ok(memoPadSrc.includes('sec-memo-quote-line'), '저장된 메모 줄에 인용 라인 클래스가 있어야 합니다.');
  assert.ok(
    /jumpToMemo\(m\)/.test(memoPadSrc),
    '저장된 메모의 인용 클릭 시 jumpToMemo가 호출되어야 합니다.'
  );
});

test('8. memo-pad.js: quotes 탭 상태 저장 및 복원', () => {
  // saveDrafts 에 quotes 포함
  const saveDraftsRe = /function saveDrafts\(\)\s*\{[\s\S]*?quotes[\s\S]*?\}/;
  assert.ok(saveDraftsRe.test(memoPadSrc), 'saveDrafts 에 quotes 가 포함되어야 합니다.');

  // restoreStateOnLoad 에 quotes 복원
  const restoreRe = /function restoreStateOnLoad\(\)\s*\{[\s\S]*?res\.quotes[\s\S]*?\}/;
  assert.ok(restoreRe.test(memoPadSrc), 'restoreStateOnLoad 에 quotes 복원이 있어야 합니다.');
});
