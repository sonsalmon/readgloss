// test/t36-memo-toc.test.mjs
// 과제 T36: 메모장 v3 모양(17-1) - 목차 + 지금 칸만 펼침 + 높이 고정 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// memo-core.js 로드
const __dirname = join(fileURLToPath(import.meta.url), '..');
const memoCorePath = join(__dirname, '../extension/memo-core.js');
const memoPadPath = join(__dirname, '../extension/memo-pad.js');

const memoCoreCode = readFileSync(memoCorePath, 'utf8');
const runMemoCore = new Function('globalThis', memoCoreCode);
runMemoCore(globalThis);
const memoCore = globalThis.readglossMemo;

// ==========================================
// 1. tocLabel: 소제목 글, 메모 개수, 쓰는 중
// ==========================================

test('tocLabel: 소제목 제목만 있을 때 (메모 0, draft 없음)', () => {
  assert.equal(
    memoCore.tocLabel({ title: 'What is a Sigmoid Function?', memoCount: 0, hasDraft: false }),
    'What is a Sigmoid Function?'
  );
});

test('tocLabel: 소제목과 메모 개수 표시 (메모 > 0, draft 없음)', () => {
  assert.equal(
    memoCore.tocLabel({ title: 'How Logistic Regression Works', memoCount: 2, hasDraft: false }),
    'How Logistic Regression Works · 메모 2'
  );
  assert.equal(
    memoCore.tocLabel({ title: 'Decision Boundary', memoCount: 1, hasDraft: false }),
    'Decision Boundary · 메모 1'
  );
});

test('tocLabel: 쓰던 글이 있을 때 "쓰는 중" 표시', () => {
  assert.equal(
    memoCore.tocLabel({ title: 'Understanding Hyperplanes', memoCount: 0, hasDraft: true }),
    'Understanding Hyperplanes · 쓰는 중'
  );
});

test('tocLabel: 메모 개수와 쓰던 글 모두 있을 때 결합 표시', () => {
  assert.equal(
    memoCore.tocLabel({ title: 'Feature Scaling', memoCount: 3, hasDraft: true }),
    'Feature Scaling · 메모 3 · 쓰는 중'
  );
});

test('tocLabel 경계 조건: falsy 및 비정상 입력 처리', () => {
  // 빈 객체 및 null/undefined
  assert.equal(memoCore.tocLabel({}), '');
  assert.equal(memoCore.tocLabel(null), '');
  assert.equal(memoCore.tocLabel(undefined), '');

  // 제목 앞뒤 공백 정리
  assert.equal(
    memoCore.tocLabel({ title: '  Gradient Descent  ', memoCount: 0, hasDraft: false }),
    'Gradient Descent'
  );

  // memoCount가 음수, NaN, 0, 문자열 등일 때 무시
  assert.equal(
    memoCore.tocLabel({ title: 'Cost Function', memoCount: -1, hasDraft: false }),
    'Cost Function'
  );
  assert.equal(
    memoCore.tocLabel({ title: 'Cost Function', memoCount: NaN, hasDraft: false }),
    'Cost Function'
  );
  assert.equal(
    memoCore.tocLabel({ title: 'Cost Function', memoCount: '5', hasDraft: false }),
    'Cost Function'
  );

  // title이 비어 있고 메모/draft만 있는 경우
  assert.equal(
    memoCore.tocLabel({ title: '', memoCount: 2, hasDraft: false }),
    '메모 2'
  );
  assert.equal(
    memoCore.tocLabel({ title: '', memoCount: 1, hasDraft: true }),
    '메모 1 · 쓰는 중'
  );
});

// ==========================================
// 2. textareaHeight: 최소 5줄, 최대 listHeight/2, scrollHeight 비례
// ==========================================

test('textareaHeight: 내용이 적을 때 최소 5줄 높이 반환', () => {
  // lineHeight 20, 5줄 = 100px. listHeight 400 -> max 200px.
  // scrollHeight가 40px이어도 최소 100px.
  const h = memoCore.textareaHeight({ scrollHeight: 40, lineHeight: 20, listHeight: 400 });
  assert.equal(h, 100);
});

test('textareaHeight: 내용에 맞춰 scrollHeight로 증가', () => {
  // lineHeight 20 -> min 100px, max 200px.
  // scrollHeight가 150px이면 150px 반환.
  const h = memoCore.textareaHeight({ scrollHeight: 150, lineHeight: 20, listHeight: 400 });
  assert.equal(h, 150);
});

