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

test('panel-words.js: ES 모듈 import/export 없음, manifest 에서 panel.js 뒤(공부 기록·드래그 번역 파일만 그 뒤)에 있다', () => {
  assert.doesNotMatch(readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8'), /^\s*(import|export)\s/m);
  const js = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')).content_scripts[0].js;
  assert.ok(js.indexOf('panel-words.js') > js.indexOf('panel.js'));
  assert.deepEqual(js.slice(js.indexOf('panel-words.js') + 1), ['panel-study.js', 'vendor/approx-string-match.js', 'scrap-core.js', 'scrap.js', 'md-list.js', 'concept-core.js', 'concept.js', 'memo-core.js', 'memo-pad.js', 'selection-core.js', 'selection.js']); // T14c·T28·T29b: 공부 기록 탭이 바로 뒤
});

// ---- T14c: 구·문장 / 내 사전 ----
const phrases = {
  aaa111: { text: 'Defense in depth layers multiple controls.', translation: '심층 방어는 여러 통제를 겹겹이 둔다.', context: { translation: '보안에서 심층 방어는...', note: '비유적 표현', wide: true }, url: 'https://a.test/x', title: 'Layered security', ts: 100 },
  bbb222: { text: 'x'.repeat(400), translation: '긴 글', url: 'javascript:alert(1)', ts: 300 },
  ccc333: { text: 'least privilege', translation: '최소 권한', url: 'https://b.test/page', ts: 200 },
};
const mine = {
  pca: { ko: '주성분 분석', exp: 'Principal Component Analysis', ts: 10 },
  xss: { ko: '교차 사이트 스크립팅', note: '웹 취약점', ts: 30 },
  'zero day': { ko: '제로데이', ts: 20 },
};

test('SUBS: 기존 세 목록 뒤에 구·문장과 내 사전이 더해지고, LISTS 는 그대로 세 개', () => {
  assert.deepEqual(W.SUBS.map((l) => l.id), ['saved', 'known', 'history', 'phrases', 'mydict']);
  assert.deepEqual(W.SUBS.slice(3).map((l) => l.title), ['구·문장', '내 용어집']);
  assert.equal(W.LISTS.length, 3);
  assert.deepEqual(W.countsAll({ ...state, phrases }, mine), { saved: 2, known: 2, history: 3, phrases: 3, mydict: 3 });
  assert.deepEqual(W.countsAll(state, null), { saved: 2, known: 2, history: 3, phrases: 0, mydict: 0 }); // 옛 다리: phrases 없음
});

test('phraseRows: 최근 저장순, 원문은 300자에서 말줄임(전체는 text), 안전하지 않은 주소는 링크가 아니다', () => {
  const rows = W.phraseRows(phrases);
  assert.deepEqual(rows.map((r) => r.id), ['bbb222', 'ccc333', 'aaa111']);
  assert.equal(rows[0].preview.length, 301);
  assert.ok(rows[0].preview.endsWith('…'));
  assert.equal(rows[0].text.length, 400);
  assert.equal(rows[0].href, ''); // javascript: 는 링크로 쓰지 않는다
  assert.deepEqual([rows[2].href, rows[2].title, rows[2].context.wide], ['https://a.test/x', 'Layered security', true]);
  assert.equal(rows[1].title, 'b.test'); // 제목이 없으면 호스트
  assert.equal(W.clip('abc', 5), 'abc');
});

test('phraseRows: 검색은 원문·맥 번역·문맥 번역·메모 어디든 포함 일치(대소문자 무시)', () => {
  assert.deepEqual(W.phraseRows(phrases, 'DEPTH').map((r) => r.id), ['aaa111']);
  assert.deepEqual(W.phraseRows(phrases, '최소').map((r) => r.id), ['ccc333']);
  assert.deepEqual(W.phraseRows(phrases, '보안에서').map((r) => r.id), ['aaa111']);
  assert.deepEqual(W.phraseRows(phrases, '비유').map((r) => r.id), ['aaa111']);
  assert.deepEqual(W.phraseRows(phrases, 'privil').map((r) => r.id), ['ccc333']); // 중간 일치도 된다
  assert.deepEqual(W.phraseRows(undefined), []);
});

test('mydictRows: 최근 순, 검색은 key 앞부분 또는 뜻·풀이·메모 포함', () => {
  assert.deepEqual(W.mydictRows(mine).map((r) => r.key), ['xss', 'zero day', 'pca']);
  assert.deepEqual(W.mydictRows(mine, ' PC ').map((r) => r.key), ['pca']);
  assert.deepEqual(W.mydictRows(mine, 'day').map((r) => r.key), []); // key 는 앞부분만
  assert.deepEqual(W.mydictRows(mine, '주성분').map((r) => r.key), ['pca']);
  assert.deepEqual(W.mydictRows(mine, 'component').map((r) => r.key), ['pca']);
  assert.deepEqual(W.mydictRows(mine, '취약점').map((r) => r.key), ['xss']);
});

test('checkMydict: key 는 소문자·공백 정리, 규칙(영문 [a-z0-9 \'’.-], 1~80자) 밖은 거절', () => {
  assert.deepEqual(W.checkMydict({ key: '  Zero   Day ', ko: ' 제로데이 ' }), { ok: true, value: { key: 'zero day', ko: '제로데이', exp: '', note: '' } });
  assert.equal(W.checkMydict({ key: "O'Brien-v2.1", ko: '가' }).ok, true);
  assert.equal(W.checkMydict({ key: 'don’t', ko: '가' }).ok, true);
  for (const key of ['', '   ', '주성분', 'a_b', 'a/b', 'a@b', 'x'.repeat(81)]) {
    const r = W.checkMydict({ key, ko: '가' });
    assert.deepEqual([r.ok, r.field], [false, 'key'], key);
  }
  assert.equal(W.checkMydict({ key: 'x'.repeat(80), ko: '가' }).ok, true);
});

test('checkMydict: 뜻 1~80, 풀이 0~120, 메모 0~200자', () => {
  const f = (o) => W.checkMydict({ key: 'pca', ko: '뜻', ...o });
  assert.deepEqual([f({ ko: '' }).field, f({ ko: '  ' }).field, f({ ko: '가'.repeat(81) }).field], ['ko', 'ko', 'ko']);
  assert.equal(f({ ko: '가'.repeat(80) }).ok, true);
  assert.deepEqual([f({ exp: 'e'.repeat(121) }).field, f({ note: 'n'.repeat(201) }).field], ['exp', 'note']);
  assert.equal(f({ exp: 'e'.repeat(120), note: 'n'.repeat(200) }).ok, true);
  for (const r of [f({ ko: '' }), f({ exp: 'e'.repeat(121) })]) assert.match(r.error, /[가-힣]/);
});

test('mydictMessage: 빈 풀이·메모는 빼고, 고칠 때는 기존 출처(url·title)를 그대로 싣는다', () => {
  const v = W.checkMydict({ key: 'PCA', ko: '주성분 분석', exp: 'Principal Component Analysis' }).value;
  assert.deepEqual(W.mydictMessage(v), { type: 'mydict', op: 'set', key: 'pca', ko: '주성분 분석', exp: 'Principal Component Analysis' });
  const edit = W.checkMydict({ key: 'pca', ko: '주성분', note: '메모' }).value;
  assert.deepEqual(W.mydictMessage(edit, { url: 'https://a.test/', title: 'T' }), { type: 'mydict', op: 'set', key: 'pca', ko: '주성분', note: '메모', url: 'https://a.test/', title: 'T' });
});

test('mydictEventDetail / unsavePhraseMessage: 계약 모양', () => {
  assert.deepEqual(W.mydictEventDetail('set', 'pca'), { set: ['pca'], delete: [] });
  assert.deepEqual(W.mydictEventDetail('delete', 'pca'), { set: [], delete: ['pca'] });
  assert.deepEqual(W.unsavePhraseMessage('abc'), { type: 'words', op: 'unsave-phrase', id: 'abc' });
});

// ---- T17b: 구·문장 탭의 주 번역·표현·필터, 저장 문장에서 낱말 더블클릭 ----
await import('../extension/text.js'); // readgloss.cleanSelection
const mixed = {
  s1: { text: 'Defense in depth layers multiple controls.', translation: '맥 번역 글', context: { translation: '보안에서 심층 방어는 여러 통제를 겹친다.', note: '비유' }, url: 'https://a.test/x', title: 'Layered', ts: 100 },
  s2: { text: 'Wide sentence.', translation: '맥 번역 둘', context: { translation: '넓은 문맥으로 본 번역', wide: true }, ts: 200 },
  s3: { text: 'Only machine translated.', translation: '맥 번역만 있음', ts: 300 },
  e1: { text: 'delve into', translation: '~을 깊이 있게 탐구하다', kind: 'expression', sentence: 'This module will delve into the math.', url: 'https://c.test/p', title: 'Course', ts: 400 },
};

test('phrasePrimary: 문맥 번역이 있으면 그것(넓으면 넓은 문맥 번역), 맥 번역은 없을 때만', () => {
  assert.deepEqual(W.phrasePrimary(mixed.s1), { title: '문맥 번역', text: '보안에서 심층 방어는 여러 통제를 겹친다.' });
  assert.deepEqual(W.phrasePrimary(mixed.s2), { title: '넓은 문맥 번역', text: '넓은 문맥으로 본 번역' });
  assert.deepEqual(W.phrasePrimary(mixed.s3), { title: '', text: '맥 번역만 있음' });
  assert.deepEqual(W.phrasePrimary(mixed.e1), { title: '', text: '~을 깊이 있게 탐구하다' });
  assert.deepEqual(W.phrasePrimary({ text: 'x y' }), { title: '', text: '' });
});

test('phraseRows: 줄마다 kind(기본 문장)·sentence·주 번역·저장 제목, 맥 번역 필드는 주 번역에 안 섞인다', () => {
  const rows = W.phraseRows(mixed);
  assert.deepEqual(rows.map((r) => [r.id, r.kind]), [['e1', 'expression'], ['s3', 'sentence'], ['s2', 'sentence'], ['s1', 'sentence']]);
  const e = rows[0];
  assert.deepEqual([e.sentence, e.primary.text, e.sourceTitle], ['This module will delve into the math.', '~을 깊이 있게 탐구하다', 'Course']);
  assert.equal(rows[3].primary.title, '문맥 번역');
  assert.equal(rows[3].sentence, '');
  assert.equal(rows[1].sourceTitle, '');
});

test('phraseRows: 종류 필터(all·expression·sentence)와 검색(출처 문장도)', () => {
  assert.deepEqual(W.phraseRows(mixed, '', 'expression').map((r) => r.id), ['e1']);
  assert.deepEqual(W.phraseRows(mixed, '', 'sentence').map((r) => r.id), ['s3', 's2', 's1']);
  assert.equal(W.phraseRows(mixed, '', 'all').length, 4);
  assert.equal(W.phraseRows(mixed, '', 'nonsense').length, 4, '모르는 값은 전체');
  assert.deepEqual(W.phraseRows(mixed, 'the math').map((r) => r.id), ['e1'], '출처 문장도 검색된다');
  assert.deepEqual(W.phraseRows(mixed, 'delve', 'sentence'), []);
});

test('PHRASE_FILTERS·phraseCounts: 전체·표현·문장 칩과 개수', () => {
  assert.deepEqual(W.PHRASE_FILTERS.map((f) => [f.id, f.title]), [['all', '전체'], ['expression', '표현'], ['sentence', '문장']]);
  assert.deepEqual(W.phraseCounts(mixed), { all: 4, expression: 1, sentence: 3 });
  assert.deepEqual(W.phraseCounts(undefined), { all: 0, expression: 0, sentence: 0 });
});

test('pickWord: 더블클릭으로 잡힌 글에서 영어 낱말만(부호·공백은 걷고, 한글·숫자·여러 낱말은 null)', () => {
  assert.deepEqual(W.pickWord('delve '), { word: 'delve', start: 0 });
  assert.equal(W.pickWord('"module,"').word, 'module');
  for (const bad of ['', '한국어', '2fa', 'two words', null, undefined]) assert.equal(W.pickWord(bad), null, String(bad));
});

test('lookupDetail: 저장 문장을 문맥·문장으로, 저장 주소·제목을 출처로 readgloss:lookup 에 싣는다', () => {
  const rect = { left: 10, top: 20, bottom: 40, width: 5 };
  const d = W.lookupDetail({ word: 'delve', sentence: 'This module will delve into the math.', rect, url: 'https://c.test/p', title: 'Course' });
  assert.deepEqual(d, {
    word: 'delve', sentence: 'This module will delve into the math.', rect: { left: 10, top: 20, bottom: 40 },
    context: { before: 'This module will delve into the math.', after: '', title: 'Course', headings: [] },
    source: { url: 'https://c.test/p', title: 'Course' },
  });
  const none = W.lookupDetail({ word: 'delve', sentence: 'S.', rect, url: '', title: undefined });
  assert.equal('source' in none, false, '저장된 주소가 없으면 출처를 싣지 않는다(카드가 지금 페이지를 쓴다)');
  assert.equal(none.context.title, '');
  assert.equal(W.lookupDetail({ word: 'a', sentence: 'x'.repeat(1500), rect }).sentence.length, 1000);
});

// ---- T19: 메모 ----
test('memoMessage: 단어는 lemma, 구는 id 로 memo 를 싣는다(빈 문자열도 그대로)', () => {
  assert.deepEqual(W.memoMessage('mitigation', '모듈 290'), { type: 'words', op: 'memo', lemma: 'mitigation', memo: '모듈 290' });
  assert.deepEqual(W.memoMessage('abcdefabcdef', '', true), { type: 'words', op: 'memo', id: 'abcdefabcdef', memo: '' });
});

test('rowsFor: 단어장 줄은 memo 를 그대로 싣는다', () => {
  const st = { known: {}, saved: { mitigation: { word: 'mitigation', gloss: '완화', sentence: '', url: '', memo: '모듈 290', ts: 1 } }, history: [] };
  assert.deepEqual(W.rowsFor(st, 'saved').map((r) => [r.lemma, r.memo]), [['mitigation', '모듈 290']]);
});

test('phraseRows: 메모가 있으면 줄에 실리고 없으면 빈 문자열', () => {
  const rows = W.phraseRows({ aaa111: { text: 'x y', translation: '뜻', memo: '구 메모', ts: 5 }, bbb222: { text: 'p q', translation: '뜻', ts: 6 } });
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.memo])), { bbb222: '', aaa111: '구 메모' });
});
