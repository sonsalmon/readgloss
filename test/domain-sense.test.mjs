import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnnotate, isCommon, pickSense, taggedGlosses } from '../bridge/annotate.mjs';
import { createGlossary } from '../bridge/glossary.mjs';
import { parseEntry } from '../bridge/dict.mjs';

// 사전 평문은 fixtures/dict-plain.json(맥 사전 원문)만 쓴다.
const fx = JSON.parse(readFileSync(new URL('../fixtures/dict-plain.json', import.meta.url), 'utf8'));
const entries = (w) => fx[w].map((e) => parseEntry(e));
const sense = (w, domains) => pickSense(taggedGlosses(entries(w)), domains);

test('pickSense: 분야 표시〔수학〕〔통계〕가 붙은 뜻을 첫 뜻 대신 짧게 다듬어 쓴다(번호 뒤·뜻 중간·묶음 표시)', () => {
  assert.deepEqual(sense('algorithm', ['math']), { ko: '알고리듬', tag: '수학' });
  assert.deepEqual(sense('average', ['math']), { ko: '산술 평균', tag: '통계' });
  assert.deepEqual(sense('subtraction', ['math']), { ko: '뺄셈', tag: '수학' }); // "빼기, …; 〔수학〕 뺄셈" 세미콜론 뒤에 표시
  // 〔수학·컴퓨터〕 묶음 표시는 둘 다 분야 표시다
  const group = [{ senses: [{ text: '반복의; 〔수학·컴퓨터〕 되풀이하는' }] }];
  assert.deepEqual(pickSense(taggedGlosses(group), ['math']), { ko: '되풀이하는', tag: '수학' });
  assert.deepEqual(pickSense(taggedGlosses(group), ['security']), { ko: '되풀이하는', tag: '컴퓨터' });
});

test('taggedGlosses: 표시 바로 뒤에 〈…이〉·（…의） 같은 쓰임 제한이 붙은 뜻은 건너뛴다(제한이 빠진 짧은 뜻은 오해를 부른다)', () => {
  assert.equal(sense('iterative', ['math']), null); // 〔수학·컴퓨터〕 〈공식·조작이〉 반복(적용)의 -> 첫 뜻 "반복의" 를 그대로 쓴다
  assert.deepEqual(taggedGlosses([{ senses: [{ text: '〔수학〕 （함수에서） 짝의' }, { text: '〔수학〕 〈근을〉 구하다' }, { text: '〔컴퓨터〕 시스템' }] }]), [{ tags: ['컴퓨터'], ko: '시스템' }]);
});

test('pickSense: 분야마다 맞는 표시만 본다(security 는 컴퓨터·통신, ml 은 컴퓨터·통계·수학)', () => {
  assert.deepEqual(sense('algorithm', ['security']), { ko: '알고리듬', tag: '컴퓨터' });
  assert.deepEqual(sense('average', ['ml']), { ko: '산술 평균', tag: '통계' });
  assert.equal(sense('average', ['security']), null);
  assert.equal(sense('subtraction', ['security']), null);
});

test('pickSense: 활성 분야 순서가 우선순위, 힌트가 없으면 null(첫 뜻을 그대로 쓰라는 뜻)', () => {
  assert.equal(sense('algorithm', ['security', 'math']).tag, '컴퓨터');
  assert.equal(sense('algorithm', ['math', 'security']).tag, '수학');
  assert.equal(sense('algorithm', []), null);
  assert.equal(sense('algorithm', undefined), null);
});

test('pickSense: 분야 표시가 아닌 〔…에의〕·〔화학〕·표시 없는 뜻은 null (multiplication 은 용어집 몫)', () => {
  assert.equal(sense('multiplication', ['math', 'ml', 'security']), null);
  assert.equal(sense('addition', ['math', 'ml', 'security']), null, '〔…에의〕〔화학〕〔법률〕 은 분야 낱말이 아니다');
  assert.deepEqual(taggedGlosses([]), []);
  assert.deepEqual(taggedGlosses([{ senses: [{ text: '〔수학〕' }, { text: '〔…에〕 곱' }, { text: 7 }] }]), []);
});

