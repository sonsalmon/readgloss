import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as glossaryModule from '../bridge/glossary.mjs';
import { DOMAINS, MAX_TERMS, createGlossary, loadGlossaries, variants } from '../bridge/glossary.mjs';

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

test('domains: 요청의 domains 힌트만 쓴다. host 는 보지 않는다(사이트 판단은 확장 설정의 몫)', () => {
  assert.equal('SITE_RULES' in glossaryModule, false);
  assert.deepEqual(G.domains({ host: 'academy.hackthebox.com' }), []);
  assert.deepEqual(G.domains({ host: 'example.com' }), []);
  assert.deepEqual(G.domains({}), []);
  assert.deepEqual(G.domains(undefined), []);
  assert.deepEqual(G.domains({ host: 'academy.hackthebox.com', domains: ['security', 'ml', 'math'] }), ['security', 'ml', 'math']);
});

test('도메인 합치기: 힌트 순서가 우선순위, 중복 없음, 모르는 값은 버림', () => {
  assert.deepEqual(G.domains({ host: 'example.com', domains: ['math'] }), ['math']);
  assert.deepEqual(G.domains({ domains: ['math', 'security', 'ml'] }), ['math', 'security', 'ml']);
  assert.deepEqual(G.domains({ domains: ['ml', 'ml', 'bogus', 7, 'math'] }), ['ml', 'math']);
  assert.deepEqual(G.domains({ domains: 'math' }), []);
  assert.deepEqual(G.domains({ host: 5, domains: null }), []);
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
  assert.equal(G.find('root', ['math', 'security']).ko, '근(루트)');
  assert.equal(G.find('root', ['security', 'math']).ko, '루트(최고 권한)');
  assert.equal(G.find('binary', ['ml', 'security']).ko, '이진');
  assert.equal(G.find('binary', ['security', 'ml']).ko, '바이너리');
  assert.equal(G.find('vector', ['security', 'math']).ko, '벡터', '공격 벡터도 벡터라 보안 쪽에서 괄호 설명을 뺐다');
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

test('Object.prototype 이름(constructor·toString 등)은 용어가 아니다: find 는 null, 번역 용어 지정에도 안 실린다', () => {
  for (const w of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(G.find(w, ['security', 'ml', 'math']), null, w);
  }
  assert.deepEqual(G.termsIn('call the constructor of the vector', ['security', 'ml', 'math']), ['vector=벡터']);
});

test('용어 검토 반영: 일반어 뜻이 HTB 본문에 나오는 낱말과 표준 표기', () => {
  const v = (d, k) => loadGlossaries()[d][k];
  assert.equal(v('math', 'cross'), '교차', 'cross validation 의 cross (외적은 phrases 의 cross product)');
  assert.equal(v('math', 'tangent'), '탄젠트');
  assert.equal(v('math', 'metric'), '지표(거리 함수)');
  assert.equal(v('math', 'cardinality'), '농도(원소의 개수)', 'cardinal number(기수)와 구분');
  assert.equal(v('math', 'outcome'), '결과');
  assert.equal(v('math', 'critical'), '임계(중요한)');
  assert.equal(v('math', 'significant'), '유의한(통계)·상당한');
  assert.equal(v('ml', 'dimensionality'), '차원');
  assert.equal(v('security', 'capability'), '능력(역량)');
  assert.equal(v('security', 'handle'), '처리하다(핸들)');
  assert.equal(v('security', 'origin'), '원점(오리진)');
  assert.equal(v('security', 'symbol'), '기호(심볼)');
  assert.equal(v('security', 'key'), '키(암호 키)');
  assert.equal(v('security', 'apt'), 'APT(지능형 지속 공격)');
  assert.equal(v('security', 'xss'), 'XSS(크로스 사이트 스크립팅)');
});

test('T13 보충: 사전 첫 뜻이 엉뚱한 사칙연산 용어(multiplication 은 증가가 아니라 곱셈)와 힌트별 intercept', () => {
  const ko = (w, d) => G.find(w, d)?.ko;
  assert.equal(ko('multiplication', ['math']), '곱셈');
  assert.equal(ko('multiplications', ['math']), '곱셈');
  assert.equal(ko('multiply', ['math']), '곱하다');
  assert.equal(ko('addition', ['math']), '덧셈');
  assert.equal(ko('subtraction', ['math']), '뺄셈');
  assert.equal(ko('division', ['math']), '나눗셈');
  assert.equal(ko('multiplication', ['security']), undefined, '힌트가 없는 분야에선 쓰지 않는다');
  assert.equal(ko('intercept', ['ml', 'security']), '절편');
  assert.equal(ko('intercept', ['security', 'ml']), '가로채기');
  assert.equal(G.find('trade-off', ['ml']), null, '한 단어가 아닌 키는 두지 않는다');
});
