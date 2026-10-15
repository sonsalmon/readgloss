// test/t37b-paste-quote.test.mjs
// 과제 T37b: 메모장 붙여넣기 → 본문 인용 / 튜터 인용(17-3 확장 쪽) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const memoCorePath = join(__dirname, '../extension/memo-core.js');
const memoPadPath = join(__dirname, '../extension/memo-pad.js');
const backgroundPath = join(__dirname, '../extension/background.js');

// globalThis에 memo-core 로드
const memoCoreCode = readFileSync(memoCorePath, 'utf8');
const runMemoCore = new Function('globalThis', memoCoreCode);
runMemoCore(globalThis);
const memoCore = globalThis.readglossMemo;

// ==========================================
// 1. classifyPaste 순수 함수 시험
// ==========================================

test('classifyPaste: 공백 정리 뒤 15자 미만이면 항상 text', () => {
  assert.equal(typeof memoCore.classifyPaste, 'function', 'classifyPaste 함수가 존재해야 함');

  // 14자 이하: inPage나 tutorFound가 true여도 'text'
  assert.equal(memoCore.classifyPaste({ text: '12345678901234', inPage: true, tutorFound: true }), 'text');
  assert.equal(memoCore.classifyPaste({ text: 'short text', inPage: true, tutorFound: false }), 'text');
  assert.equal(memoCore.classifyPaste({ text: 'short tutor', inPage: false, tutorFound: true }), 'text');
  assert.equal(memoCore.classifyPaste({ text: 'just text', inPage: false, tutorFound: false }), 'text');

  // 공백 포함 시 공백 정리 후 15자 미만
  assert.equal(memoCore.classifyPaste({ text: '   123   456   ', inPage: true, tutorFound: true }), 'text');
  assert.equal(memoCore.classifyPaste({ text: '  \n  tab \t space \n ', inPage: true, tutorFound: true }), 'text');
});

test('classifyPaste: 15자 경계값 (14자 vs 15자) 검사', () => {
  const text14 = 'a'.repeat(14);
  const text15 = 'a'.repeat(15);

  // 14자: inPage가 true여도 text
  assert.equal(memoCore.classifyPaste({ text: text14, inPage: true, tutorFound: false }), 'text');
  assert.equal(memoCore.classifyPaste({ text: text14, inPage: false, tutorFound: true }), 'text');

  // 15자: inPage true면 page, tutorFound true면 tutor, 둘 다 아니면 text
  assert.equal(memoCore.classifyPaste({ text: text15, inPage: true, tutorFound: false }), 'page');
  assert.equal(memoCore.classifyPaste({ text: text15, inPage: false, tutorFound: true }), 'tutor');
  assert.equal(memoCore.classifyPaste({ text: text15, inPage: false, tutorFound: false }), 'text');
});

test('classifyPaste: 15자 이상 경우별 판정 (본문 우선)', () => {
  const longText = 'This is a long sentence for quote test.';
  assert.ok(longText.length >= 15);

  // 본문에 있으면 page (tutorFound 여부와 무관하게 본문 우선)
  assert.equal(memoCore.classifyPaste({ text: longText, inPage: true, tutorFound: false }), 'page');
  assert.equal(memoCore.classifyPaste({ text: longText, inPage: true, tutorFound: true }), 'page');

  // 본문에 없고 튜터에 있으면 tutor
  assert.equal(memoCore.classifyPaste({ text: longText, inPage: false, tutorFound: true }), 'tutor');

  // 본문에도 없고 튜터에도 없으면 text
  assert.equal(memoCore.classifyPaste({ text: longText, inPage: false, tutorFound: false }), 'text');
});

test('classifyPaste: 비정상 및 빈 입력 방어', () => {
  assert.equal(memoCore.classifyPaste(null), 'text');
  assert.equal(memoCore.classifyPaste(undefined), 'text');
  assert.equal(memoCore.classifyPaste({}), 'text');
  assert.equal(memoCore.classifyPaste({ text: '' }), 'text');
  assert.equal(memoCore.classifyPaste({ text: 12345 }), 'text');
});

// ==========================================
// 2. 소스 검사: memo-pad.js
// ==========================================

test('소스 검사: memo-pad.js 에 paste 이벤트 리스너 등록', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // paste 이벤트 리스너 등록 확인
  assert.match(padCode, /addEventListener\(\s*['"]paste['"]/);
  // clipboardData text/plain 읽기 확인
  assert.match(padCode, /clipboardData/);
  assert.match(padCode, /text\/plain/);
  // 15자 경계 검사 확인
  assert.match(padCode, /15/);
});

test('소스 검사: memo-pad.js 가 본문 색인과 quoteOf를 재사용하여 본문 일치 비교', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // 본문 색인(buildTextIndex) 및 quoteOf 재사용 확인
  assert.match(padCode, /buildTextIndex/);
  assert.match(padCode, /quoteOf/);
});

test('소스 검사: memo-pad.js 가 tutor-quote 메시지 전송 및 1.5초(1500ms) 타임아웃 처리', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // tutor-quote 메시지 전송 확인
  assert.match(padCode, /type:\s*['"]tutor-quote['"]/);
  // 1.5초(1500ms) 타임아웃 확인
  assert.match(padCode, /1500/);
});

test('소스 검사: memo-pad.js 가 source: tutor 및 tutor 메타데이터를 저장 및 인용 줄에 반영', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // quotes에 source: 'tutor' 저장 확인
  assert.match(padCode, /source:\s*['"]tutor['"]/);
  // 튜터 인용 줄 ❝ 튜터 표시 확인
  assert.match(padCode, /❝\s*튜터/);
  // 저장(⌘Enter) 시 quote에 source, tutor 전달 확인
  assert.match(padCode, /performSave/);
});

test('소스 검사: memo-pad.js 가 튜터 인용 줄 클릭 시 본문 스크롤 대신 전문 펼침/접기 토글', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // 튜터 인용 줄 처리 (메모장 인용 줄 및 저장된 메모 인용 줄)
  assert.match(padCode, /source === ['"]tutor['"]/);
});

test('소스 검사: memo-pad.js 가 못 찾았을 때 원래 글을 커서 자리에 삽입 (insertText/setRangeText)', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // insertText 또는 setRangeText 사용 확인
  const hasInsert = padCode.includes('insertText') || padCode.includes('setRangeText');
  assert.ok(hasInsert, 'insertText 또는 setRangeText 가 사용되어야 함');
});

// ==========================================
// 3. 소스 검사: background.js
// ==========================================

test('소스 검사: background.js 가 tutor-quote 중계, sender.id 확인, /tutor-quote 호출, 401 재시도 포함', () => {
  const bgCode = readFileSync(backgroundPath, 'utf8');

  // tutor-quote 리스너
  assert.match(bgCode, /msg\?\.type\s*[!=]==?\s*['"]tutor-quote['"]/);
  // sender.id 확인
  assert.match(bgCode, /sender\.id\s*!==\s*chrome\.runtime\.id/);
  // /tutor-quote 엔드포인트 호출
  assert.match(bgCode, /['"]\/tutor-quote['"]/);
  // 401 재시도
  assert.match(bgCode, /401/);
});

test('소스 검사: background.js 의 memos 중계가 quote 객체를 그대로 전달', () => {
  const bgCode = readFileSync(backgroundPath, 'utf8');

  // memos 함수에서 quote 전달 확인
  assert.match(bgCode, /const\s*\{[^}]*quote[^}]*\}\s*=\s*msg/);
  assert.match(bgCode, /JSON\.stringify\(\{[^}]*quote[^}]*\}\)/);
});
