import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { createDict, parseEntry } from '../bridge/dict.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const FAKE = new URL('../fixtures/fake-dict.mjs', import.meta.url).pathname;

// 가짜 사전: 도우미가 mitigations 에 표제어 mitigation 을 돌려주는 모양을 흉내 낸다. 나머지는 fixtures 의 가짜 도우미.
const real = createDict({ bin: process.execPath, args: [FAKE], timeoutMs: 10_000 });
const raw = 'mit·i·ga·tion | mìtəgéiʃən | 명사완화, 경감';
const mitigation = { found: true, entries: [{ ...parseEntry({ headword: 'mitigations', text: raw }), headword: 'mitigations' }] };
const dict = { lookup: (w) => (w === 'mitigations' ? Promise.resolve(mitigation) : real.lookup(w)), close: () => real.close() };

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-words-srv-'));
  const asked = [];
  const bridge = createBridge({
    ask: async (a) => (asked.push(a), '{"gloss":"뜻"}'),
    askTranslate: async (t) => (asked.push(t), '{"translation":"번역"}'),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict,
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, { headers = {}, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }));
      });
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });
  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  return { bridge, asked, dir, req, auth, words: (body) => req('POST', '/words', { headers: auth, body }), annotate: (body) => req('POST', '/annotate', { headers: auth, body }) };
}

test('/words: 토큰 없으면 401, 남의 Origin·잘못된 Host 는 403, 메서드는 GET·POST 만', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('GET', '/words')).status, 401);
    assert.equal((await s.req('POST', '/words', { body: { op: 'known', lemma: 'a' } })).status, 401);
    assert.equal((await s.req('GET', '/words', { headers: { ...s.auth, Origin: 'chrome-extension://evil' } })).status, 403);
    assert.equal((await s.req('POST', '/words', { headers: { ...s.auth, Host: 'evil.test' }, body: { op: 'known', lemma: 'ab' } })).status, 403);
    assert.equal((await s.req('DELETE', '/words', { headers: s.auth })).status, 405);
    assert.equal((await s.req('PUT', '/words', { headers: s.auth, body: {} })).status, 405);
    assert.equal(existsSync(join(s.dir, 'words.json')), false);
  } finally {
    await s.bridge.close();
  }
});

test('/words: 깨진 본문·모르는 op·잘못된 원형·http(s) 아닌 주소는 400, 24KB 초과 본문은 413', async () => {
  const s = await start();
  try {
    assert.equal((await s.req('POST', '/words', { headers: s.auth, raw: 'not json' })).status, 400);
    for (const body of [null, {}, { op: 'known' }, { op: 'drop', lemma: 'ab' }, { op: 'known', lemma: '1ab' }, { op: 'known', lemma: ['ab'] }, { op: 'save', lemma: 'ab', url: 'javascript:alert(1)' }, { op: 'save', lemma: 'ab', word: 'a b' }]) {
      assert.equal((await s.words(body)).status, 400, JSON.stringify(body));
    }
    // 본문 상한이 24KB 로 늘어 16~24KB 는 본문을 받는다(내용이 틀리면 413 이 아니라 400), 24KB 를 넘으면 413
    assert.equal((await s.words({ op: 'nope', lemma: 'ab', sentence: 'x'.repeat(20_000) })).status, 400);
    assert.equal((await s.req('POST', '/words', { headers: s.auth, raw: 'x'.repeat(24 * 1024 + 1) })).status, 413);
    assert.deepEqual((await s.req('GET', '/words', { headers: s.auth })).json(), { known: {}, saved: {}, history: [], phrases: {} });
  } finally {
    await s.bridge.close();
  }
});

