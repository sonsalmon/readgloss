import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { start } from '../fixtures/bridge-harness.mjs';

const noon = () => new Date(2026, 9, 6, 12, 0, 0).getTime();
const withBridge = (fn, opts) => async () => {
  const s = await start({ start: noon(), ...opts });
  try {
    await fn(s);
  } finally {
    await s.close();
  }
};
const today = async (s, days = 1) => (await s.get(`/study?days=${days}`)).json().days[0];
const PAGE = { url: 'https://example.test/post', title: '글' };

test('/study: 토큰 401, 메서드 GET 만, days 는 1~60 정수(기본 7), 기록 없는 날도 0 으로', withBridge(async (s) => {
  assert.equal((await s.get('/study', { headers: {} })).status, 401);
  assert.equal((await s.post('/study', {})).status, 405);
  const r = (await s.get('/study')).json();
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.days[0], { date: '2026-10-06', counts: { dict: 0, mt: 0, context: 0, aigloss: 0, paragraph: 0, save: 0, known: 0, mydict: 0 }, items: [] });
  assert.equal((await s.get('/study?days=60')).json().days.length, 60);
  assert.equal((await s.get('/study?days=1')).json().days.length, 1);
  for (const bad of ['0', '61', '-3', 'abc', '1.5', '', '7x']) assert.equal((await s.get(`/study?days=${bad}`)).status, 400, bad);
}));

test('이벤트 종류가 각각 기록되고 /study 가 집계한다(text·ko·url, page.url 사용). /mt 는 T19부터 기록하지 않는다', withBridge(async (s) => {
  const p = { page: PAGE };
  await s.post('/dict', { word: 'payload', ...p }); // dict (fake 사전에 있다)
  await s.post('/mt', { text: 'the payload', ...p });
  await s.post('/translate-context', { text: 'the payload', context: { before: 'b' }, ...p });
  await s.post('/lookup', { word: 'payload', sentence: 'A payload.', ...p });
  await s.post('/translate', { text: 'paragraph '.repeat(5) + 'x'.repeat(500), ...p });
  await s.post('/words', { op: 'save', lemma: 'payload', word: 'payloads', gloss: '페이로드', sentence: 'x', url: 'https://other.test/w', ...p });
  await s.post('/words', { op: 'save-phrase', text: 'Apply the patch.', translation: '패치를 적용한다.', ...p });
  await s.post('/words', { op: 'known', lemma: 'patch', ...p });
  await s.post('/mydict', { op: 'set', key: 'pca', ko: '주성분 분석', ...p });
  const d = await today(s);
  assert.deepEqual(d.counts, { dict: 1, mt: 0, context: 1, aigloss: 1, paragraph: 1, save: 2, known: 1, mydict: 1 });
  const by = (kind) => d.items.filter((i) => i.kind === kind);
  assert.deepEqual([by('dict')[0].text, by('dict')[0].ko, by('dict')[0].url], ['payload', '수익 하중', PAGE.url]);
  assert.deepEqual(by('mt'), []); // /mt 는 공부 기록에 남지 않는다
  assert.deepEqual([by('context')[0].text, by('context')[0].ko], ['the payload', '문맥 번역']);
  assert.deepEqual([by('aigloss')[0].text, by('aigloss')[0].ko], ['payload', '뜻']);
  assert.equal(by('paragraph')[0].text.length, 200); // 문단 앞 200자
  assert.equal(by('paragraph')[0].ko, '번역');
  const saves = by('save');
  assert.deepEqual(saves.map((i) => [i.text, i.ko, i.url]).sort(), [['Apply the patch.', '패치를 적용한다.', PAGE.url], ['payloads', '페이로드', 'https://other.test/w']].sort()); // 낱말은 자기 주소가 우선
  assert.deepEqual([by('known')[0].text, 'ko' in by('known')[0], by('known')[0].url], ['patch', false, PAGE.url]);
  assert.deepEqual([by('mydict')[0].text, by('mydict')[0].ko], ['pca', '주성분 분석']);
  assert.deepEqual(s.asked.lookup.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'study-log.jsonl'), 'utf8').trim().split('\n')[0]).kind, 'dict');
}));

test('표현(kind expression) 저장도 save 로 기록한다(text=en, ko=뜻, url=page.url)', withBridge(async (s) => {
  await s.post('/words', { op: 'save-phrase', text: 'delve into', translation: '깊이 파고들다', kind: 'expression', sentence: 'This module delves into math.', page: PAGE });
  const d = await today(s);
  assert.equal(d.counts.save, 1);
  assert.deepEqual(d.items.map((i) => [i.kind, i.text, i.ko, i.url]), [['save', 'delve into', '깊이 파고들다', PAGE.url]]);
}));

