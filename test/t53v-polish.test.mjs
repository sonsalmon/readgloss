// 과제 T53v(변경 기록 28-17): 자동 자막 다듬기 — 번호 검사·줄 시각, 다리 /video/polish 정상·엉터리·시간 초과·캐시.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { AiTimeoutError } from '../bridge/claude-client.mjs';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const ID = 'dQw4w9WgXcQ';
const WORDS = [{ t: 0, w: 'hello' }, { t: 0.3, w: 'there' }, { t: 1, w: 'again' }];

test('validPolish: 0..n-1 을 빠짐·겹침 없이 덮어야 한다', () => {
  assert.equal(V.validPolish([{ from: 0, to: 1, text: 'Hello there.' }, { from: 2, to: 2, text: 'Again.' }], 3), true);
  assert.equal(V.validPolish([{ from: 0, to: 0, text: 'a' }, { from: 2, to: 2, text: 'b' }], 3), false, '낱말이 빠짐');
  assert.equal(V.validPolish([{ from: 0, to: 1, text: 'a' }, { from: 1, to: 2, text: 'b' }], 3), false, '겹침');
  assert.equal(V.validPolish([{ from: 0, to: 3, text: 'a' }], 3), false, '범위 밖');
  assert.equal(V.validPolish([{ from: 1, to: 2, text: 'a' }], 3), false, '처음 번호가 0 이 아님');
  assert.equal(V.validPolish([{ from: 0, to: 2, text: '' }], 3), false, '빈 글');
  assert.equal(V.validPolish([], 3), false);
  assert.equal(V.validPolish([{ from: 0, to: 0.5, text: 'a' }], 3), false, '정수가 아님');
  assert.equal(V.validPolish([{ from: 0, to: 2, text: 'a' }], 0), false);
});

test('polishedCues: 시작은 첫 낱말, 끝은 다음 줄 첫 낱말(1초 안) 또는 마지막 낱말 + 1초', () => {
  const words = [{ t: 1, w: 'So' }, { t: 1.3, w: 'it' }, { t: 1.6, w: 'begins.' }, { t: 5, w: 'Next' }, { t: 5.3, w: 'part' }];
  const lines = [{ from: 0, to: 2, text: 'So it begins.' }, { from: 3, to: 4, text: 'Next part.' }];
  assert.deepEqual(V.polishedCues(words, lines), [
    { start: 1, end: 2.6, text: 'So it begins.' },
    { start: 5, end: 6.3, text: 'Next part.' },
  ]);

  const near = [{ t: 1, w: 'a' }, { t: 1.3, w: 'b' }, { t: 1.8, w: 'c' }];
  assert.deepEqual(V.polishedCues(near, [{ from: 0, to: 1, text: 'a b' }, { from: 2, to: 2, text: 'c' }]), [
    { start: 1, end: 1.8, text: 'a b' },
    { start: 1.8, end: 2.8, text: 'c' },
  ]);
  assert.deepEqual(V.polishedCues(words, [{ from: 0, to: 1, text: 'x' }]), [], '번호가 모자라면 빈 목록');
});

test('parseTrack: 자동 생성 자막은 다듬기용 낱말 시각도 남긴다', () => {
  const body = JSON.stringify({
    events: [
      { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'so' }, { utf8: ' today', tOffsetMs: 300 }] },
      { tStartMs: 1600, dDurationMs: 3000, segs: [{ utf8: ' we' }, { utf8: ' talk', tOffsetMs: 200 }] },
    ],
  });
  const tr = V.parseTrack(body, `https://www.youtube.com/api/timedtext?v=${ID}&lang=en&kind=asr&fmt=json3`);
  assert.equal(tr.kind, 'asr');
  assert.deepEqual(tr.words, [{ t: 1, w: 'so' }, { t: 1.3, w: 'today' }, { t: 1.6, w: 'we' }, { t: 1.8, w: 'talk' }]);
});

async function startPolishBridge(askPolish) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t53v-'));
  const asked = [];
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askTranslate: async () => '{"translation":"번역"}',
    askContext: async () => '{"translation":"문맥 번역"}',
    askPolish: async (prompt) => (asked.push(prompt), askPolish(prompt)),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict: { lookup: async () => ({ found: false, entries: [] }), close() {} },
    mt: { translate: async () => '', close() {} },
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const post = (path, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Host: HOST, 'X-Bridge-Token': token, Origin: MINE, 'Content-Type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(text) }));
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
  return { asked, post, close: () => bridge.close() };
}

test('/video/polish: 가짜 AI 의 정상 줄을 돌려주고 두 번째는 캐시에서 답한다(다시 묻지 않음)', async () => {
  const s = await startPolishBridge(async () => JSON.stringify({ lines: [{ from: 0, to: 1, text: 'Hello there.' }, { from: 2, to: 2, text: 'Again.' }] }));
  try {
    const a = await s.post('/video/polish', { id: ID, words: WORDS });
    assert.equal(a.status, 200);
    assert.deepEqual(a.json(), { lines: [{ from: 0, to: 1, text: 'Hello there.' }, { from: 2, to: 2, text: 'Again.' }], cached: false });
    assert.equal(s.asked.length, 1);
    assert.match(s.asked[0], /낱말을 바꾸거나 빼지 말고/);
    assert.match(s.asked[0], /문장 단위/);

    const b = await s.post('/video/polish', { id: ID, words: WORDS });
    assert.equal(b.status, 200);
    assert.deepEqual(b.json().lines, a.json().lines);
    assert.equal(b.json().cached, true);
    assert.equal(s.asked.length, 1, '캐시가 있으면 AI 를 다시 부르지 않는다');
  } finally {
    await s.close();
  }
});

test('/video/polish: 낱말 번호가 겹치거나 빠진 결과는 버리고 502 bad-polish', async () => {
  for (const lines of [
    [{ from: 0, to: 1, text: 'Hello there.' }, { from: 1, to: 2, text: 'Again.' }], // 겹침
    [{ from: 0, to: 0, text: 'Hello.' }, { from: 2, to: 2, text: 'Again.' }], // 빠짐
    [{ from: 0, to: 9, text: 'Hello there again.' }], // 범위 밖
  ]) {
    const s = await startPolishBridge(async () => JSON.stringify({ lines }));
    try {
      const r = await s.post('/video/polish', { id: ID, words: WORDS });
      assert.equal(r.status, 502);
      assert.deepEqual(r.json(), { error: 'bad-polish' });
    } finally {
      await s.close();
    }
  }
});

test('/video/polish: AI 시간 초과는 504 timeout, 요청 모양·낱말 상한은 400/413', async () => {
  const slow = await startPolishBridge(async () => { throw new AiTimeoutError(); });
  try {
    const r = await slow.post('/video/polish', { id: ID, words: WORDS });
    assert.equal(r.status, 504);
    assert.deepEqual(r.json(), { error: 'timeout' });
  } finally {
    await slow.close();
  }

  const s = await startPolishBridge(async () => JSON.stringify({ lines: [{ from: 0, to: 2, text: 'ok' }] }));
  try {
    assert.equal((await s.post('/video/polish', { id: 'short', words: WORDS })).status, 400);
    assert.equal((await s.post('/video/polish', { id: ID, words: [] })).status, 400);
    assert.equal((await s.post('/video/polish', { id: ID, words: [{ t: '0', w: 'x' }] })).status, 400);
    const tooMany = Array.from({ length: 6001 }, (_, i) => ({ t: i / 10, w: 'a' }));
    assert.equal((await s.post('/video/polish', { id: ID, words: tooMany })).status, 413);
  } finally {
    await s.close();
  }
});
