import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGloss } from '../bridge/parse.mjs';

test('순수 JSON을 읽는다', () => {
  assert.equal(parseGloss('{"gloss":"취약점"}'), '취약점');
});

test('```json 코드펜스로 감싼 JSON을 읽는다', () => {
  assert.equal(parseGloss('```json\n{"gloss": "페이로드"}\n```'), '페이로드');
});

test('언어 표시 없는 펜스와 앞뒤 공백도 읽는다', () => {
  assert.equal(parseGloss('  ```\n{"gloss":"완화"}\n```  \n'), '완화');
});

test('JSON 앞뒤에 잡담이 붙어도 중괄호 구간을 읽는다', () => {
  assert.equal(parseGloss('Here you go: {"gloss":"인젝션"} done'), '인젝션');
});

test('깨진 출력은 에러', () => {
  assert.throws(() => parseGloss('{"gloss": "취약'), /parse/i);
  assert.throws(() => parseGloss('그냥 문장'), /parse/i);
  assert.throws(() => parseGloss(''), /parse/i);
});

test('gloss 가 없거나 문자열이 아니거나 비었거나 너무 길면 에러', () => {
  assert.throws(() => parseGloss('{"meaning":"x"}'), /parse/i);
  assert.throws(() => parseGloss('{"gloss":3}'), /parse/i);
  assert.throws(() => parseGloss('{"gloss":"  "}'), /parse/i);
  assert.throws(() => parseGloss(`{"gloss":"${'가'.repeat(81)}"}`), /parse/i);
});

test('에러는 AiParseError 이름을 가진다', () => {
  try {
    parseGloss('x');
    assert.fail();
  } catch (e) {
    assert.equal(e.name, 'AiParseError');
  }
});
