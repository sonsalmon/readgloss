// T61a: 메모 쓰는 칸을 Tiptap 편집기로 바꾸는 얇은 덮개.
// textarea 처럼 value·selectionStart/End·setSelectionRange·setRangeText·focus 를 흉내 낸다.
// 묶음(globalThis.readglossTiptap)이 없으면 create 가 null 을 돌려주어 호출자가 textarea 로 되돌아간다.
(() => {
  const RULE = 'readglossRichRules';

  // 끝 공백·줄바꿈만 자른다(저장 글과 왕복을 맞춘다).
  function trimEnd(md) {
    return String(md ?? '').replace(/\s+$/, '');
  }

  function create({ value = '', placeholder = '', maxLength = 2000, onMarkPrefix } = {}) {
    const T = globalThis.readglossTiptap;
    if (!T || typeof document === 'undefined') return null;

    const {
      Editor,
      Extension,
      InputRule,
      StarterKit,
      Markdown,
      TaskList,
      TaskItem,
      Placeholder,
      CharacterCount,
    } = T;

    const host = document.createElement('div');
    let editor = null;

    const rules = Extension.create({
      name: RULE,
      addKeyboardShortcuts() {
        // ⌘·Ctrl+Enter 는 저장이라 HardBreak(Mod-Enter)보다 먼저 처리해 줄바꿈을 넣지 않는다.
        // Shift+Enter 줄바꿈은 HardBreak 그대로 둔다.
        return {
          'Mod-Enter': () => true,
        };
      },
      addInputRules() {
        const list = [];

        // 비어 있는 칸 맨 앞에서 '? '·'! ' → 모드. 지우고 호출자에게 알린다.
        if (typeof onMarkPrefix === 'function') {
          list.push(
            new InputRule({
              find: (text) => {
                const match = /^([?!])\s$/.exec(text);
                if (!match) return null;
                const doc = editor?.state?.doc;
                if (!doc || doc.childCount !== 1) return null;
                const first = doc.firstChild;
                if (!first || first.type.name !== 'paragraph' || first.textContent !== match[1]) return null;
                return {
                  index: 0,
                  text: match[0],
                  data: { kind: match[1] === '?' ? 'question' : 'insight' },
                };
              },
              handler: ({ range, chain, match }) => {
                chain().deleteRange(range).run();
                onMarkPrefix(match.data?.kind ?? 'insight');
              },
            }),
          );
        }

        // 줄 처음 " + 스페이스 → 인용 블록.
        list.push(
          new InputRule({
            find: /^"\s$/,
            handler: ({ range, chain }) => {
              chain().deleteRange(range).setBlockquote().run();
            },
          }),
        );

        // ~글~ → 취소선. StarterKit 의 ~~글~~ 규칙이 먼저 돌므로 겹치지 않게 앞의 ~ 를 막는다.
        list.push(
          new InputRule({
            find: /(?<!~)~([^~\s](?:[^~\s]*[^~\s])?)~$/,
            handler: ({ state, range, match }) => {
              const strike = state.schema.marks.strike;
              if (!strike) return;
              const inner = match[1];
              const { tr } = state;
              tr.delete(range.from, range.to);
              tr.insertText(inner, range.from);
              tr.addMark(range.from, range.from + inner.length, strike.create());
              tr.removeStoredMark(strike);
            },
          }),
        );

        return list;
      },
    });

    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({
          link: { openOnClick: false, autolink: false },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown,
        Placeholder.configure({ placeholder }),
        CharacterCount.configure({ limit: maxLength }),
        rules,
      ],
      content: '',
    });

    const dom = editor.view.dom;
    dom.classList.add('rg-rich');

    // 초기값은 마크다운으로 넣는다. setContent 는 update 를 쏘지 않는다.
    editor.commands.setContent(String(value ?? ''), { contentType: 'markdown', emitUpdate: false });

    editor.on('update', () => {
      const win = dom.ownerDocument?.defaultView;
      const EventCtor = win?.Event ?? Event;
      dom.dispatchEvent(new EventCtor('input', { bubbles: true }));
    });

    const getValue = () => trimEnd(editor.getMarkdown());

    const atStart = () => editor.state.selection.from <= 1;
    const atEnd = () => editor.state.selection.to >= editor.state.doc.content.size - 1;

    // ponytail: 글자 자리를 정확히 세지 않는다. 호출자는 맨 앞이냐(0)만 쓰고,
    // 그 밖의 자리는 "0보다 큰 값"으로만 본다. 정확한 커서 복원이 필요해지면 그때 옮긴다.
    Object.defineProperty(dom, 'value', {
      get: getValue,
      set: (next) => {
        editor.commands.setContent(String(next ?? ''), { contentType: 'markdown', emitUpdate: false });
        editor.commands.focus('end');
      },
    });

    Object.defineProperty(dom, 'selectionStart', {
      get: () => {
        const valueLength = getValue().length;
        if (!valueLength) return 0;
        if (atStart()) return 0;
        return Math.max(1, Math.min(valueLength, editor.state.selection.from));
      },
    });

    Object.defineProperty(dom, 'selectionEnd', {
      get: () => {
        const valueLength = getValue().length;
        if (!valueLength) return 0;
        if (atEnd()) return valueLength;
        return Math.max(1, Math.min(valueLength, editor.state.selection.to));
      },
    });

    dom.setSelectionRange = (start) => {
      // ponytail: 자리를 세지 않는다. s === 0 이면 맨 앞, 아니면 끝(근사).
      if (start === 0) {
        editor.commands.setTextSelection(1);
      } else {
        editor.commands.focus('end');
      }
    };

    dom.setRangeText = (text) => {
      // 지금 선택 자리에 평문으로 넣는다(넣는 글은 마크다운으로 해석하지 않는다).
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(String(text ?? ''), from, to));
    };

    dom.focus = () => {
      editor.commands.focus();
    };

    Object.defineProperty(dom, 'maxLength', {
      get: () => maxLength,
    });

    Object.defineProperty(dom, 'placeholder', {
      get: () => placeholder,
    });

    Object.defineProperty(dom, 'rgEditor', {
      get: () => editor,
    });

    return dom;
  }

  globalThis.readglossRichInput = {
    create,
  };
})();
