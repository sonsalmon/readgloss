import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEntry } from '../bridge/dict.mjs';

const fx = JSON.parse(readFileSync(new URL('../fixtures/dict-plain.json', import.meta.url), 'utf8'));
const parse = (word, i = 0) => parseEntry(fx[word][i]);
const hangul = (s) => (s.match(/[가-힣]/g) ?? []).length;
// 품사·활용형은 묶음마다 한 번만 센다(뜻마다 되풀이되므로)
const everything = (e) =>
  [
    e.etym,
    ...e.senses.flatMap((s, i) => {
      const p = e.senses[i - 1];
      return [...(p && p.pos === s.pos && p.posNote === s.posNote ? [] : [s.pos, s.posNote]), s.text, ...s.examples];
    }),
  ]
    .filter(Boolean)
    .join(' ');

test('exploit 1: 표제어·번호·발음·명사·예문', () => {
  const e = parse('exploit', 0);
  assert.equal(e.headword, 'exploit');
  assert.equal(e.homograph, 1);
  assert.equal(e.pron, 'éksplɔit');
  assert.equal(e.senses.length, 1);
  const [s] = e.senses;
  assert.equal(s.pos, '명사');
  assert.equal(s.num, null);
  assert.match(s.text, /위업/);
  assert.deepEqual(s.examples, ["sing a person's exploits 남의 공적을 칭송하다."]);
});

test('exploit 2: 어원·동사/타동사·번호 뜻 둘·예문 셋', () => {
  const e = parse('exploit', 1);
  assert.equal(e.homograph, 2);
  assert.equal(e.pron, 'iksplɔ́it');
  assert.match(e.etym, /ex\(바깥으로\)/);
  assert.deepEqual(e.senses.map((s) => [s.pos, s.num]), [['동사, 타동사', 1], ['동사, 타동사', 2]]);
  assert.match(e.senses[0].text, /이용\[활용\]하다/);
  assert.equal(e.senses[0].examples.length, 3);
  assert.match(e.senses[1].text, /개발\[개척\]하다/);
});

test('delve: 활용형은 posNote, 동사+자동사는 한 묶음, 번호 없는 타동사 뜻이 뒤에 붙는다', () => {
  const e = parse('delve');
  assert.equal(e.pron, 'delv');
  assert.deepEqual(e.senses.map((s) => [s.pos, s.num]), [['동사 · 자동사', 1], ['동사 · 자동사', 2], ['동사 · 자동사', 3], ['타동사', null]]);
  assert.equal(e.senses[0].posNote, '(delved, delv·ing)');
  assert.equal(e.senses[0].examples.length, 3);
  assert.match(e.senses[3].text, /도랑 등을/);
});

test('mitigate: 동사·타동사 1·2, 뒤따르는 자동사', () => {
  const e = parse('mitigate');
  assert.deepEqual(e.senses.map((s) => [s.pos, s.num]), [['동사 · 타동사', 1], ['동사 · 타동사', 2], ['자동사', null]]);
  assert.match(e.senses[0].text, /^《격식》 〈분노/); // 번호 앞 머리말은 첫 뜻에 붙인다
  assert.equal(e.senses[2].text, '누그러지다, 가라앉다.');
});

test('payload: 발음 칸이 없어도 품사와 번호 뜻 4개', () => {
  const e = parse('payload');
  assert.equal(e.pron, '');
  assert.equal(e.senses.length, 4);
  assert.deepEqual(e.senses.map((s) => s.num), [1, 2, 3, 4]);
  assert.equal(e.senses[0].pos, '명사');
  assert.match(e.senses[3].text, /유효 탑재량/);
});

test('privilege: 번호 4개 뒤 동사/타동사 묶음', () => {
  const e = parse('privilege');
  assert.deepEqual(e.senses.map((s) => [s.pos, s.num]), [['명사', 1], ['명사', 2], ['명사', 3], ['명사', 4], ['동사, 타동사', null]]);
  assert.equal(e.senses[4].posNote, '(-leged, -leg·ing)');
  assert.equal(e.senses[4].examples.length, 2);
});

test('뜻을 잃지 않는다: 원문 한글 글자 수 == 구조에 담긴 한글 글자 수(머리 표제어 제외)', () => {
  for (const [word, entries] of Object.entries(fx)) {
    for (const raw of entries) {
      const e = parseEntry(raw);
      assert.equal(e.raw, raw.text);
      const body = raw.text.split(' | ').slice(-1)[0]; // 표제어·발음 뒤
      assert.equal(hangul(everything(e)), hangul(body), `${word} ${raw.homograph}`);
    }
  }
});

test('모르는 모양은 평문을 그대로 한 뜻으로', () => {
  const e = parseEntry({ headword: 'foo', homograph: 0, text: '이상한 사전 글\n둘째 줄' });
  assert.equal(e.senses.length, 1);
  assert.equal(e.senses[0].pos, '');
  assert.match(e.senses[0].text, /이상한 사전 글/);
  assert.match(e.senses[0].text, /둘째 줄/);
  assert.equal(e.raw, '이상한 사전 글\n둘째 줄');
});

test('동그라미 번호(①②)도 번호 뜻으로', () => {
  const e = parseEntry({ headword: 'payload', homograph: 0, text: '페이로ː드 (payload) 명사① 첫째 뜻. ② 둘째 뜻.' });
  assert.deepEqual(e.senses.map((s) => [s.pos, s.num, s.text]), [['명사', 1, '첫째 뜻.'], ['명사', 2, '둘째 뜻.']]);
});
