import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// T22 후속 수정 시험: (1) 걷기 직후 재시작의 세대 경합(끝 정리·옛 로딩), (2) 늦은 옛 답의 로딩 표시,
// (3/5) 메모 Esc 예외·페이지 스크립트 .click() 차단. 1·4번은 paragraph.js 를 가짜 DOM 에 실제로 로드해 루프를 돌린다.
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
const TRANSLATION_TAG = 'readgloss-translation';

// ---- 가짜 브라우저 환경(브라우저 없이 paragraph.js 를 돌린다) ----
function el(tag, attrs = {}, ...kids) {
  const n = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: null,
    isContentEditable: false,
    isConnected: true,
    childNodes: [],
    _attrs: { ...attrs },
    style: {},
    textContent: '',
    hasAttribute(k) { return k in this._attrs; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    append(...ns) { for (const x of ns) { const node = typeof x === 'string' ? { nodeType: 3, nodeValue: x } : x; if (node?.nodeType === 1) node.parentElement = this; this.childNodes.push(node); } return this; },
    insertAdjacentElement(_pos, x) { if (x) { x.parentElement = this.parentElement; x.isConnected = true; this.parentElement?.childNodes.push(x); } return x; },
    getBoundingClientRect() { return { top: 0, bottom: 100, left: 100, width: 100, height: 100 }; },
    remove() { this.isConnected = false; if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((c) => c !== this); },
  };
  n.append(...kids);
  return n;
}

const created = [];
const calls = [];
const fakeDocument = {
  body: el('div'),
  documentElement: { append() {}, setAttribute() {}, removeAttribute() {} },
  addEventListener() {},
  createElement: (tag) => { const n = el(tag); if (tag === TRANSLATION_TAG) created.push(n); return n; },
  querySelectorAll: (sel) => created.filter((n) => n.tagName === String(sel).toUpperCase() && n.isConnected),
  createTreeWalker: () => ({ nextNode: () => null }),
  createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [] }),
};
globalThis.document = fakeDocument;
globalThis.getComputedStyle = () => ({ display: 'block' });
globalThis.innerHeight = 800;
globalThis.location = { hostname: 'a.test', href: 'https://a.test/p' };
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.getSelection = () => ({ isCollapsed: true });
globalThis.readglossPageOff = false;
globalThis.readglossSettings = {
  normalize: (s) => ({ enabled: true, sites: [], ...s }),
  load: () => Promise.resolve({ enabled: true, sites: [] }),
  onChange: () => {},
};
globalThis.chrome = { runtime: { id: 'test', sendMessage: (msg) => new Promise((resolve) => calls.push({ msg, resolve })) } };

await import('../extension/paragraph-core.js');
await import('../extension/paragraph.js');
const api = globalThis.readglossPageTranslate;
const core = globalThis.readglossParagraph;
const tick = () => new Promise((r) => setTimeout(r, 0));

function reset() {
  calls.length = 0;
  created.length = 0;
  api.clear();
}
function setBody(...blocks) {
  fakeDocument.body = el('div', {}, ...blocks);
}

test('T22-1 걷기 직후 재시작: 옛 실행의 끝 정리가 새 실행을 덮지 않고, 늦게 온 옛 답 뒤에도 모든 문단을 번역한다', async () => {
  reset();
  const A = el('p', {}, 'Alpha paragraph has plenty of English words to translate well.');
  const B = el('p', {}, 'Bravo paragraph has plenty of English words to translate well.');
  setBody(A, B);

  api.start(); // 1회차: A 요청
  await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0].msg.text, /Alpha/);

  api.clear(); // 걷기
  api.start(); // 걷기 직후 재시작
  await tick();
  assert.equal(calls.length, 2, '옛 전체 번역이 남긴 로딩 때문에 건너뛰지 않고 다시 보낸다');
  assert.equal(api.state().running, true);

  calls[0].resolve({ translation: '옛 알파' }); // 늦게 온 옛 답
  await tick();
  assert.equal(api.state().running, true, '옛 실행의 끝 정리가 새 실행의 running 을 덮지 않는다');
  assert.equal(api.state().done, 0, '옛 답은 진행으로 세지 않는다');
  assert.equal(created.length, 0, '옛 답으로는 번역문을 넣지 않는다');

  calls[1].resolve({ translation: '새 알파' });
  await tick();
  assert.equal(calls.length, 3, '첫 문단이 끝나면 다음 문단으로 넘어간다');

  calls[2].resolve({ translation: '새 브라보' });
  await tick();

  const st = api.state();
  assert.equal(st.running, false);
  assert.equal(st.done, 2, '진행 n/N 이 맞는다');
  assert.equal(st.total, 2);
  assert.equal(created.filter((n) => n.isConnected).length, 2, '모든 문단이 번역된다');
  assert.deepEqual(created.map((n) => n.textContent).sort(), ['새 브라보', '새 알파']);
});

test('T22-4 전체 번역 루프 예외: 현재 세대면 finally 로 running 을 false 로 되돌리고 상태를 알린다', async () => {
  reset();
  setBody(el('p', {}, 'Charlie paragraph has plenty of English words to translate well.'));

  const seen = [];
  const off = api.onStatus((d) => seen.push(d));
  const orig = core.bulkStep;
  core.bulkStep = () => { throw new Error('boom'); };
  try {
    api.start();
    await tick();
    assert.equal(calls.length, 1);
    calls[0].resolve({ translation: '찰리' });
    await tick();
  } finally {
    core.bulkStep = orig;
    off();
  }
  const st = api.state();
  assert.equal(st.running, false, '예외가 나도 running 이 true 로 남지 않는다');
  assert.equal(st.started, true, '걷기 버튼으로 바뀐다(stop 으로 굳지 않는다)');
  assert.equal(seen.some((d) => d.running === false), true, '마지막 상태를 알린다');
});

test('T22-1b paragraph.js: 루프 끝 정리는 현재 세대일 때만, finally 로 한다', () => {
  const src = read('paragraph.js');
  const loop = src.slice(src.indexOf('const queue = orderFromVisible(blocks)'), src.indexOf('function stopPageTranslate'));
  assert.match(loop, /try \{/);
  assert.match(loop, /finally \{/);
  assert.match(loop, /if \(gen === bulkGen\) \{/);
});

test('T22-2 paragraph.js: 늦게 온 옛 답을 버릴 때 현재 문단이면 로딩 표시를 새로 그린다', () => {
  const src = read('paragraph.js');
  const stale = src.slice(src.indexOf('if (stale?.())'), src.indexOf('if (r?.translation'));
  assert.match(stale, /if \(current === block\) refresh\(\)/);
  assert.match(stale, /if \(requests\.get\(block\) === req\) requests\.delete\(block\)/, '새 실행의 요청 표시는 지우지 않는다');
});

test('T22-3 content.js: 사전 카드 Esc 도 확인 메시지(readgloss-toast) 안에서는 무시한다', () => {
  const src = read('content.js');
  assert.match(src, /document\.addEventListener\('keydown', \(e\) => e\.key === 'Escape' && host && !e\.composedPath\(\)\.some\(\(n\) => n\.localName === 'readgloss-toast'\) && \(\(e\.readglossCardClosed = true\), close\(\)\), true\)/);
});

test('T22-5 panel.js: 전체 번역 메뉴 클릭은 신뢰한 클릭만 처리한다(페이지 .click() 차단)', () => {
  const src = read('panel.js');
  const fn = src.slice(src.indexOf('function onPageTranslateClick'), src.indexOf('// 메뉴를 열 때'));
  assert.match(fn, /e\.isTrusted === false\) return/);
});
