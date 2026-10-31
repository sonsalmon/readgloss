import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBridge } from '../bridge/server.mjs';
import {
  ankiExport,
  blankWord,
  csvExport,
  csvField,
  exportWords,
  rowsFromWords,
  sceneLink,
} from '../scripts/export-anki.mjs';
import '../extension/panel-words.js';

const W = globalThis.readglossWords;
const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const SCRIPT = new URL('../scripts/export-anki.mjs', import.meta.url).pathname;

test('csvField: 쉼표·따옴표·줄바꿈을 따옴표로 감싸고 안쪽 따옴표를 두 번 쓴다', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
  assert.equal(csvField('carriage\rreturn'), '"carriage\rreturn"');
  assert.equal(csvField(undefined), '');
  assert.equal(csvField(12), '12');
});

test('csvExport: 머리줄 word,gloss,sentence,link 와 escape 된 줄', () => {
  const text = csvExport([
    { word: 'mitigation', gloss: '완화, 경감', sentence: 'He said "go".', link: 'https://youtu.be/x?t=12s' },
  ]);
  assert.deepEqual(text.split('\n'), [
    'word,gloss,sentence,link',
    'mitigation,"완화, 경감","He said ""go"".",https://youtu.be/x?t=12s',
    '',
  ]);
  assert.equal(csvExport([]), 'word,gloss,sentence,link\n');
});

test('blankWord: 원형·활용형을 ____ 로, 없으면 문장 그대로', () => {
  assert.equal(blankWord('Apply mitigations now.', 'mitigation'), 'Apply ____ now.');
  assert.equal(blankWord('She studies every day.', 'study'), 'She ____ every day.');
  assert.equal(blankWord('He was running fast.', 'run'), 'He was ____ fast.');
  assert.equal(blankWord('The word is mitigation.', ['mitigation', 'mitigations']), 'The word is ____.');
  assert.equal(blankWord('Nothing to see here.', 'apple'), 'Nothing to see here.');
  assert.equal(blankWord('', 'apple'), '');
  assert.equal(blankWord('Delves into it.', 'delve'), '____ into it.');
  assert.equal(blankWord('mittens and mitigation', 'mitigation'), 'mittens and ____'); // 낱말 경계
});

test('blankWord: 구는 구 전체를 가리고, 저장 때 본 다른 형태도 함께 본다', () => {
  assert.equal(blankWord('This module will delve into the math.', ['delve into']), 'This module will ____ the math.');
  assert.equal(blankWord('She delved into the logs.', ['delve into']), 'She ____ the logs.');
  assert.equal(blankWord('A zero-day exploit.', ['zero-day', 'zero day']), 'A ____ exploit.');
});

test('ankiExport: 앞면은 빈칸 문장, 뒷면은 낱말 · 뜻 · 링크, 탭·줄바꿈은 칸을 깨지 않는다', () => {
  const text = ankiExport([
    {
      word: 'mitigation',
      gloss: '완화',
      sentence: 'Apply mitigations, "now".\nThen wait.\tAgain.',
      link: 'https://youtu.be/x?t=5s',
      targets: ['mitigation'],
    },
  ]);
  assert.equal(text, '"Apply ____, ""now"".<br>Then wait. Again."\tmitigation · 완화 · https://youtu.be/x?t=5s\n');
  assert.equal(ankiExport([]), '');
});

test('ankiExport: 문장에 낱말이 없으면 그대로 두고, 빈 링크는 구분자도 남기지 않는다', () => {
  assert.equal(ankiExport([{ word: 'apple', gloss: '사과', sentence: 'Nothing here.', link: '', targets: ['apple'] }]), 'Nothing here.\tapple · 사과\n');
});

test('sceneLink / rowsFromWords: 저장 주소를 쓰고, 시각이 없으면 구간 시작을 붙인다', () => {
  assert.equal(sceneLink({ url: 'https://youtu.be/x?t=12s', clip: { start: 12, end: 16 } }), 'https://youtu.be/x?t=12s');
  assert.equal(sceneLink({ url: 'https://youtu.be/x', clip: { start: 62.9, end: 66 } }), 'https://youtu.be/x?t=62s');
  assert.equal(sceneLink({ url: 'https://example.com/p' }), 'https://example.com/p');
  assert.equal(sceneLink({}), '');

  const rows = rowsFromWords({
    saved: {
      mitigation: { word: 'mitigations', gloss: '완화', sentence: 'Apply mitigations.', url: 'https://youtu.be/x?t=12s', ts: 20 },
      apple: { word: 'apple', gloss: '사과', sentence: 'An apple.', url: '', ts: 10 },
    },
    phrases: {
      aaaaaaaaaaaa: { text: 'delve into', translation: '맥 번역', context: { translation: '파고들다' }, sentence: 'This module will delve into the math.', url: 'https://youtu.be/y', clip: { start: 30, end: 34 }, ts: 30 },
    },
  });
  assert.deepEqual(rows.map((r) => [r.word, r.gloss, r.sentence, r.link]), [
    ['apple', '사과', 'An apple.', ''],
    ['mitigation', '완화', 'Apply mitigations.', 'https://youtu.be/x?t=12s'],
    ['delve into', '파고들다', 'This module will delve into the math.', 'https://youtu.be/y?t=30s'],
  ]);
  assert.deepEqual(rows[1].targets, ['mitigation', 'mitigations']);
});

