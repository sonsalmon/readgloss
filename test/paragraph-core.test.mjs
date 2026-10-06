import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// extension/paragraph-core.js 는 text.js 와 같은 classic script. 전역 readglossParagraph 로 쓴다.
await import('../extension/paragraph-core.js');
const { MAX_TEXT, MIN_TEXT, TRANSLATION_TAG, TRANSLATION_STYLE, normalizeText, isTargetText, findBlock, insertPlacement, textOf, textExceeds, buttonPosition } = globalThis.readglossParagraph;

// 브라우저 없이 쓰는 가짜 DOM. el('p', {attrs}, ...children), 문자열 자식은 텍스트 노드.
function el(tag, attrs = {}, ...kids) {
  const { isContentEditable, ...a } = attrs;
  const n = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: null,
    isContentEditable: isContentEditable === true,
    hasAttribute: (k) => k in a,
    getAttribute: (k) => a[k] ?? null,
    childNodes: kids.map((k) => (typeof k === 'string' ? { nodeType: 3, nodeValue: k } : k)),
  };
  for (const k of n.childNodes) if (k.nodeType === 1) k.parentElement = n;
  return n;
}
const tr = (text) => el(TRANSLATION_TAG, { 'data-readgloss': 'translation' }, text);

test('normalizeText: 공백 정리', () => {
  assert.equal(normalizeText('  a \n b\t\tc  '), 'a b c');
  assert.equal(normalizeText(null), '');
});

test('상수: 상한은 다리와 같고 번역 노드 스타일은 페이지 글꼴을 물려받는다', () => {
  assert.equal(MAX_TEXT, 4000);
  assert.equal(MIN_TEXT, 20);
  assert.equal(TRANSLATION_TAG, 'readgloss-translation');
  for (const part of ['display:block', 'border-left:3px solid rgba(47,111,235,.45)', 'color:inherit', 'font:inherit', 'white-space:pre-wrap', 'opacity:.88', 'font-size:.96em', 'line-height:inherit']) {
    assert.ok(TRANSLATION_STYLE.includes(part), part);
  }
});

test('isTargetText: 20자 이상이고 영어가 대부분이어야 한다', () => {
  assert.ok(isTargetText('Attackers can chain the gadget with an SSRF bug.'));
  assert.ok(isTargetText('  The   quick brown fox\n jumps over the lazy dog. '));
  assert.ok(isTargetText('a'.repeat(20)));
  assert.ok(!isTargetText('a'.repeat(19)));
  assert.ok(!isTargetText('Too short to translate'.slice(0, 15)));
  assert.ok(!isTargetText('이 문단은 한국어로 쓰여 있어서 번역 대상이 아닙니다 정말로요'));
  assert.ok(!isTargetText('이 문서는 정보보안 문서이며 XSS 와 CSRF 와 SSRF 를 다룹니다 매우 자세히'));
  assert.ok(!isTargetText('1234567890 1234567890 1234567890 -- ;;'));
  assert.ok(!isTargetText(''));
  assert.ok(!isTargetText(undefined));
});

