// 과제 T53l(변경 기록 28-15): 구 기본형(base) 저장·검사와 base 로 묶기(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_MAX, createWords, parseBase, parseWordsOp } from '../bridge/words.mjs';

await import('../extension/panel-words.js');
await import('../extension/video-core.js');
await import('../extension/saved-marks-core.js');
await import('../extension/selection-core.js');
await import('../extension/panel-video.js');
const W = globalThis.readglossWords;
const Sel = globalThis.readglossSelection;
const P = globalThis.readglossVideoPanel;

const tmp = () => join(mkdtempSync(join(tmpdir(), 'rg-t53l-')), 'words.json');
const clock = (start = 1000) => {
  let t = start;
  return () => t++;
};

test('parseBase: 문자열만, 공백 정리 뒤 1~80자, 그 밖은 버림(undefined)', () => {
  assert.equal(parseBase('eat A alive'), 'eat A alive');
  assert.equal(parseBase('  eat   A\talive  '), 'eat A alive', '공백 정리');
  assert.equal(parseBase('x'.repeat(BASE_MAX)), 'x'.repeat(BASE_MAX), '80자까지');
  for (const bad of ['x'.repeat(BASE_MAX + 1), '', '   ', 5, null, undefined, [], {}, true]) {
    assert.equal(parseBase(bad), undefined, JSON.stringify(bad));
  }
});

test('parseWordsOp: save-phrase 의 base 는 더하며, 틀린 base 는 요청을 막지 않고 그 칸만 버린다', () => {
  const req = { type: 'words', op: 'save-phrase', text: 'He ate it alive.', translation: '그가 그것을 산 채로 먹었다.', kind: 'expression', base: 'eat A alive' };
  assert.equal(parseWordsOp(req).base, 'eat A alive');
  assert.equal(parseWordsOp({ ...req, base: undefined }).base, undefined, '없으면 칸 없음');
  assert.equal(parseWordsOp({ ...req, base: 'x'.repeat(81) }).base, undefined, '넘치면 버림');
  assert.ok(parseWordsOp({ ...req, base: 7 }), '타입이 틀려도 저장 요청은 살아 있다');
  assert.equal(parseWordsOp({ ...req, base: 7 }).base, undefined);
  assert.equal(parseWordsOp({ ...req, op: 'unsave-phrase', id: 'abcdefabcdef' }).base, undefined, '빼기에는 안 붙는다');
});

test('createWords: base 를 저장·돌려주고 파일에서도 읽는다. 다시 저장할 때 base 가 없으면 옛 값을 남긴다', () => {
  const file = tmp();
  const w = createWords({ file, now: clock() });
  const run = (v) => w.apply(parseWordsOp(v));
  const req = { op: 'save-phrase', text: 'He ate it alive.', translation: '산 채로 먹었다.', kind: 'expression', url: 'https://a.test/v', base: 'eat A alive' };
  const saved = run(req);
  const id = saved.id;
  assert.equal(saved.phrases[id].base, 'eat A alive');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).phrases[id].base, 'eat A alive');
  const reloaded = createWords({ file, now: clock() });
  assert.equal(reloaded.all().phrases[id].base, 'eat A alive', '다시 열어도 남는다');

  const again = run({ ...req, translation: '고친 뜻', base: undefined });
  assert.equal(again.phrases[id].base, 'eat A alive', 'base 없이 다시 저장해도 기본형은 남는다');
  assert.equal(again.phrases[id].translation, '고친 뜻');

  const old = w.apply(parseWordsOp({ op: 'save-phrase', text: 'A plain line.', translation: '평범한 줄' }));
  assert.equal('base' in old.phrases[old.id], false, '옛 항목·base 없는 저장은 base 칸이 없다');
});

test('groupByBase: 같은 base(대소문자·공백 무시)를 첫 줄로 묶고 다른 장면은 scenes 로, base 없으면 그대로', () => {
  const rows = [
    { id: 'a', base: 'eat A alive', text: 'He ate it alive.', ts: 30 },
    { id: 'b', text: 'plain', ts: 25 },
    { id: 'c', base: '  EAT   a ALIVE ', text: 'They eat it alive.', ts: 20 },
    { id: 'd', base: 'give up', text: 'She gave up.', ts: 10 },
  ];
  const got = W.groupByBase(rows);
  assert.deepEqual(got.map((r) => r.id), ['a', 'b', 'd'], '묶인 줄은 첫 자리에, 나머지 순서는 그대로');
  assert.equal(got[0].base, 'eat A alive');
  assert.deepEqual(got[0].scenes.map((r) => r.id), ['c']);
  assert.equal(got[1].scenes, undefined, 'base 없는 줄은 손대지 않는다');
  assert.deepEqual(got[2].scenes, [], 'base 가 있어도 겹치는 장면이 없으면 빈 목록');
  assert.deepEqual(W.groupByBase(undefined), []);
});

