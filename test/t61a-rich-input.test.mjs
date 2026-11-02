import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

// happy-dom 창을 전역에 세운 뒤 묶음과 덮개를 고전 스크립트처럼 읽는다.
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

const { create } = globalThis.readglossRichInput;

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

test('(가) value 왕복: 제목·목록·태그·할 일이 그대로', () => {
  const cases = ['## 제목\n\n- a\n- b', '#태그 글', '1. x\n2. y', '- [ ] 할 일'];
  for (const md of cases) {
    const el = mount({ value: md });
    assert.equal(el.value, md);
    el.rgEditor.destroy();
  }
});

test('(나) 빈 편집기의 value 는 빈 글', () => {
  const el = mount({});
  assert.equal(el.value, '');
  el.rgEditor.destroy();
});

test('(다) 맨 앞 커서는 selectionStart 0, 글 끝은 0보다 크다', () => {
  const el = mount({ value: 'hello' });
  el.setSelectionRange(0);
  assert.equal(el.selectionStart, 0);
  el.setSelectionRange(999);
  assert.ok(el.selectionStart > 0);
  el.rgEditor.destroy();
});

test('(라) setRangeText 는 평문을 넣고 input 이벤트를 쏜다', () => {
  const el = mount({ value: 'abc' });
  let inputCount = 0;
  el.addEventListener('input', () => {
    inputCount += 1;
  });
  el.setSelectionRange(999);
  el.setRangeText('X');
  assert.equal(el.value, 'abcX');
  assert.ok(inputCount >= 1);
  el.rgEditor.destroy();
});

test('(마) 빈 칸의 ? · ! 규칙이 모드를 부르고 글을 비운다', () => {
  const marks = [];
  const question = mount({ onMarkPrefix: (mark) => marks.push(mark) });
  type(question, '? ');
  assert.deepEqual(marks, ['question']);
  assert.equal(question.value, '');
  question.rgEditor.destroy();

  const insight = mount({ onMarkPrefix: (mark) => marks.push(mark) });
  type(insight, '! ');
  assert.deepEqual(marks, ['question', 'insight']);
  assert.equal(insight.value, '');
  insight.rgEditor.destroy();
});

test('(바) "## " 를 치면 첫 블록이 제목 2가 된다', () => {
  const el = mount({});
  type(el, '## ');
  const first = el.rgEditor.state.doc.firstChild;
  assert.equal(first.type.name, 'heading');
  assert.equal(first.attrs.level, 2);
  el.rgEditor.destroy();
});

test('(아) 평문의 _ · * · [ 는 저장 글에서 이스케이프된다', () => {
  const el = mount({});
  type(el, 'a_b*c[d]');
  assert.equal(el.value, 'a\\_b\\*c\\[d\\]');
  el.rgEditor.destroy();
});

test('(사) 문서가 비어 있지 않으면 ? 는 모드가 아니다', () => {
  const marks = [];
  const el = mount({ value: 'abc', onMarkPrefix: (mark) => marks.push(mark) });
  el.setSelectionRange(0);
  type(el, '? ');
  assert.deepEqual(marks, []);
  assert.ok(el.value.includes('?'));
  el.rgEditor.destroy();
});

test('인용·취소선 규칙도 같은 입력 경로에서 돈다', () => {
  const quote = mount({});
  type(quote, '" ');
  assert.equal(quote.rgEditor.state.doc.firstChild.type.name, 'blockquote');
  quote.rgEditor.destroy();

  const strike = mount({});
  type(strike, '~abc~');
  assert.equal(strike.value, '~~abc~~');
  strike.rgEditor.destroy();
});