test('textareaHeight: listHeight/2 초과 시 상한선(listHeight/2)으로 제한', () => {
  // lineHeight 20 -> min 100px, max 200px.
  // scrollHeight가 350px이면 최대 200px 반환.
  const h = memoCore.textareaHeight({ scrollHeight: 350, lineHeight: 20, listHeight: 400 });
  assert.equal(h, 200);
});

test('textareaHeight 경계 조건: 극단적 또는 비정상 입력 처리', () => {
  // 기본값 fallback (lineHeight 20 -> min 100px)
  assert.equal(memoCore.textareaHeight({}), 100);
  assert.equal(memoCore.textareaHeight(null), 100);

  // listHeight가 매우 작아 listHeight/2 < 5 * lineHeight 인 경우 최소 5줄 보장
  // listHeight 100 -> half 50px < min 100px. 결과는 최소 100px.
  assert.equal(
    memoCore.textareaHeight({ scrollHeight: 50, lineHeight: 20, listHeight: 100 }),
    100
  );
  assert.equal(
    memoCore.textareaHeight({ scrollHeight: 150, lineHeight: 20, listHeight: 100 }),
    100
  );

  // scrollHeight가 0 또는 음수인 경우
  assert.equal(
    memoCore.textareaHeight({ scrollHeight: 0, lineHeight: 18, listHeight: 500 }),
    90
  );
  assert.equal(
    memoCore.textareaHeight({ scrollHeight: -50, lineHeight: 18, listHeight: 500 }),
    90
  );
});

// ==========================================
// 3. shouldSwitchSection: typingFocused 및 msSinceInput 판정
// ==========================================

test('shouldSwitchSection: 포커스가 없으면 경과 시간에 관계없이 섹션 변경 허용(true)', () => {
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: false, msSinceInput: 0 }),
    true
  );
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: false, msSinceInput: 500 }),
    true
  );
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: false, msSinceInput: 2000 }),
    true
  );
});

test('shouldSwitchSection: 포커스가 있고 마지막 입력 뒤 1.5초(1500ms) 미만이면 변경 차단(false)', () => {
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: 0 }),
    false
  );
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: 500 }),
    false
  );
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: 1499 }),
    false
  );
});

test('shouldSwitchSection: 포커스가 있어도 마지막 입력 뒤 1.5초(1500ms) 이상이면 변경 허용(true)', () => {
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: 1500 }),
    true
  );
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: 2000 }),
    true
  );
});

test('shouldSwitchSection 경계 조건: 비정상 입력 및 입력 이력 없음 처리', () => {
  // 입력 이력 없음 (Infinity)
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: Infinity }),
    true
  );

  // undefined, null, 빈 객체
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: undefined }),
    true
  );
  assert.equal(
    memoCore.shouldSwitchSection({ typingFocused: true, msSinceInput: NaN }),
    true
  );
  assert.equal(memoCore.shouldSwitchSection({}), true);
  assert.equal(memoCore.shouldSwitchSection(null), true);
});

// ==========================================
// 4. 소스 검사: 칸 목록 overflow-y:auto, scrollIntoView, focus preventScroll
// ==========================================

test('소스 검사: 칸 목록(.sections-container)에 overflow-y: auto 스타일 지정 확인', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // .sections-container 가 flex: 1 과 overflow-y: auto 를 포함하는지 확인
  assert.match(
    padCode,
    /\.sections-container[\s\S]*?overflow-y:\s*auto/
  );
});

test('소스 검사: 목차 줄 클릭 또는 섹션 이동 시 scrollIntoView 호출 확인', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // 본문 소제목 요소로 scrollIntoView({ behavior: 'smooth', block: 'start' }) 또는 유사 호출
  assert.match(
    padCode,
    /scrollIntoView\(\s*\{\s*behavior:\s*['"]smooth['"],\s*block:\s*['"]start['"]\s*\}\s*\)/
  );

  // 칸 목록 안에서 지금 칸 보이게 scrollIntoView({ block: 'nearest' }) 호출
  assert.match(
    padCode,
    /scrollIntoView\(\s*\{\s*block:\s*['"]nearest['"]\s*\}\s*\)/
  );
});

test('소스 검사: 쓰는 칸 포커스 시 preventScroll: true 옵션 적용 확인', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // focus({ preventScroll: true }) 호출 확인
  assert.match(
    padCode,
    /focus\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/
  );
});
