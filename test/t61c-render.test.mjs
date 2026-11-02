import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

// happy-dom 창을 전역에 세운 뒤 묶음과 고전 스크립트를 읽는다(t61a 시험과 같은 방식).
const window = new Window({ url: 'https://example.test' });
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = window[key];
    } catch {
      // 읽기 전용 전역은 건너뛴다.
    }
  }
}
globalThis.getSelection = window.getSelection.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const root = new URL('../extension/', import.meta.url);
vm.runInThisContext(readFileSync(new URL('vendor/tiptap.bundle.js', root), 'utf8'), {
  filename: 'tiptap.bundle.js',
});

// 그리기 편집기를 몇 번 만드는지 세려고 Editor 생성자를 감싼다(시험용 훅 없이 확인).
const RealEditor = globalThis.readglossTiptap.Editor;
let editorCount = 0;
globalThis.readglossTiptap.Editor = class CountingEditor extends RealEditor {
  constructor(...args) {
    super(...args);
    editorCount += 1;
  }
};

vm.runInThisContext(readFileSync(new URL('rich-input.js', root), 'utf8'), { filename: 'rich-input.js' });
vm.runInThisContext(readFileSync(new URL('memo-core.js', root), 'utf8'), { filename: 'memo-core.js' });

const { renderMarkdown } = globalThis.readglossRichInput;
const { extractTags } = globalThis.readglossMemo;

function target() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('(가) 제목·목록·굵게를 DOM 노드로 그린다', () => {
  const el = target();
  renderMarkdown('## 제목\n\n- a\n- **b**', el);
  assert.equal(el.querySelectorAll('h2').length, 1);
  assert.equal(el.querySelectorAll('ul > li').length, 2);
  assert.equal(el.querySelectorAll('strong').length, 1);
});

test('(나) 링크는 http(s)만 남기고 새 탭으로 연다', () => {
  const el = target();
  renderMarkdown('[x](javascript:alert(1)) [y](https://e.com)', el);
  const links = el.querySelectorAll('a');
  assert.equal(links.length, 2);
  assert.equal(links[0].hasAttribute('href'), false);
  assert.equal(links[1].getAttribute('href'), 'https://e.com');
  assert.equal(links[1].getAttribute('target'), '_blank');
  assert.equal(links[1].getAttribute('rel'), 'noopener noreferrer');
});

test('(다) #태그는 span.sec-tag-chip 하나가 된다', () => {
  const el = target();
  renderMarkdown('#태그 글', el);
  const chips = el.querySelectorAll('span.sec-tag-chip');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].textContent, '#태그');
});

test('(라) 코드 안의 #글자는 칩이 되지 않는다', () => {
  const el = target();
  renderMarkdown('`#코드`', el);
  assert.equal(el.querySelectorAll('span.sec-tag-chip').length, 0);
  assert.equal(el.querySelector('code').textContent, '#코드');
});

test('(마) 여러 요소에 그려도 그리기 편집기를 새로 만들지 않는다', () => {
  const warm = target();
  renderMarkdown('warm', warm);
  assert.ok(editorCount >= 1);
  const before = editorCount;

  const first = target();
  const second = target();
  renderMarkdown('first', first);
  renderMarkdown('second', second);
  assert.equal(editorCount, before);
  assert.equal(first.textContent, 'first');
  assert.equal(second.textContent, 'second');
});

test('(바) 묶음이 없으면 글자 조각으로 넣는다', () => {
  const saved = globalThis.readglossTiptap;
  delete globalThis.readglossTiptap;
  try {
    const el = target();
    renderMarkdown('## 제목\n\n- a', el);
    assert.equal(el.textContent, '## 제목\n\n- a');
    assert.equal(el.children.length, 0);
  } finally {
    globalThis.readglossTiptap = saved;
  }
});

test('extractTags: 마크다운 이스케이프를 풀고 태그를 뽑는다', () => {
  assert.deepEqual(extractTags('#tag\\_name 글'), ['tag_name']);
  assert.deepEqual(extractTags('#a\\*b #c'), ['a*b', 'c']);
});
