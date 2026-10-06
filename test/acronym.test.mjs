import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/text.js');
await import('../extension/selection-core.js');
const { isAcronym, expandAcronym, acronymLine } = globalThis.readglossSelection;

test('isAcronym: 전부 대문자 2~6자만', () => {
  for (const ok of ['PCA', 'SVM', 'XSS', 'OWASP', 'MITRE', 'AB', 'ABCDEF']) assert.equal(isAcronym(ok), true, ok);
  for (const no of ['A', 'ABCDEFG', 'Pca', 'pca', 'PCa', 'P2P', 'AI-ML', '', null, undefined]) assert.equal(isAcronym(no), false, String(no));
});

test('expandAcronym: "(PCA)" 앞의 머리글자가 맞는 구를 찾는다(소문자로)', () => {
  assert.equal(expandAcronym('We apply principal component analysis (PCA) to the data.', 'PCA'), 'principal component analysis');
  assert.equal(expandAcronym('Principal Component Analysis (PCA) reduces dimensions.', 'PCA'), 'principal component analysis');
  assert.equal(expandAcronym('Cross-Site Request Forgery (CSRF) is an attack.', 'CSRF'), 'cross-site request forgery');
  assert.equal(expandAcronym('Return-Oriented Programming (ROP) chains gadgets.', 'ROP'), 'return-oriented programming');
});

test('expandAcronym: 복수형 (SVMs), 사이의 작은 낱말(and/of)은 건너뛴다', () => {
  assert.equal(expandAcronym('Support Vector Machines (SVMs) are classifiers.', 'SVM'), 'support vector machines');
  assert.equal(expandAcronym('See Common Vulnerabilities and Exposures (CVE) entries.', 'CVE'), 'common vulnerabilities and exposures');
  assert.equal(expandAcronym('a time of check to time of use (TOCTOU) race', 'TOCTOU'), 'time of check to time of use');
});

test('expandAcronym: 여러 곳 중 맞는 곳, 앞 문장과 섞이지 않는다', () => {
  assert.equal(expandAcronym('The data (DB) is big. Then we use principal component analysis (PCA).', 'PCA'), 'principal component analysis');
  assert.equal(expandAcronym('In this paper, principal component analysis (PCA) is used.', 'PCA'), 'principal component analysis');
});

test('expandAcronym: 실패 사례는 null', () => {
  assert.equal(expandAcronym('We use the method (PCA) here.', 'PCA'), null, '머리글자 불일치');
  assert.equal(expandAcronym('principal component analysis is PCA', 'PCA'), null, '괄호 없음');
  assert.equal(expandAcronym('analysis, principal component (PCA)', 'PCA'), null, '글자 모자람');
  assert.equal(expandAcronym('cross-site scripting (XSS) attack', 'XSS'), null, '약어 X 는 머리글자가 아님(ponytail 한계)');
  assert.equal(expandAcronym('Principal component analysis. (PCA)', 'PCA'), null, '문장 부호를 넘지 않는다');
  assert.equal(expandAcronym('', 'PCA'), null);
  assert.equal(expandAcronym('principal component analysis (PCA)', 'pca'), null, '대문자 약어만');
  assert.equal(expandAcronym('x (A) y', 'A'), null);
});

test('expandAcronym: 최대 8낱말까지만 거슬러 올라간다', () => {
  assert.equal(expandAcronym(`alpha ${'of '.repeat(6)}beta (AB)`, 'AB'), `alpha ${'of '.repeat(6)}beta`, '8낱말');
  assert.equal(expandAcronym(`alpha ${'of '.repeat(7)}beta (AB)`, 'AB'), null, '9낱말');
});

test('acronymLine: "PCA = 풀이 · 뜻", 이 페이지 풀이면 표시', () => {
  assert.equal(acronymLine({ word: 'PCA', exp: 'principal component analysis', ko: '주성분 분석' }), 'PCA = principal component analysis · 주성분 분석');
  assert.equal(acronymLine({ word: 'PCA', exp: 'principal component analysis', page: true }), 'PCA = principal component analysis (이 페이지)');
  assert.equal(acronymLine({ word: 'PCA', exp: 'principal component analysis', ko: '주성분 분석', page: true }), 'PCA = principal component analysis · 주성분 분석 (이 페이지)');
  assert.equal(acronymLine({ word: 'PCA', ko: '주성분 분석' }), '', '풀이가 없으면 줄을 만들지 않는다');
});
