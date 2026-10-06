import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/glossary-core.js');
const G = globalThis.readglossGlossary;

// 수식 DOM 이 없는 HTB 같은 페이지: 제목과 인라인 코드의 글자로 판단한다.
const htbLike = { codeTexts: ['A^T', 'A^{-1}', 'x_t', 'det(A)'], headingTexts: ['Transpose (A^T)', 'Matrices'] };

test('detectMath: 수식 DOM 이 있으면 수학 페이지', () => {
  assert.equal(G.detectMath({ hasMathDom: true }), true);
  assert.equal(G.detectMath({}), false);
  assert.equal(G.detectMath(), false);
});

test('detectMath: 수식 DOM 없이도 코드·제목의 수식 표기와 수학 낱말로 알아본다(HTB 모양)', () => {
  assert.equal(G.detectMath(htbLike), true);
  assert.equal(G.detectMath({ codeTexts: ['A^T = [[1,3],[2,4]]', 'e^x'], headingTexts: [] }), true, '표기 둘');
  assert.equal(G.detectMath({ codeTexts: ['Var(X) = E[(X - E[X])^2]'], headingTexts: ['Variance and Covariance'] }), true, '표기 하나 + 제목 낱말');
  assert.equal(G.detectMath({ codeTexts: ['log2(x)', 'tr(A)'], headingTexts: [] }), true);
});

test('detectMath: 보안·일반 개발 글은 수학이 아니다(표기 하나만, 낱말만, 흔한 코드)', () => {
  assert.equal(G.detectMath({ codeTexts: ['console.log(x)', 'user_id', 'snake_case_var', 'a_b_c', 'tr -d "\\r"', 'nmap -sV 10.0.0.1', 'x^2'], headingTexts: ['SQL Injection', 'Reverse Shells'] }), false);
  assert.equal(G.detectMath({ codeTexts: ['A^T'], headingTexts: ['Setup'] }), false, '표기 하나뿐이면 아니다');
  assert.equal(G.detectMath({ codeTexts: [], headingTexts: ['Vector Graphics', 'Matrix Movie Night'] }), false, '낱말만으로는 아니다');
  assert.equal(G.detectMath({ codeTexts: ['x_t'], headingTexts: ['Gradient of the cost'] }), true);
});

test('inputFromDoc: 수식 DOM 질의 한 번 + code·h1~h3 글자(길이 상한)', () => {
  const calls = [];
  const node = (t) => ({ textContent: t });
  const doc = {
    querySelector: (sel) => (calls.push(sel), null),
    querySelectorAll: (sel) => (sel === 'code' ? [node('A^T'), node('y'.repeat(1000))] : [node('Transpose (A^T)')]),
  };
  const i = G.inputFromDoc(doc);
  assert.equal(calls.length, 1);
  for (const sel of ['mjx-container', '.MathJax', '.katex', 'math']) assert.ok(calls[0].includes(sel), sel);
  assert.equal(i.hasMathDom, false);
  assert.deepEqual(i.headingTexts, ['Transpose (A^T)']);
  assert.equal(i.codeTexts[0], 'A^T');
  assert.ok(i.codeTexts[1].length <= 300);
  assert.equal(G.detectMath(i), true, '코드 A^T + 제목 (A^T) 로 표기 둘');
  assert.equal(G.inputFromDoc({ querySelector: () => ({}), querySelectorAll: () => [] }).hasMathDom, true);
});

test('detectMl: ML 낱말이 든 제목이 둘 이상이면 ML 글(HTB 머신러닝 모듈 제목 모양)', () => {
  assert.equal(G.detectMl({ headingTexts: ['Introduction to Machine Learning', 'Deep Learning (DL)'] }), true);
  assert.equal(G.detectMl({ headingTexts: ['Perceptrons', 'Perceptrons', 'Structure of a Perceptron'] }), true);
  assert.equal(G.detectMl({ headingTexts: ['Q-Learning', 'The Q-Learning Algorithm'] }), true);
  assert.equal(G.detectMl({ headingTexts: ['Support Vector Machines (SVMs)', 'Kernel Trick'] }), false, '하나뿐');
  assert.equal(G.detectMl({ headingTexts: ['SQL Injection', 'Union Based Injection', 'Classification of Attacks'] }), false);
  assert.equal(G.detectMl({ headingTexts: ['Principal Component Analysis (PCA)', 'Principal Component Analysis (PCA)'] }), true);
  assert.equal(G.detectMl({ headingTexts: ['Anomaly Detection', 'Isolation Forest'] }), true);
  assert.equal(G.detectMl({}), false);
  assert.equal(G.detectMl(), false);
});

