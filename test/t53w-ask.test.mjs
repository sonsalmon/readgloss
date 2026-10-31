// 과제 T53w(변경 기록 28-18): 지금 줄에 묻기 — 다리 /ask 검사·캐시·실패 문구, 확장 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { AiError, AiTimeoutError } from '../bridge/claude-client.mjs';
import { MAX_ASK_QUESTION, MAX_ASK_SELECTION, askKey, buildAskPrompt, parseAskRequest } from '../bridge/ask.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const SYSTEM = '질문에 한국어로 1~3문장, 질문을 되풀이하지 말 것';

test('parseAskRequest: selection 1~600자·question 1~200자·문맥 길이를 검사한다', () => {
  assert.deepEqual(parseAskRequest({ selection: '  So it begins. ', question: '  왜 시작이라고 해?  ' }), {
    selection: 'So it begins.',
    question: '왜 시작이라고 해?',
    context: null,
  });
  assert.equal(parseAskRequest({ selection: 'a'.repeat(MAX_ASK_SELECTION), question: 'q' }).selection.length, 600);
  assert.deepEqual(parseAskRequest({ selection: 'a'.repeat(MAX_ASK_SELECTION + 1), question: 'q' }), { error: 'bad-request' });
  assert.equal(parseAskRequest({ selection: 'a', question: 'q'.repeat(MAX_ASK_QUESTION) }).question.length, 200);
  assert.deepEqual(parseAskRequest({ selection: 'a', question: 'q'.repeat(MAX_ASK_QUESTION + 1) }), { error: 'bad-request' });
  for (const bad of [null, undefined, [], 'x', {}, { selection: '', question: 'q' }, { selection: 'a', question: '   ' }, { selection: 3, question: 'q' }, { selection: 'a', question: 3 }]) {
    assert.deepEqual(parseAskRequest(bad), { error: 'bad-request' }, JSON.stringify(bad));
  }
  assert.deepEqual(parseAskRequest({ selection: 'a', question: 'q', context: { before: 'b'.repeat(1500), after: 'c'.repeat(1500), title: 't'.repeat(200) } }), {
    selection: 'a',
    question: 'q',
    context: { before: 'b'.repeat(1500), after: 'c'.repeat(1500), title: 't'.repeat(200), headings: [] },
  });
  for (const bad of [
    { context: { before: 'b'.repeat(1501) } },
    { context: { after: 'c'.repeat(1501) } },
    { context: { title: 't'.repeat(201) } },
    { context: 'not-object' },
    { context: [] },
    { context: { before: 3 } },
  ]) {
    assert.deepEqual(parseAskRequest({ selection: 'a', question: 'q', ...bad }), { error: 'bad-request' }, JSON.stringify(bad));
  }
});

