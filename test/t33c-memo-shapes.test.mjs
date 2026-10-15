// test/t33c-memo-shapes.test.mjs
// 과제 T33c: 명세 16-1(소제목 칸에 모든 모양), 16-3(!/?, 개념 줄 그 자리 고치기) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// memo-core.js 로드
const __dirname = join(fileURLToPath(import.meta.url), '..');
const memoCorePath = join(__dirname, '../extension/memo-core.js');
const memoPadPath = join(__dirname, '../extension/memo-pad.js');

// globalThis에 memo-core 로드
const memoCoreCode = readFileSync(memoCorePath, 'utf8');
const runMemoCore = new Function('globalThis', memoCoreCode);
runMemoCore(globalThis);
const memoCore = globalThis.readglossMemo;

// ==========================================
// 1. assignToSections: 소제목 매칭, _page, 순서
// ==========================================

test('assignToSections: headings 마지막 글과 소제목 텍스트 매칭 (앞뒤 공백 무시)', () => {
  const sections = [
    { key: 'h0:Intro', text: 'Introduction', level: 1 },
    { key: 'h1:AccessControl', text: 'Access Control', level: 2 },
  ];

  const items = [
    { kind: 'concept', name: 'AC', headings: ['Introduction', 'Access Control'], ts: 100 },
    { kind: 'scrap', text: 'quote 1', headings: ['  Access Control  '], ts: 150 },
    { kind: 'word', lemma: 'privilege', headings: ['Introduction'], ts: 50 },
  ];

  const assigned = memoCore.assignToSections(sections, items);
  assert.equal(assigned.length, 2);

  // Introduction 섹션
  const introSec = assigned.find((s) => s.key === 'h0:Intro');
  assert.ok(introSec);
  assert.equal(introSec.items.length, 1);
  assert.equal(introSec.items[0].kind, 'word');
  assert.equal(introSec.items[0].lemma, 'privilege');

  // Access Control 섹션
  const acSec = assigned.find((s) => s.key === 'h1:AccessControl');
  assert.ok(acSec);
  assert.equal(acSec.items.length, 2);
  assert.equal(acSec.items[0].kind, 'concept');
  assert.equal(acSec.items[1].kind, 'scrap');
});

test('assignToSections: headings 없거나 못 찾은 항목은 _page 칸에 할당', () => {
  const sections = [
    { key: 'h0:Intro', text: 'Introduction', level: 1 },
    { key: '_page', text: 'Page Title', level: 1 },
  ];

  const items = [
    { kind: 'concept', name: 'Unknown', headings: ['NonExistent Heading'], ts: 200 },
    { kind: 'later', name: 'NoHeadings', ts: 100 },
    { kind: 'phrase', text: 'phrase without headings', headings: [], ts: 300 },
  ];

  const assigned = memoCore.assignToSections(sections, items);
  const pageSec = assigned.find((s) => s.key === '_page');
  assert.ok(pageSec);
  assert.equal(pageSec.items.length, 3);
  assert.equal(pageSec.items[0].name, 'NoHeadings');
  assert.equal(pageSec.items[1].name, 'Unknown');
  assert.equal(pageSec.items[2].text, 'phrase without headings');
});

test('assignToSections: _page 칸이 없는 sections에 매칭 안 되는 항목이 오면 _page 칸 생성', () => {
  const sections = [
    { key: 'h0:Intro', text: 'Introduction', level: 1 },
  ];

  const items = [
    { kind: 'concept', name: 'AC', headings: ['Introduction'], ts: 100 },
    { kind: 'concept', name: 'Standalone', headings: ['Not Found'], ts: 200 },
  ];

  const assigned = memoCore.assignToSections(sections, items);
  assert.equal(assigned.length, 2);
  const pageSec = assigned.find((s) => s.key === '_page');
  assert.ok(pageSec);
  assert.equal(pageSec.items.length, 1);
  assert.equal(pageSec.items[0].name, 'Standalone');
});

test('assignToSections: 칸 안 항목은 ts 오름차순으로 정렬', () => {
  const sections = [
    { key: 'h0:Sec', text: 'Section A', level: 1 },
  ];

  const items = [
    { kind: 'phrase', text: 'p3', headings: ['Section A'], ts: 300 },
    { kind: 'concept', name: 'c1', headings: ['Section A'], ts: 100 },
    { kind: 'scrap', text: 's4', headings: ['Section A'], ts: 400 },
    { kind: 'word', lemma: 'w2', headings: ['Section A'], ts: 200 },
  ];

  const assigned = memoCore.assignToSections(sections, items);
  const sec = assigned[0];
  assert.deepEqual(sec.items.map((i) => i.ts), [100, 200, 300, 400]);
});