test('hint: 자동이면 host 와 domains, 끄기면 빈 객체(아무것도 안 보낸다)', () => {
  const doc = { querySelector: () => null, querySelectorAll: (s) => (s === 'code' ? htbLike.codeTexts : htbLike.headingTexts).map((t) => ({ textContent: t })) };
  assert.deepEqual(G.hint({ glossary: 'auto' }, doc, 'academy.hackthebox.com'), { host: 'academy.hackthebox.com', domains: ['math'] });
  assert.deepEqual(G.hint({}, doc, 'example.com'), { host: 'example.com', domains: ['math'] }, '설정 값이 없으면 자동');
  assert.deepEqual(G.hint({ glossary: 'off' }, doc, 'academy.hackthebox.com'), {});
  const mlDoc = { querySelector: () => null, querySelectorAll: (s) => (s === 'code' ? [] : [{ textContent: 'Neural Networks' }, { textContent: 'Gradient Descent' }]) };
  assert.deepEqual(G.hint({}, mlDoc, 'academy.hackthebox.com'), { host: 'academy.hackthebox.com', domains: ['ml'] });
  const both = { querySelector: () => null, querySelectorAll: (s) => (s === 'code' ? [{ textContent: 'x_t' }] : [{ textContent: 'Neural Networks' }, { textContent: 'Gradient Descent' }]) };
  assert.deepEqual(G.hint({}, both, 'a.com').domains, ['ml', 'math']);
  const plain = { querySelector: () => null, querySelectorAll: () => [] };
  assert.deepEqual(G.hint({ glossary: 'auto' }, plain, 'example.com'), { host: 'example.com', domains: [] });
});

test('hintKey: 분야 조합이 달라지면 키가 달라진다(확장 쪽 캐시를 비울 때 쓴다)', () => {
  assert.equal(G.hintKey({}), '');
  assert.equal(G.hintKey({ host: 'a.com', domains: [] }), 'a.com|');
  assert.notEqual(G.hintKey({ host: 'a.com', domains: ['math'] }), G.hintKey({ host: 'a.com', domains: [] }));
});

test('termLine: "용어: 전치(행렬) · 수학"', () => {
  assert.equal(G.termLine({ ko: '전치(행렬)', domain: 'math' }), '용어: 전치(행렬) · 수학');
  assert.equal(G.termLine({ ko: '페이로드', domain: 'security' }), '용어: 페이로드 · 보안');
  assert.equal(G.termLine({ ko: '과적합', domain: 'ml' }), '용어: 과적합 · 머신러닝');
  assert.equal(G.termLine({ ko: '값', domain: 'zzz' }), '용어: 값');
  assert.equal(G.termLine(undefined), '');
  assert.equal(G.termLine({ domain: 'math' }), '');
});

test('manifest: glossary-core.js 는 settings-core.js 뒤, 쓰는 파일(content·paragraph·annotate)보다 앞. import/export 없음', () => {
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const js = m.content_scripts[0].js;
  const at = (f) => js.indexOf(f);
  assert.ok(at('glossary-core.js') > at('settings-core.js'));
  for (const f of ['content.js', 'paragraph.js', 'annotate.js']) assert.ok(at('glossary-core.js') < at(f), f);
  assert.doesNotMatch(readFileSync(new URL('../extension/glossary-core.js', import.meta.url), 'utf8'), /^\s*(import|export)\s/m);
});

test('배선: 세 요청(annotate·dict·translate)이 host·domains 를 다리로 그대로 넘기고, 보내는 쪽은 hint 를 쓴다', () => {
  const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
  const bg = read('background.js');
  for (const body of ['{ words, level, host, domains }', '{ word, host, domains }', '{ text, force: force === true, host, domains }']) assert.ok(bg.includes(`JSON.stringify(${body})`), body);
  assert.match(read('annotate.js'), /G\.hint\(when, document, location\.hostname\)/);
  assert.match(read('paragraph.js'), /readglossGlossary\?\.hint\(settings, document, location\.hostname\)/);
  assert.match(read('content.js'), /readglossGlossary\?\.hint\(\{ glossary \}, document, location\.hostname\)/);
  assert.match(read('panel.js'), /path: 'glossary'/);
});
