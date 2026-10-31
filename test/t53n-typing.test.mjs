// 과제 T53n(변경 기록 28-20): 대화 + 빈칸 타이핑 복습 — 판정 순수 함수, 다리 /review/drill 정상·모양 실패·캐시.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { buildDrillPrompt, parseDrillRequest } from '../bridge/drill.mjs';

await import('../extension/panel-words.js');
await import('../extension/settings-core.js');
const W = globalThis.readglossWords;
const S = globalThis.readglossSettings;

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';

const DRILL = {
  dialogue: [
    { en: 'Have you ever exploited this bug?', ko: '이 버그를 악용해 본 적 있어?' },
    { en: 'No, but I saw someone try.', ko: '아니, 누가 시도하는 건 봤어.' },
  ],
  ko: '해커들은 그 허점을 악용했다.',
  en: 'Hackers exploited the flaw.',
  answer: 'exploited',
};

test('judgeTyped: 대소문자·앞뒤 공백을 무시하고 여러 정답 중 하나면 ok', () => {
  assert.equal(W.judgeTyped('  Exploit  ', ['exploit']), 'ok');
  assert.equal(W.judgeTyped('EXPLOITED', ['exploited', 'exploit']), 'ok');
  assert.equal(W.judgeTyped('take off', ['take off']), 'ok');
  assert.equal(W.judgeTyped('  ', ['exploit']), 'wrong', '빈 입력은 틀림');
  assert.equal(W.judgeTyped('exploit', []), 'wrong');
  assert.equal(W.judgeTyped('exploit', null), 'wrong');
});

test('judgeTyped: 네 글자 이상 정답과 한 글자 바꿈·넣음·뺌은 almost', () => {
  assert.equal(W.judgeTyped('exploix', ['exploit']), 'almost', '바꿈');
  assert.equal(W.judgeTyped('exploitt', ['exploit']), 'almost', '넣음');
  assert.equal(W.judgeTyped('exploi', ['exploit']), 'almost', '뺌');
  assert.equal(W.judgeTyped('aaaa', ['aaab']), 'almost');
  assert.equal(W.judgeTyped('axxle', ['apple']), 'wrong', '두 글자가 다르면 틀림');
  assert.equal(W.judgeTyped('explain', ['exploit']), 'wrong');
  assert.equal(W.judgeTyped('car', ['cat']), 'wrong', '세 글자 낱말은 almost 로 치지 않는다');
  assert.equal(W.judgeTyped('cats', ['cat']), 'wrong', '짧은 정답에 한 글자 붙여도 틀림');
  assert.equal(W.judgeTyped('cat', ['cat']), 'ok', '짧아도 똑같으면 맞음');
});

test('judgeTyped: 정답 후보(다리 answer)·기본형·저장 표면형을 함께 받는다', () => {
  const card = { type: 'word', key: 'exploit', lemma: 'exploit', word: 'exploited' };
  assert.deepEqual(W.typedAnswers(card, { answer: 'exploits' }), ['exploits', 'exploit', 'exploited']);
  assert.equal(W.judgeTyped('exploited', W.typedAnswers(card, { answer: 'exploits' })), 'ok');
  const phrase = { type: 'phrase', key: 'abcdefabcdef', text: 'eat it alive', base: 'eat A alive' };
  assert.deepEqual(W.typedAnswers(phrase, { answer: 'eat it alive' }, 'eat A alive'), ['eat it alive', 'eat A alive']);
  assert.deepEqual(W.typedAnswers(phrase, null, 'eat A alive'), ['eat A alive', 'eat it alive']);
});

test('blankParts: 낱말 경계를 지키고 다른 출현도 가린다(maskWord 와 같게)', () => {
  assert.deepEqual(W.blankParts('Start the art class.', 'art'), { before: 'Start the ', after: ' class.', found: true });
  assert.deepEqual(W.blankParts('I run, you run.', 'run'), { before: 'I ', after: ', you ____.', found: true });
  assert.equal(W.blankParts('Start the art class.', 'tar').found, false);
});

test('blankParts·koParts: 예문의 정답 자리와 한국어 표현 부분을 가른다', () => {
  assert.deepEqual(W.blankParts('Hackers exploited the flaw.', 'exploited'), { before: 'Hackers ', after: ' the flaw.', found: true });
  assert.deepEqual(W.blankParts('Exploited again.', 'exploited'), { before: '', after: ' again.', found: true }, '대소문자 무시');
  assert.deepEqual(W.blankParts('They eat it   alive.', 'eat it alive'), { before: 'They ', after: '.', found: true }, '공백이 달라도 찾는다');
  assert.deepEqual(W.blankParts('No match here.', 'exploited'), { before: 'No match here.', after: '', found: false });

  const kp = W.koParts('해커들은 그 허점을 악용했다.', '악용하다');
  assert.deepEqual(kp, { before: '해커들은 그 허점을 ', expr: '악용', after: '했다.' });
  assert.deepEqual(W.koParts('짧은 문장.', ''), { before: '짧은 문장.', expr: '', after: '' });
  assert.deepEqual(W.koParts('다른 말.', '악용하다'), { before: '다른 말.', expr: '', after: '' });
});