test('assignToSections: memo 항목은 buildSections 규칙 준수 (못 찾으면 첫 칸)', () => {
  const sections = [
    { key: 'h0:First', text: 'First Section', level: 1 },
    { key: 'h1:Second', text: 'Second Section', level: 2 },
    { key: '_page', text: 'Page', level: 1 },
  ];

  const items = [
    // headings 일치 시 해당 섹션
    { kind: 'memo', id: 'm1', text: 'memo 1', headings: ['Second Section'], ts: 10 },
    // headings 없으면 첫 칸
    { kind: 'memo', id: 'm2', text: 'memo 2', headings: [], ts: 20 },
    // headings 못 찾아도 첫 칸
    { kind: 'memo', id: 'm3', text: 'memo 3', headings: ['Unknown'], ts: 30 },
    // 반면 concept는 못 찾으면 _page 칸
    { kind: 'concept', name: 'c1', headings: ['Unknown'], ts: 40 },
  ];

  const assigned = memoCore.assignToSections(sections, items);
  const firstSec = assigned.find((s) => s.key === 'h0:First');
  const secondSec = assigned.find((s) => s.key === 'h1:Second');
  const pageSec = assigned.find((s) => s.key === '_page');

  // firstSec에는 m2, m3
  assert.equal(firstSec.items.length, 2);
  assert.equal(firstSec.items[0].id, 'm2');
  assert.equal(firstSec.items[1].id, 'm3');

  // secondSec에는 m1
  assert.equal(secondSec.items.length, 1);
  assert.equal(secondSec.items[0].id, 'm1');

  // pageSec에는 c1
  assert.equal(pageSec.items.length, 1);
  assert.equal(pageSec.items[0].name, 'c1');
});

// ==========================================
// 2. parseConceptCommand: !, ?, 이름 길이, 둘째 줄 정의, 일반 글 null
// ==========================================

test('parseConceptCommand: !이름 파싱', () => {
  const res = memoCore.parseConceptCommand('!접근 통제');
  assert.deepEqual(res, {
    kind: 'concept',
    name: '접근 통제',
    definition: '',
  });
});

test('parseConceptCommand: ?이름 파싱 (나중에 볼 것, 정의 빈 값)', () => {
  const res = memoCore.parseConceptCommand('?IDOR');
  assert.deepEqual(res, {
    kind: 'later',
    name: 'IDOR',
    definition: '',
  });
});

test('parseConceptCommand: 둘째 줄부터 정의 추출', () => {
  const text = '!access control\n- 서버 권한 검증\n- 클라이언트 숨김은 통제 아님';
  const res = memoCore.parseConceptCommand(text);
  assert.deepEqual(res, {
    kind: 'concept',
    name: 'access control',
    definition: '- 서버 권한 검증\n- 클라이언트 숨김은 통제 아님',
  });
});

test('parseConceptCommand: ?이름은 둘째 줄이 있어도 정의 빈 값', () => {
  const text = '?IDOR\n- 어떤 설명';
  const res = memoCore.parseConceptCommand(text);
  assert.deepEqual(res, {
    kind: 'later',
    name: 'IDOR',
    definition: '',
  });
});

test('parseConceptCommand: 이름 길이 1~80자 유효성 검사', () => {
  // 1자 통과
  assert.ok(memoCore.parseConceptCommand('!a'));
  assert.equal(memoCore.parseConceptCommand('!a').name, 'a');

  // 80자 통과
  const name80 = 'x'.repeat(80);
  assert.ok(memoCore.parseConceptCommand(`!${name80}`));
  assert.equal(memoCore.parseConceptCommand(`!${name80}`).name, name80);

  // 0자 (느낌표만 있거나 공백만) -> null
  assert.equal(memoCore.parseConceptCommand('!'), null);
  assert.equal(memoCore.parseConceptCommand('!   '), null);
  assert.equal(memoCore.parseConceptCommand('?'), null);
  assert.equal(memoCore.parseConceptCommand('?   '), null);

  // 81자 이상 -> null
  const name81 = 'x'.repeat(81);
  assert.equal(memoCore.parseConceptCommand(`!${name81}`), null);
  assert.equal(memoCore.parseConceptCommand(`?${name81}`), null);
});

test('parseConceptCommand: 일반 글 및 비정상 입력은 null 반환', () => {
  assert.equal(memoCore.parseConceptCommand('일반 메모 글입니다'), null);
  assert.equal(memoCore.parseConceptCommand('hello world'), null);
  assert.equal(memoCore.parseConceptCommand(''), null);
  assert.equal(memoCore.parseConceptCommand(null), null);
  assert.equal(memoCore.parseConceptCommand(undefined), null);
  assert.equal(memoCore.parseConceptCommand(123), null);
});

// ==========================================
// 3. 소스 검사: concepts/words/scraps get 요청, 0.8초 자동 저장, Esc
// ==========================================

test('소스 검사: extension/memo-pad.js 가 scraps/concepts/words get 요청을 보내는지 확인', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // scraps get 요청
  assert.match(padCode, /type:\s*['"]scraps['"],\s*op:\s*['"]get['"]/);

  // concepts get 요청
  assert.match(padCode, /type:\s*['"]concepts['"],\s*op:\s*['"]get['"]/);

  // words get 요청
  assert.match(padCode, /type:\s*['"]words['"],\s*op:\s*['"]get['"]/);
});

test('소스 검사: extension/memo-pad.js 가 0.8초(800ms) 자동 저장 및 Esc 처리를 포함하는지 확인', () => {
  const padCode = readFileSync(memoPadPath, 'utf8');

  // 800ms 타이머
  assert.match(padCode, /800/);

  // concepts save 요청
  assert.match(padCode, /type:\s*['"]concepts['"],\s*op:\s*['"]save['"]/);

  // Esc 접기/닫기 처리
  assert.match(padCode, /Escape/);

  // md-list 연동
  assert.match(padCode, /readglossMdList/);

  // openForm 연동
  assert.match(padCode, /readglossConceptPage.*openForm/);
});
