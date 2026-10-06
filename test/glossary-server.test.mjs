import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { buildTranslatePrompt, createTranslate, textKey } from '../bridge/translate.mjs';

// 분야 용어집이 /annotate·/dict·/translate 에 끼는 자리. 진짜 사전·claude 는 부르지 않는다(가짜 dict 객체와 가짜 ask).
const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const HTB = 'academy.hackthebox.com';

const entry = (headword, gloss) => ({ headword, raw: `${headword} | x | ${gloss}`, senses: [{ text: gloss }] });
const DICT = {
  transpose: entry('transpose', '뒤바꾸다'),
  transposed: entry('transpose', '뒤바꾸다'),
  normalized: entry('normalize', '정상화하다'),
  payload: entry('payload', '수익 하중'),
  kernel: entry('kernel', '알맹이'),
  vector: entry('vector', '매개체'),
  root: entry('root', '뿌리'),
  mitigate: entry('mitigate', '완화시키다'),
  constructor: entry('constructor', '건설자'),
};
function fakeDict() {
  const calls = [];
  return { calls, lookup: async (w) => (calls.push(w), DICT[w] ? { found: true, entries: [DICT[w]] } : { found: false }), close() {} };
}

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-glos-'));
  const dict = fakeDict();
  const prompts = [];
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askTranslate: async (text, terms) => (prompts.push({ text, terms }), `{"translation":"번역${prompts.length}"}`),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict,
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const post = (path, body) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Host: HOST, 'X-Bridge-Token': token, Origin: MINE } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) }));
      });
      r.on('error', reject);
      r.end(JSON.stringify(body));
    });
  return { bridge, dict, prompts, post };
}
const items = async (s, body) => (await s.post('/annotate', body)).json.items;

