// 과제 T53f(변경 기록 28-9): 칠하기 구간·낱말 색·숙어 덩어리, 다리 /annotate 의 minP·p.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { createDict } from '../bridge/dict.mjs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;

test('bandOf: 0.35·0.65 경계', () => {
  assert.equal(V.bandOf(0), 'easy');
  assert.equal(V.bandOf(0.349), 'easy');
  assert.equal(V.bandOf(0.35), 'medium');
  assert.equal(V.bandOf(0.649), 'medium');
  assert.equal(V.bandOf(0.65), 'hard');
  assert.equal(V.bandOf(1), 'hard');
  assert.equal(V.bandOf(null), null, '확률이 없으면 구간도 없다');
  assert.equal(V.bandOf(Number.NaN), null);
});

test('minPFor: 고른 구간 중 가장 낮은 경계, 아무것도 안 고르면 null', () => {
  assert.equal(V.minPFor({ easy: false, medium: true, hard: true }), 0.35, '기본(보통 이상)');
  assert.equal(V.minPFor({ easy: false, medium: false, hard: true }), 0.65);
  assert.equal(V.minPFor({ easy: true, medium: false, hard: false }), 0);
  assert.equal(V.minPFor({ easy: true, medium: true, hard: true }), 0);
  assert.equal(V.minPFor({ easy: true, medium: false, hard: true }), 0);
  assert.equal(V.minPFor({ easy: false, medium: false, hard: false }), null, '칠 안 함');
  assert.equal(V.minPFor({}), null);
  assert.equal(V.minPFor(null), null);
});

test('tokenColor: 우선순위 초록 > 주황 > ✓, 알아요는 칠 없음, 구간 밖은 ✓만', () => {
  const bands = { easy: false, medium: true, hard: true };
  assert.equal(V.tokenColor({ p: 0.4, bands, saved: false, done: false, known: false }), 'orange');
  assert.equal(V.tokenColor({ p: 0.4, bands, saved: true, done: false, known: false }), 'orange', '주황이 ✓보다 앞');
  assert.equal(V.tokenColor({ p: 0.4, bands, saved: true, done: true, known: false }), 'green', '초록이 맨 앞');
  assert.equal(V.tokenColor({ p: 0.1, bands, saved: true, done: false, known: false }), 'check', '쉬운 구간은 ✓');
  assert.equal(V.tokenColor({ p: 0.4, bands: { easy: false, medium: false, hard: false }, saved: true }), 'check');
  assert.equal(V.tokenColor({ p: 0.4, bands, saved: false, done: false, known: true }), null, '알아요');
  assert.equal(V.tokenColor({ p: 0.4, bands: { easy: true, medium: false, hard: false }, saved: false, done: false }), null, '고른 구간 밖이고 저장 안 됨');
  assert.equal(V.tokenColor({ p: null, bands, saved: true }), 'check');
  assert.equal(V.tokenColor(), null);
});

test('phraseSpans: 대소문자·문장부호를 무시하고, 겹치면 앞·긴 것을 고른다', () => {
  const text = 'She gave up on the plan, but he did not give up.';
  const tokens = V.tokenize(text);
  const spans = V.phraseSpans(tokens, {
    a: { text: 'GAVE UP!' },
    b: { text: 'up on the' },
    c: { text: 'give up' },
  });
  const words = tokens.filter((tk) => tk.w).map((tk) => tk.lower);
  assert.deepEqual(spans.map((s) => [s.start, s.end]), [
    [tokens.findIndex((tk) => tk.w && tk.lower === 'gave'), tokens.findIndex((tk) => tk.w && tk.lower === 'up')],
    [tokens.findIndex((tk) => tk.w && tk.lower === 'give'), tokens.findIndex((tk) => tk.w && tk.lower === 'give') + 2],
  ], '두 번째 give up 은 문장부호 뒤에서도 찾는다');
  assert.equal(words[0], 'she');
});

