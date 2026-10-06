import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWords, parseWordsOp, phraseId } from '../bridge/words.mjs';
import { start } from '../fixtures/bridge-harness.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'rg-phrases-')), 'words.json');
const run = (w, v) => w.apply(parseWordsOp(v));

test('phraseId: 공백 정리한 글의 sha1 앞 12자', () => {
  const id = phraseId('  The  attacker\n sends a payload. ');
  assert.equal(id, createHash('sha1').update('The attacker sends a payload.').digest('hex').slice(0, 12));
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.notEqual(phraseId('the attacker sends a payload.'), id); // 대소문자는 구분
});

test('parseWordsOp save-phrase: 글·번역·문맥 번역·주소·제목을 정리하고, 상한을 넘으면 거절한다', () => {
  assert.deepEqual(parseWordsOp({ op: 'save-phrase', text: ' a \n b ', translation: '가나' }), { op: 'save-phrase', text: 'a b', translation: '가나', url: '', title: '' });
  assert.deepEqual(
    parseWordsOp({ op: 'save-phrase', text: 'x', translation: 't', context: { translation: 'ct', note: 'n', wide: true, extra: 1 }, url: 'https://a.test/p', title: 'T' }),
    { op: 'save-phrase', text: 'x', translation: 't', context: { translation: 'ct', note: 'n', wide: true }, url: 'https://a.test/p', title: 'T' },
  );
  assert.deepEqual(parseWordsOp({ op: 'save-phrase', text: 'x', context: { translation: 'ct' } }).context, { translation: 'ct' });
  assert.equal(parseWordsOp({ op: 'save-phrase', text: 'x'.repeat(1000) }).text.length, 1000);
  assert.equal(parseWordsOp({ op: 'save-phrase', text: 'x', translation: '가'.repeat(2000), url: `https://a.test/${'y'.repeat(1984)}`, title: 'T'.repeat(200), context: { translation: '나'.repeat(2000), note: 'n'.repeat(400) } }).op, 'save-phrase');
  const base = { op: 'save-phrase', text: 'x', translation: 't' };
  for (const bad of [{ text: '' }, { text: '   ' }, { text: 5 }, { text: undefined }, { text: 'x'.repeat(1001) }, { translation: 5 }, { translation: '가'.repeat(2001) }, { url: 'javascript:1' }, { url: 5 }, { url: `https://a.test/${'y'.repeat(2000)}` },
    { title: 'T'.repeat(201) }, { title: 5 }, { context: 'x' }, { context: [] }, { context: { translation: 5 } }, { context: { translation: '나'.repeat(2001) } }, { context: { note: 'n'.repeat(401) } }, { context: { wide: 'yes' } }]) {
    assert.equal(parseWordsOp({ ...base, ...bad }), null, JSON.stringify(bad).slice(0, 80));
  }
});

test('parseWordsOp unsave-phrase: 12자리 소문자 16진 id 만', () => {
  assert.deepEqual(parseWordsOp({ op: 'unsave-phrase', id: 'abc123def456' }), { op: 'unsave-phrase', id: 'abc123def456' });
  for (const id of [undefined, '', 'ABC123DEF456', 'abc123def45', 'abc123def4567', 'zzzzzzzzzzzz', 5]) assert.equal(parseWordsOp({ op: 'unsave-phrase', id }), null, String(id));
});

