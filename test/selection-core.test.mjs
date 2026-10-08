import test from 'node:test';
import assert from 'node:assert/strict';

// selection-core.js 는 text.js 와 같은 classic script. text.js 의 readgloss(cleanSelection·plainTextAt)를 먼저 올린다.
await import('../extension/text.js');
await import('../extension/selection-core.js');
const { MAX_TEXT, MAX_SIDE, MAX_TITLE, MAX_HEADINGS, classify, buildContext, around } = globalThis.readglossSelection;

test('상수: 다리의 상한과 같다(글 1000, 앞뒤 각 1500, 제목 200, 소제목 3개 보냄)', () => {
  assert.deepEqual([MAX_TEXT, MAX_SIDE, MAX_TITLE, MAX_HEADINGS], [1000, 1500, 200, 3]);
});

test('classify: 영어 낱말 하나는 word(앞뒤 부호는 걷는다)', () => {
  assert.deepEqual(classify('exploit'), { kind: 'word', word: 'exploit' });
  assert.deepEqual(classify('  "exploit,"  '), { kind: 'word', word: 'exploit' });
  assert.deepEqual(classify('state-of-the-art'), { kind: 'word', word: 'state-of-the-art' });
  assert.deepEqual(classify("don't"), { kind: 'word', word: "don't" });
});

test('classify: 두 단어 이상(1000자 이하)은 phrase, 공백은 한 칸으로', () => {
  assert.deepEqual(classify('matrix multiplication'), { kind: 'phrase', text: 'matrix multiplication' });
  assert.deepEqual(classify('  The transpose\n of  a matrix. '), { kind: 'phrase', text: 'The transpose of a matrix.' });
  assert.equal(classify('a '.repeat(500)).kind, 'phrase'); // 정규화 뒤 999자
  assert.equal(classify('SQL injection 공격').kind, 'phrase', '한국어가 섞여도 영어가 대부분이면');
});

test('classify: 1000자를 넘으면 long(정규화 뒤 길이 기준)', () => {
  assert.equal(classify(`${'word '.repeat(199)}word`).kind, 'phrase'); // 999자
  assert.equal(classify('x'.repeat(995) + ' abcd').kind, 'phrase'); // 1000자
  assert.equal(classify('x'.repeat(996) + ' abcd').kind, 'long');
  assert.equal(classify('word '.repeat(400)).kind, 'long');
});

test('classify: 대상 아님(none) — 빈 선택·영어 글자 거의 없음·낱말이 하나뿐인 조각', () => {
  for (const s of ['', '   ', '\n\t', '한국어로만 쓴 문장입니다', '1234 5678', '-- ;; ..', 'a', 'x86', '2fa', '한글word', '이 문장에는 a 가 하나 있을 뿐이고 영어가 거의 없다', null, undefined, 42]) {
    assert.deepEqual(classify(s), { kind: 'none' }, String(s));
  }
  assert.deepEqual(classify('1 2 3 4 5 6 abc'), { kind: 'none' }, '낱말이 하나뿐');
});

// 브라우저 없이 쓰는 가짜 DOM(paragraph-core 시험과 같은 방식)
function el(tag, attrs = {}, ...kids) {
  const n = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: null,
    hasAttribute: (k) => k in attrs,
    getAttribute: (k) => attrs[k] ?? null,
    childNodes: kids.map((k) => (typeof k === 'string' ? { nodeType: 3, nodeValue: k } : k)),
  };
  for (const k of n.childNodes) if (k.nodeType === 1) k.parentElement = n;
  return n;
}
const ann = (word, gloss) => el('ruby', { 'data-readgloss': 'ann' }, word, el('rt', { 'data-readgloss': 'gloss' }, gloss));