test('buildAskPrompt: 시스템 문구와 입력 JSON(마지막 줄)을 싣고 빈 문맥은 뺀다', () => {
  const prompt = buildAskPrompt({ selection: 'So it begins.', question: '무슨 뜻이야?', before: '앞', after: '뒤', title: '영상 제목' });
  assert.match(prompt, new RegExp(SYSTEM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const input = JSON.parse(prompt.split('\n').at(-1));
  assert.deepEqual(input, { selection: 'So it begins.', question: '무슨 뜻이야?', before: '앞', after: '뒤', title: '영상 제목' });
  const bare = JSON.parse(buildAskPrompt({ selection: 'a', question: 'q', before: '', after: '', title: '' }).split('\n').at(-1));
  assert.deepEqual(bare, { selection: 'a', question: 'q' });
  assert.equal(askKey('a  b', ' q '), askKey('a b', 'q'), '공백만 다른 같은 질문은 같은 키');
  assert.notEqual(askKey('a', 'q'), askKey('a', 'q2'));
  assert.notEqual(askKey('a', 'q'), askKey('b', 'q'));
});

async function startAskBridge(askAsk) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t53w-'));
  const asked = [];
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askTranslate: async () => '{"translation":"번역"}',
    askContext: async () => '{"translation":"문맥 번역"}',
    askAsk: async (prompt) => (asked.push(prompt), askAsk(prompt)),
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

test('/ask: 가짜 AI 답을 돌려주고 같은 (selection, question)은 문맥이 달라도 캐시에서 답한다', async () => {
  const s = await startAskBridge(async () => '이 줄은 “이제 시작이다”라는 뜻이에요.\n영상의 첫 장면을 연다라는 뜻은 아니에요.');
  try {
    const body = { selection: 'So it begins.', question: '무슨 뜻이야?', context: { before: '앞 줄', after: '뒤 줄', title: '영상 제목' } };
    const a = await s.post('/ask', body);
    assert.equal(a.status, 200);
    assert.deepEqual(a.json(), { answer: '이 줄은 “이제 시작이다”라는 뜻이에요. 영상의 첫 장면을 연다라는 뜻은 아니에요.', cached: false });
    assert.equal(s.asked.length, 1);
    assert.match(s.asked[0], new RegExp(SYSTEM));
    assert.match(s.asked[0], /So it begins\./);
    assert.match(s.asked[0], /무슨 뜻이야\?/);
    assert.match(s.asked[0], /영상 제목/);

    const b = await s.post('/ask', { ...body, context: { before: '다른 앞', after: '', title: '다른 제목' } });
    assert.equal(b.status, 200);
    assert.equal(b.json().answer, a.json().answer);
    assert.equal(b.json().cached, true);
    assert.equal(s.asked.length, 1, '같은 (selection, question)이면 AI 를 다시 부르지 않는다');

    const c = await s.post('/ask', { selection: 'So it begins.', question: '다른 질문' });
    assert.equal(c.json().cached, false);
    assert.equal(s.asked.length, 2, '질문이 다르면 새로 묻는다(문맥 없이도 동작)');
  } finally {
    await s.close();
  }
});

test('/ask: 검사 실패는 400', async () => {
  const s = await startAskBridge(async () => '답');
  try {
    for (const body of [
      {},
      { selection: 'a' },
      { selection: '', question: 'q' },
      { selection: 'a', question: '   ' },
      { selection: 'a'.repeat(601), question: 'q' },
      { selection: 'a', question: 'q'.repeat(201) },
      { selection: 'a', question: 'q', context: { before: 'b'.repeat(1501) } },
      { selection: 'a', question: 'q', context: { after: 'b'.repeat(1501) } },
      { selection: 'a', question: 'q', context: { title: 't'.repeat(201) } },
      { selection: 'a', question: 'q', context: 'nope' },
      null,
    ]) {
      const r = await s.post('/ask', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual(r.json(), { error: 'bad-request' });
    }
    assert.equal(s.asked.length, 0, '검사에서 걸리면 AI 를 부르지 않는다');
  } finally {
    await s.close();
  }
});

test('/ask: AI 시간 초과는 504 timeout, AI 실패는 502 ai-failed', async () => {
  const slow = await startAskBridge(async () => { throw new AiTimeoutError(); });
  try {
    const r = await slow.post('/ask', { selection: 'a', question: 'q' });
    assert.equal(r.status, 504);
    assert.deepEqual(r.json(), { error: 'timeout' });
  } finally {
    await slow.close();
  }

  const fail = await startAskBridge(async () => { throw new AiError('claude exited'); });
  try {
    const r = await fail.post('/ask', { selection: 'a', question: 'q' });
    assert.equal(r.status, 502);
    assert.deepEqual(r.json(), { error: 'ai-failed' });
  } finally {
    await fail.close();
  }
});

test('확장 연결: background 중계, 자막 말풍선·패널 풀이·드래그 카드에 묻기, 영상은 앞뒤 3줄·제목', () => {
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const subs = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../extension/panel-video.js', import.meta.url), 'utf8');
  const selection = readFileSync(new URL('../extension/selection.js', import.meta.url), 'utf8');

  assert.match(bg, /ask: \(\{ selection, question, context \}\) => relay\('\/ask'/);
  assert.match(subs, /type: 'ask', selection: askSelection\(cue\.text\), question/);
  assert.match(subs, /V\.contextOf\(S\.cues, i, titleNow\(\)\)/);
  assert.match(subs, /maxLength = 200/);
  assert.match(subs, /askAt: \(i, question\) => askAt\(i, question\)/);
  assert.match(panel, /askInput\.maxLength = 200/);
  assert.match(panel, /ui\(\)\.askAt\(i, question\)/);
  assert.match(selection, /type: 'ask', selection: sent, question/);
  assert.match(selection, /const ctx = contextFor\(cur\.range\)/);
  assert.match(selection, /메모장에 인용/);
  assert.match(selection, /readglossMemoPad\?\.attachQuote\?\./);
});

test('영상 키: 자막 층(closed shadow) 안 입력칸에 포커스가 있으면 단축키·Shift 저장이 막힌다', async () => {
  await import('../extension/text.js');
  await import('../extension/selection-core.js');
  const Sel = globalThis.readglossSelection;
  assert.equal(Sel.isEditableElement({ localName: 'input' }), true);
  assert.equal(Sel.isEditableElement({ localName: 'textarea' }), true);
  assert.equal(Sel.isEditableElement({ localName: 'div', isContentEditable: true }), true);
  assert.equal(Sel.isEditableElement({ localName: 'div', getAttribute: () => 'true' }), true);
  assert.equal(Sel.isEditableElement({ localName: 'div', getAttribute: () => 'false' }), false);
  assert.equal(Sel.isEditableElement({ localName: 'div' }), false);
  assert.equal(Sel.isEditableElement(null), false);
  const subs = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.match(subs, /const typingInLayer = \(\) => Sel\.isEditableElement\(ui\?\.lines\?\.getRootNode\?\.\(\)\?\.activeElement\)/);
  assert.match(subs, /Sel\.isTypingPath\(path, e\.isComposing\) \|\| typingInLayer\(\)\) return true/);
  assert.match(subs, /Sel\.isTypingPath\(e\.composedPath\(\), e\.isComposing\) \|\| typingInLayer\(\)\) return;/);
});

test('드래그 카드 묻기: 600자로 자르고 알림 한 줄, 실패 문구는 묻기용', () => {
  const selection = readFileSync(new URL('../extension/selection.js', import.meta.url), 'utf8');
  assert.match(selection, /cur\.text\.length > 600 \? cur\.text\.slice\(0, 600\) : cur\.text/);
  assert.match(selection, /앞부분 600자만 물었어요/);
  assert.match(selection, /errText\(r, '답을 가져오지 못했어요\. 다시 시도해 주세요'\)/);
  assert.match(selection, /const errText = \(r, fallback\) =>/);
});