test('phraseSpans: 8낱말은 받고 9낱말은 무시, 복습 끝 표시는 숨은 속성', () => {
  const tokens = V.tokenize('one two three four five six seven eight nine');
  const eight = V.phraseSpans(tokens, { p: { text: 'ONE two three four five six seven eight!', review: { done: false } } });
  assert.equal(eight.length, 1);
  assert.equal(eight[0].start, 0);
  assert.equal(tokens[eight[0].end].lower, 'eight');
  assert.equal(eight[0].done, false);
  assert.deepEqual(eight[0], { start: 0, end: 14 }, '범위만 보는 deepEqual 에는 숨은 속성이 안 나온다');
  const nine = V.phraseSpans(tokens, { p: { text: 'one two three four five six seven eight nine' } });
  assert.deepEqual(nine, []);
  assert.deepEqual(V.phraseSpans(tokens, { p: { text: 'three four', review: { done: true } } }).map((s) => s.done), [true]);
  assert.deepEqual(V.phraseSpans(tokens, {}), []);
  assert.deepEqual(V.phraseSpans(null, null), []);
});

test('설정: video.wordBands 기본 보통 이상, video.idioms 기본 켬', () => {
  assert.deepEqual(S.DEFAULTS.video.wordBands, { easy: false, medium: true, hard: true });
  assert.equal(S.DEFAULTS.video.idioms, true);
  assert.deepEqual(S.normalize({}).video.wordBands, { easy: false, medium: true, hard: true });
  assert.deepEqual(S.normalize({ video: { wordBands: { easy: true } } }).video.wordBands, { easy: true, medium: true, hard: true });
  assert.deepEqual(S.normalize({ video: { wordBands: { easy: 1, medium: 'yes', hard: false } } }).video.wordBands, { easy: false, medium: true, hard: false });
  assert.equal(S.normalize({ video: { idioms: false } }).video.idioms, false);
  assert.equal(S.merge({}, { video: { wordBands: { hard: false } } }).video.wordBands.medium, true, '한 칸만 바꿔도 나머지는 그대로');
});

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const FAKE = new URL('../fixtures/fake-dict.mjs', import.meta.url).pathname;

async function startBridge() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t53f-'));
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askTranslate: async () => '{"translation":"번역"}',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict: createDict({ bin: process.execPath, args: [FAKE], timeoutMs: 10_000 }),
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, { headers = {}, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) }));
      });
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });
  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  return { bridge, post: (body) => req('POST', '/annotate', { headers: auth, body }) };
}

test('/annotate: minP 가 있으면 기준을 바꾸고 응답마다 p(소수 둘째 자리)를 붙인다', async () => {
  const s = await startBridge();
  try {
    const at = (await s.post({ words: ['privilege'], minP: 0.35 })).json();
    assert.deepEqual(at.items.privilege, { lemma: 'privilege', level: 'B2', gloss: '특권', p: 0.35 });
    assert.equal((await s.post({ words: ['privilege'], minP: 0.36 })).json().items.privilege, undefined, '기준 아래면 응답에서 빠진다');
    const any = (await s.post({ words: ['payload'], minP: 0 })).json();
    assert.equal(any.items.payload.p, 0.72);
    const high = (await s.post({ words: ['payload'], minP: 0.72 })).json();
    assert.equal(high.items.payload.p, 0.72, '기준과 같으면 들어온다');
    assert.equal((await s.post({ words: ['payload'], minP: 0.73 })).json().items.payload, undefined);
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: minP 가 없으면 응답이 예전과 같다(p 없음)', async () => {
  const s = await startBridge();
  try {
    const r = await s.post({ words: ['payload', 'mitigate'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), {
      items: {
        payload: { lemma: 'payload', level: null, gloss: '수익 하중' },
        mitigate: { lemma: 'mitigate', level: null, gloss: '완화시키다' },
      },
    });
  } finally {
    await s.bridge.close();
  }
});

test('/annotate: 잘못된 minP 는 400', async () => {
  const s = await startBridge();
  try {
    for (const bad of [-0.1, 1.1, '0.5', null, [], true]) {
      const r = await s.post({ words: ['payload'], minP: bad });
      assert.equal(r.status, 400, String(bad));
    }
    assert.equal((await s.post({ words: ['payload'], minP: 0 })).status, 200);
    assert.equal((await s.post({ words: ['payload'], minP: 1 })).status, 200);
  } finally {
    await s.bridge.close();
  }
});