test('/words: GET 은 셋 다, POST 는 바뀐 전체 상태를 돌려주고 words.json 에 저장한다(AI 호출 0번)', async () => {
  const s = await start();
  try {
    assert.deepEqual((await s.req('GET', '/words', { headers: s.auth })).json(), { known: {}, saved: {}, history: [], phrases: {} });
    const a = await s.words({ op: 'save', lemma: 'Mitigation', word: 'mitigations', gloss: '완화', sentence: 'Apply mitigations.', url: 'https://a.test/p' });
    assert.equal(a.status, 200);
    assert.equal(a.headers['access-control-allow-origin'], MINE);
    assert.deepEqual(Object.keys(a.json().saved), ['mitigation']);
    assert.equal(a.json().saved.mitigation.gloss, '완화');
    const b = await s.words({ op: 'known', lemma: 'payload' });
    assert.deepEqual(Object.keys(b.json().known), ['payload']);
    assert.deepEqual(Object.keys(b.json().saved), ['mitigation']);
    const c = await s.words({ op: 'history', lemma: 'payload', word: 'payload', gloss: '수익 하중' });
    assert.deepEqual(c.json().history.map((h) => h.lemma), ['payload']);
    assert.deepEqual((await s.req('GET', '/words', { headers: s.auth })).json(), c.json());
    assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'words.json'), 'utf8')), c.json());
    assert.deepEqual(Object.keys((await s.words({ op: 'unsave', lemma: 'mitigation' })).json().saved), []);
    assert.deepEqual(Object.keys((await s.words({ op: 'unknown', lemma: 'payload' })).json().known), []);
    assert.equal(s.asked.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 아는 단어(원형 기준)는 빠지고, 알아요 취소하면 바로 다시 나온다', async () => {
  const s = await start();
  try {
    const has = async (w) => Object.hasOwn((await s.annotate({ words: [w, 'payload'], level: 'A2' })).json().items, w);
    assert.equal(await has('mitigations'), true);
    await s.words({ op: 'known', lemma: 'mitigation' });
    assert.equal(await has('mitigations'), false);
    assert.equal(await has('payload'), true); // 다른 단어는 그대로
    await s.words({ op: 'unknown', lemma: 'mitigation' });
    assert.equal(await has('mitigations'), true);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: level C2 는 200(목록 밖 단어는 나온다), 모르는 등급은 400', async () => {
  const s = await start();
  try {
    const r = await s.annotate({ words: ['payload', 'privilege'], level: 'C2' });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json().items), ['payload']); // privilege 는 B2 라 C2 기준에선 쉬움
    assert.equal((await s.annotate({ words: ['payload'], level: 'C3' })).status, 400);
  } finally {
    await s.bridge.close();
  }
});

test('/dict: 원형 lemma 와 짧은 뜻 gloss 를 더해 준다(mitigations -> mitigation, 악센트 표제어 payload, 없는 단어는 소문자 그대로)', async () => {
  const s = await start();
  try {
    const d = async (word) => (await s.req('POST', '/dict', { headers: s.auth, body: { word } })).json();
    const m = await d('mitigations');
    assert.deepEqual([m.found, m.lemma, m.gloss], [true, 'mitigation', '완화']);
    assert.equal(m.entries[0].headword, 'mitigations'); // 기존 응답은 그대로
    const p = await d('payload');
    assert.deepEqual([p.lemma, p.gloss], ['payload', '수익 하중']);
    assert.deepEqual(await d('Deserialize'), { found: false, lemma: 'deserialize' });
  } finally {
    await s.bridge.close();
  }
});

