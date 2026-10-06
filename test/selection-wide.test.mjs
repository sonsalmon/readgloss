import test from 'node:test';
import assert from 'node:assert/strict';

// T14a 의 순수 판단: 넓은 문맥, 버튼 단계, 내 사전 키·메시지, 가장 나은 뜻, 구 단어장 메시지
await import('../extension/text.js');
await import('../extension/selection-core.js');
const S = globalThis.readglossSelection;

test('상수: 넓은 문맥은 앞뒤 각 6000자·소제목 20개, 기본은 그대로', () => {
  assert.deepEqual([S.WIDE_SIDE, S.WIDE_HEADINGS, S.MAX_SIDE, S.MAX_HEADINGS], [6000, 20, 1500, 3]);
});

test('buildContext: wide 면 앞뒤 6000자·소제목 20개까지, 선택에 가까운 글을 남긴다', () => {
  const prev = ['x'.repeat(7000), 'near before'];
  const next = ['near after', 'y'.repeat(7000)];
  const headings = Array.from({ length: 25 }, (_, i) => `H${i}`);
  const narrow = S.buildContext({ prev, head: 'HEAD', tail: 'TAIL', next, headings });
  assert.equal(narrow.before.length, 1500);
  assert.equal(narrow.after.length, 1500);
  assert.equal(narrow.headings.length, 3);
  const wide = S.buildContext({ prev, head: 'HEAD', tail: 'TAIL', next, headings, wide: true });
  assert.equal(wide.before.length, 6000);
  assert.equal(wide.after.length, 6000);
  assert.ok(wide.before.endsWith('near before HEAD'));
  assert.ok(wide.after.startsWith('TAIL near after'));
  assert.equal(wide.headings.length, 20);
  assert.equal(wide.headings.at(-1), 'H24');
  const long = S.buildContext({ headings: ['a'.repeat(500)], wide: true });
  assert.equal(long.headings[0].length, 200);
});

test('pickHeadings: 20개 이하면 전부, 넘으면 선택 위치 근처 20개(현재 절이 들어간다)', () => {
  const list = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual(S.pickHeadings([1, 2, 3], 2, 20), [1, 2, 3]);
  const mid = S.pickHeadings(list, 30, 20); // 선택 위에 제목 30개
  assert.equal(mid.length, 20);
  assert.ok(mid.includes(29) && mid.includes(30), '선택 바로 위 제목과 바로 아래 제목');
  assert.deepEqual(S.pickHeadings(list, 0, 20), list.slice(0, 20), '맨 위');
  assert.deepEqual(S.pickHeadings(list, 50, 20), list.slice(30), '맨 아래');
});

test('stageButton: 문맥 번역 -> 더 넓게 보기 -> 숨김(문맥 번역·AI 문맥 뜻 같은 단계)', () => {
  const first = S.stageButton('ctx', {});
  assert.deepEqual([first.text, first.wide, first.hidden], ['문맥 번역', false, false]);
  const next = S.stageButton('ctx', { done: true });
  assert.deepEqual([next.text, next.wide, next.hidden], ['더 넓게 보기', true, false]);
  assert.equal(S.stageButton('ctx', { done: true, wide: true }).hidden, true);
  const ai = S.stageButton('ai', {});
  assert.equal(ai.text, 'AI 문맥 뜻');
  assert.equal(S.stageButton('ai', { done: true }).text, '더 넓게 보기');
  assert.equal(S.stageButton('ai', { done: true, wide: true }).hidden, true);
  for (const m of [first, next, ai, S.stageButton('ai', { done: true })]) assert.ok(m.label.includes(m.text), 'aria-label 은 보이는 글자를 포함');
});

