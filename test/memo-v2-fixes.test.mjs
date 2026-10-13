import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderScrapDocs } from '../scripts/export-scraps.mjs';

// 메모 독립 검증 지적 수정(T31 후속, 변경 기록 14). 기존 시험 파일은 고치지 않고 여기에만 더한다.
// 소스 검사는 test/memo-quote.test.mjs 와 같은 방식이다. 순수 함수는 readglossMemo 로 직접 부른다.

await import('../extension/selection-core.js');
await import('../extension/memo-core.js');

const memoCore = globalThis.readglossMemo;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const bgSrc = read('extension/background.js');
const padSrc = read('extension/memo-pad.js');
const serverSrc = read('bridge/server.mjs');

// 함수 본문 한 덩이: start 표식부터 end 표식(닫는 괄호 줄)까지
function fnBlock(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} 가 있어야 합니다.`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `${startMarker} 의 닫는 부분이 있어야 합니다.`);
  return src.slice(start, end);
}

// memo-pad.js 는 IIFE 안이라 함수 닫는 괄호가 들여쓰기 2칸이다
const padFn = (name) => fnBlock(padSrc, `function ${name}(`, '\n  }\n');

// ---------------------------------------------------------------------------
// A. 메모 중계가 quote 를 다리로 보낸다
// ---------------------------------------------------------------------------

test('A. background.js memos 중계: 구조 분해와 POST body JSON 에 quote 가 있다', () => {
  const block = fnBlock(bgSrc, 'async function memos(', '\n}\n');
  assert.match(block, /const \{[^}]*\bquote\b[^}]*\} = msg;/, '구조 분해에 quote 가 있어야 합니다.');
  assert.match(block, /JSON\.stringify\(\{[^}]*\bquote\b[^}]*\}\)/, 'POST body JSON 에 quote 가 있어야 합니다.');
});

// ---------------------------------------------------------------------------
// B. 열자마자 쓰는 칸에 커서가 들어가고, 키는 메모장 어디서나 동작한다
// ---------------------------------------------------------------------------

test('B-1. 메모장을 열면 쓰는 칸에 포커스를 넣는다(같은 칸이어도)', () => {
  assert.match(padFn('openPad'), /applyActiveSection\(true, true\);/);
});

test('B-2. 칸을 다시 그린 뒤에도 쓰는 칸에 포커스를 다시 넣는다', () => {
  assert.match(padFn('rebuildSectionsUI'), /applyActiveSection\(true, true\);/);
});

test('B-3. applyActiveSection 은 force 인자가 참이면 입력 직후 제한 시간 검사를 건너뛴다', () => {
  const fn = padFn('applyActiveSection');
  assert.match(fn, /function applyActiveSection\(moveCaret = true, force = false\)/);
  assert.match(fn, /force\s*\|\|/, 'allowMove 가 force 를 보아야 합니다.');
});

test('B-4. ⌘Enter·Esc 처리는 textarea 가 아니라 메모장 상자(box) keydown 에서 받는다', () => {
  const fn = padFn('renderPadUI');
  assert.match(fn, /box\.addEventListener\('keydown'/, '상자에 keydown 리스너가 있어야 합니다.');
  assert.match(fn, /padKeyV2/, 'padKeyV2 로 키를 판정해야 합니다.');
  assert.match(fn, /performSave\(/, '저장은 상자 keydown 에서 불러야 합니다.');
  assert.match(fn, /closePad\(\)/, 'Esc 접기는 상자 keydown 에서 불러야 합니다.');
  assert.doesNotMatch(fn, /ta\.addEventListener\('keydown'/, 'textarea 별 keydown 리스너가 남으면 안 됩니다.');
  assert.match(fn, /newline/, 'textarea 안 Enter 줄바꿈 처리는 남아야 합니다.');
});

// ---------------------------------------------------------------------------
// C. 페이지 입력칸에 커서가 있으면 스크롤 따라가기가 커서를 옮기지 않는다
// ---------------------------------------------------------------------------

test('C-1. isPageField: 페이지 입력칸(input·textarea·select·편집 영역)만 참이다', () => {
  assert.equal(memoCore.isPageField({ tagName: 'INPUT' }), true);
  assert.equal(memoCore.isPageField({ tagName: 'TEXTAREA' }), true);
  assert.equal(memoCore.isPageField({ tagName: 'SELECT' }), true);
  assert.equal(memoCore.isPageField({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(memoCore.isPageField({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(memoCore.isPageField({ tagName: 'BUTTON' }), false);
  assert.equal(memoCore.isPageField(null), false);
});

test('C-2. 커서를 옮기는 자리(applyActiveSection)가 페이지 입력칸 검사를 거친다', () => {
  assert.match(padFn('applyActiveSection'), /isPageField\(document\.activeElement\)/);
});

// ---------------------------------------------------------------------------
// D. 창 전체가 화면 안에 들어온다
// ---------------------------------------------------------------------------

test('D-1. clampRect: 오른쪽·아래로 넘어가면 창 전체가 화면 안에 들어오게 당긴다', () => {
  assert.deepEqual(
    memoCore.clampRect({ left: 990, top: 850, width: 260, height: 200 }, { vw: 1000, vh: 800 }),
    { left: 740, top: 600, width: 260, height: 200 },
  );
  assert.deepEqual(
    memoCore.clampRect({ left: 500, top: 100, width: 400, height: 300 }, { vw: 600, vh: 500 }),
    { left: 200, top: 100, width: 400, height: 300 },
  );
});

test('D-2. clampRect: 창이 화면보다 크면 상한이 먼저 줄어든다', () => {
  assert.deepEqual(
    memoCore.clampRect({ left: 0, top: 0, width: 640, height: 900 }, { vw: 400, vh: 300 }),
    { left: 0, top: 0, width: 400, height: 260 },
  );
  assert.deepEqual(
    memoCore.clampRect({}, { vw: 200, vh: 150 }),
    { left: 0, top: 0, width: 200, height: 150 },
  );
});

// ---------------------------------------------------------------------------
// E. 인용만 있는 메모가 내보내기·study·목록 미리보기에서 빠지지 않는다
// ---------------------------------------------------------------------------

const TASKS = { 'S1-04': '접근 통제' };
const baseMemo = { id: 'm1', task: 'S1-04', url: 'https://example.test/a', title: 'A 페이지', ts: 1791443403464 };
const exportAll = (memos) => [...renderScrapDocs([], TASKS, memos).values()].join('\n');

test('E-1. 인용만 있는 메모: "- > 인용 (날짜)" 한 줄로 내보내고 인용은 앞 200자까지', () => {
  const all = exportAll([{ ...baseMemo, text: '', quote: { exact: 'ㄱ'.repeat(250) } }]);
  assert.match(all, /^- > ㄱ{200} \(\d{4}-\d{2}-\d{2}\)$/m);
  assert.doesNotMatch(all, /ㄱ{201}/);
  assert.doesNotMatch(all, /^- \(\d{4}/m, '빈 글 줄이 나오면 안 됩니다.');
});

test('E-2. 글과 인용이 함께 있으면 "- > 인용" 줄 다음에 들여쓴 글과 날짜', () => {
  const all = exportAll([{ ...baseMemo, text: '내 글', quote: { exact: '인용 문장' } }]);
  assert.match(all, /^- > 인용 문장$/m);
  assert.match(all, /^ {2}내 글 \(\d{4}-\d{2}-\d{2}\)$/m);
});

test('E-3. 인용이 없는 글 메모는 예전과 같은 줄로 나온다', () => {
  const all = exportAll([{ ...baseMemo, text: '그냥 글' }]);
  assert.match(all, /^- 그냥 글 \(\d{4}-\d{2}-\d{2}\)$/m);
});

test('E-4. bridge 저장 때 study 기록은 글이 비면 인용 앞부분을 쓴다', () => {
  assert.match(serverSrc, /study\.record\(\{ kind: 'memo', text: op\.text \|\| op\.quote\?\.exact/);
});

test('E-5. ⌥⇧M 목록 미리보기: 글이 비면 인용을 쓰고 undefined 글에서 죽지 않는다', () => {
  const fn = padFn('openListUI');
  assert.match(fn, /previewText\(m\.text \|\| m\.quote\?\.exact \|\| '', 80\)/);
  assert.doesNotMatch(fn, /m\.text\.slice\(0, 80\)/);
});