test('createWords save-phrase / unsave-phrase: {id, phrases} 를 돌려주고 파일에 저장, 같은 글은 덮어쓴다', () => {
  const file = tmp();
  let t = 100;
  const w = createWords({ file, now: () => t++ });
  assert.deepEqual(w.all().phrases, {});
  const r = run(w, { op: 'save-phrase', text: 'The attacker  sends a payload.', translation: '공격자가 페이로드를 보낸다.', context: { translation: '문맥 번역', wide: true }, url: 'https://a.test/p', title: '글' });
  const id = phraseId('The attacker sends a payload.');
  assert.equal(r.id, id);
  assert.deepEqual(Object.keys(r), ['id', 'phrases']);
  assert.deepEqual(r.phrases[id], { text: 'The attacker sends a payload.', translation: '공격자가 페이로드를 보낸다.', context: { translation: '문맥 번역', wide: true }, url: 'https://a.test/p', title: '글', ts: 100 });
  assert.deepEqual(w.all().phrases, r.phrases);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).phrases, r.phrases);
  assert.deepEqual(createWords({ file }).all().phrases, r.phrases); // 새로 열어도
  const again = run(w, { op: 'save-phrase', text: 'The attacker sends a payload.', translation: '다시' });
  assert.equal(Object.keys(again.phrases).length, 1);
  assert.deepEqual(again.phrases[id], { text: 'The attacker sends a payload.', translation: '다시', ts: 101 }); // url·context 가 없으면 키도 없다
  run(w, { op: 'save-phrase', text: 'Another one', translation: '' });
  assert.equal(Object.keys(w.all().phrases).length, 2);
  const gone = run(w, { op: 'unsave-phrase', id });
  assert.equal(gone.id, id);
  assert.deepEqual(Object.keys(gone.phrases), [phraseId('Another one')]);
  assert.deepEqual(run(w, { op: 'unsave-phrase', id }).phrases, gone.phrases); // 없는 id 도 오류 없이
  assert.deepEqual(readdirSync(join(file, '..')).filter((f) => f.endsWith('.tmp')), []);
});

test('createWords: 구는 낱말 상태(known·saved·history)와 따로, 깨진 항목은 버린다', () => {
  const file = tmp();
  const w = createWords({ file });
  run(w, { op: 'save', lemma: 'payload', word: 'payload', gloss: '뜻' });
  run(w, { op: 'save-phrase', text: 'a b c', translation: '가' });
  assert.deepEqual(Object.keys(w.all().saved), ['payload']);
  assert.equal(Object.keys(w.all().phrases).length, 1);
  assert.deepEqual(Object.keys(run(w, { op: 'unsave', lemma: 'payload' }).phrases).length, 1);
  const bad = tmp();
  createWords({ file: bad }).apply(parseWordsOp({ op: 'save-phrase', text: 'good one', translation: 'g' }));
  const raw = JSON.parse(readFileSync(bad, 'utf8'));
  Object.assign(raw.phrases, { nothex: { text: 'x' }, abcabcabcabc: { text: '' }, defdefdefdef: 5, aaaaaaaaaaaa: { text: 'no translation' } });
  writeFileSync(bad, JSON.stringify(raw));
  const v = createWords({ file: bad }).all().phrases;
  assert.deepEqual(Object.keys(v).sort(), ['aaaaaaaaaaaa', phraseId('good one')].sort());
  assert.equal(v.aaaaaaaaaaaa.translation, '');
});

test('/words save-phrase·unsave-phrase: POST 는 {id, phrases}, GET 은 phrases 를 함께, 틀린 본문은 400, 기존 op 응답에도 phrases', async () => {
  const s = await start();
  try {
    const get = async () => (await s.get('/words')).json();
    assert.deepEqual(await get(), { known: {}, saved: {}, history: [], phrases: {} });
    const body = { op: 'save-phrase', text: 'Apply the patch.', translation: '패치를 적용한다.', context: { translation: '문맥', note: '메모' }, url: 'https://a.test/x', title: '글' };
    const r = await s.post('/words', body);
    assert.equal(r.status, 200);
    const id = phraseId('Apply the patch.');
    assert.deepEqual(Object.keys(r.json()), ['id', 'phrases']);
    assert.equal(r.json().id, id);
    assert.equal(r.json().phrases[id].translation, '패치를 적용한다.');
    assert.deepEqual((await get()).phrases, r.json().phrases);
    assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'words.json'), 'utf8')).phrases, r.json().phrases);
    assert.deepEqual(Object.keys((await s.post('/words', { op: 'known', lemma: 'patch' })).json().phrases), [id]);
    for (const bad of [{ op: 'save-phrase', translation: 't' }, { ...body, text: 'x'.repeat(1001) }, { ...body, url: 'file:///x' }, { op: 'unsave-phrase', id: 'nothex' }, { op: 'unsave-phrase' }]) {
      assert.equal((await s.post('/words', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    const u = await s.post('/words', { op: 'unsave-phrase', id });
    assert.deepEqual(u.json(), { id, phrases: {} });
    assert.deepEqual((await get()).phrases, {});
  } finally {
    await s.close();
  }
});