test('around: 선택 앞·뒤 글자만 돌려주고, 주석 뜻 글자·번역 노드는 섞지 않는다', () => {
  const mid = { nodeType: 3, nodeValue: ' of a matrix ' };
  const tr = el('readgloss-translation', { 'data-readgloss': 'translation' }, '행렬의 전치');
  const p = el('p', {}, 'See the ', ann('transpose', '전치'), mid, 'here. ', tr);
  // 선택: mid 텍스트 노드의 3번째 글자('of' 뒤)부터 끝(공백 포함)까지가 아니라, " of a" 만 고른 경우
  const r = around(p, mid, 1, p, mid, 5);
  assert.equal(r.head, 'See the transpose ');
  assert.equal(r.tail, ' matrix here. ');
  assert.doesNotMatch(r.head + r.tail, /전치|행렬의/);
});

test('around: 시작과 끝이 다른 블록이면 각자의 블록에서 앞·뒤를 잘라 온다', () => {
  const a = { nodeType: 3, nodeValue: 'First block end' };
  const b = { nodeType: 3, nodeValue: 'Second block start' };
  const p1 = el('p', {}, 'Intro. ', a);
  const p2 = el('p', {}, b, ' and more.');
  const r = around(p1, a, 6, p2, b, 6);
  assert.equal(r.head, 'Intro. First ');
  assert.equal(r.tail, ' block start and more.');
});

test('buildContext: 앞 글(앞 블록 포함)은 끝에서 1500자, 뒤 글은 처음에서 1500자, 공백 정리', () => {
  const c = buildContext({ prev: ['Earlier block.', 'Previous   block.'], head: 'Before  the', tail: 'after it.', next: ['Next block.'], title: ' Matrix  basics ', headings: ['A', 'B', 'C', 'D', 'E'] });
  assert.deepEqual(c, { before: 'Earlier block. Previous block. Before the', after: 'after it. Next block.', title: 'Matrix basics', headings: ['C', 'D', 'E'] });
  const long = buildContext({ prev: ['p'.repeat(3000)], head: 'HEAD', tail: 'TAIL', next: ['n'.repeat(3000)] });
  assert.equal(long.before.length, MAX_SIDE);
  assert.ok(long.before.endsWith('p HEAD'), '선택에 가까운 쪽을 남긴다');
  assert.equal(long.after.length, MAX_SIDE);
  assert.ok(long.after.startsWith('TAIL n'), '선택에 가까운 쪽을 남긴다');
  assert.equal(buildContext({ title: 'T'.repeat(500) }).title.length, MAX_TITLE);
  assert.deepEqual(buildContext({ headings: ['h'.repeat(500), '', '  '] }).headings, ['h'.repeat(MAX_TITLE)]);
  assert.deepEqual(buildContext({}), { before: '', after: '', title: '', headings: [] });
});

// T25 fix A: 우리 확장 화면(readgloss-*) 안에서 누른 키는 막대·⌥S가 가로채지 않는다
test('isOwnUiPath: 경로에 readgloss-* host 가 있으면 true, 제외 노드는 무시', () => {
  const el = (localName) => ({ localName });
  const bar = el('readgloss-scrap-bar');
  assert.equal(globalThis.readglossSelection.isOwnUiPath([el('input'), el('readgloss-toast'), el('body')]), true);
  assert.equal(globalThis.readglossSelection.isOwnUiPath([el('button'), el('readgloss-ui')]), true);
  assert.equal(globalThis.readglossSelection.isOwnUiPath([el('readgloss-selection')]), true);
  assert.equal(globalThis.readglossSelection.isOwnUiPath([el('p'), el('body'), el('html')]), false);
  assert.equal(globalThis.readglossSelection.isOwnUiPath([bar, el('div')], bar), false, '막대 자신은 제외');
  assert.equal(globalThis.readglossSelection.isOwnUiPath([bar, el('readgloss-ui')], bar), true, '막대 밖 우리 host 는 포함');
  assert.equal(globalThis.readglossSelection.isOwnUiPath(undefined), false);
});
