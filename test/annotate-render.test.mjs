import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 자동 주석 그리기·걷기·설정 반영. 브라우저 없이 쓰는 아주 작은 가짜 DOM(이 파일 안에만 둔다. test/ 아래 공유 파일은 node --test 가 시험 파일로 실행한다).
await import('../extension/settings-core.js');
await import('../extension/annotate-core.js');
const S = globalThis.readglossSettings;
const A = globalThis.readglossAnnotate;
const { annotateBlock, unwrapAnnotations, makeAnnotation, blockCandidates, cssVars, annotating, enabledHere, structuralKey, applyWords } = A;

class FNode {
  parentNode = null;
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.isRoot === true;
  }
  get textContent() { return this.childNodes ? this.childNodes.map((c) => c.textContent).join('') : this.nodeValue; }
  set textContent(v) {
    if (this.nodeType === 3) this.nodeValue = String(v);
    else {
      this.childNodes.splice(0).forEach((c) => (c.parentNode = null));
      this.append(this.ownerDocument.createTextNode(String(v)));
    }
  }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(...nodes) {
    const p = this.parentNode;
    const flat = nodes.flatMap((n) => (n.nodeType === 11 ? n.childNodes.splice(0) : [n]));
    flat.forEach((n) => n.parentNode?.removeChild(n));
    p.childNodes.splice(p.childNodes.indexOf(this), 1, ...flat);
    flat.forEach((n) => (n.parentNode = p));
    this.parentNode = null;
  }
}
class FText extends FNode {
  nodeType = 3;
  constructor(doc, v) { super(); this.ownerDocument = doc; this.nodeValue = v; }
}
class FElement extends FNode {
  nodeType = 1;
  constructor(doc, tag, type = 1) {
    super();
    this.ownerDocument = doc;
    this.nodeType = type;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.childNodes = [];
    this.vars = {};
    this.style = { setProperty: (k, v) => (this.vars[k] = v), margin: '' };
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; }
  append(...nodes) {
    for (const n0 of nodes) {
      const n = typeof n0 === 'string' ? this.ownerDocument.createTextNode(n0) : n0;
      const kids = n.nodeType === 11 ? n.childNodes.splice(0) : [n];
      for (const k of kids) {
        k.parentNode?.removeChild(k);
        k.parentNode = this;
        this.childNodes.push(k);
      }
    }
  }
  // 지원하는 선택자: [attr="v"], [attr] (쉼표 목록 없음)
  querySelectorAll(sel) {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    const out = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.hasAttribute(m[1]) && (m[2] === undefined || c.getAttribute(m[1]) === m[2])) out.push(c);
        walk(c);
      }
    })(this);
    return out;
  }
  // 이어진 글자 노드를 합치고 빈 글자 노드를 지운다(하위 전체)
  normalize() {
    const kids = [];
    for (const c of this.childNodes) {
      const last = kids.at(-1);
      if (c.nodeType === 3 && c.nodeValue === '') continue;
      if (c.nodeType === 3 && last?.nodeType === 3) last.nodeValue += c.nodeValue;
      else kids.push(c);
    }
    this.childNodes.splice(0, this.childNodes.length, ...kids);
    for (const c of kids) if (c.nodeType === 1) c.normalize();
  }
}
function makeDoc() {
  const doc = {
    createElement: (t) => new FElement(doc, t),
    createTextNode: (v) => new FText(doc, v),
    createDocumentFragment: () => new FElement(doc, '#fragment', 11),
  };
  doc.body = doc.createElement('body');
  doc.body.isRoot = true;
  doc.documentElement = doc.body;
  return doc;
}

