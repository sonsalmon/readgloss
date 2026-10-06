import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/annotate-core.js');
const { MAX_ACRONYMS, candidates, blockCandidates, chooseSpans, splitText, mydictKeys } = globalThis.readglossAnnotate;
const both = (text, before) => candidates(text, before, { acronyms: true });
const acr = (text) => both(text).filter((c) => c.acronym).map((c) => c.word);
const words = (text) => both(text).filter((c) => !c.acronym).map((c) => c.word);

test('MAX_ACRONYMS 는 다리의 acronyms 상한(100)과 같다', () => {
  assert.equal(MAX_ACRONYMS, 100);
});

test('candidates 기본값은 예전 그대로: 전부 대문자 낱말은 버린다', () => {
  assert.deepEqual(candidates('Use HTTPS and TLS with PCA'), [{ word: 'with', start: 18, end: 22 }]);
  assert.deepEqual(candidates('Use HTTPS and TLS with PCA', '', {}), candidates('Use HTTPS and TLS with PCA'));
  assert.deepEqual(candidates('Use PCA', '', { acronyms: false }), candidates('Use PCA'));
});

test('candidates(acronyms:true): 2~6자 전부 대문자 낱말은 따로(원래 철자·acronym 표시) 모으고, 일반 낱말과 섞여도 문서 순서', () => {
  const t = 'Apply PCA before the SVM and XSS checks';
  assert.deepEqual(both(t).map((c) => [c.word, !!c.acronym, t.slice(c.start, c.end)]), [
    ['apply', false, 'Apply'], ['PCA', true, 'PCA'], ['before', false, 'before'], ['SVM', true, 'SVM'], ['XSS', true, 'XSS'], ['checks', false, 'checks'],
  ]);
  assert.deepEqual(words(t), ['apply', 'before', 'checks']); // 일반 words 에는 약어가 안 들어간다
  assert.deepEqual(acr('HTTPS TLS ab AB A ABCDEF ABCDEFG'), ['HTTPS', 'TLS', 'AB', 'ABCDEF']); // 2~6자만(소문자·1자·7자 이상 제외)
});

test('약어 후보에서 빼는 것: 낱말에 붙은 것·URL·파일 이름·섞인 대소문자·하이픈 낱말·CVE-2024 식별자', () => {
  assert.deepEqual(acr('CVE-2024-1234 and CVE-2021'), []);
  assert.deepEqual(acr('x86 2FA ABC123 123ABC SNAKE_CASE snake_CASE'), []);
  assert.deepEqual(acr('visit https://EXAMPLE.com or user@EXAMPLE.org and NODE.js FILE.txt'), []);
  assert.deepEqual(acr('OAuth JavaScript iPhone TCP-IP ID-based'), []); // 안에 소문자가 있거나 하이픈으로 이은 낱말은 약어가 아니다
  assert.deepEqual(acr('(PCA) "SVM", XSS. [CNN] — RNN'), ['PCA', 'SVM', 'XSS', 'CNN', 'RNN']);
  assert.deepEqual(acr('café ÉCOLE NASA'), ['NASA']); // 비라틴 글자 이웃은 낱말이 아니다
});

test('blockCandidates(acronyms:true): 노드 안 위치와 acronym 표시, 노드 경계를 걸친 약어는 버린다, 기본은 약어 없음', () => {
  const texts = ['Run P', 'CA then SVM and ', 'XSS'];
  assert.deepEqual(blockCandidates(texts, { acronyms: true }), [
    { node: 1, word: 'then', start: 3, end: 7 },
    { node: 1, word: 'SVM', start: 8, end: 11, acronym: true },
    { node: 2, word: 'XSS', start: 0, end: 3, acronym: true },
  ]);
  assert.deepEqual(blockCandidates(texts), [{ node: 1, word: 'then', start: 3, end: 7 }]);
  assert.deepEqual(blockCandidates(['Use SVM']), []);
  assert.deepEqual(blockCandidates(['Use SVM'], { acronyms: true }), [{ node: 0, word: 'SVM', start: 4, end: 7, acronym: true }]);
});

test('chooseSpans: 약어도 원래 철자로 items 를 찾고 같은 규칙(반복·개수 상한·아는 단어)에 든다', () => {
  const text = 'PCA then PCA and SVM plus XSS';
  const occs = blockCandidates([text], { acronyms: true });
  const items = Object.assign(Object.create(null), { PCA: { lemma: 'pca', gloss: '주성분 분석' }, SVM: { lemma: 'svm', gloss: '서포트 벡터 머신' }, XSS: { lemma: 'xss', gloss: 'XSS' } });
  const seen = new Set();
  const spans = chooseSpans(occs, items, seen);
  assert.deepEqual(spans.map((s) => [s.lemma, text.slice(s.start, s.end)]), [['pca', 'PCA'], ['svm', 'SVM'], ['xss', 'XSS']]); // 두 번째 PCA 는 반복이라 뺀다
  assert.deepEqual([...seen], ['pca', 'svm', 'xss']);
  assert.deepEqual(chooseSpans(occs, items, new Set(), { limit: 2 }).map((s) => s.lemma), ['pca', 'svm']); // 개수에 약어도 센다
  assert.deepEqual(chooseSpans(occs, items, null).map((s) => s.lemma), ['pca', 'pca', 'svm', 'xss']);
  assert.deepEqual(chooseSpans(occs, items, new Set(), { skip: new Set(['pca']) }).map((s) => s.lemma), ['svm', 'xss']);
  assert.deepEqual(splitText(text, spans).filter((p) => p.gloss).map((p) => [p.text, p.gloss]), [['PCA', '주성분 분석'], ['SVM', '서포트 벡터 머신'], ['XSS', 'XSS']]);
});

test('mydictKeys: readgloss:mydict detail 의 set·delete 키를 소문자·공백 정리한 집합으로, 이상한 값은 버린다', () => {
  assert.deepEqual([...mydictKeys({ set: ['PCA', ' Principal  Component '], delete: ['svm', 'PCA'] })].sort(), ['pca', 'principal component', 'svm']);
  assert.deepEqual([...mydictKeys({ set: ['a'] })], ['a']);
  assert.deepEqual([...mydictKeys({ delete: ['b'] })], ['b']);
  for (const bad of [undefined, null, {}, 'x', 5, { set: 'pca' }, { set: [5, null, '', '   ', {}, 'x'.repeat(81)] }, { set: {} }]) assert.equal(mydictKeys(bad).size, 0, JSON.stringify(bad));
});

test('annotate.js 는 acronyms 를 따로 요청하고 readgloss:mydict 를 듣는다(접착 코드는 브라우저 없이 정적 확인)', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');
  assert.match(src, /blockCandidates\(texts, \{ acronyms: true \}\)/);
  assert.match(src, /acronyms/);
  assert.match(src, /addEventListener\('readgloss:mydict'/);
  assert.match(src, /mydictKeys\(e\.detail\)/);
  assert.doesNotMatch(src, /innerHTML/);
});