test('/words memo: 단어·구에 붙고 ts 유지, 응답 모양(단어 전체 상태·구 {id, phrases}), 없는 대상 404, 1000자 초과 400, 공부 기록 없음', async () => {
  const s = await start();
  try {
    await s.words({ op: 'save', lemma: 'mitigation', word: 'mitigations', gloss: '완화' });
    const ts = (await s.req('GET', '/words', { headers: s.auth })).json().saved.mitigation.ts;
    const m = await s.words({ op: 'memo', lemma: 'Mitigation', memo: '모듈 290' });
    assert.equal(m.status, 200);
    assert.deepEqual(Object.keys(m.json()).sort(), ['history', 'known', 'phrases', 'saved']); // 단어는 전체 상태
    assert.equal(m.json().saved.mitigation.memo, '모듈 290');
    assert.equal(m.json().saved.mitigation.ts, ts); // ts 는 그대로
    await s.words({ op: 'save', lemma: 'mitigation', word: 'mitigation', gloss: '경감' }); // 재저장해도 메모는 남는다
    assert.equal((await s.req('GET', '/words', { headers: s.auth })).json().saved.mitigation.memo, '모듈 290');
    assert.equal('memo' in (await s.words({ op: 'memo', lemma: 'mitigation', memo: '' })).json().saved.mitigation, false); // '' 이면 삭제
    // 없는 단어 -> 404 not-found
    const miss = await s.words({ op: 'memo', lemma: 'nope', memo: 'x' });
    assert.equal(miss.status, 404);
    assert.deepEqual(miss.json(), { error: 'not-found' });
    // 구: 저장 -> 메모
    const id = (await s.words({ op: 'save-phrase', text: 'Apply the patch.', translation: '패치를 적용한다.' })).json().id;
    const pm = await s.words({ op: 'memo', id, memo: '구 메모' });
    assert.equal(pm.status, 200);
    assert.deepEqual(Object.keys(pm.json()).sort(), ['id', 'phrases']); // 구는 { id, phrases }
    assert.equal(pm.json().id, id);
    assert.equal(pm.json().phrases[id].memo, '구 메모');
    assert.equal((await s.words({ op: 'memo', id: 'ffffffffffff', memo: 'x' })).status, 404); // 없는 구
    // 길이 초과는 자르지 않고 400
    assert.equal((await s.words({ op: 'memo', lemma: 'mitigation', memo: 'x'.repeat(1001) })).status, 400);
    assert.equal(s.asked.length, 0); // 메모는 AI 를 안 부른다
    // 공부 기록을 남기지 않는다: 앞선 save 기록은 그대로, 메모만 더하면 줄 수가 늘지 않는다
    const logsBefore = readFileSync(join(s.dir, 'study-log.jsonl'), 'utf8');
    await s.words({ op: 'memo', lemma: 'mitigation', memo: '마지막 메모' });
    await s.words({ op: 'memo', id, memo: '마지막 구 메모' });
    assert.equal(readFileSync(join(s.dir, 'study-log.jsonl'), 'utf8'), logsBefore);
  } finally {
    await s.bridge.close();
  }
});

// 실제 맥 사전 도우미 실연동(darwin + native/macdict 가 있을 때만)
const bin = new URL('../native/macdict', import.meta.url).pathname;
const skip = process.platform !== 'darwin' || !existsSync(bin) ? '맥이 아니거나 npm run build:dict 를 안 했어요' : false;

test('실연동: /dict mitigations -> lemma mitigation, 알아요 뒤 /annotate 에서 빠졌다가 취소하면 다시 나온다', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-words-live-'));
  const bridge = createBridge({ ask: async () => '', askTranslate: async () => '', cacheFile: join(dir, 'cache.json'), tokenFile: join(dir, 'token'), extensionId: EXT, dict: createDict() });
  const port = await bridge.listen(0);
  const headers = { Host: HOST, 'X-Bridge-Token': readFileSync(join(dir, 'token'), 'utf8') };
  const post = (path, body) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve(JSON.parse(t)));
      });
      r.on('error', reject);
      r.end(JSON.stringify(body));
    });
  try {
    assert.equal((await post('/dict', { word: 'mitigations' })).lemma, 'mitigation');
    const has = async () => Object.hasOwn((await post('/annotate', { words: ['mitigations'], level: 'A2' })).items, 'mitigations');
    assert.equal(await has(), true);
    await post('/words', { op: 'known', lemma: 'mitigation' });
    assert.equal(await has(), false);
    await post('/words', { op: 'unknown', lemma: 'mitigation' });
    assert.equal(await has(), true);
  } finally {
    await bridge.close();
  }
});