test('parseDrillRequest: key·lemma|text·gloss·sentence 를 검사한다', () => {
  assert.deepEqual(parseDrillRequest({ key: ' exploit ', lemma: 'exploit', gloss: ' 악용하다 ', sentence: 'They exploit it.' }), {
    key: 'exploit',
    lemma: 'exploit',
    gloss: '악용하다',
    sentence: 'They exploit it.',
  });
  assert.deepEqual(parseDrillRequest({ key: 'abcdefabcdef', text: 'eat it alive', gloss: '산 채로 먹다' }), {
    key: 'abcdefabcdef',
    text: 'eat it alive',
    gloss: '산 채로 먹다',
  });
  const bad = [
    null,
    [],
    {},
    { lemma: 'exploit', gloss: '뜻' }, // key 없음
    { key: 'x', gloss: '뜻' }, // lemma·text 둘 다 없음
    { key: 'x', lemma: 'exploit', text: 'eat it alive', gloss: '뜻' }, // 둘 다 있음
    { key: 'x', lemma: '123', gloss: '뜻' },
    { key: 'x', lemma: 'exploit' }, // gloss 없음
    { key: 'x', lemma: 'exploit', gloss: '뜻', sentence: 's'.repeat(1001) },
    { key: 'k'.repeat(201), lemma: 'exploit', gloss: '뜻' },
  ];
  for (const v of bad) assert.deepEqual(parseDrillRequest(v), { error: 'bad-request' }, JSON.stringify(v));

  const prompt = buildDrillPrompt({ lemma: 'exploit', gloss: '악용하다', sentence: 'They exploit it.' });
  assert.match(prompt, /대화 2~3줄/);
  assert.match(prompt, /answer/);
  assert.deepEqual(JSON.parse(prompt.split('\n').at(-1)), { lemma: 'exploit', gloss: '악용하다', sentence: 'They exploit it.' });
});

async function startDrillBridge(askDrill) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t53n-'));
  const asked = [];
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askTranslate: async () => '{"translation":"번역"}',
    askContext: async () => '{"translation":"문맥 번역"}',
    askDrill: async (prompt) => (asked.push(prompt), askDrill(prompt)),
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

test('/review/drill: 가짜 AI 의 대화·예문을 돌려주고 같은 key 는 캐시에서 답한다', async () => {
  const s = await startDrillBridge(async () => JSON.stringify(DRILL));
  try {
    const body = { key: 'exploit', lemma: 'exploit', gloss: '악용하다', sentence: 'They exploit the bug.' };
    const a = await s.post('/review/drill', body);
    assert.equal(a.status, 200);
    assert.deepEqual(a.json(), { ...DRILL, cached: false });
    assert.equal(s.asked.length, 1);
    assert.match(s.asked[0], /악용하다/);
    assert.match(s.asked[0], /exploit/);
    assert.match(s.asked[0], /They exploit the bug\./);

    const b = await s.post('/review/drill', { ...body, sentence: '다른 저장 문장' });
    assert.equal(b.status, 200);
    assert.deepEqual(b.json(), { ...DRILL, cached: true });
    assert.equal(s.asked.length, 1, '같은 key 는 AI 를 다시 부르지 않는다');

    const c = await s.post('/review/drill', { key: 'abcdefabcdef', text: 'eat it alive', gloss: '산 채로 먹다' });
    assert.equal(c.status, 200);
    assert.equal(c.json().cached, false);
    assert.equal(s.asked.length, 2, '다른 key 는 새로 묻는다');
  } finally {
    await s.close();
  }
});

test('/review/drill: AI 모양이 틀리거나 en 에 answer 가 없으면 502 bad-drill', async () => {
  const cases = [
    JSON.stringify({ ...DRILL, answer: 'missing' }), // en 에 없음
    JSON.stringify({ ...DRILL, dialogue: [DRILL.dialogue[0]] }), // 1줄
    JSON.stringify({ ...DRILL, dialogue: [...DRILL.dialogue, DRILL.dialogue[0], DRILL.dialogue[0]] }), // 4줄
    JSON.stringify({ ...DRILL, en: '' }),
    JSON.stringify({ ...DRILL, ko: 3 }),
    JSON.stringify({ dialogue: DRILL.dialogue, ko: '번역', en: 'Hackers exploited the flaw.' }), // answer 없음
  ];
  for (const output of cases) {
    const s = await startDrillBridge(async () => output);
    try {
      const r = await s.post('/review/drill', { key: 'exploit', lemma: 'exploit', gloss: '악용하다' });
      assert.equal(r.status, 502, output);
      assert.deepEqual(r.json(), { error: 'bad-drill' });
    } finally {
      await s.close();
    }
  }
});

test('/review/drill: 검사 실패는 400 이고 AI 를 부르지 않는다', async () => {
  const s = await startDrillBridge(async () => JSON.stringify(DRILL));
  try {
    for (const body of [null, {}, { key: 'x', gloss: '뜻' }, { key: 'x', lemma: 'exploit' }, { key: 'x', lemma: 'exploit', text: 'a', gloss: '뜻' }]) {
      const r = await s.post('/review/drill', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual(r.json(), { error: 'bad-request' });
    }
    assert.equal(s.asked.length, 0);
  } finally {
    await s.close();
  }
});

test('확장 연결: 설정 enum·중계·빈칸 화면 흐름', () => {
  assert.equal(S.normalize({ reviewMode: 'type' }).reviewMode, 'type');
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(bg, /'review-drill': \(\{ key, lemma, text, gloss, sentence \}\) => relay\('\/review\/drill'/);
  const panel = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');
  assert.match(panel, /\{ id: 'type', title: '빈칸' \}/);
  assert.match(panel, /type: 'review-drill'/);
  assert.match(panel, /judgeTyped\(value, W\.typedAnswers\(card, drill, phraseBaseOf\(card\)\)\)/);
  assert.match(panel, /sendResult\(card, 'hold'\)/);
  assert.match(panel, /sendResult\(card, 'again'\)/);
  assert.match(panel, /sendResult\(card, 'know'\)/);
  assert.match(panel, /장면 듣기/);
  assert.match(panel, /openScene\(scene\)/);
  assert.match(panel, /W\.maskWord\(/);
});
