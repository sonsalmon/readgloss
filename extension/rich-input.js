// T61a: 메모 쓰는 칸을 Tiptap 편집기로 바꾸는 얇은 덮개.
// textarea 처럼 value·selectionStart/End·setSelectionRange·setRangeText·focus 를 흉내 낸다.
// 묶음(globalThis.readglossTiptap)이 없으면 create 가 null 을 돌려주어 호출자가 textarea 로 되돌아간다.
(() => {
  const RULE = 'readglossRichRules';

  // 끝 공백·줄바꿈만 자른다(저장 글과 왕복을 맞춘다).
  function trimEnd(md) {
    return String(md ?? '').replace(/\s+$/, '');
  }

  // 쓰는 칸과 그리기 편집기가 같은 스키마를 쓰도록 확장 목록을 한 곳에 둔다.
  function extensionsFor({ placeholder = '', maxLength = 2000, rules = null } = {}) {
    const T = globalThis.readglossTiptap;
    if (!T) return [];
    const { StarterKit, Markdown, TaskList, TaskItem, Placeholder, CharacterCount } = T;
    const list = [
      StarterKit.configure({
        link: { openOnClick: false, autolink: false },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: maxLength }),
    ];
    if (rules) list.push(rules);
    return list;
  }

  function create({ value = '', placeholder = '', maxLength = 2000, onMarkPrefix } = {}) {
    const T = globalThis.readglossTiptap;
    if (!T || typeof document === 'undefined') return null;

    const { Editor, Extension, InputRule } = T;

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
      extensions: extensionsFor({ placeholder, maxLength, rules }),
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

  // ---- 저장한 메모 그리기 (T61c, 30-4) ----
  // 파싱 전용 편집기는 처음 그릴 때 한 번만 만들어 다시 쓴다.
  let renderEditor = null;

  function getRenderEditor() {
    if (renderEditor) return renderEditor;
    const T = globalThis.readglossTiptap;
    if (!T) return null;
    // 붙이지 않는 편집기: 스키마와 마크다운 파서만 쓴다.
    renderEditor = new T.Editor({
      editable: false,
      extensions: extensionsFor(),
      content: '',
    });
    return renderEditor;
  }

  // 링크는 http(s)만 남긴다. 남는 링크는 새 탭으로 연다.
  function cleanLink(a) {
    let ok = false;
    try {
      const u = new URL(a.getAttribute('href') || '');
      ok = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      ok = false;
    }
    if (!ok) {
      a.removeAttribute('href');
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }

  // 글 노드 앞이 줄 처음·공백인지(앞의 굵게 같은 인라인 요소를 건너뛴다).
  const BLOCK_TAGS = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'DIV', 'UL', 'OL', 'HR', 'TABLE', 'TD', 'TH',
  ]);
  function boundaryBefore(node, root) {
    let cur = node;
    while (cur && cur !== root) {
      let prev = cur.previousSibling;
      while (prev) {
        const text = prev.textContent ?? '';
        if (text.length > 0) return /\s$/.test(text);
        prev = prev.previousSibling;
      }
      const parent = cur.parentNode;
      if (!parent || parent === root) return true;
      if (BLOCK_TAGS.has(parent.nodeName)) return true;
      cur = parent;
    }
    return true;
  }

  // 글 노드 안 #태그를 칩으로 바꾼다(지금 appendMemoText 와 같은 모양).
  function chipifyTextNode(node, root) {
    const doc = node.ownerDocument;
    const text = node.nodeValue ?? '';
    const startOk = boundaryBefore(node, root);
    const re = startOk ? /(^|\s)#([^\s#]{1,20})(?=$|\s)/g : /\s#([^\s#]{1,20})(?=$|\s)/g;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let made = false;
    let m;
    while ((m = re.exec(text)) !== null) {
      const group = startOk ? m[1] : m[0].slice(0, 1);
      const hashIndex = m.index + group.length;
      const tag = startOk ? m[2] : m[1];
      if (hashIndex > last) frag.append(doc.createTextNode(text.slice(last, hashIndex)));
      const chip = doc.createElement('span');
      chip.className = 'sec-tag-chip';
      chip.textContent = `#${tag}`;
      frag.append(chip);
      last = hashIndex + 1 + tag.length;
      made = true;
    }
    if (!made) return;
    if (last < text.length) frag.append(doc.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  // 코드·pre 안은 건드리지 않는다.
  function chipsIn(el) {
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, 4); // 4 = SHOW_TEXT
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('code, pre')) continue;
      nodes.push(node);
    }
    for (const n of nodes) chipifyTextNode(n, el);
  }

  // 묶음이 없을 때: 지금 appendMemoText 와 같은 결과(글 조각 + #태그 칩).
  function appendPlainText(el, text) {
    const doc = el.ownerDocument;
    const re = /(^|\s)#([^\s#]{1,20})(?=$|\s)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const hashIndex = m.index + m[1].length;
      if (hashIndex > last) el.append(doc.createTextNode(text.slice(last, hashIndex)));
      const chip = doc.createElement('span');
      chip.className = 'sec-tag-chip';
      chip.textContent = `#${m[2]}`;
      el.append(chip);
      last = hashIndex + 1 + m[2].length;
    }
    if (last < text.length) el.append(doc.createTextNode(text.slice(last)));
  }

  // 마크다운 글을 targetEl 에 DOM 조각으로 그린다(HTML 문자열·innerHTML 없음).
  function renderMarkdown(md, targetEl) {
    if (!targetEl || typeof targetEl !== 'object') return;
    const text = String(md ?? '');
    if (!text) return;
    const doc = targetEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    if (!globalThis.readglossTiptap) {
      appendPlainText(targetEl, text);
      return;
    }

    const editor = getRenderEditor();
    if (!editor) {
      appendPlainText(targetEl, text);
      return;
    }

    const json = editor.markdown.parse(text);
    const node = editor.schema.nodeFromJSON(json);
    const { DOMSerializer } = globalThis.readglossTiptap;
    const frag = DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content, { document: doc });
    targetEl.replaceChildren(frag);

    for (const a of targetEl.querySelectorAll('a')) cleanLink(a);
    for (const box of targetEl.querySelectorAll('input[type="checkbox"]')) box.disabled = true;
    chipsIn(targetEl);
  }

  globalThis.readglossRichInput = {
    create,
    renderMarkdown,
  };
})();
