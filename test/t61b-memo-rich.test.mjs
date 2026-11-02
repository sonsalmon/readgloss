import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

// happy-dom 창을 전역에 세운 뒤 묶음과 덮개를 고전 스크립트처럼 읽는다.
const window = new Window({ url: 'https://example.test' });
// Mod-Enter 를 ⌘(meta)로 보게 한다(prosemirror-keymap 은 묶음을 읽을 때 플랫폼을 본다).
const originalPlatform = window.navigator.platform;
Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
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

const { create } = globalThis.readglossRichInput;

function mount(options) {
  const el = create(options);
  document.body.appendChild(el);
  return el;
}

test('(가) ⌘Enter 는 HardBreak 줄바꿈을 넣지 않고 글을 그대로 둔다', () => {
  const el = mount({ value: 'abcd' });
  try {
    el.rgEditor.commands.setTextSelection(3);
    el.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
    assert.equal(el.value, 'abcd');
    assert.equal(el.rgEditor.state.doc.textContent, 'abcd');
  } finally {
    el.rgEditor.destroy();
    Object.defineProperty(window.navigator, 'platform', { value: originalPlatform, configurable: true });
  }
});

test('Shift+Enter 줄바꿈은 남는다', () => {
  const el = mount({ value: 'abcd' });
  el.rgEditor.commands.setTextSelection(3);
  el.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Enter',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(el.value, 'ab  \ncd');
  el.rgEditor.destroy();
});

test('(나) 첫 줄 !이름·?이름은 역슬래시로 이스케이프되지 않는다', () => {
  const bang = mount({ value: '!이름\n정의' });
  assert.ok(bang.value.split('\n')[0].startsWith('!이름'));
  bang.rgEditor.destroy();

  const question = mount({ value: '?이름' });
  assert.ok(question.value.split('\n')[0].startsWith('?이름'));
  question.rgEditor.destroy();
});

test('(다) Backspace 판정에 쓰는 value·selectionStart: 빈 칸은 ""·0, 맨 앞은 0', () => {
  const empty = mount({});
  assert.equal(empty.value, '');
  assert.equal(empty.selectionStart, 0);
  empty.rgEditor.destroy();

  const el = mount({ value: 'abc' });
  el.setSelectionRange(0);
  assert.equal(el.selectionStart, 0);
  el.rgEditor.destroy();
});
