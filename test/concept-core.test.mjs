import test from 'node:test';
import assert from 'node:assert/strict';

// concept-core.js 및 scrap-core.js는 classic script이므로 import 후 전역에서 꺼낸다.
await import('../extension/selection-core.js');
await import('../extension/scrap-core.js');
await import('../extension/concept-core.js');

const { findTerms } = globalThis.readglossConcept;

test('"control"은 "controller" 안에서 찾지 않는다', () => {
  const fullText = 'The controller handles requests, while control verifies permissions.';
  const terms = [{ id: 'c_ctrl', term: 'control' }];
  const matches = findTerms(fullText, terms);

  // 'controller' 안의 'control'은 찾지 않고, 'control' 단독 단어만 찾아야 한다.
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'c_ctrl');
  assert.equal(fullText.slice(matches[0].start, matches[0].end), 'control');
  assert.equal(matches[0].start, fullText.indexOf('control verifies'));
});

test('"access control"과 "control"이 겹치면 "access control"만', () => {
  const fullText = 'We need access control here.';
  const terms = [
    { id: 'c_ctrl', term: 'control' },
    { id: 'c_ac', term: 'access control' },
  ];
  const matches = findTerms(fullText, terms);

  // 긴 것 먼저, 겹치면 긴 'access control'만 찾아야 한다.
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'c_ac');
  assert.equal(fullText.slice(matches[0].start, matches[0].end), 'access control');
});

test('별칭으로도 찾는다. 대소문자를 무시한다', () => {
  const fullText = 'Using RBAC and rbac and Access Control.';
  const terms = [
    { id: 'c_ac', term: 'access control' },
    { id: 'c_ac', term: 'RBAC' },
  ];
  const matches = findTerms(fullText, terms);

  assert.equal(matches.length, 3);
  assert.deepEqual(
    matches.map((m) => ({ id: m.id, text: fullText.slice(m.start, m.end) })),
    [
      { id: 'c_ac', text: 'RBAC' },
      { id: 'c_ac', text: 'rbac' },
      { id: 'c_ac', text: 'Access Control' },
    ],
  );
});

test('개념 300개, 본문 20만 자에서 0.2초 안', () => {
  // 300개 개념 용어 생성
  const terms = [];
  for (let i = 0; i < 300; i++) {
    terms.push({ id: `c_${i}`, term: `concept term ${i}` });
  }
  // 특정 용어도 포함
  terms.push({ id: 'c_special', term: 'buffer overflow' });

  // 20만 자 본문 생성 (약 20만 자의 텍스트 구성)
  const paragraph = 'Web security requires continuous verification of buffer overflow vulnerabilities and proper access control policies. ';
  const repeatCount = Math.ceil(200_000 / paragraph.length);
  const fullText = paragraph.repeat(repeatCount).slice(0, 200_000);

  const t0 = performance.now();
  const matches = findTerms(fullText, terms);
  const elapsed = performance.now() - t0;

  assert.ok(matches.length > 0);
  assert.ok(elapsed < 200, `0.2초(200ms) 안에 완료되어야 함: ${elapsed.toFixed(1)}ms`);
});

test('링크 안 개념어는 찾고, pre 안은 찾지 않는다', () => {
  // 모의 DOM 노드 구성: <p>Check this <a href="...">access control</a> link.</p><pre>access control in pre</pre>
  const textNode1 = { nodeType: 3, nodeValue: 'Check this ' };
  const textNode2 = { nodeType: 3, nodeValue: 'access control' };
  const linkEl = { nodeType: 1, localName: 'a', childNodes: [textNode2] };
  const textNode3 = { nodeType: 3, nodeValue: ' link.' };
  const pEl = { nodeType: 1, localName: 'p', childNodes: [textNode1, linkEl, textNode3] };

  const textNodePre = { nodeType: 3, nodeValue: 'access control in pre' };
  const preEl = { nodeType: 1, localName: 'pre', childNodes: [textNodePre] };

  const root = { nodeType: 1, localName: 'body', childNodes: [pEl, preEl] };

  // scrap-core.js의 indexText와 skipsIndex 규칙 적용
  const skipEl = (el) => globalThis.readglossScrap.skipsIndex(el);
  const { fullText } = globalThis.readglossScrap.indexText(root, skipEl);

  const terms = [{ id: 'c_ac', term: 'access control' }];
  const matches = findTerms(fullText, terms);

  // 링크 안의 'access control'은 찾고, pre 안의 것은 색인에서 빠져 찾지 않는다.
  assert.equal(matches.length, 1);
  assert.equal(fullText.slice(matches[0].start, matches[0].end), 'access control');
});