test('/annotate: host 도 domains 도 없으면 지금과 같다(사전 뜻 그대로, term 없음)', async () => {
  const s = await start();
  try {
    assert.deepEqual(await items(s, { words: ['transpose'] }), { transpose: { lemma: 'transpose', level: null, gloss: '뒤바꾸다' } });
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: HTB 에서는 transpose 가 전치 계열(용어집 뜻 + term:true + domain)', async () => {
  const s = await start();
  try {
    const it = await items(s, { words: ['transpose', 'payload', 'mitigate'], host: HTB });
    assert.equal(it.transpose.gloss, '전치(행렬)');
    assert.equal(it.transpose.term, true);
    assert.equal(it.transpose.domain, 'math');
    assert.equal(it.transpose.lemma, 'transpose');
    assert.equal(it.payload.gloss, '페이로드');
    assert.equal(it.payload.domain, 'security');
    assert.deepEqual(it.mitigate, { lemma: 'mitigate', level: null, gloss: '완화시키다' }, '용어집에 없는 단어는 사전 뜻 그대로');
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 일반 사이트라도 domains 힌트(math)가 오면 수학 용어집, 힌트 없으면 아님', async () => {
  const s = await start();
  try {
    assert.equal((await items(s, { words: ['transpose'], host: 'example.com', domains: ['math'] })).transpose.gloss, '전치(행렬)');
    assert.equal((await items(s, { words: ['transpose'], host: 'example.com' })).transpose.gloss, '뒤바꾸다');
    assert.equal((await items(s, { words: ['payload'], host: 'example.com', domains: ['math'] })).payload.gloss, '수익 하중', '켜지지 않은 분야(보안)는 안 쓴다');
  } finally {
    await s.bridge.close();
  }
});

test('/annotate 캐시 분리: 같은 단어가 도메인 조합에 따라 다르게, 되돌려도 섞이지 않는다', async () => {
  const s = await start();
  try {
    const a = async (extra) => (await items(s, { words: ['kernel', 'root'], level: 'A2', ...extra }));
    const plain = await a({});
    const math = await a({ domains: ['math'] });
    const sec = await a({ host: HTB });
    const mathFirst = await a({ host: HTB, domains: ['math'] });
    assert.equal(plain.root.gloss, '뿌리');
    assert.equal(math.root.gloss, '근(루트)');
    assert.equal(sec.root.gloss, '루트(최고 권한)');
    assert.equal(mathFirst.root.gloss, '근(루트)');
    assert.equal(mathFirst.kernel.gloss, '핵(커널)');
    assert.equal(sec.kernel.gloss, '커널');
    assert.equal((await a({})).root.gloss, '뿌리');
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 용어집 단어도 수준·아는 단어 규칙은 그대로(쉬운 단어는 빠진다), 복수·활용형도 원형으로', async () => {
  const s = await start();
  try {
    const it = await items(s, { words: ['function', 'matrices', 'normalized', 'eigenvalues'], host: HTB, level: 'C1' });
    assert.equal(it.function, undefined, 'function 은 A2 라 C1 에서 빠진다');
    assert.deepEqual(it.matrices, { lemma: 'matrix', level: null, gloss: '행렬', term: true, domain: 'math' });
    assert.equal(it.normalized.gloss, '정규화');
    assert.equal(it.normalized.lemma, 'normalize');
    assert.equal(it.eigenvalues.gloss, '고윳값');
    assert.equal((await items(s, { words: ['function'], host: HTB, level: 'A2' })).function.gloss, '함수');
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 모르는 단어 목록 위반은 그대로 400, host·domains 가 이상해도 에러가 아니다', async () => {
  const s = await start();
  try {
    assert.equal((await s.post('/annotate', { words: ['transpose'], host: 7, domains: 'math' })).status, 200);
    assert.equal((await s.post('/annotate', { words: 'x', host: HTB })).status, 400);
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 용어집에 있는 원형이면 term:{ko, domain}, 없으면 필드 없음', async () => {
  const s = await start();
  try {
    const hit = (await s.post('/dict', { word: 'transposed', host: HTB })).json;
    assert.equal(hit.lemma, 'transpose');
    assert.deepEqual(hit.term, { ko: '전치(행렬)', domain: 'math' });
    const none = (await s.post('/dict', { word: 'transpose' })).json;
    assert.equal('term' in none, false);
    const miss = (await s.post('/dict', { word: 'eigenvectors', host: HTB })).json; // 사전에 없어도 용어집은 답한다
    assert.equal(miss.found, false);
    assert.deepEqual(miss.term, { ko: '고유벡터', domain: 'math' });
    assert.equal('term' in (await s.post('/dict', { word: 'mitigate', host: 'example.com' })).json, false);
  } finally {
    await s.bridge.close();
  }
});

test('/translate: 문단에 나온 용어집 단어를 용어 지정으로 ask 에 넘기고, 도메인이 다르면 캐시도 다르다', async () => {
  const s = await start();
  try {
    const text = 'The transpose of a matrix swaps rows and columns.';
    assert.equal((await s.post('/translate', { text })).json.translation, '번역1');
    assert.deepEqual(s.prompts[0].terms, []);
    const htb = (await s.post('/translate', { text, host: HTB })).json;
    assert.equal(htb.cached, false, '도메인 조합이 다르면 같은 문단도 새로 번역한다');
    assert.ok(s.prompts[1].terms.includes('transpose=전치(행렬)'));
    assert.ok(s.prompts[1].terms.includes('matrix=행렬'));
    assert.equal((await s.post('/translate', { text, host: HTB })).json.cached, true);
    assert.equal((await s.post('/translate', { text })).json.cached, true);
    assert.equal(s.prompts.length, 2);
  } finally {
    await s.bridge.close();
  }
});

test('번역 프롬프트: 용어 지정 줄은 있을 때만, 입력 JSON 은 항상 마지막 줄', () => {
  const plain = buildTranslatePrompt('hello');
  assert.doesNotMatch(plain, /용어 지정/);
  const withTerms = buildTranslatePrompt('hello', ['transpose=전치(행렬)', 'matrix=행렬']);
  assert.match(withTerms, /용어 지정: transpose=전치\(행렬\), matrix=행렬/);
  assert.equal(withTerms.split('\n').at(-1), '{"text":"hello"}');
  assert.equal(plain.split('\n').at(-1), '{"text":"hello"}');
});

test('createTranslate: 캐시 키에 도메인 조합이 들어가고, 없으면 예전 키 그대로', async () => {
  assert.equal(textKey('a  b'), textKey('a b'));
  assert.equal(textKey('a b', ''), textKey('a b'));
  assert.notEqual(textKey('a b', 'math'), textKey('a b'));
  assert.notEqual(textKey('a b', 'math'), textKey('a b', 'security,math'));
  const store = new Map();
  const asked = [];
  const t = createTranslate({ cache: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, ask: async (text, terms) => (asked.push(terms), '{"translation":"x"}') });
  await t({ text: 'a b' });
  await t({ text: 'a b', domainsKey: 'math', terms: ['a=가'] });
  await t({ text: 'a b', domainsKey: 'math', terms: ['a=가'] });
  assert.deepEqual(asked, [[], ['a=가']]);
});

test('constructor 같은 상속 속성 이름은 용어가 아니다: 사전 뜻이 그대로 나오고 번역 용어 지정에도 안 실린다', async () => {
  const s = await start();
  try {
    const it = await items(s, { words: ['constructor'], host: HTB });
    assert.deepEqual(it.constructor, { lemma: 'constructor', level: null, gloss: '건설자' });
    assert.equal('term' in (await s.post('/dict', { word: 'constructor', host: HTB })).json, false);
    await s.post('/translate', { text: 'call the constructor of the vector', host: HTB });
    assert.deepEqual(s.prompts.at(-1).terms, ['vector=벡터']);
  } finally {
    await s.bridge.close();
  }
});
