import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

// happy-dom 창을 전역에 세운 뒤 묶음·덮개·순수 로직을 고전 스크립트처럼 읽는다.
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
vm.runInThisContext(readFileSync(new URL('rich-input.js', root), 'utf8'), { filename: 'rich-input.js' });
vm.runInThisContext(readFileSync(new URL('memo-core.js', root), 'utf8'), { filename: 'memo-core.js' });

const { create } = globalThis.readglossRichInput;
const memoCore = globalThis.readglossMemo;

function mount(options) {
  const el = create(options);
  document.body.appendChild(el);
  return el;
}

// 입력 규칙은 브라우저의 글자 입력 경로를 부른다.
function type(el, text) {
  const view = el.rgEditor.view;
  for (const ch of text) {
    const from = view.state.selection.from;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, from, ch, () => view.state.tr));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, from));
  }
}

test('2100자 초안은 편집기에 그대로 남는다(상한은 저장 때 막는다)', () => {
  const long = 'a'.repeat(2100);
  const el = mount({ value: long });
  try {
    assert.equal(el.value.length, 2100);
    assert.equal(el.value, long);
  } finally {
    el.rgEditor.destroy();
  }
});

test("'- a' 첫 줄 맨 앞에서 selectionStart 는 0", () => {
  const el = mount({ value: '- a' });
  try {
    el.setSelectionRange(0);
    assert.equal(el.value, '- a');
    assert.equal(el.selectionStart, 0);
  } finally {
    el.rgEditor.destroy();
  }
});

test("'- ' 만 있는 목록의 value 는 빈 글", () => {
  const el = mount({});
  try {
    type(el, '- ');
    assert.equal(el.value, '');
  } finally {
    el.rgEditor.destroy();
  }
});

test('unescapeMd 는 마크다운 이스케이프를 풀고 개념 명령 이름에도 쓰인다', () => {
  assert.equal(memoCore.unescapeMd('!snake\\_case'), '!snake_case');
  const cmd = memoCore.parseConceptCommand(memoCore.unescapeMd('!snake\\_case'));
  assert.equal(cmd?.name, 'snake_case');
});

test('injectCSS: false 라서 document.head 에 style[data-tiptap-style] 이 생기지 않는다', () => {
  const styleSel = 'style[data-tiptap-style]';
  assert.equal(document.head.querySelectorAll(styleSel).length, 0);
  const el = mount({ value: 'a' });
  try {
    assert.equal(document.head.querySelectorAll(styleSel).length, 0);
  } finally {
    el.rgEditor.destroy();
  }
});
