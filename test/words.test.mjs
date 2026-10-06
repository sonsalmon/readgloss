import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_HISTORY, createWords, parseWordsOp } from '../bridge/words.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'rg-words-')), 'words.json');
const clock = (start = 1000) => {
  let t = start;
  return () => t++;
};
const run = (w, v) => w.apply(parseWordsOp(v)); // 서버가 하는 순서: 검증 -> 적용
const fresh = (file = tmp()) => ({ file, w: createWords({ file, now: clock() }) });

test('parseWordsOp: 올바른 요청은 정규화한다(lemma 소문자, 기본값, 문장·주소 상한)', () => {
  assert.deepEqual(parseWordsOp({ op: 'known', lemma: 'Mitigation' }), { op: 'known', lemma: 'mitigation' });
  assert.deepEqual(parseWordsOp({ op: 'unsave', lemma: 'payload' }), { op: 'unsave', lemma: 'payload' });
  const s = parseWordsOp({ op: 'save', lemma: 'mitigation', word: 'Mitigations', gloss: '완화', sentence: 'x'.repeat(1500), url: `https://a.test/${'y'.repeat(2500)}` });
  assert.equal(s.word, 'Mitigations');
  assert.equal(s.gloss, '완화');
  assert.equal(s.sentence.length, 1000);
  assert.equal(s.url.length, 2000);
  assert.deepEqual(parseWordsOp({ op: 'history', lemma: 'delve' }), { op: 'history', lemma: 'delve', word: 'delve', gloss: '', sentence: '', url: '' });
});

test('parseWordsOp: 잘못된 op·lemma·word·타입, http(s) 아닌 주소는 거절한다', () => {
  for (const v of [null, 'x', [], {}, { op: 'drop', lemma: 'a' }, { op: 'known' }, { op: 'known', lemma: '1abc' }, { op: 'known', lemma: 'a b' }, { op: 'known', lemma: '__proto__' }, { op: 'known', lemma: 'x'.repeat(65) }, { op: 'known', lemma: 42 }]) {
    assert.equal(parseWordsOp(v), null, JSON.stringify(v));
  }
  const base = { op: 'save', lemma: 'delve' };
  for (const extra of [{ word: 'a b' }, { word: 5 }, { gloss: 5 }, { sentence: {} }, { url: 5 }, { url: 'javascript:alert(1)' }, { url: 'file:///etc/passwd' }]) {
    assert.equal(parseWordsOp({ ...base, ...extra }), null, JSON.stringify(extra));
  }
  assert.ok(parseWordsOp({ ...base, url: 'http://a.test/x' }));
  assert.ok(parseWordsOp({ ...base, url: '' }));
});

test('createWords: 처음엔 비어 있고, known/unknown 은 원형별로 저장·취소된다', () => {
  const { file, w } = fresh();
  assert.deepEqual(w.all(), { known: {}, saved: {}, history: [], phrases: {} });
  assert.equal(w.isKnown('mitigation'), false);
  run(w, { op: 'known', lemma: 'mitigation' });
  assert.equal(w.isKnown('mitigation'), true);
  assert.deepEqual(Object.keys(w.all().known), ['mitigation']);
  assert.equal(typeof w.all().known.mitigation.ts, 'number');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).known.mitigation, w.all().known.mitigation);
  run(w, { op: 'unknown', lemma: 'mitigation' });
  assert.equal(w.isKnown('mitigation'), false);
  assert.deepEqual(w.all().known, {});
});

test('createWords: constructor 같은 이름도 평범한 원형으로 다룬다(prototype 오염·누락 없음)', () => {
  const { w } = fresh();
  assert.equal(w.isKnown('constructor'), false);
  run(w, { op: 'known', lemma: 'constructor' });
  assert.equal(w.isKnown('constructor'), true);
  assert.equal(w.isKnown('toString'), false);
  assert.deepEqual(Object.keys(w.all().known), ['constructor']);
});