test('findBlock: 클릭 지점에서 가장 가까운 글 블록', () => {
  const span = el('span');
  const p = el('p', {}, 'text', span);
  assert.equal(findBlock(span), p);
  assert.equal(findBlock(p), p);
  for (const tag of ['li', 'blockquote', 'dd', 'dt', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption']) {
    const b = el(tag, {}, 'x');
    assert.equal(findBlock(b), b, tag);
  }
  const inner = el('p');
  const li = el('li', {}, inner);
  assert.equal(findBlock(inner), inner); // 가장 가까운 것
  assert.equal(findBlock(li), li);
  const strong = el('strong');
  const td = el('td', {}, strong);
  assert.equal(findBlock(strong), td);
});

test('findBlock: 블록이 없으면(div·span 뿐) null', () => {
  const s = el('span');
  el('div', {}, s);
  assert.equal(findBlock(s), null);
  assert.equal(findBlock(null), null);
});

test('findBlock: pre·code 안, 링크·버튼·label·select·입력창, contenteditable 은 대상이 아니다', () => {
  for (const tag of ['a', 'button', 'label', 'select', 'input', 'textarea', 'pre', 'code']) {
    const t = el(tag);
    el('p', {}, t);
    assert.equal(findBlock(t), null, `${tag} 위`);
  }
  // 조상이 막으면 안쪽 블록도 대상이 아니다
  const p1 = el('p');
  el('a', {}, p1);
  assert.equal(findBlock(p1), null);
  const li = el('li');
  el('pre', {}, el('code', {}, li));
  assert.equal(findBlock(li), null);
  const p2 = el('p', {}, el('em'));
  el('div', { isContentEditable: true }, p2);
  assert.equal(findBlock(p2), null);
  const edited = el('p', { isContentEditable: true });
  assert.equal(findBlock(edited), null);
});

test('findBlock: 우리가 넣은 번역 노드(와 그 안)는 대상이 아니다', () => {
  const t = tr('번역문입니다 번역문입니다 번역문입니다');
  const li = el('li', {}, 'English text here for the list item', t);
  assert.equal(findBlock(t), null);
  assert.equal(findBlock(el('b', {}, 'x')), null);
  assert.equal(findBlock(li), li);
  const p = el('p');
  const inside = el('em');
  t.childNodes.push(inside);
  inside.parentElement = t;
  assert.equal(findBlock(inside), null);
  void p;
});

const ann = (word, gloss) => el('ruby', { 'data-readgloss': 'ann' }, word, el('rt', {}, gloss));

test('textOf: 자동 주석(ruby data-readgloss=ann)은 원래 단어는 남기고 rt 글자만 뺀다', () => {
  const p = el('p', {}, 'Attackers ', ann('exploit', '이용하다'), ' the ', ann('payload', '수익 하중'), ' now.');
  assert.equal(textOf(p), 'Attackers exploit the payload now.');
  const li = el('li', {}, 'Item ', ann('delve', '손으로 더듬다'), tr('번역문이 여기 들어 있다'), ' end');
  assert.equal(textOf(li), 'Item delve end'); // 번역 노드는 통째로, 주석은 rt 만 뺀다
});

test('textExceeds: 길이 상한은 주석 rt 글자를 빼고 잰다(주석이 많은 긴 문단이 일찍 막히지 않게)', () => {
  const words = Array.from({ length: 50 }, () => ann('exploit', '이용하다이용하다이용하다')); // 단어 7자 + rt 12자
  const p = el('p', {}, ...words);
  assert.ok(!textExceeds(p, 350)); // 본문 350자, rt 600자를 합치면 넘는다
  assert.ok(textExceeds(p, 349));
  assert.ok(!textExceeds(el('p', {}, 'a ', tr('가'.repeat(500)), 'b'), 10)); // 번역 노드는 세지 않는다
  assert.ok(textExceeds(el('p', {}, 'x'.repeat(11)), 10));
});

test('textOf: 다른 data-readgloss 노드(button 등)는 통째로 제외, 페이지 자신의 ruby·rt 는 그대로', () => {
  const p = el('p', {}, 'a ', el('span', { 'data-readgloss': 'button' }, 'UI'), 'b ', el('ruby', {}, '漢', el('rt', {}, 'kan')));
  assert.equal(textOf(p), 'a b 漢kan');
});

test('findBlock: 주석 붙은 단어(ruby ann)와 그 rt 를 눌러도 문단 블록을 찾는다', () => {
  const r = ann('exploit', '이용하다');
  const p = el('p', {}, 'x ', r);
  assert.equal(findBlock(r), p);
  assert.equal(findBlock(r.childNodes[1]), p); // rt
  assert.equal(findBlock(tr('번역')), null); // 번역 노드는 여전히 대상이 아니다
});

test('insertPlacement: li·td·th 는 안쪽 끝, 나머지는 바로 아래(형제)', () => {
  for (const tag of ['LI', 'TD', 'TH', 'li', 'td']) assert.equal(insertPlacement(tag), 'beforeend', tag);
  for (const tag of ['P', 'BLOCKQUOTE', 'H1', 'H3', 'H6', 'DD', 'DT', 'FIGCAPTION']) assert.equal(insertPlacement(tag), 'afterend', tag);
});

test('textOf: 번역 노드는 제외하고 <br>·블록 경계는 공백으로 이어 붙인다', () => {
  const p = el('p', {}, 'Hello', el('br'), 'world ', el('em', {}, 'again'), '!');
  assert.equal(textOf(p), 'Hello world again!'); // br 은 공백, 인라인 em 은 이어 붙임
  const li = el('li', {}, '  First   line\n', tr('한국어 번역이 들어 있다'), ' second line');
  assert.equal(textOf(li), 'First line second line'); // 다시 번역할 때 한국어가 섞이지 않는다
  const nested = el('li', {}, 'Parent text', el('ul', {}, el('li', {}, 'Child one'), el('li', {}, 'Child two')));
  assert.equal(textOf(nested), 'Parent text Child one Child two');
  const withTr = el('td', {}, 'cell text', el('div', {}, tr('번역'), 'tail'));
  assert.equal(textOf(withTr), 'cell text tail');
});

test('textOf: script·style 과 숨은 요소는 건너뛴다', () => {
  const hidden = el('span', { id: 'h' }, 'secret');
  const p = el('p', {}, 'visible ', el('script', {}, 'alert(1)'), el('style', {}, '.x{}'), hidden, ' end');
  assert.equal(textOf(p, { isHidden: (n) => n === hidden }), 'visible end');
  assert.equal(textOf(p), 'visible secret end');
});

test('buttonPosition: 기본은 블록 왼쪽 바깥 28px, 첫 줄 높이에 세로 가운데', () => {
  const r = buttonPosition({ blockRect: { left: 100, top: 50 }, firstLine: { top: 50, height: 24 } });
  assert.deepEqual(r, { left: 72, top: 51, inside: false });
  const tall = buttonPosition({ blockRect: { left: 200, top: 10 }, firstLine: { top: 40, height: 30 } });
  assert.deepEqual(tall, { left: 172, top: 44, inside: false });
});

test('buttonPosition: 왼쪽 여백이 모자라면(left < 32) 블록 안쪽 왼쪽 위에 겹친다', () => {
  assert.deepEqual(buttonPosition({ blockRect: { left: 31, top: 0 }, firstLine: { top: 0, height: 22 } }), { left: 33, top: 0, inside: true });
  assert.deepEqual(buttonPosition({ blockRect: { left: 0, top: 5 }, firstLine: { top: 5, height: 22 } }), { left: 2, top: 5, inside: true });
  assert.equal(buttonPosition({ blockRect: { left: 32, top: 0 }, firstLine: { top: 0, height: 22 } }).inside, false);
  assert.equal(buttonPosition({ blockRect: { left: 32, top: 0 }, firstLine: { top: 0, height: 22 } }).left, 4);
});

test('buttonPosition: 첫 줄 정보가 없으면 블록 맨 위를 쓴다', () => {
  assert.deepEqual(buttonPosition({ blockRect: { left: 100, top: 50 } }), { left: 72, top: 50, inside: false });
});

test('manifest: content script 목록에 paragraph-core.js, paragraph.js 가 이어서 있다(ES 모듈 import 없음)', () => {
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const js = m.content_scripts[0].js;
  assert.deepEqual(js.slice(2, 4), ['paragraph-core.js', 'paragraph.js']); // 뒤에 붙는 스크립트(annotate)는 각자 시험한다
  for (const f of ['paragraph-core.js', 'paragraph.js']) assert.doesNotMatch(readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8'), /^\s*(import|export)\s/m, f);
});
