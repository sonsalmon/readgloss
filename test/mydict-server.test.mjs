import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { start, MINE } from '../fixtures/bridge-harness.mjs';

const withBridge = (fn) => async () => {
  const s = await start();
  try {
    await fn(s);
  } finally {
    await s.close();
  }
};
const setMine = (s, key, ko, extra = {}) => s.post('/mydict', { op: 'set', key, ko, ...extra });

test('/mydict: 토큰 없으면 401, 남의 Origin 403, 메서드는 GET·POST 만', withBridge(async (s) => {
  assert.equal((await s.get('/mydict', { headers: {} })).status, 401);
  assert.equal((await s.get('/mydict', { headers: { ...s.auth, Origin: 'chrome-extension://evil' } })).status, 403);
  assert.equal((await s.req('DELETE', '/mydict')).status, 405);
  assert.equal((await s.req('PUT', '/mydict', { body: {} })).status, 405);
}));

test('/mydict: GET 은 비어 있다가, set·delete 가 바뀐 전체 { entries } 를 돌려주고 data/mydict.json 에 저장한다', withBridge(async (s) => {
  assert.deepEqual((await s.get('/mydict')).json(), { entries: {} });
  const r = await setMine(s, ' PCA ', '주성분 분석', { exp: 'Principal Component Analysis', note: '차원 축소', url: 'https://a.test/p', title: '글' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], MINE);
  assert.deepEqual(Object.keys(r.json().entries), ['pca']);
  const e = r.json().entries.pca;
  assert.deepEqual([e.ko, e.exp, e.note, e.url, e.title], ['주성분 분석', 'Principal Component Analysis', '차원 축소', 'https://a.test/p', '글']);
  assert.equal(typeof e.ts, 'number');
  assert.deepEqual((await s.get('/mydict')).json(), r.json());
  assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'mydict.json'), 'utf8')), r.json());
  assert.deepEqual((await s.post('/mydict', { op: 'delete', key: 'PCA' })).json(), { entries: {} });
}));

