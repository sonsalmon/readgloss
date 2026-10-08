import test from 'node:test';
import assert from 'node:assert/strict';

// T24 스크랩 고리 검증 수정 시험. 브라우저 없이 순수 함수만 본다.
await import('../extension/scrap-core.js');
await import('../extension/selection-core.js');
const SC = globalThis.readglossScrap;
const SEL = globalThis.readglossSelection;

// 1. 칠하기는 이 페이지 스크랩만 다룬다
test('scrapsOnPage: 다른 페이지 스크랩은 걸러낸다(칠하기·찾기 공통)', () => {
  const here = 'https://a.test/post';
  const list = [
    { id: 'aaaaaaaaaaaa', url: here, quote: { exact: 'x' } },
    { id: 'bbbbbbbbbbbb', url: 'https://b.test/other', quote: { exact: 'x' } },
    null,
  ];
  const got = SC.scrapsOnPage(list, here).map((s) => s.id);
  assert.deepEqual(got, ['aaaaaaaaaaaa']);
  assert.deepEqual(SC.scrapsOnPage(undefined, here), []);
});

// 2. 글 색인: ann 루비 단어·인라인 code 는 넣고, rt·pre·뜻 글자·입력칸·편집 영역은 뺀다
test('skipsIndex: 자동 주석 단어와 인라인 code 는 색인에 넣는다', () => {
  assert.equal(SC.skipsIndex({ localName: 'ruby', readgloss: 'ann' }), false);
  assert.equal(SC.skipsIndex({ localName: 'span', readgloss: null }), false);
  assert.equal(SC.skipsIndex({ localName: 'code', readgloss: null }), false);
});

test('skipsIndex: rt·pre·뜻 글자·입력칸·편집 영역·우리가 넣은 노드는 뺀다', () => {
  assert.equal(SC.skipsIndex({ localName: 'rt', readgloss: null }), true);
  assert.equal(SC.skipsIndex({ localName: 'pre', readgloss: null }), true);
  assert.equal(SC.skipsIndex({ localName: 'span', readgloss: 'gloss' }), true);
  assert.equal(SC.skipsIndex({ localName: 'div', readgloss: 'translation' }), true);
  assert.equal(SC.skipsIndex({ localName: 'input', readgloss: null }), true);
  assert.equal(SC.skipsIndex({ localName: 'textarea', readgloss: null }), true);
  assert.equal(SC.skipsIndex({ localName: 'div', readgloss: null, editable: true }), true);
  assert.equal(SC.skipsIndex({ localName: 'div', readgloss: null, editable: false }), false);
});

// 2b. [스크랩됨] 판정: 공백이 달라도 같은 글
test('normText: 공백을 하나로 줄인 글끼리 같은 문장으로 본다', () => {
  assert.equal(SC.normText('  Broken   access\n control  '), 'Broken access control');
  assert.equal(SC.normText("a\u00a0 b"), "a b");
  assert.equal(SC.normText(null), '');
});

// 3. ⌥S 는 입력칸(또는 IME 조합 중)에서 돌지 않는다
const node = (localName, attrs = {}) => ({ localName, ...attrs });
test('isTypingPath: 입력칸·textarea·편집 영역 경로면 true', () => {
  assert.equal(SEL.isTypingPath([node('input')], false), true);
  assert.equal(SEL.isTypingPath([node('textarea')], false), true);
  assert.equal(SEL.isTypingPath([node('div', { isContentEditable: true })], false), true);
  assert.equal(SEL.isTypingPath([node('div', { getAttribute: (k) => (k === 'contenteditable' ? 'true' : null) })], false), true);
});

test('isTypingPath: 일반 글·IME 조합 중이면 판단 결과', () => {
  assert.equal(SEL.isTypingPath([node('p'), node('body')], false), false);
  assert.equal(SEL.isTypingPath([node('p')], true), true);
});

// 4. guess 응답을 기다리는 시간 상한(최대 2초 중 여기서는 짧게)
test('waitUpTo: 응답이 먼저 오면 값, 늦으면 undefined 로 끝낸다', async () => {
  assert.equal(await SEL.waitUpTo(Promise.resolve(7), 1000), 7);
  const never = new Promise(() => {});
  const t0 = Date.now();
  assert.equal(await SEL.waitUpTo(never, 30), undefined);
  assert.ok(Date.now() - t0 < 1000);
});

// 4. 글 색인이 선택 글(paragraph-core textOf)과 같은 규칙: <br>·블록 경계에 공백, kbd 포함
const dom = (localName, ...kids) => ({ nodeType: 1, localName, childNodes: kids, readgloss: null, editable: false });
const dtxt = (v) => ({ nodeType: 3, nodeValue: v, childNodes: [] });
const indexOfDom = (root) => SC.indexText(root, (n) => SC.skipsIndex(n));

test('색인: <br> 자리에 공백 한 칸, 저장 exact 는 공백 정리 후 선택 글과 같다', () => {
  const root = dom('body', dom('p', dtxt('First line goes here'), dom('br'), dtxt('second line goes there.')));
  const { fullText, nodes } = indexOfDom(root);
  const exact = SC.quoteOf(fullText, 0, fullText.length).exact;
  assert.equal(SC.normText(exact), 'First line goes here second line goes there.');
  // 노드 위치는 fullText 와 어긋나지 않는다
  assert.equal(fullText.slice(nodes[1].start, nodes[1].end), 'second line goes there.');
  // 다시 선택하면 같은 자리를 찾고, [스크랩됨] 판정(공백 정리 후 같음)이 참이다
  const found = SC.findQuote(fullText, { exact, prefix: '', suffix: '' }, 0);
  assert.ok(found);
  assert.equal(SC.normText(exact), SC.normText('First line goes here\nsecond line goes there.'));
});

test('색인: kbd 는 건너뛰지 않는다(인라인 code 와 같다), 저장 exact 에 Ctrl 포함', () => {
  const root = dom('body', dom('p', dtxt('Press '), dom('kbd', dtxt('Ctrl')), dtxt(' and the other key')));
  const { fullText } = indexOfDom(root);
  const exact = SC.quoteOf(fullText, 0, fullText.length).exact;
  assert.ok(SC.normText(exact).includes('Ctrl'));
  assert.equal(SC.normText(exact), 'Press Ctrl and the other key');
  assert.ok(SC.findQuote(fullText, { exact, prefix: '', suffix: '' }, 0));
  assert.equal(SC.normText(exact), SC.normText('Press Ctrl and the other key'));
});
