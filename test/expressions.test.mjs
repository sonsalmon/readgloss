import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// T17b: 드래그 카드·문단 번역 블록의 "기억할 표현" 순수 로직(selection-core.js)
await import('../extension/text.js');
await import('../extension/selection-core.js');
const S = globalThis.readglossSelection;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('expressionRows: en 2~60자·ko 1~60자만 남기고 6개까지, 이미 담은 표현은 id 를 단다', () => {
  const phrases = { abc123abc123: { text: 'delve into', kind: 'expression' } };
  const rows = S.expressionRows(
    [{ en: ' delve   into ', ko: '~을 깊이 있게 탐구하다' }, { en: 'x', ko: '짧음' }, { en: 'ok', ko: '' }, { en: 'a'.repeat(61), ko: '김' }, { en: 'fine', ko: 'k'.repeat(61) }, null, { en: 'zero-day', ko: '제로데이' }],
    phrases,
  );
  assert.deepEqual(rows, [{ en: 'delve into', ko: '~을 깊이 있게 탐구하다', id: 'abc123abc123' }, { en: 'zero-day', ko: '제로데이', id: null }]);
  const many = Array.from({ length: 9 }, (_, i) => ({ en: `phrase ${i}`, ko: `뜻${i}` }));
  assert.equal(S.expressionRows(many).length, 6);
  assert.deepEqual(S.expressionRows(undefined), []);
  assert.deepEqual(S.expressionRows('nope'), []);
});

test('noteText: note 는 표현 목록이 비었을 때만 보인다', () => {
  const some = S.expressionRows([{ en: 'delve into', ko: '탐구하다' }]);
  assert.equal(S.noteText('비유적 표현', some), '');
  assert.equal(S.noteText('비유적 표현', []), '비유적 표현');
  assert.equal(S.noteText('비유적 표현', S.expressionRows([{ en: 'x', ko: '깨진 항목뿐' }])), '비유적 표현');
  assert.equal(S.noteText(undefined, []), '');
});

test('expressionButton: ☆/★ 과 aria-label(보이는 글자 포함)', () => {
  const off = S.expressionButton('delve into', false);
  const on = S.expressionButton('delve into', true);
  assert.deepEqual([off.text, on.text], ['☆', '★']);
  for (const b of [off, on]) assert.ok(b.label.includes(b.text) && b.label.includes('delve into'), b.label);
  assert.match(on.label, /빼기/);
});

test('expressionToggle: 안 담았으면 save-phrase(kind expression·sentence), 담았으면 unsave-phrase', () => {
  const src = { sentence: 'Let us delve into the topic.', url: 'https://x.test/a', title: 'T' };
  assert.deepEqual(S.expressionToggle({ en: 'delve into', ko: '탐구하다', id: null }, src), {
    type: 'words', op: 'save-phrase', text: 'delve into', translation: '탐구하다', kind: 'expression', base: 'delve into', sentence: 'Let us delve into the topic.', url: 'https://x.test/a', title: 'T',
  });
  assert.deepEqual(S.expressionToggle({ en: 'delve into', ko: '탐구하다', id: 'abc123abc123' }, src), { type: 'words', op: 'unsave-phrase', id: 'abc123abc123' });
  const long = S.expressionToggle({ en: 'delve into', ko: 'k', id: null }, { sentence: `${'s '.repeat(800)}`, url: '', title: '' });
  assert.equal(long.sentence.length <= 1000, true);
  assert.equal('url' in long, false, '빈 주소·제목은 싣지 않는다');
  assert.equal('title' in long, false);
});

test('lookupExtras: readgloss:lookup 의 context·source 는 모양이 맞을 때만(http/https 주소, 문자열)', () => {
  const ok = S.lookupExtras({ context: { before: 'Stored sentence.', after: '', title: 'T', headings: [] }, source: { url: 'https://a.test/x', title: 'A' } });
  assert.deepEqual(ok, { context: { before: 'Stored sentence.', after: '', title: 'T', headings: [] }, source: { url: 'https://a.test/x', title: 'A' }, nolog: false });
  assert.deepEqual(S.lookupExtras({}), { context: undefined, source: undefined, nolog: false });
  assert.equal(S.lookupExtras({ drag: true }).nolog, true, '드래그로 연 카드는 nolog');
  assert.equal(S.lookupExtras({ drag: false }).nolog, false);
  assert.equal(S.lookupExtras({ source: { url: 'javascript:alert(1)' } }).source, undefined);
  assert.equal(S.lookupExtras({ source: { url: 42 } }).source, undefined);
  assert.equal(S.lookupExtras({ context: { before: 5 } }).context, undefined);
  assert.equal(S.lookupExtras({ context: { before: '' } }).context, undefined, '빈 문맥은 쓰지 않는다');
  assert.equal(S.lookupExtras({ context: { before: 'x'.repeat(2000) } }).context.before.length, 1500);
});

test('배선: 번역 응답의 expressions 와 save-phrase 의 kind 를 background.js 가 그대로 전달한다', () => {
  const bg = read('background.js');
  assert.match(bg, /expressions: data\.expressions/, '문단 번역 응답');
  assert.match(bg, /const \{[^}]*\bkind\b[^}]*\} = msg/, 'words 요청의 kind 를 읽는다');
  assert.match(bg, /JSON\.stringify\(\{ op,[^}]*\bkind\b/, 'kind 를 다리로 보낸다');
});

test('배선: 내용 스크립트 순서(T24 스크랩 파일 3개 포함)', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.deepEqual(m.content_scripts[0].js, ['text.js', 'settings-core.js', 'glossary-core.js', 'paragraph-core.js', 'annotate-core.js', 'content.js', 'paragraph.js', 'annotate.js', 'structure-core.js', 'structure.js', 'saved-marks-core.js', 'saved-marks.js', 'panel.js', 'panel-scraps.js', 'panel-concepts.js', 'panel-words.js', 'panel-study.js', 'panel-marks.js', 'vendor/approx-string-match.js', 'scrap-core.js', 'scrap.js', 'md-list.js', 'concept-core.js', 'concept.js', 'memo-core.js', 'study-time-core.js', 'study-time.js', 'memo-pad.js', 'selection-core.js', 'selection.js', 'opacity.js', 'video-core.js', 'video-subs.js', 'panel-video.js']); // T28: 개념 파일 3개, T29b: 메모장 2개, T34a: 투명도, T40a: 시간 2개, T51: 영상 3개, T60c: 다시 볼 것 탭
  assert.deepEqual(m.permissions, ['storage']);
});