// 블록 하나: 글자 노드 목록 -> 블록. 후보 계산(blockCandidates)까지 진짜 함수를 쓴다.
function block(doc, ...texts) {
  const p = doc.createElement('p');
  const nodes = texts.map((t) => doc.createTextNode(t));
  p.append(...nodes);
  doc.body.append(p);
  return { p, nodes, texts, occs: blockCandidates(texts) };
}
const ITEMS = Object.assign(Object.create(null), {
  payload: { lemma: 'payload', gloss: '수익 하중' },
  exploit: { lemma: 'exploit', gloss: '이용하다' },
  delves: { lemma: 'delve', gloss: '파고들다' },
  delve: { lemma: 'delve', gloss: '파고들다' },
  mitigate: { lemma: 'mitigate', gloss: '완화하다' },
});
const cfg = (patch = {}) => S.merge({}, patch);
const fresh = () => ({ pageSeen: new Set(), skip: new Set() });
const draw = (b, settings = cfg(), state = fresh(), items = ITEMS) => annotateBlock(b.p, b, items, settings, state);
const annsOf = (p) => p.querySelectorAll('[data-readgloss="ann"]');
const glossOf = (ann) => ann.childNodes.find((c) => c.nodeType === 1 && c.getAttribute('data-readgloss') === 'gloss');
// 노드 구조를 글자로(글자 노드는 "…", 요소는 <tag attrs>…</tag>)
const shape = (n) => (n.nodeType === 3 ? JSON.stringify(n.nodeValue) : `<${n.tagName.toLowerCase()}${Object.entries(n.attrs).map(([k, v]) => ` ${k}=${v}`).join('')}>${n.childNodes.map(shape).join('')}</${n.tagName.toLowerCase()}>`);

const TEXT = 'Attackers exploit the payload and delves deep. Then exploit again.';

test('위치 top: ruby 감싸개 + rt(gloss), 원형은 data-lemma, 단어 글자는 감싸개 바로 아래 글자 노드', () => {
  const doc = makeDoc();
  const b = block(doc, TEXT);
  assert.equal(draw(b, cfg({ repeat: 'always', maxPerParagraph: 0 })), 4); // exploit, payload, delves, exploit
  const [first] = annsOf(b.p);
  assert.equal(first.tagName, 'RUBY');
  assert.equal(first.getAttribute('data-lemma'), 'exploit');
  assert.equal(shape(first), '<ruby data-readgloss=ann data-lemma=exploit>"exploit"<rt data-readgloss=gloss lang=ko>"이용하다"</rt></ruby>');
  assert.equal(b.p.textContent.replace(/이용하다|수익 하중|파고들다/g, ''), TEXT); // 뜻만 빼면 원문 그대로
});

test('위치 right: span 감싸개 + span "(뜻)"(gloss)', () => {
  const doc = makeDoc();
  const b = block(doc, TEXT);
  draw(b, cfg({ annotation: { position: 'right' }, repeat: 'always', maxPerParagraph: 0 }));
  const [first] = annsOf(b.p);
  assert.equal(shape(first), '<span data-readgloss=ann data-lemma=exploit>"exploit"<span data-readgloss=gloss lang=ko>"(이용하다)"</span></span>');
});

test('위치 none + mark: 뜻 노드 없이 단어 표시만, mark 도 none 이면 아무것도 안 그린다(주석 수 0, 노드 그대로)', () => {
  const doc = makeDoc();
  const b = block(doc, TEXT);
  draw(b, cfg({ annotation: { position: 'none' }, mark: 'underline' }));
  const [first] = annsOf(b.p);
  assert.equal(shape(first), '<span data-readgloss=ann data-lemma=exploit><span data-rg-word=>"exploit"</span></span>');
  assert.equal(b.p.querySelectorAll('[data-readgloss="gloss"]').length, 0);
  assert.equal(b.p.textContent, TEXT);

  const b2 = block(doc, TEXT);
  assert.equal(draw(b2, cfg({ annotation: { position: 'none' }, mark: 'none' })), 0);
  assert.deepEqual(b2.p.childNodes, b2.nodes);
  assert.equal(annotating(cfg({ annotation: { position: 'none' }, mark: 'none' }), 'a.com'), false);
  assert.equal(annotating(cfg({ annotation: { position: 'none' }, mark: 'color' }), 'a.com'), true);
});