test('mydictKey: 소문자·공백 정리, 1~80자, [a-z0-9 \'’.-] 만. 밖이면 null', () => {
  assert.equal(S.mydictKey('PCA'), 'pca');
  assert.equal(S.mydictKey('  Matrix   Multiplication '), 'matrix multiplication');
  assert.equal(S.mydictKey("don't"), "don't");
  assert.equal(S.mydictKey('don’t'), 'don’t');
  assert.equal(S.mydictKey('state-of-the-art v1.2'), 'state-of-the-art v1.2');
  assert.equal(S.mydictKey('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(S.mydictKey('a'.repeat(81)), null);
  for (const bad of ['', '   ', 'hello, world', 'what?', '한글', 'café', 'a/b', null, undefined, 3]) assert.equal(S.mydictKey(bad), null, String(bad));
});

test('bestMeaning: 넓은 문맥 > 문맥 > AI 문맥 뜻 > 약어 > 맥 번역 > 용어 > 분야 뜻 > 사전 첫 뜻, 80자까지', () => {
  const all = { wide: 'W', ctx: 'C', ai: 'A', acr: 'R', mt: 'M', term: 'T', sense: 'S', first: 'F' };
  const order = ['wide', 'ctx', 'ai', 'acr', 'mt', 'term', 'sense', 'first'];
  const want = { wide: 'W', ctx: 'C', ai: 'A', acr: 'R', mt: 'M', term: 'T', sense: 'S', first: 'F' };
  const cur = { ...all };
  for (const k of order) {
    assert.equal(S.bestMeaning(cur), want[k]);
    delete cur[k];
  }
  assert.equal(S.bestMeaning(cur), '');
  assert.equal(S.bestMeaning({ ctx: '  ', mt: ' 곱셈 ' }), '곱셈', '빈 글은 건너뛰고 앞뒤 공백은 정리');
  assert.equal(S.bestMeaning({ ctx: '가'.repeat(100) }).length, 80);
});

test('firstMeaning: 사전 뜻 글에서 〈〉·괄호 설명을 걷고 첫 뜻만', () => {
  assert.equal(S.firstMeaning('〈분노·슬픔·고통 등을〉 완화시키다, 누그러뜨리다; 〈형벌을〉 가볍게 하다'), '완화시키다, 누그러뜨리다');
  assert.equal(S.firstMeaning('…을 이용[활용]하다; 착취하다'), '…을 이용하다');
  assert.equal(S.firstMeaning(''), '');
  assert.equal(S.firstMeaning(undefined), '');
});

test('mydictMessage: 상한(ko 80·exp 120·note 200)에 맞추고 빈 칸은 뺀다', () => {
  const m = S.mydictMessage({ key: 'pca', ko: '가'.repeat(90), exp: 'e'.repeat(130), note: 'n'.repeat(210), url: 'https://x.test/a', title: 'T' });
  assert.deepEqual(Object.keys(m), ['type', 'op', 'key', 'ko', 'exp', 'note', 'url', 'title']);
  assert.equal(m.type, 'mydict');
  assert.equal(m.op, 'set');
  assert.equal(m.ko.length, 80);
  assert.equal(m.exp.length, 120);
  assert.equal(m.note.length, 200);
  assert.deepEqual(S.mydictMessage({ key: 'pca', ko: '주성분 분석', exp: '', note: undefined }), { type: 'mydict', op: 'set', key: 'pca', ko: '주성분 분석' });
});

test('phraseMessage: 맥 번역은 translation, 문맥·넓은 문맥 번역은 context 로(없으면 context 없음)', () => {
  const base = { text: 'matrix multiplication', mt: '행렬 곱셈', url: 'https://x.test/a', title: 'T' };
  assert.deepEqual(S.phraseMessage(base), { type: 'words', op: 'save-phrase', text: 'matrix multiplication', translation: '행렬 곱셈', url: 'https://x.test/a', title: 'T' });
  const ctx = S.phraseMessage({ ...base, ctx: '행렬의 곱', ctxNote: '노트' });
  assert.deepEqual(ctx.context, { translation: '행렬의 곱', note: '노트' });
  const wide = S.phraseMessage({ ...base, ctx: '넓은 번역', wide: true });
  assert.deepEqual(wide.context, { translation: '넓은 번역', wide: true });
  assert.equal(S.phraseMessage({ text: 'a b' }).translation, '', '맥 번역이 없어도 저장은 된다(0자 허용)');
  assert.equal(S.phraseMessage({ ...base, mt: 'x'.repeat(2100), ctx: 'y'.repeat(2100), ctxNote: 'n'.repeat(500) }).translation.length, 2000);
  assert.equal(S.phraseMessage({ ...base, ctx: 'y'.repeat(2100), ctxNote: 'n'.repeat(500) }).context.note.length, 400);
});

test('findPhrase: 저장된 구 목록에서 같은 글을 찾아 id 를 돌려준다', () => {
  const phrases = { a1: { text: 'matrix multiplication' }, b2: { text: 'other thing' } };
  assert.equal(S.findPhrase(phrases, 'other thing'), 'b2');
  assert.equal(S.findPhrase(phrases, 'nope'), null);
  assert.equal(S.findPhrase(undefined, 'x'), null);
});
