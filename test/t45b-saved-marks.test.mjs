import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formsOf as bridgeFormsOf } from '../bridge/annotate.mjs';

// T45b: 단어장 단어 칠하기 시험
await import('../extension/settings-core.js');
await import('../extension/saved-marks-core.js');

const S = globalThis.readglossSettings;
const core = globalThis.readglossSavedMarksCore;

test('formsOf: 순방향 활용형 생성 검사 (FX-L 4: 역방향 끝말 빼기 제외)', () => {
  const words = [
    'study',
    'run',
    'make',
    'mitigation',
    'apple',
    'box',
    'carry',
    'stop',
    'delve',
    'payload',
    'exploit',
  ];

  for (const w of words) {
    const fromCore = core.formsOf(w);
    assert.ok(fromCore.includes(w), `formsOf(${w})에 원형이 포함되어야 한다`);
    assert.ok(fromCore.includes(w + 's'), `formsOf(${w})에 +s가 포함되어야 한다`);
  }

  // 예외 입력 검사
  assert.deepEqual(core.formsOf(''), []);
  assert.deepEqual(core.formsOf(null), []);
  assert.deepEqual(core.formsOf(undefined), []);
  assert.deepEqual(core.formsOf(123), []);
});

test('buildFormSet: 단어장 원형 목록 -> Map(형태 -> 원형)', () => {
  const formMap = core.buildFormSet(['payload', 'study']);
  assert.ok(formMap instanceof Map);

  // payload 활용형
  assert.equal(formMap.get('payload'), 'payload');
  assert.equal(formMap.get('payloads'), 'payload');

  // study 활용형
  assert.equal(formMap.get('study'), 'study');
  assert.equal(formMap.get('studies'), 'study');
  assert.equal(formMap.get('studied'), 'study');
  assert.equal(formMap.get('studying'), 'study');

  // 없는 단어
  assert.equal(formMap.has('unknown'), false);
});

test('findSavedTokens: 경계·대소문자·활용형', () => {
  const formMap = core.buildFormSet(['payload', 'delve', 'mitigation', 'apple']);

  // 대소문자 & 활용형 매칭
  const text = 'The Payload and payloads will Delve into mitigations.';
  const tokens = core.findSavedTokens(text, formMap);

  assert.deepEqual(tokens, [
    { start: 4, end: 11, lemma: 'payload' }, // Payload
    { start: 16, end: 24, lemma: 'payload' }, // payloads
    { start: 30, end: 35, lemma: 'delve' }, // Delve
    { start: 41, end: 52, lemma: 'mitigation' }, // mitigations
  ]);

  // 경계 검사: 다른 단어 속 일부이거나 식별자(snake_case, 숫자 결합 등)인 경우 제외
  const nonBoundaryText = 'pineapple x86apple apple_pie apple123 (apple) [apple] apple.';
  const boundaryTokens = core.findSavedTokens(nonBoundaryText, formMap);

  assert.deepEqual(boundaryTokens, [
    { start: 39, end: 44, lemma: 'apple' }, // (apple)
    { start: 47, end: 52, lemma: 'apple' }, // [apple]
    { start: 54, end: 59, lemma: 'apple' }, // apple.
  ]);
});

test('설정 기본값: savedMarks 기본 true, normalize 검사', () => {
  assert.equal(S.DEFAULTS.savedMarks, true);
  assert.equal(S.normalize({}).savedMarks, true);
  assert.equal(S.normalize({ savedMarks: false }).savedMarks, false);
  assert.equal(S.normalize({ savedMarks: true }).savedMarks, true);
  assert.equal(S.normalize({ savedMarks: 'invalid' }).savedMarks, true);
});

test('소스 검사: readgloss-saved, rgba, DOM 유지(replaceWith/splitText 없음), readgloss:words 리스너', () => {
  const code = readFileSync(new URL('../extension/saved-marks.js', import.meta.url), 'utf8');

  // 하이라이트 이름
  assert.match(code, /readgloss-saved/);

  // 반투명 바탕 색 (rgba(56, 189, 248, .22))
  assert.match(code, /rgba\(\s*56\s*,\s*189\s*,\s*248\s*,\s*\.?22\s*\)/);

  // 페이지 DOM 건드리지 않음 (replaceWith, splitText 없음)
  assert.equal(code.includes('replaceWith'), false, '페이지 글자를 갈아끼우지 않는다 (replaceWith 금지)');
  assert.equal(code.includes('splitText'), false, '페이지 텍스트 노드를 쪼개지 않는다 (splitText 금지)');

  // readgloss:words 이벤트 수신 시 단어장 다시 받아 갱신
  assert.match(code, /readgloss:words/);
  assert.match(code, /chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*['"]words['"]\s*,\s*op:\s*['"]get['"]/);
});

test('manifest 등록: content_scripts에 structure.js 뒤에 등록', () => {
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scripts = m.content_scripts[0].js;

  const structIdx = scripts.indexOf('structure.js');
  assert.ok(structIdx >= 0, 'structure.js가 있어야 한다');
  assert.equal(scripts[structIdx + 1], 'saved-marks-core.js');
  assert.equal(scripts[structIdx + 2], 'saved-marks.js');
});