// 가짜 사전: 호출 기록을 남기고 fixtures 의 평문을 parseEntry 로 푼 결과를 준다.
function fakeDict() {
  const calls = [];
  return { calls, lookup: async (w) => (calls.push(w), fx[w] ? { found: true, entries: entries(w) } : { found: false }) };
}
const levels = new Map();
const noGlossary = createGlossary({ math: {}, ml: {}, security: {} });

test('annotate: 용어집에 없으면 활성 분야의 표시 뜻을, 힌트가 없으면 지금처럼 첫 뜻을 쓴다', async () => {
  const a = createAnnotate({ dict: fakeDict(), levels, glossary: noGlossary });
  assert.equal((await a(['subtraction'], 'A2', ['math'])).subtraction.gloss, '뺄셈');
  assert.equal((await a(['subtraction'], 'A2', [])).subtraction.gloss, '빼기');
  assert.equal((await a(['average'], 'A2', ['math'])).average.gloss, '산술 평균');
  assert.equal((await a(['average'], 'A2', [])).average.gloss, '평균');
  assert.equal((await a(['average'], 'A2', ['security'])).average.gloss, '평균', '이 분야 표시가 없으면 첫 뜻');
  const v = (await a(['subtraction'], 'A2', ['math'])).subtraction;
  assert.equal(v.term, undefined, '사전 뜻이라 용어 표시는 붙지 않는다');
});

test('annotate 캐시: 사전은 한 번만 부르고, 분야가 달라도 뜻이 섞이지 않는다', async () => {
  const d = fakeDict();
  const a = createAnnotate({ dict: d, levels, glossary: noGlossary });
  const g = async (domains) => (await a(['algorithm', 'average'], 'A2', domains)).average.gloss;
  assert.equal(await g(['math']), '산술 평균');
  assert.equal(await g([]), '평균');
  assert.equal(await g(['security']), '평균');
  assert.equal(await g(['ml']), '산술 평균');
  assert.equal(await g(['math']), '산술 평균');
  assert.deepEqual(d.calls, ['algorithm', 'average']);
});

test('annotate: 용어집이 있으면 용어집이 이긴다(multiplication 은 사전 1번 뜻 증가가 아니라 곱셈)', async () => {
  const d = fakeDict();
  const a = createAnnotate({ dict: d, levels, glossary: createGlossary() });
  assert.deepEqual((await a(['multiplication'], 'A2', ['math'])).multiplication, { lemma: 'multiplication', level: null, gloss: '곱셈', term: true, domain: 'math' });
  assert.deepEqual(d.calls, [], '용어집에 철자가 있으면 사전은 안 부른다');
  // 힌트가 없으면 사전 첫 뜻(증가)이 그대로 나온다
  assert.equal((await a(['multiplication'], 'A2', [])).multiplication.gloss, '증가');
  // 용어집이 있는 낱말은 분야 표시 뜻보다 용어집
  const g = createGlossary({ math: { algorithm: '알고리즘(용어집)' }, ml: {}, security: {} });
  assert.equal((await createAnnotate({ dict: fakeDict(), levels, glossary: g })(['algorithm'], 'A2', ['math'])).algorithm.gloss, '알고리즘(용어집)');
});

test('흔한 낱말(A1~B1)은 분야 표시 뜻을 안 쓴다: 글 전체 힌트로는 문장 속 뜻을 못 가려서 base 가 밑변이 되는 걸 막는다', async () => {
  assert.deepEqual(['A1', 'A2', 'B1', 'B2', 'C1', null, undefined].map(isCommon), [true, true, true, false, false, false, false]);
  const common = createAnnotate({ dict: fakeDict(), levels: new Map([['average', 'A2']]), glossary: noGlossary });
  assert.equal((await common(['average'], 'A2', ['math'])).average.gloss, '평균', 'A2 낱말은 첫 뜻 그대로');
  const rare = createAnnotate({ dict: fakeDict(), levels: new Map([['average', 'B2']]), glossary: noGlossary });
  assert.equal((await rare(['average'], 'A2', ['math'])).average.gloss, '산술 평균', 'B2 이상은 분야 뜻');
  // 용어집은 낱말 수준과 상관없이 쓴다
  const g = createGlossary({ math: { average: '평균값' }, ml: {}, security: {} });
  assert.equal((await createAnnotate({ dict: fakeDict(), levels: new Map([['average', 'A2']]), glossary: g })(['average'], 'A2', ['math'])).average.gloss, '평균값');
});
