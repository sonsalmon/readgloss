import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/structure-core.js');
await import('../extension/settings-core.js');
await import('../extension/panel.js');

const core = globalThis.readglossStructureCore;
const S = globalThis.readglossSettings;
const P = globalThis.readglossPanelCore;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('findPhrases: 21-1 규칙 기본 구절(for which, of whom, in whose) 추출', () => {
  const t1 = 'This is a problem for which we have no solution.';
  const p1 = core.findPhrases(t1);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].phrase, 'for which');
  assert.equal(p1[0].start, 18);
  assert.equal(p1[0].end, 27);

  const t2 = 'He met three colleagues, of whom two were engineers.';
  const p2 = core.findPhrases(t2);
  assert.equal(p2.length, 1);
  assert.equal(p2[0].phrase, 'of whom');

  const t3 = 'The author in whose name the book was published.';
  const p3 = core.findPhrases(t3);
  assert.equal(p3.length, 1);
  assert.equal(p3[0].phrase, 'in whose');
});

test('findPhrases: 특별 구절(the extent to which, the degree to which, the way in which)', () => {
  const t1 = 'We investigated the extent to which stress affects memory.';
  const p1 = core.findPhrases(t1);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].phrase, 'the extent to which');
  assert.equal(t1.slice(p1[0].start, p1[0].end), 'the extent to which');

  const t2 = 'The degree to which people agree varies.';
  const p2 = core.findPhrases(t2);
  assert.equal(p2.length, 1);
  assert.equal(p2[0].phrase, 'The degree to which');

  const t3 = 'I like the way in which you solved the problem.';
  const p3 = core.findPhrases(t3);
  assert.equal(p3.length, 1);
  assert.equal(p3[0].phrase, 'the way in which');
});

test('findPhrases: 낱말 경계 및 "therein which" 안 걸림', () => {
  const t1 = 'He spoke therein which was unusual.';
  const p1 = core.findPhrases(t1);
  assert.deepEqual(p1, [], 'therein which는 therein의 in으로 매칭되지 않아야 함');

  const t2 = 'forwhich without space is not matched';
  const p2 = core.findPhrases(t2);
  assert.deepEqual(p2, []);
});

test('findPhrases: 대소문자 무시', () => {
  const t = 'FOR WHICH we fought, and In Whose honor, THE EXTENT TO WHICH it grew.';
  const p = core.findPhrases(t);
  assert.equal(p.length, 3);
  assert.equal(p[0].phrase, 'FOR WHICH');
  assert.equal(p[1].phrase, 'In Whose');
  assert.equal(p[2].phrase, 'THE EXTENT TO WHICH');
});

test('findPhrases: 겹치면 긴 것만 남김', () => {
  const t = 'Consider the extent to which learning occurs.';
  const p = core.findPhrases(t);
  // 'the extent to which' 안에 'to which'가 포함되어 있으나 긴 것 1개만 남아야 함
  assert.equal(p.length, 1);
  assert.equal(p[0].phrase, 'the extent to which');

  const t2 = 'Observe the way in which it works.';
  const p2 = core.findPhrases(t2);
  assert.equal(p2.length, 1);
  assert.equal(p2[0].phrase, 'the way in which');
});

test('sentenceAround: 마침표, 물음표, 느낌표, 줄바꿈 기준 및 약어 유지', () => {
  const full = 'First sentence. This is the condition for which we test! Third sentence? And fourth line\nAnother for whom it applies.\nFinal.';
  const matches = core.findPhrases(full);
  assert.equal(matches.length, 2);

  const s1 = core.sentenceAround(full, matches[0].start, matches[0].end);
  assert.equal(s1, 'This is the condition for which we test!');

  const s2 = core.sentenceAround(full, matches[1].start, matches[1].end);
  assert.equal(s2, 'Another for whom it applies.');

  const withAbbr = 'Look at e.g. the case in which rules apply. Next sentence.';
  const m3 = core.findPhrases(withAbbr);
  assert.equal(m3.length, 1);
  const s3 = core.sentenceAround(withAbbr, m3[0].start, m3[0].end);
  assert.equal(s3, 'Look at e.g. the case in which rules apply.');
});

test('sentenceAround: ≤600자 상한 자름', () => {
  const prefix = 'Intro. ';
  const longSentence = 'word '.repeat(300) + 'for which ' + 'tail '.repeat(300) + '.';
  const text = prefix + longSentence + ' Outro.';
  const matches = core.findPhrases(text);
  assert.equal(matches.length, 1);
  const s = core.sentenceAround(text, matches[0].start, matches[0].end);
  assert.ok(s.length <= 600, `length ${s.length} <= 600`);
  assert.ok(s.includes('for which'), '구절이 잘려나가지 않고 포함되어야 함');
});

test('설정 기본값: structureHints 기본 true 및 settings-core / panel 연동', () => {
  assert.equal(S.DEFAULTS.structureHints, true);
  assert.equal(S.normalize({}).structureHints, true);
  assert.equal(S.normalize({ structureHints: false }).structureHints, false);
  assert.equal(S.normalize({ structureHints: 'no' }).structureHints, true);

  const toggle = P.TOGGLES.find((t) => t.path === 'structureHints');
  assert.ok(toggle, 'panel.js TOGGLES에 structureHints가 등록되어 있어야 함');
});

test('소스 검사: structure.js Highlight API, DOM 보존, 250ms dblclick 취소, Esc readglossCardClosed', () => {
  const src = read('structure.js');
  assert.match(src, /CSS\.highlights/, 'CSS.highlights Custom Highlight API 사용');
  assert.match(src, /readgloss-struct/, 'readgloss-struct 이름 사용');
  assert.match(src, /250/, '250ms 대기');
  assert.match(src, /dblclick/, 'dblclick 이벤트 감지 및 취소');
  assert.match(src, /readgloss-struct-card/, 'shadow host 이름');
  assert.match(src, /readglossCardClosed\s*=\s*true/, 'Esc 누를 때 readglossCardClosed 표시');
  assert.match(src, /explain-structure|'structure'/, '다리 /explain-structure 요청 전송');
  assert.match(src, /save-phrase/, 'save-phrase 단어장 문장 저장 요청');
});

test('소스 검사: background.js 중계 및 sender 검사', () => {
  const bg = read('background.js');
  assert.match(bg, /explain-structure/, '/explain-structure 다리 중계');
  assert.match(bg, /sender\.id\s*!==\s*chrome\.runtime\.id\s*\|\|\s*msg\?\.type\s*!==\s*'structure'/, 'sender 검사');
});

test('manifest 등록: annotate.js 바로 뒤에 structure-core.js, structure.js 등록', () => {
  const m = JSON.parse(read('manifest.json'));
  const js = m.content_scripts[0].js;
  const annIdx = js.indexOf('annotate.js');
  assert.ok(annIdx >= 0, 'annotate.js 존재');
  assert.equal(js[annIdx + 1], 'structure-core.js');
  assert.equal(js[annIdx + 2], 'structure.js');
});