test('createWords: save/unsave 는 단어·뜻·문장·주소·시각을 남기고 다시 save 하면 덮어쓴다', () => {
  const { w } = fresh();
  run(w, { op: 'save', lemma: 'mitigation', word: 'mitigations', gloss: '완화', sentence: 'Apply mitigations.', url: 'https://a.test/p' });
  assert.deepEqual(w.all().saved.mitigation, { word: 'mitigations', gloss: '완화', sentence: 'Apply mitigations.', url: 'https://a.test/p', ts: 1000 });
  run(w, { op: 'save', lemma: 'mitigation', word: 'mitigation', gloss: '경감', sentence: 'Another.', url: '' });
  assert.equal(w.all().saved.mitigation.gloss, '경감');
  assert.equal(Object.keys(w.all().saved).length, 1);
  run(w, { op: 'unsave', lemma: 'mitigation' });
  assert.deepEqual(w.all().saved, {});
});

test('createWords: history 는 같은 원형이면 맨 앞으로 옮기고 200개까지만 남긴다', () => {
  const { w } = fresh();
  assert.equal(MAX_HISTORY, 200);
  const at = (i) => `w${'abcdefghij'[i % 10]}${'abcdefghij'[Math.floor(i / 10) % 10]}${'abcdefghij'[Math.floor(i / 100)]}`;
  for (let i = 0; i < 205; i++) run(w, { op: 'history', lemma: at(i), word: at(i) });
  const h = w.all().history;
  assert.equal(h.length, 200);
  assert.equal(h[0].lemma, at(204));
  assert.equal(h[199].lemma, at(5)); // 0~4 는 밀려났다
  run(w, { op: 'history', lemma: at(100), word: 'again', gloss: '다시' });
  const h2 = w.all().history;
  assert.equal(h2.length, 200);
  assert.deepEqual([h2[0].lemma, h2[0].word, h2[0].gloss], [at(100), 'again', '다시']);
  assert.equal(h2.filter((x) => x.lemma === at(100)).length, 1);
  assert.equal(h2[1].lemma, at(204));
});

test('createWords: 파일에 저장하고 새로 열어도 같은 상태(원자적 쓰기: 임시 파일이 남지 않는다)', () => {
  const { file, w } = fresh();
  run(w, { op: 'known', lemma: 'delve' });
  run(w, { op: 'save', lemma: 'payload', word: 'payload', gloss: '탑재량' });
  run(w, { op: 'history', lemma: 'payload', word: 'payload', gloss: '탑재량' });
  const again = createWords({ file });
  assert.deepEqual(again.all(), w.all());
  assert.deepEqual(readdirSync(join(file, '..')).filter((f) => f.endsWith('.tmp')), []);
});

test('createWords: 깨진 파일은 빈 상태로 시작하되 원본을 .broken 으로 남긴다, 모양이 틀린 항목은 버린다', () => {
  const file = tmp();
  writeFileSync(file, '{not json');
  const w = createWords({ file });
  assert.deepEqual(w.all(), { known: {}, saved: {}, history: [], phrases: {} });
  assert.equal(readFileSync(`${file}.broken`, 'utf8'), '{not json');
  const file2 = tmp();
  writeFileSync(
    file2,
    JSON.stringify({
      known: { ok: { ts: 5 }, 'bad key!': { ts: 6 }, nots: 'x' },
      saved: { fine: { word: 'fine', gloss: 'g', sentence: 's', url: '', ts: 7 }, wrong: 3 },
      history: [{ lemma: 'ok', word: 'ok', gloss: '', sentence: '', url: '', ts: 8 }, { lemma: '1x' }, 'str'],
    }),
  );
  const v = createWords({ file: file2 }).all();
  assert.deepEqual(Object.keys(v.known), ['ok']);
  assert.deepEqual(Object.keys(v.saved), ['fine']);
  assert.deepEqual(v.history.map((x) => x.lemma), ['ok']);
  assert.equal(existsSync(`${file2}.broken`), false);
});
