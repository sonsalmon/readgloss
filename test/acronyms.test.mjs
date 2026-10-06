import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGlossary, loadAcronyms } from '../bridge/glossary.mjs';
import { createAnnotate } from '../bridge/annotate.mjs';

const data = loadAcronyms();

test('acronyms.json: 약 150개(150~200), 키는 소문자 알파벳 2~6자, d 는 세 분야, exp·ko 는 비지 않고 ko 는 주석이라 짧다', () => {
  const keys = Object.keys(data);
  assert.ok(keys.length >= 150 && keys.length <= 200, String(keys.length));
  for (const [k, v] of Object.entries(data)) {
    assert.match(k, /^[a-z]{2,6}$/, k); // 확장이 모으는 약어 후보(문자만 2~6자)와 같은 모양
    assert.deepEqual(Object.keys(v).sort(), ['d', 'exp', 'ko'], k);
    assert.ok(['security', 'ml', 'math'].includes(v.d), k);
    assert.ok(v.exp.trim() && v.ko.trim(), k);
    assert.ok(v.ko.length <= 16, `${k}: ko 가 길다`);
  }
  assert.equal(JSON.stringify(Object.keys(data)), JSON.stringify([...new Set(keys)]));
  const bySecurity = keys.filter((k) => data[k].d === 'security').length;
  assert.ok(bySecurity >= 60 && keys.filter((k) => data[k].d === 'ml').length >= 25 && keys.filter((k) => data[k].d === 'math').length >= 10);
  // 계약에 적힌 대표 약어
  for (const k of ['pca', 'svm', 'knn', 'cnn', 'rnn', 'llm', 'rag', 'xss', 'csrf', 'ssrf', 'sqli', 'rce', 'lfi', 'idor', 'aslr', 'dep', 'rop', 'cve', 'cwe', 'cvss', 'apt', 'ioc', 'ttp', 'mitre', 'owasp', 'jwt', 'tls']) assert.ok(data[k], k);
  assert.deepEqual(data.pca, { exp: 'Principal Component Analysis', ko: '주성분 분석', d: 'ml' });
  assert.equal(readFileSync(new URL('../bridge/glossaries/SOURCE.md', import.meta.url), 'utf8').includes('acronyms.json'), true);
});

test('glossary.acronym: 활성 분야를 주면 그 약어의 분야가 켜졌을 때만, 안 주면 분야와 무관, 모르는 키·상속 속성은 null', () => {
  const g = createGlossary();
  assert.equal(g.acronym('pca', ['ml']).ko, '주성분 분석');
  assert.equal(g.acronym('pca', ['security', 'math']), null);
  assert.equal(g.acronym('pca', []), null);
  assert.equal(g.acronym('pca').d, 'ml');
  assert.equal(g.acronym('xss', ['security']).d, 'security');
  for (const k of ['nope', 'constructor', '__proto__', 'toString', 5, undefined]) assert.equal(g.acronym(k), null, String(k));
});

test('createAnnotate: 약어는 내 사전 -> 약어집(그 분야가 켜졌을 때만), 키는 원래 철자, 사전은 안 부른다', async () => {
  const calls = [];
  const dict = { lookup: async (w) => (calls.push(w), { found: false }) };
  const mine = new Map([['pca', { key: 'pca', ko: '내 뜻' }]]);
  const annotate = createAnnotate({ dict, glossary: createGlossary(), mydict: { find: () => null, get: (k) => mine.get(k) ?? null } });
  assert.deepEqual(await annotate([], 'B2', ['ml', 'security'], ['PCA', 'XSS', 'ZZZ', 'SVM']), {
    PCA: { lemma: 'pca', gloss: '내 뜻', term: true, mine: true, acronym: true },
    XSS: { lemma: 'xss', gloss: '크로스 사이트 스크립팅', term: true, domain: 'security', acronym: true },
    SVM: { lemma: 'svm', gloss: '서포트 벡터 머신', term: true, domain: 'ml', acronym: true },
  });
  assert.deepEqual(await annotate([], 'B2', [], ['PCA', 'XSS']), { PCA: { lemma: 'pca', gloss: '내 뜻', term: true, mine: true, acronym: true } }); // 분야가 없으면 약어집은 안 쓴다, 내 사전은 쓴다
  assert.deepEqual(await annotate([], 'B2', ['math'], ['XSS', 'SVM']), {});
  assert.deepEqual(calls, []);
});

test('createAnnotate: 아는 단어(원형)는 약어집에서 빠진다(내 사전은 그래도 나온다)', async () => {
  const annotate = createAnnotate({ dict: { lookup: async () => ({ found: false }) }, glossary: createGlossary(), isKnown: (l) => l === 'xss' });
  assert.deepEqual(await annotate([], 'B2', ['security'], ['XSS', 'CSRF']), { CSRF: { lemma: 'csrf', gloss: '사이트 간 요청 위조', term: true, domain: 'security', acronym: true } });
});

test('createAnnotate: 낱말도 내 사전이 가장 우선(기준 등급·사전보다 앞, 복수형은 원형 key)', async () => {
  const calls = [];
  const mydict = { get: () => null, find: (w) => (['make', 'payloads', 'payload'].includes(w) ? { key: w.replace(/s$/, ''), ko: '내 ' + w } : null) };
  const annotate = createAnnotate({ dict: { lookup: async (w) => (calls.push(w), { found: false }) }, mydict });
  assert.deepEqual(await annotate(['make', 'payloads'], 'C2'), {
    make: { lemma: 'make', gloss: '내 make', term: true, mine: true },
    payloads: { lemma: 'payload', gloss: '내 payloads', term: true, mine: true },
  });
  assert.deepEqual(calls, []);
});
