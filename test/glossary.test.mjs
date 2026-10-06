import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DOMAINS, MAX_TERMS, SITE_RULES, createGlossary, loadGlossaries, variants } from '../bridge/glossary.mjs';

const G = createGlossary();

test('용어집 로딩: 세 분야 파일, 값은 비어 있지 않은 한국어 문자열, 키는 소문자 한 단어', () => {
  const data = loadGlossaries();
  assert.deepEqual(Object.keys(data).sort(), [...DOMAINS].sort());
  for (const d of DOMAINS) {
    const entries = Object.entries(data[d]);
    assert.ok(entries.length > 150, `${d} ${entries.length}`);
    for (const [k, v] of entries) {
      assert.match(k, /^[a-z]+$/, `${d}:${k}`);
      assert.match(v, /[가-힣]/, `${d}:${k}=${v}`);
    }
  }
  assert.equal(data.math.transpose, '전치(행렬)');
});

test('두 단어 이상(phrases-*.json)은 저장만 하고 용어집에는 섞이지 않는다', () => {
  const files = readdirSync(new URL('../bridge/glossaries/', import.meta.url)).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('phrases-')), ['phrases-math.json', 'phrases-ml.json', 'phrases-security.json']);
  assert.equal(G.find('dot product', ['math']), null);
  const p = JSON.parse(readFileSync(new URL('../bridge/glossaries/phrases-math.json', import.meta.url), 'utf8'));
  assert.equal(p['identity matrix'], '단위행렬');
});

test('사이트 규칙: HTB(하위 도메인 포함)는 보안·ML·수학, 다른 사이트는 없음', () => {
  assert.deepEqual(SITE_RULES['academy.hackthebox.com'], ['security', 'ml', 'math']);
  assert.deepEqual(G.domains({ host: 'academy.hackthebox.com' }), ['security', 'ml', 'math']);
  assert.deepEqual(G.domains({ host: 'ACADEMY.hackthebox.com' }), ['security', 'ml', 'math']);
  assert.deepEqual(G.domains({ host: 'x.academy.hackthebox.com' }), ['security', 'ml', 'math']);
  assert.deepEqual(G.domains({ host: 'notacademy.hackthebox.com' }), []);
  assert.deepEqual(G.domains({ host: 'evil-academy.hackthebox.com.example.org' }), []);
  assert.deepEqual(G.domains({ host: 'example.com' }), []);
  assert.deepEqual(G.domains({}), []);
  assert.deepEqual(G.domains(undefined), []);
});

test('도메인 합치기: 페이지가 알려 준 힌트가 앞, 사이트 기본값이 뒤, 중복 없음, 모르는 값은 버림', () => {
  assert.deepEqual(G.domains({ host: 'example.com', domains: ['math'] }), ['math']);
  assert.deepEqual(G.domains({ host: 'academy.hackthebox.com', domains: ['math'] }), ['math', 'security', 'ml']);
  assert.deepEqual(G.domains({ domains: ['ml', 'ml', 'bogus', 7, 'math'] }), ['ml', 'math']);
  assert.deepEqual(G.domains({ domains: 'math' }), []);
  assert.deepEqual(G.domains({ host: 5, domains: null }), []);
  assert.deepEqual(G.domains({ host: 'a'.repeat(300) + '.academy.hackthebox.com' }), []);
});

test('find: 활성 분야 안에서만, 앞선 분야 먼저. 복수형은 단수로 찾는다', () => {
  assert.deepEqual(G.find('transpose', ['math']), { ko: '전치(행렬)', domain: 'math', key: 'transpose' });
  assert.equal(G.find('transpose', ['security']), null);
  assert.equal(G.find('transpose', []), null);
  assert.equal(G.find('Transpose', ['math']).key, 'transpose');
  assert.equal(G.find('matrices', ['math']).ko, '행렬');
  assert.equal(G.find('features', ['ml']).key, 'feature');
  assert.equal(G.find('outliers', ['math']).key, 'outlier');
  // 겹치는 단어: 분야 순서가 곧 우선순위
  assert.equal(G.find('vector', ['math', 'security']).ko, '벡터');
  assert.equal(G.find('vector', ['security', 'math']).ko, '벡터(경로)');
});

test('variants: 원형 먼저, 복수형 규칙만(-ing·-ed 는 사전 원형에 맡긴다)', () => {
  assert.deepEqual(variants('matrices'), ['matrices', 'matrix', 'matrice']);
  assert.deepEqual(variants('queries').slice(0, 2), ['queries', 'query']);
  assert.deepEqual(variants('classes'), ['classes', 'class', 'classe']);
  assert.deepEqual(variants('class'), ['class']);
  assert.ok(!variants('meaning').includes('mean'));
});

test('용어집 품질: HTB 후보 용어가 모두 있다, 낮은 확신 표제어는 없다', () => {
  const all = (w) => ['security', 'ml', 'math'].some((d) => G.find(w, [d]));
  for (const w of ['transpose', 'matrix', 'eigenvalue', 'variance', 'covariance', 'gradient', 'determinant', 'regression', 'classification', 'clustering', 'perceptron', 'tanh', 'spam', 'fraud', 'intrusion', 'euclidean', 'summation', 'subscript', 'superscript']) assert.ok(all(w), w);
  for (const w of ['loot', 'detonate', 'tarpit', 'stationary', 'module']) assert.ok(w === 'module' ? G.find(w, ['security']) : !all(w), w);
  assert.equal(G.find('module', ['math']), null, '수학 module(가군)은 확신이 낮아 뺐다');
});

test('termsIn: 본문에 나온 용어를 "원형=뜻"으로, 나온 순서·중복 없이 최대 30개', () => {
  const t = G.termsIn('The Transpose of a matrix flips it; matrices and transpose again.', ['math']);
  assert.deepEqual(t, ['transpose=전치(행렬)', 'matrix=행렬']);
  assert.deepEqual(G.termsIn('transpose', []), []);
  assert.deepEqual(G.termsIn('', ['math']), []);
  const many = Object.keys(loadGlossaries().math).slice(0, 80).join(' ');
  assert.equal(G.termsIn(many, ['math']).length, MAX_TERMS);
});

test('keyOf: 활성 도메인 조합(순서 포함) 문자열, 없으면 빈 문자열', () => {
  assert.equal(G.keyOf([]), '');
  assert.equal(G.keyOf(['math', 'security']), 'math,security');
  assert.notEqual(G.keyOf(['math', 'security']), G.keyOf(['security', 'math']));
});
