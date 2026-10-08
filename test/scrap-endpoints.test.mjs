import test from 'node:test';
import assert from 'node:assert/strict';

// T24 스크랩 끝점 시험: 경계점이 요소일 때 색인 위치로 바꾸는 endpointIndex. 브라우저 없이 작은 가짜 DOM으로 본다.
await import('../extension/scrap-core.js');
const SC = globalThis.readglossScrap;

const el = (localName, ...kids) => {
  const n = { nodeType: 1, localName, parentNode: null, childNodes: [], readgloss: null, editable: false };
  for (const k of kids) { k.parentNode = n; n.childNodes.push(k); }
  return n;
};
const txt = (v) => ({ nodeType: 3, nodeValue: v, parentNode: null, childNodes: [] });

// scrap.js buildTextIndex 와 같은 규칙: 건너뛴 요소(rt 등) 안의 글은 뺀다
function indexOf(root) {
  const items = [];
  let full = '';
  const walk = (n) => {
    if (n.nodeType === 3) {
      let skipped = false;
      for (let p = n.parentNode; p; p = p.parentNode) {
        if (p.nodeType === 1 && SC.skipsIndex(p)) skipped = true;
      }
      if (!skipped && n.nodeValue) {
        items.push({ node: n, start: full.length, end: full.length + n.nodeValue.length });
        full += n.nodeValue;
      }
      return;
    }
    n.childNodes.forEach(walk);
  };
  walk(root);
  return { full, items };
}

test('끝점이 다음 블록 요소(offset 0)면 앞 글의 끝에 붙는다', () => {
  const p1 = el('p', txt('Hello world'));
  const p2 = el('p', txt('Next'));
  const body = el('body', p1, p2);
  const { full, items } = indexOf(body);
  const start = SC.endpointIndex(items, items[0].node, 0, true);
  const end = SC.endpointIndex(items, p2, 0, false);
  assert.equal(start, 0);
  assert.equal(end, 11);
  assert.equal(full.slice(start, end), 'Hello world');
});

test('시작점이 부모 요소면 그 자식 위치 뒤 첫 글에 붙는다', () => {
  const p = el('p', txt('Alpha '), el('em', txt('beta')), txt(' gamma'));
  const body = el('body', p);
  const { full, items } = indexOf(body);
  const start = SC.endpointIndex(items, p, 1, true); // em 앞
  const end = SC.endpointIndex(items, items[2].node, 6, false); // ' gamma' 끝
  assert.equal(full, 'Alpha beta gamma');
  assert.equal(start, 6);
  assert.equal(end, 16);
  assert.equal(full.slice(start, end), 'beta gamma');
});

test('자동 주석 ruby 안에서 시작: 요소 시작은 본문 글, rt 안 글 시작은 rt 뒤 글로 붙는다', () => {
  const rt = el('rt', txt('뜻'));
  const ruby = el('ruby', txt('word'), rt);
  ruby.readgloss = 'ann';
  const tail = txt(' tail');
  const p = el('p', ruby, tail);
  const body = el('body', p);
  const { full, items } = indexOf(body);
  assert.equal(full, 'word tail');
  assert.equal(SC.endpointIndex(items, ruby, 0, true), 0);
  assert.equal(SC.endpointIndex(items, rt.childNodes[0], 0, true), 4); // rt 안 글 시작 → 뒤 ' tail'
  assert.equal(SC.endpointIndex(items, tail, 5, false), 9);
});

test('색인 글이 하나도 없으면 -1', () => {
  const body = el('body', el('pre', txt('code only')));
  const { items } = indexOf(body);
  assert.equal(items.length, 0);
  assert.equal(SC.endpointIndex(items, body, 0, true), -1);
  assert.equal(SC.endpointIndex(items, body, 1, false), -1);
});