test('exportWords: 모르는 형식은 던진다', () => {
  assert.throws(() => exportWords('pdf', {}), /모르는 형식/);
});

test('export-anki 스크립트: --data 를 읽어 --format·--out 으로 파일을 쓴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 't53x-export-'));
  writeFileSync(join(dir, 'words.json'), JSON.stringify({
    saved: { mitigation: { word: 'mitigations', gloss: '완화', sentence: 'Apply mitigations.', url: 'https://youtu.be/x?t=12s', ts: 1 } },
    phrases: {},
  }));
  const csvOut = join(dir, 'words.csv');
  execFileSync(process.execPath, [SCRIPT, '--data', dir, '--format', 'csv', '--out', csvOut]);
  assert.equal(readFileSync(csvOut, 'utf8'), 'word,gloss,sentence,link\nmitigation,완화,Apply mitigations.,https://youtu.be/x?t=12s\n');

  const ankiOut = join(dir, 'words.txt');
  execFileSync(process.execPath, [SCRIPT, '--data', dir, '--format', 'anki', '--out', ankiOut]);
  assert.equal(readFileSync(ankiOut, 'utf8'), 'Apply ____.\tmitigation · 완화 · https://youtu.be/x?t=12s\n');
});

async function startBridge() {
  const dir = mkdtempSync(join(tmpdir(), 't53x-bridge-'));
  const aiCalls = [];
  const bridge = createBridge({
    ask: async () => {
      aiCalls.push('ask');
      throw new Error('시험에서 AI 를 부르면 안 된다');
    },
    askTranslate: async () => {
      aiCalls.push('translate');
      throw new Error('시험에서 AI 를 부르면 안 된다');
    },
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict: { lookup: async () => ({ found: false, entries: [] }), close() {} },
    mt: { translate: async () => '', close() {} },
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t }));
      });
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  return { bridge, aiCalls, req, auth, words: (body) => req('POST', '/words', { headers: auth, body }) };
}

test('다리 GET /words/export: CSV·Anki 본문, 토큰·형식·메서드 검사, AI 호출 0번', async () => {
  const s = await startBridge();
  try {
    assert.equal((await s.req('GET', '/words/export?format=csv')).status, 401);
    assert.equal((await s.req('POST', '/words/export?format=csv', { headers: s.auth, body: {} })).status, 405);
    assert.equal((await s.req('GET', '/words/export?format=pdf', { headers: s.auth })).status, 400);

    await s.words({ op: 'save', lemma: 'mitigation', word: 'mitigations', gloss: '완화, 경감', sentence: 'Apply mitigations, "now".', url: 'https://www.youtube.com/watch?v=abc&t=12s' });
    await s.words({ op: 'save-phrase', text: 'delve into', translation: '파고들다', kind: 'expression', sentence: 'This module will delve into the math.', url: 'https://www.youtube.com/watch?v=xyz&t=30s' });

    const csv = await s.req('GET', '/words/export?format=csv', { headers: s.auth });
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /^text\/csv/);
    assert.equal(csv.text.split('\n')[0], 'word,gloss,sentence,link');
    assert.match(csv.text, /^mitigation,"완화, 경감","Apply mitigations, ""now""\.",https:\/\/www\.youtube\.com\/watch\?v=abc&t=12s$/m);
    assert.match(csv.text, /^delve into,파고들다,This module will delve into the math\.,https:\/\/www\.youtube\.com\/watch\?v=xyz&t=30s$/m);

    const anki = await s.req('GET', '/words/export?format=anki', { headers: s.auth });
    assert.equal(anki.status, 200);
    assert.match(anki.headers['content-type'], /^text\/tab-separated-values/);
    assert.match(anki.text, /^"Apply ____, ""now""\."\tmitigation · 완화, 경감 · https:\/\/www\.youtube\.com\/watch\?v=abc&t=12s$/m);
    assert.match(anki.text, /^This module will ____ the math\.\tdelve into · 파고들다 · https:\/\/www\.youtube\.com\/watch\?v=xyz&t=30s$/m);

    // 형식을 빼면 CSV 로 본다(옛 호출 호환).
    assert.equal((await s.req('GET', '/words/export', { headers: s.auth })).headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(s.aiCalls.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('panel-words: 내보내기 형식·파일 이름·요청 모양', () => {
  assert.deepEqual(W.EXPORT_FORMATS.map((f) => [f.id, f.title, f.ext]), [['csv', 'CSV', 'csv'], ['anki', 'Anki', 'txt']]);
  const now = new Date(2026, 9, 31, 12).getTime();
  assert.equal(W.exportFilename('csv', now), 'readgloss-words-2026-10-31.csv');
  assert.equal(W.exportFilename('anki', now), 'readgloss-words-2026-10-31.txt');
  assert.equal(W.exportFilename('nope', now), 'readgloss-words-2026-10-31.csv');
  assert.deepEqual(W.exportRequest('anki'), { type: 'words', op: 'export', format: 'anki' });
});