test('mark 4종: none 은 단어를 감싸지 않고, 나머지는 단어를 data-rg-word 로 감싸며 CSS 변수가 맞는 값을 낸다', () => {
  const doc = makeDoc();
  for (const mark of ['none', 'color', 'underline', 'background']) {
    const b = block(doc, 'The payload arrives');
    draw(b, cfg({ mark }));
    const [ann] = annsOf(b.p);
    const wrapped = ann.childNodes[0].nodeType === 1 && ann.childNodes[0].hasAttribute('data-rg-word');
    assert.equal(wrapped, mark !== 'none', mark);
    assert.equal(glossOf(ann).textContent, '수익 하중'); // 뜻 글자는 단어 표시 바깥(색·밑줄이 안 번진다)
  }
  const v = (mark, dark) => cssVars(cfg({ mark }), dark);
  assert.deepEqual([v('none')['--rg-mark-color'], v('none')['--rg-mark-line'], v('none')['--rg-mark-bg']], ['currentColor', 'none', 'transparent']);
  assert.equal(v('color')['--rg-mark-color'], '#2f6feb');
  assert.equal(v('color', true)['--rg-mark-color'], '#6b9bff');
  assert.equal(v('underline')['--rg-mark-line'], 'underline');
  assert.match(v('background')['--rg-mark-bg'], /^rgba\(47,111,235,/);
  assert.match(v('background', true)['--rg-mark-bg'], /^rgba\(107,155,255,/);
});

test('maxPerParagraph: 문단당 최대 개수(0 = 제한 없음), 이미 붙은 주석도 센다', () => {
  const doc = makeDoc();
  const text = 'Attackers exploit the payload and delves deep, mitigate it.'; // 4개 후보(원형 다름)
  const count = (max) => {
    const b = block(doc, text);
    draw(b, cfg({ maxPerParagraph: max }));
    return annsOf(b.p).length;
  };
  assert.equal(count(2), 2);
  assert.equal(count(3), 3);
  assert.equal(count(0), 4);
  assert.equal(count(10), 4);
  // 먼저 붙은 것은 앞에서부터
  const b = block(doc, text);
  draw(b, cfg({ maxPerParagraph: 2 }));
  assert.deepEqual(annsOf(b.p).map((a) => a.getAttribute('data-lemma')), ['exploit', 'payload']);
  // 같은 블록을 다시 그려도(글이 바뀌어 다시 처리) 이미 붙은 2개가 상한을 채웠으니 더 안 붙는다
  const again = { ...b, nodes: b.p.childNodes.filter((n) => n.nodeType === 3), texts: b.p.childNodes.filter((n) => n.nodeType === 3).map((n) => n.nodeValue) };
  again.occs = blockCandidates(again.texts);
  assert.equal(draw(again, cfg({ maxPerParagraph: 2 }), fresh()), 0);
  assert.equal(draw(again, cfg({ maxPerParagraph: 3 }), fresh()), 1);
});

test('repeat 3종: page = 페이지에서 원형당 한 번, paragraph = 문단마다 첫 등장, always = 매번', () => {
  const doc = makeDoc();
  const run = (repeat) => {
    const state = fresh();
    const s = cfg({ repeat, maxPerParagraph: 0 });
    const b1 = block(doc, 'Attackers exploit the flaw, then exploit more.');
    const b2 = block(doc, 'Defenders exploit it too.');
    return [draw(b1, s, state), draw(b2, s, state)];
  };
  assert.deepEqual(run('page'), [1, 0]);
  assert.deepEqual(run('paragraph'), [1, 1]);
  assert.deepEqual(run('always'), [2, 1]);
});

test('skip(아는 단어 원형)는 어느 반복 모드에서도 안 붙인다', () => {
  const doc = makeDoc();
  const b = block(doc, 'Attackers exploit the payload and delves deep.');
  draw(b, cfg(), { pageSeen: new Set(), skip: new Set(['payload', 'delve']) });
  assert.deepEqual(annsOf(b.p).map((a) => a.getAttribute('data-lemma')), ['exploit']);
});

test('노드 여러 개에 걸친 블록: 글자 노드마다 쪼개 붙이고, 그 사이 페이지가 바꾼 노드는 건드리지 않는다', () => {
  const doc = makeDoc();
  const b = block(doc, 'Attackers ', ' the payload ', ' and mitigate it');
  b.nodes[2].nodeValue = ' and CHANGED it'; // 요청을 기다리는 사이 페이지가 글을 바꿈
  draw(b, cfg({ maxPerParagraph: 0 }));
  assert.deepEqual(annsOf(b.p).map((a) => a.getAttribute('data-lemma')), ['payload']);
});

test('unwrap: 여러 번 그렸다 걷어도 글자 노드 수와 내용이 처음과 같고, 조각난 노드가 안 남는다', () => {
  const doc = makeDoc();
  const b = block(doc, TEXT);
  const original = b.p.childNodes.map((n) => [n.nodeType, n.nodeValue]);
  const variants = [
    cfg({ repeat: 'always', maxPerParagraph: 0 }),
    cfg({ repeat: 'always', maxPerParagraph: 0, annotation: { position: 'right' } }),
    cfg({ repeat: 'always', maxPerParagraph: 0, mark: 'background' }),
    cfg({ repeat: 'always', maxPerParagraph: 0, annotation: { position: 'none' }, mark: 'color' }),
  ];
  for (let round = 0; round < 3; round++) {
    for (const s of variants) {
      assert.ok(draw(b, s) > 0);
      assert.ok(annsOf(b.p).length > 1);
      unwrapAnnotations(doc.body);
      assert.deepEqual(b.p.childNodes.map((n) => [n.nodeType, n.nodeValue]), original);
      assert.equal(annsOf(b.p).length, 0);
      // 다음 그리기는 걷힌 뒤의 노드로 다시 후보를 뽑는다(annotate.js 가 블록을 다시 처리하는 것과 같다)
      b.nodes = b.p.childNodes.slice();
      b.texts = b.nodes.map((n) => n.nodeValue);
      b.occs = blockCandidates(b.texts);
    }
  }
});

test('unwrap: 원형을 주면 그 원형만 걷고, 걷힌 자리의 글자는 이웃 글자와 한 노드로 합쳐진다', () => {
  const doc = makeDoc();
  const b = block(doc, 'Attackers exploit the payload now');
  draw(b, cfg({ maxPerParagraph: 0, mark: 'underline' }));
  assert.equal(annsOf(b.p).length, 2);
  unwrapAnnotations(doc.body, new Set(['exploit']));
  assert.deepEqual(annsOf(b.p).map((a) => a.getAttribute('data-lemma')), ['payload']);
  assert.equal(b.p.childNodes[0].nodeValue, 'Attackers exploit the '); // 합쳐짐
  assert.equal(b.p.textContent.replace('수익 하중', ''), 'Attackers exploit the payload now');
  unwrapAnnotations(doc.body, new Set()); // 빈 집합: 아무것도 안 걷는다
  assert.equal(annsOf(b.p).length, 1);
  unwrapAnnotations(doc.body);
  assert.deepEqual(b.p.childNodes.map((n) => n.nodeValue), ['Attackers exploit the payload now']);
});

test('readgloss:words: known 원형은 skip 집합에 넣고 걷을 원형으로 돌려주고, unknown 은 집합에서 빼기만 한다', () => {
  const skip = new Set(['payload']);
  assert.deepEqual([...applyWords(skip, { known: ['exploit', 'delve'], unknown: ['payload'] })].sort(), ['delve', 'exploit']);
  assert.deepEqual([...skip].sort(), ['delve', 'exploit']);
  assert.equal(applyWords(skip, { unknown: ['delve'] }).size, 0);
  assert.deepEqual([...skip], ['exploit']);
  for (const bad of [undefined, null, {}, { known: 'x', unknown: 5 }, { known: [1, null, ''] }]) assert.equal(applyWords(skip, bad).size, 0);
  assert.deepEqual([...skip], ['exploit']);
  // 걷기: 페이지의 해당 주석만 사라지고, 이후 그리기에서도 건너뛴다
  const doc = makeDoc();
  const b = block(doc, 'Attackers exploit the payload now');
  const state = fresh();
  draw(b, cfg({ maxPerParagraph: 0 }), state);
  unwrapAnnotations(doc.body, applyWords(state.skip, { known: ['payload'] }));
  assert.deepEqual(annsOf(b.p).map((a) => a.getAttribute('data-lemma')), ['exploit']);
  const b2 = block(doc, 'Another payload here');
  assert.equal(draw(b2, cfg({ repeat: 'always' }), state), 0);
});

test('readgloss:words unknown: 알아요 취소한 원형은 이 페이지에서 한 번만 주던 기록(pageSeen)에서도 빠져, 새 블록에 다시 주석이 붙는다', () => {
  const doc = makeDoc();
  const state = fresh();
  const b = block(doc, 'Attackers exploit the payload now');
  draw(b, cfg({ maxPerParagraph: 0 }), state); // repeat 기본 'page'
  assert.ok(state.pageSeen.has('payload'));
  const b2 = block(doc, 'Another payload here');
  assert.equal(draw(b2, cfg({ maxPerParagraph: 0 }), state), 0, '이미 본 원형이라 안 붙는다');
  applyWords(state.skip, { unknown: ['payload'] }, state.pageSeen);
  assert.equal(state.pageSeen.has('payload'), false);
  assert.ok(state.pageSeen.has('exploit'), '다른 원형은 그대로');
  const b3 = block(doc, 'Dynamic payload text');
  assert.equal(draw(b3, cfg({ maxPerParagraph: 0 }), state), 1);
  applyWords(state.skip, { unknown: ['payload'] }); // pageSeen 을 안 줘도 던지지 않는다
  assert.match(readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8'), /applyWords\(state\.skip, e\.detail, state\.pageSeen\)/); // 접착 코드가 실제로 넘긴다
});

test('끄기 범위: enabled=false · 이 페이지만 끄기 · 끌 사이트 목록이면 자동 주석이 꺼진다', () => {
  const s = cfg();
  assert.equal(enabledHere(s, 'example.com', false), true);
  assert.equal(enabledHere({ ...s, enabled: false }, 'example.com', false), false);
  assert.equal(enabledHere(s, 'example.com', true), false);
  assert.equal(enabledHere(cfg({ sites: ['example.com'] }), 'example.com'), false);
  assert.equal(enabledHere(cfg({ sites: ['example.com'] }), 'sub.example.com'), true);
  assert.equal(enabledHere(cfg({ sites: ['*.example.com'] }), 'sub.example.com'), false);
  assert.equal(enabledHere(cfg({ sites: ['example.com'] }), 'other.org'), true);
  assert.equal(annotating(s, 'example.com', true), false);
  assert.equal(annotating(cfg({ sites: ['example.com'] }), 'example.com'), false);
  assert.equal(annotating(s, 'example.com'), true);
});

test('structuralKey: 위치·단어 표시·반복·개수·수준이 바뀔 때만 달라진다(크기·색·불투명도·굵기·간격·복사는 변수만)', () => {
  const base = structuralKey(cfg());
  for (const patch of [{ annotation: { position: 'right' } }, { mark: 'color' }, { repeat: 'always' }, { maxPerParagraph: 5 }, { level: 'C2' }]) assert.notEqual(structuralKey(cfg(patch)), base, JSON.stringify(patch));
  for (const patch of [{ annotation: { sizePct: 80 } }, { annotation: { color: 'accent' } }, { annotation: { opacityPct: 100 } }, { annotation: { weight: 'bold' } }, { annotation: { gapEm: 0.2 } }, { allowCopy: true }, { theme: 'dark' }, { enabled: false }]) {
    assert.equal(structuralKey(cfg(patch)), base, JSON.stringify(patch));
  }
});

test('cssVars: 크기·색(본문색/강조색/직접)·불투명도·굵기·간격·복사 허용', () => {
  const v = cssVars(cfg());
  assert.deepEqual(v, {
    '--rg-ann-size': '55%', '--rg-ann-color': 'currentColor', '--rg-ann-opacity': '0.7', '--rg-ann-weight': '400', '--rg-ann-gap': '0em', '--rg-ann-select': 'none',
    '--rg-mark-color': 'currentColor', '--rg-mark-bg': 'transparent', '--rg-mark-line': 'none',
  });
  const t = cssVars(cfg({ annotation: { sizePct: 80, color: 'accent', opacityPct: 100, weight: 'light', gapEm: 0.15 }, allowCopy: true }), false);
  assert.equal(t['--rg-ann-size'], '80%');
  assert.equal(t['--rg-ann-color'], '#2f6feb');
  assert.equal(t['--rg-ann-opacity'], '1');
  assert.equal(t['--rg-ann-weight'], '300');
  assert.equal(t['--rg-ann-gap'], '0.15em');
  assert.equal(t['--rg-ann-select'], 'text');
  assert.equal(cssVars(cfg({ annotation: { color: 'accent', weight: 'bold' } }), true)['--rg-ann-color'], '#6b9bff');
  assert.equal(cssVars(cfg({ annotation: { color: 'accent', weight: 'bold' } }), true)['--rg-ann-weight'], '600');
  assert.equal(cssVars(cfg({ annotation: { color: 'custom', customColor: '#AA00ff' } }))['--rg-ann-color'], '#aa00ff');
});

test('readglossAnnotStyle(계약 F): apply 는 CSS 변수만 쓰고 DOM 은 안 건드리며, 스타일시트 글에 gloss 규칙과 복사 막기가 있다', () => {
  const st = globalThis.readglossAnnotStyle;
  assert.deepEqual(Object.keys(st).sort(), ['apply', 'css', 'renderPreview', 'sheet']);
  const doc = makeDoc();
  const target = doc.createElement('div');
  target.append('keep');
  st.apply(cfg({ annotation: { sizePct: 70 } }), target, false);
  assert.equal(target.vars['--rg-ann-size'], '70%');
  assert.equal(target.childNodes.length, 1); // 구조는 그대로
  st.apply({ annotation: { sizePct: 9999 } }, target, true); // 범위 밖·부분 설정도 normalize 해서 쓴다
  assert.equal(target.vars['--rg-ann-size'], '100%');
  assert.match(st.css, /\[data-readgloss="gloss"\][^}]*user-select: var\(--rg-ann-select, none\)/);
  assert.match(st.css, /\[data-rg-word\]/);
});

test('renderPreview: 예시 문장에 실제 그리기 함수로 주석 3개(설정의 위치·표시 반영), 다시 부르면 갈아 끼운다', () => {
  const doc = makeDoc();
  const box = doc.createElement('div');
  doc.body.append(box);
  const { renderPreview } = globalThis.readglossAnnotStyle;
  renderPreview(box, cfg());
  assert.equal(annsOf(box).length, 3);
  assert.deepEqual(annsOf(box).map((a) => a.getAttribute('data-lemma')), ['exploit', 'escalate', 'exfiltrate']);
  assert.ok(annsOf(box).every((a) => a.tagName === 'RUBY'));
  assert.equal(box.textContent.replace(/이용하다|단계적으로 확대하다|유출하다/g, ''), 'Attackers exploit unpatched services to escalate privileges and exfiltrate data.');
  assert.equal(box.vars['--rg-ann-size'], '55%'); // 변수는 container 에 쓴다
  renderPreview(box, cfg({ annotation: { position: 'right', sizePct: 90 }, mark: 'underline', maxPerParagraph: 1, repeat: 'page' }));
  assert.equal(box.childNodes.length, 1); // 문장 하나만 남는다
  assert.equal(annsOf(box).length, 3); // 미리보기는 개수·반복 설정과 상관없이 예시를 보여 준다
  assert.ok(annsOf(box).every((a) => a.tagName === 'SPAN' && glossOf(a).textContent.startsWith('(')));
  assert.equal(box.vars['--rg-ann-size'], '90%');
  renderPreview(box, cfg({ annotation: { position: 'none' }, mark: 'none' }));
  assert.equal(annsOf(box).length, 0); // 둘 다 없음이면 문장만
  assert.equal(box.textContent, 'Attackers exploit unpatched services to escalate privileges and exfiltrate data.');
});

test('makeAnnotation: 뜻은 textContent 로만 넣는다(마크업이 들어 있어도 글자 그대로)', () => {
  const doc = makeDoc();
  const ann = makeAnnotation(doc, { text: 'payload', lemma: 'payload', gloss: '<img src=x onerror=alert(1)>' }, 'top', 'none');
  assert.equal(glossOf(ann).childNodes.length, 1);
  assert.equal(glossOf(ann).childNodes[0].nodeType, 3);
});

test('annotate.js: 두 이벤트·설정 변경·끄기 범위를 연결하고, 낡은 키(annotateEnabled)와 data-rg-lemma 는 더는 안 쓴다', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\('readgloss:words'/);
  assert.match(src, /addEventListener\('readgloss:pageoff'/);
  assert.match(src, /readglossSettings/);
  assert.match(src, /onChange/);
  assert.match(src, /annotating\(/);
  assert.match(src, /adoptedStyleSheets/);
  assert.doesNotMatch(src, /annotateEnabled|data-rg-lemma/);
  const para = readFileSync(new URL('../extension/paragraph.js', import.meta.url), 'utf8');
  assert.match(para, /addEventListener\('readgloss:pageoff'/);
  assert.match(para, /enabledHere\(/);
  assert.match(para, /buttonPosition\(\{[^}]*\blist\b/); // li 글머리표 비켜 두기
});

test('paragraph.js: 버튼 말풍선 색이 설정 테마를 따른다(auto 면 미디어 쿼리, light·dark 면 호스트 data-theme)', () => {
  const para = readFileSync(new URL('../extension/paragraph.js', import.meta.url), 'utf8');
  assert.match(para, /@media \(prefers-color-scheme: dark\) \{\s*:host\(:not\(\[data-theme="light"\]\)\) \.wrap \{ \$\{DARK\} \}/);
  assert.match(para, /:host\(\[data-theme="dark"\]\) \.wrap \{ \$\{DARK\} \}/);
  assert.doesNotMatch(para, /@media \(prefers-color-scheme: dark\) \{\s*\.wrap/, '미디어 쿼리가 .wrap 을 직접 바꾸면 밝게 고정이 안 먹는다');
  assert.match(para, /setAttribute\('data-theme'/);
  assert.match(para, /removeAttribute\('data-theme'/);
  assert.ok(para.match(/applyTheme\(/g).length >= 3, '정의 + 버튼 만들 때 + 설정 읽을·바뀔 때');
});

test('annotate-core: 위쪽 주석 뜻은 가운데 정렬·줄바꿈 없음(공백 낀 뜻이 단어 폭에 흩어지지 않게)', () => {
  const css = globalThis.readglossAnnotStyle.css;
  assert.match(css, /ruby\[data-readgloss="ann"\][^}]*ruby-align: center/);
  assert.match(css, /rt\[data-readgloss="gloss"\][^}]*white-space: nowrap/);
});