test('phraseRows: base 로 묶고 검색은 기본형도 보고, 같은 base 의 다른 장면을 scenes 로 넘긴다', () => {
  const phrases = {
    a1: { text: 'He ate it alive.', translation: '산 채로 먹었다.', kind: 'expression', base: 'eat A alive', url: 'https://www.youtube.com/watch?v=v1&t=1s', ts: 30 },
    a2: { text: 'They eat it alive.', translation: '산 채로 먹는다.', kind: 'expression', base: 'eat   A alive', url: 'https://www.youtube.com/watch?v=v1&t=9s', ts: 20 },
    b1: { text: 'A plain line.', translation: '평범한 줄', kind: 'sentence', ts: 10 },
  };
  const rows = W.phraseRows(phrases);
  assert.deepEqual(rows.map((r) => r.id), ['a1', 'b1']);
  assert.equal(rows[0].base, 'eat A alive');
  assert.deepEqual(rows[0].scenes.map((r) => r.id), ['a2']);
  assert.deepEqual(W.phraseRows(phrases, 'eat a alive').map((r) => r.id), ['a1'], '기본형으로도 찾는다');
  assert.deepEqual(W.phraseRows(phrases, 'they eat').map((r) => r.id), ['a2'], '장면 원문으로도 찾는다');
});

test('expressionToggle: 표현 저장에 원형(en)을 base 로 싣고, 이미 있으면 빼기만 한다', () => {
  const msg = Sel.expressionToggle({ en: 'gave it up', ko: '포기했다' }, { sentence: 'She gave it up.', url: 'https://a.test/v', title: 't' });
  assert.deepEqual(msg, {
    type: 'words', op: 'save-phrase', text: 'gave it up', translation: '포기했다', kind: 'expression',
    base: 'gave it up', sentence: 'She gave it up.', url: 'https://a.test/v', title: 't',
  });
  assert.equal('base' in Sel.expressionToggle({ en: 'gave it up', ko: '포기했다' }, { sentence: 'x' }), true);
  assert.equal(Sel.expressionToggle({ en: 'gave it up', ko: '포기했다', id: 'abcdefabcdef' }, {}).base, undefined, '빼기에는 base 없음');
});

test('나의 표현: 같은 base 의 다른 장면을 한 줄로 묶고, 펼치면 두 장면의 줄을 모두 찾는다', () => {
  const ID = 'dQw4w9WgXcQ';
  const library = {
    saved: {},
    phrases: {
      p1: { text: 'He ate it alive.', base: 'eat A alive', translation: '산 채로 먹었다.', kind: 'expression', url: `https://www.youtube.com/watch?v=${ID}` },
      p2: { text: 'They eat it alive.', base: 'EAT A ALIVE', translation: '산 채로 먹는다.', kind: 'expression', url: `https://www.youtube.com/watch?v=${ID}` },
      p3: { text: 'A plain line.', translation: '평범한 줄', kind: 'sentence', url: `https://www.youtube.com/watch?v=${ID}` },
    },
  };
  const got = P.videoExpressions(library, ID);
  assert.equal(got.length, 1, '같은 base 는 한 줄');
  assert.deepEqual([got[0].title, got[0].text, got[0].scenes.length], ['eat A alive', 'He ate it alive.', 1]);
  const cues = [
    { start: 0, text: 'Nothing here.' },
    { start: 3, text: 'He ate it alive.' },
    { start: 7, text: 'They eat it alive.' },
  ];
  assert.deepEqual(P.expressionLines(cues, got[0]), [1, 2], '묶인 장면들의 줄을 모두 찾는다');
});

test('panel-words 소스: 다른 장면 펼침 단추는 btn(글자, 처리 함수, 클래스, 이름) 순서로 만든다', () => {
  const code = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');
  const at = code.indexOf('다른 장면 ${p.scenes.length}개 펼치기`');
  assert.ok(at > 0, '펼침 단추 글자를 찾아야 한다');
  const after = code.slice(at, at + 120);
  assert.ok(/^다른 장면 \$\{p\.scenes\.length\}개 펼치기`\s*,\s*\(\)\s*=>/.test(after), '둘째 인자는 클릭 처리 함수여야 한다(문자열이면 addEventListener 가 TypeError)');
});

test('background 소스: words 중계가 base 를 구조 분해하고 본문에 싣는다', () => {
  const code = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.ok(/const\s*\{\s*[^}]*\bbase\b[^}]*\}\s*=\s*msg/.test(code), 'words() 구조 분해에 base 가 있어야 한다');
  assert.ok(/JSON\.stringify\(\s*\{[^}]*\bbase\b[^}]*\}\s*\)/.test(code), 'words() 요청 body 에 base 가 있어야 한다');
});
