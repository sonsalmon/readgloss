import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMydict, keysOfText, normalizeKey, parseMydictOp } from '../bridge/mydict.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'rg-mydict-')), 'mydict.json');
const clock = (start = 1000) => {
  let t = start;
  return () => t++;
};
const fresh = (file = tmp()) => ({ file, m: createMydict({ file, now: clock() }) });
const set = (m, v) => m.apply(parseMydictOp({ op: 'set', ...v }));

test('normalizeKey: 소문자·공백 정리, 허용 글자는 [a-z0-9 \'’.-] 만, 1~80자', () => {
  assert.equal(normalizeKey('  PCA '), 'pca');
  assert.equal(normalizeKey('Principal   Component\n Analysis'), 'principal component analysis');
  assert.equal(normalizeKey("e.g. don't-x’s 2fa"), "e.g. don't-x’s 2fa");
  for (const bad of ['', '   ', 'a_b', 'a/b', '주성분', 'a+b', 'x'.repeat(81), 5, null, undefined, {}]) assert.equal(normalizeKey(bad), null, String(bad));
  assert.equal(normalizeKey('x'.repeat(80)).length, 80);
});

test('keysOfText: 글 전체 철자, 앞뒤 부호를 걷은 철자도 후보', () => {
  assert.deepEqual(keysOfText('PCA'), ['pca']);
  assert.deepEqual(keysOfText('"PCA."'), ['pca']);
  assert.deepEqual(keysOfText(' e.g. '), ['e.g.', 'e.g']);
  assert.deepEqual(keysOfText('a_b'), []);
});

test('parseMydictOp: set 은 정리·검증(ko 1~80, exp 0~120, note 0~200, 상한 초과는 자르지 않고 거절)', () => {
  assert.deepEqual(parseMydictOp({ op: 'set', key: ' PCA ', ko: ' 주성분  분석 ' }), { op: 'set', key: 'pca', ko: '주성분 분석', exp: '', note: '', url: '', title: '' });
  const full = parseMydictOp({ op: 'set', key: 'pca', ko: '가'.repeat(80), exp: 'e'.repeat(120), note: 'n'.repeat(200), url: 'https://a.test/x', title: 'T' });
  assert.equal(full.ko.length, 80);
  assert.equal(full.exp.length, 120);
  assert.equal(full.note.length, 200);
  assert.deepEqual(parseMydictOp({ op: 'delete', key: 'PCA', ko: 'ignored' }), { op: 'delete', key: 'pca' });
  const base = { op: 'set', key: 'pca', ko: '뜻' };
  for (const bad of [null, 'x', [], {}, { op: 'drop', key: 'pca' }, { op: 'set', key: 'pca' }, { op: 'set', key: 'a_b', ko: '뜻' }, { op: 'delete' }, { op: 'delete', key: 'a/b' },
    { ...base, ko: '' }, { ...base, ko: '   ' }, { ...base, ko: '가'.repeat(81) }, { ...base, ko: 5 }, { ...base, exp: 'e'.repeat(121) }, { ...base, exp: 5 }, { ...base, note: 'n'.repeat(201) },
    { ...base, note: {} }, { ...base, url: 'javascript:alert(1)' }, { ...base, url: 5 }, { ...base, title: 'T'.repeat(201) }]) {
    assert.equal(parseMydictOp(bad), null, JSON.stringify(bad));
  }
});

test('createMydict: 처음엔 비어 있고, set 은 저장·덮어쓰기, delete 는 지운다, 응답에 빈 칸은 안 싣는다', () => {
  const { file, m } = fresh();
  assert.deepEqual(m.all(), { entries: {} });
  const r = set(m, { key: 'PCA', ko: '주성분 분석', exp: 'Principal Component Analysis' });
  assert.deepEqual(r, { entries: { pca: { ko: '주성분 분석', exp: 'Principal Component Analysis', ts: 1000 } } });
  set(m, { key: 'pca', ko: '주성분', note: '차원 축소', url: 'https://a.test/p', title: '글' });
  assert.deepEqual(m.all().entries.pca, { ko: '주성분', note: '차원 축소', url: 'https://a.test/p', title: '글', ts: 1001 }); // 덮어쓰면 옛 exp 는 없다
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), m.all());
  assert.deepEqual(m.apply(parseMydictOp({ op: 'delete', key: 'PCA' })), { entries: {} });
  assert.deepEqual(m.apply(parseMydictOp({ op: 'delete', key: 'nothing' })), { entries: {} });
  assert.deepEqual(readdirSync(join(file, '..')).filter((f) => f.endsWith('.tmp')), []);
});

test('createMydict: constructor 같은 이름도 평범한 키', () => {
  const { m } = fresh();
  assert.equal(m.get('constructor'), null);
  set(m, { key: 'constructor', ko: '생성자' });
  assert.deepEqual(Object.keys(m.all().entries), ['constructor']);
  assert.equal(m.get('toString'), null);
});

test('createMydict: 새로 열어도 같은 상태, 깨진 파일은 빈 상태로 시작하되 .broken 으로 남긴다, 모양이 틀린 항목은 버린다', () => {
  const { file, m } = fresh();
  set(m, { key: 'pca', ko: '주성분 분석' });
  assert.deepEqual(createMydict({ file }).all(), m.all());
  writeFileSync(file, '{broken');
  assert.deepEqual(createMydict({ file }).all(), { entries: {} });
  assert.equal(readFileSync(`${file}.broken`, 'utf8'), '{broken');
  writeFileSync(file, JSON.stringify({ entries: { 'A_B': { ko: 'x' }, ok: { ko: '뜻' }, empty: { ko: '' }, bad: 5 } }));
  assert.deepEqual(Object.keys(createMydict({ file }).all().entries), ['ok']);
  assert.equal(existsSync(`${file}.broken`), true);
});

test('find: 복수형 규칙까지 본다(원형이 key), findText: 글 전체가 키와 같을 때만', () => {
  const { m } = fresh();
  set(m, { key: 'exploit', ko: '악용' });
  set(m, { key: 'principal component analysis', ko: '주성분 분석' });
  assert.equal(m.find('exploits').key, 'exploit');
  assert.equal(m.find('Exploit').ko, '악용');
  assert.equal(m.find('exploiter'), null);
  assert.equal(m.findText(' Principal  Component Analysis. ').ko, '주성분 분석');
  assert.equal(m.findText('principal component'), null);
  assert.equal(m.findText('Use principal component analysis here'), null);
});

test('termsIn: 글 안의 키를 나온 순서로, 낱말 경계에서만(뒤 s 는 복수), 구도 찾는다, 상한', () => {
  const { m } = fresh();
  set(m, { key: 'pca', ko: '주성분 분석' });
  set(m, { key: 'exploit', ko: '악용' });
  set(m, { key: 'cross site scripting', ko: '교차 사이트 스크립팅' });
  assert.deepEqual(m.termsIn('We use PCA before exploits; Cross  Site\nScripting too.'), ['pca=주성분 분석', 'exploit=악용', 'cross site scripting=교차 사이트 스크립팅']);
  assert.deepEqual(m.termsIn('pcas pca-x'), ['pca=주성분 분석']); // pcas(복수)·pca-x(하이픈 뒤 경계)는 맞다
  assert.deepEqual(m.termsIn('xpca apca exploiter'), []);
  assert.deepEqual(m.termsIn('pca exploit', 1), ['pca=주성분 분석']);
  assert.deepEqual(m.termsIn(''), []);
});
