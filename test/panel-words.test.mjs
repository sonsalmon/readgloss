import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../extension/panel-words.js';

const W = globalThis.readglossWords;
const info = (lemma, ts, gloss = '', sentence = '') => ({ word: lemma, gloss, sentence, url: 'https://a.test/', ts });
const state = {
  known: { delve: { ts: 30 }, payload: { ts: 50 } },
  saved: { mitigation: info('mitigation', 10, '완화', 'Apply mitigations.'), payload: info('payload', 20, '탑재량', 'The payload runs.') },
  history: [{ lemma: 'exploit', ...info('exploit', 90, '이용하다', 'Attackers exploit it.') }, { lemma: 'delve', ...info('delve', 80, '파고들다', 'Delve into it.') }, { lemma: 'payload', ...info('payload', 70, '탑재량', 'The payload runs.') }],
};

test('패널 탭이 id words, 이름 내 단어, order 20 으로 등록된다(계약 E)', () => {
  const tab = globalThis.readglossPanelTabs.find((t) => t.id === 'words');
  assert.deepEqual([tab.title, tab.order, typeof tab.render], ['내 단어', 20, 'function']);
});

test('counts / LISTS: 하위 탭 세 개와 개수', () => {
  assert.deepEqual(W.LISTS.map((l) => l.title), ['단어장', '아는 단어', '최근 찾은 단어']);
  assert.deepEqual(W.counts(state), { saved: 2, known: 2, history: 3 });
});

test('rowsFor: 단어장은 최근 추가순, 줄마다 원형·뜻·문장·시각·동작(빼기·알아요/알아요 취소)', () => {
  const rows = W.rowsFor(state, 'saved');
  assert.deepEqual(rows.map((r) => r.lemma), ['payload', 'mitigation']);
  assert.deepEqual([rows[1].gloss, rows[1].sentence, rows[1].ts], ['완화', 'Apply mitigations.', 10]);
  assert.deepEqual(rows[1].actions, [{ op: 'unsave', label: '빼기' }, { op: 'known', label: '알아요' }]);
  assert.deepEqual(rows[0].actions, [{ op: 'unsave', label: '빼기' }, { op: 'unknown', label: '알아요 취소' }]); // payload 는 이미 아는 단어
});

test('rowsFor: 아는 단어는 단어장·최근 기록에서 뜻과 문장을 빌리고 동작은 알아요 취소 하나', () => {
  const rows = W.rowsFor(state, 'known');
  assert.deepEqual(rows.map((r) => [r.lemma, r.gloss, r.sentence]), [['payload', '탑재량', 'The payload runs.'], ['delve', '파고들다', 'Delve into it.']]);
  assert.deepEqual(rows[0].actions, [{ op: 'unknown', label: '알아요 취소' }]);
  assert.deepEqual(W.rowsFor({ known: { zzz: { ts: 1 } }, saved: {}, history: [] }, 'known'), [{ lemma: 'zzz', word: 'zzz', gloss: '', sentence: '', url: '', ts: 1, actions: [{ op: 'unknown', label: '알아요 취소' }] }]);
});

test('rowsFor: 최근 찾은 단어는 기록 순서 그대로, 동작은 단어장에 추가·알아요(했으면 되돌리기)', () => {
  const rows = W.rowsFor(state, 'history');
  assert.deepEqual(rows.map((r) => r.lemma), ['exploit', 'delve', 'payload']);
  assert.deepEqual(rows[0].actions, [{ op: 'save', label: '단어장에 추가' }, { op: 'known', label: '알아요' }]);
  assert.deepEqual(rows[1].actions, [{ op: 'save', label: '단어장에 추가' }, { op: 'unknown', label: '알아요 취소' }]);
  assert.deepEqual(rows[2].actions, [{ op: 'unsave', label: '단어장에서 빼기' }, { op: 'unknown', label: '알아요 취소' }]);
});

test('rowsFor: 검색은 원형 앞부분 일치(대소문자·앞뒤 공백 무시), 중간 일치는 안 됨', () => {
  assert.deepEqual(W.rowsFor(state, 'history', ' EX ').map((r) => r.lemma), ['exploit']);
  assert.deepEqual(W.rowsFor(state, 'history', 'ploit'), []);
  assert.deepEqual(W.rowsFor(state, 'saved', 'm').map((r) => r.lemma), ['mitigation']);
  assert.equal(W.rowsFor(state, 'saved', '').length, 2);
});

test('messageFor: save 는 단어·뜻·문장·주소를 싣고, 나머지는 원형만', () => {
  const row = W.rowsFor(state, 'history')[0];
  assert.deepEqual(W.messageFor('save', row), { type: 'words', op: 'save', lemma: 'exploit', word: 'exploit', gloss: '이용하다', sentence: 'Attackers exploit it.', url: 'https://a.test/' });
  assert.deepEqual(W.messageFor('known', row), { type: 'words', op: 'known', lemma: 'exploit' });
});

test('buttonModel: 카드 두 버튼 토글 문구·동작, aria-label 이 보이는 글자를 포함한다', () => {
  const off = W.buttonModel();
  assert.deepEqual([off.save.op, off.save.text, off.known.op, off.known.text], ['save', '☆ 단어장에 추가', 'known', '✓ 알아요']);
  const on = W.buttonModel({ saved: true, known: true });
  assert.deepEqual([on.save.op, on.save.text, on.known.op, on.known.text], ['unsave', '★ 단어장에 있음', 'unknown', '알아요 취소']);
  for (const b of [off.save, off.known, on.save, on.known]) assert.ok(b.label.includes(b.text), b.label);
});

test('eventDetail: 알아요는 known, 취소는 unknown 원형 배열(둘 다 배열), 그 밖의 동작은 null', () => {
  assert.deepEqual(W.eventDetail('known', 'delve'), { known: ['delve'], unknown: [] });
  assert.deepEqual(W.eventDetail('unknown', 'delve'), { known: [], unknown: ['delve'] });
  for (const op of ['save', 'unsave', 'history']) assert.equal(W.eventDetail(op, 'delve'), null);
});

test('formatDate: YYYY.MM.DD(현지 날짜), 이상한 값은 빈 문자열', () => {
  assert.equal(W.formatDate(new Date(2026, 9, 6, 13, 5).getTime()), '2026.10.06');
  assert.equal(W.formatDate(NaN), '');
});

test('panel-words.js: ES 모듈 import/export 없음, manifest 에서 panel.js 뒤(드래그 번역 두 파일만 그 뒤)에 있다', () => {
  assert.doesNotMatch(readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8'), /^\s*(import|export)\s/m);
  const js = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')).content_scripts[0].js;
  assert.ok(js.indexOf('panel-words.js') > js.indexOf('panel.js'));
  assert.deepEqual(js.slice(js.indexOf('panel-words.js') + 1), ['selection-core.js', 'selection.js']);
});