test('/mydict: 깨진 본문·모르는 op·키·길이 위반은 400, 너무 큰 본문은 413', withBridge(async (s) => {
  assert.equal((await s.req('POST', '/mydict', { raw: 'not json' })).status, 400);
  for (const body of [null, {}, { op: 'drop', key: 'a' }, { op: 'set', key: 'a' }, { op: 'set', key: 'a_b', ko: '뜻' }, { op: 'set', key: 'x'.repeat(81), ko: '뜻' }, { op: 'set', key: 'a', ko: '' },
    { op: 'set', key: 'a', ko: '가'.repeat(81) }, { op: 'set', key: 'a', ko: '뜻', exp: 'e'.repeat(121) }, { op: 'set', key: 'a', ko: '뜻', note: 'n'.repeat(201) }, { op: 'set', key: 'a', ko: '뜻', url: 'javascript:1' }, { op: 'delete' }]) {
    assert.equal((await s.post('/mydict', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.req('POST', '/mydict', { raw: 'x'.repeat(20_000) })).status, 413);
  assert.deepEqual((await s.get('/mydict')).json(), { entries: {} });
}));

test('/annotate: 내 사전이 낱말에서 가장 우선(사전·기준 등급보다 앞), 지우면 사전 뜻으로 돌아온다', withBridge(async (s) => {
  const ask = async (words) => (await s.post('/annotate', { words, level: 'B2' })).json().items;
  assert.equal((await ask(['payload'])).payload.gloss, '수익 하중');
  await setMine(s, 'payload', '페이로드');
  assert.deepEqual((await ask(['payload', 'payloads'])).payload, { lemma: 'payload', gloss: '페이로드', term: true, mine: true });
  assert.equal((await ask(['payloads'])).payloads.lemma, 'payload'); // 복수형도 원형 key
  await setMine(s, 'make', '만들다'); // 쉬운 낱말도 사용자가 정했으면 나온다
  assert.equal((await ask(['make'])).make.gloss, '만들다');
  await s.post('/mydict', { op: 'delete', key: 'payload' });
  assert.equal((await ask(['payload'])).payload.gloss, '수익 하중');
}));

test('/annotate acronyms: 내 사전이 약어집보다 우선, 분야가 없으면 약어집은 안 쓰고 내 사전은 쓴다, 키는 원래 철자', withBridge(async (s) => {
  const ann = async (body) => (await s.post('/annotate', { words: [], level: 'B2', ...body })).json().items;
  assert.deepEqual(await ann({ acronyms: ['PCA', 'XSS'] }), {}); // domains 가 없다
  assert.deepEqual(await ann({ acronyms: ['PCA', 'XSS'], domains: ['ml'] }), { PCA: { lemma: 'pca', gloss: '주성분 분석', term: true, domain: 'ml', acronym: true } });
  assert.deepEqual(Object.keys(await ann({ acronyms: ['PCA', 'XSS'], domains: ['security', 'ml', 'math'] })), ['PCA', 'XSS']);
  await setMine(s, 'pca', '내 주성분');
  assert.deepEqual((await ann({ acronyms: ['PCA'] })).PCA, { lemma: 'pca', gloss: '내 주성분', term: true, mine: true, acronym: true }); // domains 가 없어도
  assert.equal((await ann({ acronyms: ['PCA'], domains: ['ml'] })).PCA.gloss, '내 주성분');
  await setMine(s, 'zzz', '내 약어');
  assert.equal((await ann({ acronyms: ['ZZZ'] })).ZZZ.gloss, '내 약어'); // 약어집에 없는 약어도
  await s.post('/mydict', { op: 'delete', key: 'pca' });
  assert.equal((await ann({ acronyms: ['PCA'], domains: ['ml'] })).PCA.gloss, '주성분 분석');
  // 낱말과 함께
  const both = await ann({ words: ['payload'], acronyms: ['SVM'], domains: ['ml'] });
  assert.deepEqual(Object.keys(both).sort(), ['SVM', 'payload']);
}));

test('/annotate acronyms: 모양 검증(배열·문자열), 철자 틀린 것은 조용히 버림, 100개까지, 101개는 413', withBridge(async (s) => {
  const post = (acronyms) => s.post('/annotate', { words: [], acronyms, domains: ['ml'] });
  for (const bad of ['PCA', {}, [1], [null]]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  assert.deepEqual((await post(['pca', 'P', 'PCAAAAA', 'P-CA', 'PCA'])).json().items, { PCA: { lemma: 'pca', gloss: '주성분 분석', term: true, domain: 'ml', acronym: true } });
  const many = Array.from({ length: 101 }, (_, i) => 'A' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)));
  assert.equal((await post(many)).status, 413);
  assert.equal((await post(many.slice(0, 100))).status, 200);
}));

test('/dict: 약어(전부 대문자 2~6자)는 acronym 풀이(분야와 무관), 내 사전이 있으면 mine 이 함께, 낱말도 mine', withBridge(async (s) => {
  const dict = async (word) => (await s.post('/dict', { word })).json();
  const r = await dict('PCA');
  assert.deepEqual(r.acronym, { exp: 'Principal Component Analysis', ko: '주성분 분석' });
  assert.equal('mine' in r, false);
  assert.equal('acronym' in (await dict('Pca')), false);
  assert.equal('acronym' in (await dict('pca')), false);
  assert.equal('acronym' in (await dict('payload')), false);
  await setMine(s, 'pca', '내 뜻', { exp: '내 풀이', note: '메모' });
  const m = await dict('PCA');
  assert.deepEqual(m.mine, { ko: '내 뜻', exp: '내 풀이', note: '메모' });
  assert.deepEqual(m.acronym, r.acronym);
  assert.equal(m.found, false);
  await setMine(s, 'payload', '페이로드');
  const p = await dict('payloads');
  assert.deepEqual(p.mine, { ko: '페이로드' });
  assert.equal(p.found, false); // fake 사전엔 복수형이 없다
  assert.deepEqual((await dict('payload')).mine, { ko: '페이로드' });
  assert.equal((await dict('payload')).gloss, '수익 하중'); // 사전 뜻은 그대로, mine 이 따로
}));

test('/mt: 글 전체가 내 사전 키와 같으면 mine 을 싣는다(구도), 아니면 안 싣는다, 맥 번역이 실패해도 내 뜻은 답한다', withBridge(async (s) => {
  const mt = async (text) => s.post('/mt', { text });
  assert.equal('mine' in (await mt('PCA')).json(), false);
  await setMine(s, 'pca', '주성분 분석', { exp: 'Principal Component Analysis' });
  await setMine(s, 'principal component analysis', '주성분 분석(구)');
  const a = (await mt('PCA.')).json();
  assert.deepEqual(a.mine, { ko: '주성분 분석', exp: 'Principal Component Analysis' });
  assert.equal(a.engine, 'apple');
  assert.match(a.translation, /^번역\d+:PCA\.$/);
  assert.equal((await mt(' Principal  Component\nAnalysis ')).json().mine.ko, '주성분 분석(구)');
  assert.equal('mine' in (await mt('principal component')).json(), false);
  assert.equal('mine' in (await mt('PCA is useful')).json(), false);
  assert.equal((await mt('FAIL')).status, 502);
  await setMine(s, 'fail', '내 실패 뜻');
  const f = await mt('FAIL');
  assert.equal(f.status, 200);
  assert.deepEqual(f.json(), { translation: '내 실패 뜻', engine: 'mydict', mine: { ko: '내 실패 뜻' } });
}));

test('용어 지정: 내 사전 키가 본문에 나오면 /translate·/translate-context·/lookup 프롬프트에 지정 번역어로(내 사전이 용어집보다 앞)', withBridge(async (s) => {
  await setMine(s, 'pca', '주성분 분석');
  await setMine(s, 'transpose', '내 전치');
  const text = 'Run PCA and transpose the matrix.';
  await s.post('/translate', { text, domains: ['math'] });
  const terms = s.asked.translate[0].terms;
  assert.deepEqual(terms.slice(0, 2), ['pca=주성분 분석', 'transpose=내 전치']); // 내 사전이 먼저(글에 나온 순서)
  assert.equal(terms.filter((t) => t.startsWith('transpose=')).length, 1); // 용어집의 transpose 는 가려진다
  assert.ok(terms.some((t) => t.startsWith('matrix=')), '용어집 용어도 그대로');
  await s.post('/translate-context', { text, context: { before: 'b' }, domains: ['math'] });
  assert.match(s.asked.context[0], /용어 지정: pca=주성분 분석, transpose=내 전치/);
  await s.post('/lookup', { word: 'pca', sentence: 'We run PCA first.' });
  assert.deepEqual(s.asked.lookup[0].terms, ['pca=주성분 분석']);
  await s.post('/lookup', { word: 'payload', sentence: 'A payload.' });
  assert.equal('terms' in s.asked.lookup[1], false); // 내 사전 키가 없으면 예전과 같은 요청
}));

test('용어 지정 캐시: 내 사전이 바뀌면 같은 글도 다시 묻고, 안 바뀌면 캐시에서', withBridge(async (s) => {
  const text = 'Run PCA on the data.';
  const calls = () => s.asked.translate.length + s.asked.context.length + s.asked.lookup.length;
  const all = async () => {
    await s.post('/translate', { text });
    await s.post('/translate-context', { text, context: { before: 'b' } });
    await s.post('/lookup', { word: 'run', sentence: text });
  };
  await all();
  assert.equal(calls(), 3);
  await all();
  assert.equal(calls(), 3); // 캐시
  await setMine(s, 'pca', '주성분 분석');
  await all();
  assert.equal(calls(), 6); // 키가 달라졌다
  await all();
  assert.equal(calls(), 6);
  await setMine(s, 'pca', '다른 뜻');
  await all();
  assert.equal(calls(), 9);
  await s.post('/mydict', { op: 'delete', key: 'pca' });
  await all();
  assert.equal(calls(), 9); // 내 사전이 없어지면 처음 키로 돌아가 캐시에 있다
}));