test('/translate: bulk:true(전체 번역)는 문단 기록을 남기지 않고, 그 외에는 남긴다', withBridge(async (s) => {
  await s.post('/translate', { text: 'Bulk paragraph one.', bulk: true, page: PAGE });
  await s.post('/translate', { text: 'Bulk paragraph two.', bulk: true, page: PAGE });
  await s.post('/translate', { text: 'Normal paragraph.', page: PAGE });
  const d = await today(s);
  assert.equal(d.counts.paragraph, 1);
  assert.deepEqual(d.items.filter((i) => i.kind === 'paragraph').map((i) => i.text), ['Normal paragraph.']);
}));

test('캐시 적중도 기록하고, 응답 못 한 요청·사전에 없는 단어·알아요 취소·최근 기록은 안 남긴다', withBridge(async (s) => {
  await s.post('/lookup', { word: 'payload', sentence: 'A payload.' });
  await s.post('/lookup', { word: 'payload', sentence: 'A payload.' }); // 캐시
  await s.post('/translate', { text: 'Same text.' });
  await s.post('/translate', { text: 'Same text.' });
  await s.post('/dict', { word: 'zzzzzz' }); // 사전·용어집·내 사전·약어집 어디에도 없다
  await s.post('/translate-context', { text: '' }); // 400
  await s.post('/words', { op: 'unknown', lemma: 'patch' });
  await s.post('/words', { op: 'history', lemma: 'patch' });
  await s.post('/words', { op: 'unsave', lemma: 'patch' });
  await s.post('/mydict', { op: 'delete', key: 'pca' });
  await s.post('/mydict', { op: 'set', key: 'a_b', ko: 'x' }); // 400
  await s.post('/annotate', { words: ['payload'] });
  const d = await today(s);
  assert.deepEqual(d.counts, { dict: 0, mt: 0, context: 0, aigloss: 2, paragraph: 2, save: 0, known: 0, mydict: 0 });
  assert.equal(s.asked.lookup.length, 1);
  assert.equal(s.asked.translate.length, 1);
}));

test('/dict: 약어·내 사전만 있어도(사전에는 없어도) 기록한다', withBridge(async (s) => {
  await s.post('/dict', { word: 'PCA' }); // 약어집
  await s.post('/mydict', { op: 'set', key: 'zzzzzz', ko: '내 뜻' });
  await s.post('/dict', { word: 'zzzzzz' }); // 내 사전
  const d = await today(s);
  assert.equal(d.counts.dict, 2);
  assert.deepEqual(d.items.filter((i) => i.kind === 'dict').map((i) => [i.text, i.ko]).sort(), [['PCA', '주성분 분석'], ['zzzzzz', '내 뜻']].sort());
}));

test('날짜별 집계(로컬 날짜)와 항목 최신순, page.url 이 http(s) 가 아니면 url 을 빼고 요청은 그대로 성공', withBridge(async (s) => {
  await s.post('/lookup', { word: 'first', sentence: 'x', page: { url: 'javascript:alert(1)' } });
  s.clock.t += 60_000;
  await s.post('/lookup', { word: 'second', sentence: 'x', page: { url: 'https://a.test/' } });
  s.clock.t += 24 * 3_600_000 * 2; // 이틀 뒤
  await s.post('/lookup', { word: 'later', sentence: 'x', page: 5 });
  const r = (await s.get('/study?days=3')).json().days;
  assert.deepEqual(r.map((x) => x.date), ['2026-10-08', '2026-10-07', '2026-10-06']);
  assert.deepEqual(r.map((x) => x.counts.aigloss), [1, 0, 2]);
  assert.deepEqual(r[2].items.map((i) => i.text), ['second', 'first']);
  assert.equal('url' in r[2].items[1], false);
  assert.equal(r[2].items[0].url, 'https://a.test/');
  assert.equal('url' in r[0].items[0], false);
}));

test('기록을 못 써도 응답은 그대로(기록 실패는 응답에 영향 없음)', async () => {
  const dir = (await import('node:fs')).mkdtempSync(join((await import('node:os')).tmpdir(), 'rg-t14b-fail-'));
  const s = await start({ dir, start: noon(), studyFile: join(dir, 'token', 'cannot', 'study-log.jsonl') }); // token 은 파일이라 폴더를 못 만든다
  try {
    assert.equal((await s.post('/dict', { word: 'payload' })).status, 200);
    assert.equal((await s.post('/lookup', { word: 'payload', sentence: 'A payload.' })).status, 200);
    assert.equal((await s.post('/mydict', { op: 'set', key: 'pca', ko: '뜻' })).status, 200);
    assert.equal((await s.get('/study')).json().days[0].counts.dict, 0);
  } finally {
    await s.close();
  }
});
