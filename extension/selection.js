// 드래그 -> 번역 카드. DOM 접착만 한다. 판단 로직은 selection-core.js(globalThis.readglossSelection), 글 뽑기는 text.js·paragraph-core.js.
// 한 단어를 드래그하면 더블클릭과 같은 사전 카드(content.js)를 열고, 두 단어 이상이면 맥 번역 카드를 띄운다. [문맥 번역] 은 앞뒤 문맥을 보고 AI 가 번역한다.
(() => {
  const core = globalThis.readglossSelection;
  const T = globalThis.readgloss;
  const P = globalThis.readglossParagraph;
  const blockOf = globalThis.readglossBlockOf; // content.js 가 올려 둔다(더블클릭 사전 카드와 같은 블록 판정)
  if (!core || !T || !P || !blockOf) return;
  const { classify, around, buildContext, MAX_SIDE } = core;
  const { extractSentence, plainTextAt, positionBubble } = T;
  const { textOf, textExceeds } = P;

  const MAX_RAW = 20_000; // 이보다 큰 선택은 대상으로 보지 않는다(복제·분류 비용)

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    'mt-unavailable': '맥 번역 도우미가 아직 없어요. 터미널에서 cd ~/dev/readgloss && npm run build:mt 를 실행하고, 시스템 설정의 번역 언어에서 영어·한국어를 받아 주세요',
    'mt-failed': '맥 번역에 실패했어요. [문맥 번역]을 눌러 보세요',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요',
    'ai-failed': '번역하지 못했어요. 다시 시도해 주세요',
    'too-large': '글이 너무 길어요(문단 번역 버튼을 써 주세요)',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };
  const errText = (r) => MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;

  // 카드 디자인 토큰·모양은 content.js 의 사전 카드와 같다(바꿀 땐 같이 바꾼다).
  const DARK = `--rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45);`;
  const CSS = `
    .card { --rg-bg: #ffffff; --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); --rg-radius: 10px;
      box-sizing: border-box; width: 340px; max-width: calc(100vw - 16px); overflow: hidden; border-radius: var(--rg-radius);
      background: var(--rg-bg); color: var(--rg-fg); border: 1px solid var(--rg-border); box-shadow: var(--rg-shadow);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .card { ${DARK} } }
    :host([data-theme="dark"]) .card { ${DARK} }
    .scroll { max-height: 400px; overflow-y: auto; overscroll-behavior: contain; padding: 12px 16px 6px; }
    .scroll:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    .src { color: var(--rg-muted); font-size: 12.5px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    .term { display: none; margin-top: 8px; color: var(--rg-accent); font-size: 12px; font-weight: 600; word-break: keep-all; overflow-wrap: anywhere; }
    .term.on { display: block; }
    .out { margin-top: 8px; word-break: keep-all; overflow-wrap: anywhere; white-space: pre-wrap; }
    .out.err, .msg { color: var(--rg-muted); }
    .ctx { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--rg-border); }
    .ctx[hidden] { display: none; }
    .ctx-title { color: var(--rg-accent); font-size: 12px; font-weight: 700; }
    .note { margin-top: 4px; color: var(--rg-muted); font-size: 12px; word-break: keep-all; overflow-wrap: anywhere; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px 12px; }
    .btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border);
      color: var(--rg-fg); font-size: 12.5px; line-height: 1.6; }
    .btn:hover { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .btn[aria-disabled="true"] { opacity: .55; cursor: default; }
  `;

  let settings = globalThis.readglossSettings?.normalize({}) ?? { selectionTranslate: true, theme: 'auto' }; // 저장된 값을 읽기 전에는 기본값
  let host = null;
  let ui = null; // { card, src, term, out, ctx, ctxBody, note, ctxBtn, copyBtn }
  let current = null; // { text, range, anchor, mt, ctx, ctxAsked }
  let seq = 0; // 닫거나 새로 열 때마다 올려서 늦게 온 응답을 버린다
  const applyTheme = () => host && (settings.theme === 'light' || settings.theme === 'dark' ? host.setAttribute('data-theme', settings.theme) : host.removeAttribute('data-theme'));
  try {
    globalThis.readglossSettings?.load().then((s) => ((settings = s), applyTheme()), () => {});
    globalThis.readglossSettings?.onChange((s) => ((settings = s), applyTheme()));
  } catch {
    // 확장이 다시 로드된 뒤의 낡은 페이지: 기본값으로 둔다
  }

  const hint = () => globalThis.readglossGlossary?.hint(settings, document, location.hostname) ?? {};
  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  const isHidden = (el) => getComputedStyle(el).display === 'none';

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }
  }

  // 사용자가 고른 글: 주석 뜻 글자(gloss)·번역 노드는 뺀다(range.toString() 은 rt 글자까지 섞는다).
  function selectedText(range) {
    const box = document.createElement('div');
    box.append(range.cloneContents());
    return textOf(box);
  }

  // block 의 앞(dir -1)·뒤(dir 1) 블록 글. 형제를 따라가다 없으면 한 단계 위로. 문서 순서로 돌려준다. 1500자가 모이면 멈춘다.
  // ponytail: 형제 하나가 6000자를 넘으면(큰 래퍼) 거기서 멈춘다. 안으로 내려가 찾지는 않는다 -- 문맥이 짧아질 뿐이다.
  function neighbors(block, dir) {
    const out = [];
    let size = 0;
    let node = block;
    for (let guard = 0; guard < 60 && size < MAX_SIDE && node && node !== document.body && node !== document.documentElement; guard++) {
      const sib = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
      if (!sib) {
        node = node.parentElement;
        continue;
      }
      node = sib;
      if (textExceeds(sib, 6000)) break;
      const t = textOf(sib, { isHidden });
      if (!t) continue;
      out.push(t);
      size += t.length;
    }
    return dir < 0 ? out.reverse() : out;
  }

  // 선택 시작 위쪽의 h1~h3 (문서 순서, 가까운 것이 끝). 셋만 쓰니 요소를 먼저 고른 뒤 글을 뽑는다.
  function headingsAbove(node) {
    const found = [];
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (!(h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) break; // 문서 순서라 선택을 지나면 끝
      found.push(h);
    }
    return found.slice(-core.MAX_HEADINGS).map((h) => textOf(h, { isHidden }));
  }

  // 선택을 담은 글 블록 앞뒤와 제목·소제목 -> 다리에 싣는 context. 못 만들면 undefined(문맥 없이 번역).
  function contextFor(range) {
    try {
      const sc = range.startContainer;
      const ec = range.endContainer;
      const sb = blockOf(sc);
      const eb = blockOf(ec);
      const { head, tail } = around(sb, sc, range.startOffset, eb, ec, range.endOffset);
      return buildContext({ prev: neighbors(sb, -1), head, tail, next: neighbors(eb, 1), title: document.title, headings: headingsAbove(sc) });
    } catch {
      return undefined;
    }
  }
  core.contextFor = contextFor; // content.js 의 [AI 문맥 뜻] 도 같은 함수를 쓴다

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(label, aria, onclick) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onclick);
    return b;
  }

  function close() {
    seq++;
    current = null;
    host?.remove();
    host = ui = null;
  }

  function place() {
    if (!host || !current) return;
    const a = current.anchor;
    const p = positionBubble({
      rect: { left: a.left - scrollX, top: a.top - scrollY, bottom: a.bottom - scrollY },
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollX, scrollY },
      size: ui.card.getBoundingClientRect(),
    });
    host.style.left = `${p.left}px`;
    host.style.top = `${p.top}px`;
  }

  // text: 선택 원문(정리한 것). 너무 길면(long) 안내만 보인다. 모든 글은 textContent 로만 넣는다(innerHTML 금지).
  function build(text, long) {
    host = document.createElement('readgloss-selection');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; left: 0; top: 0;';
    applyTheme();
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = el('style');
    style.textContent = CSS;
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '번역');
    const scroll = el('div', 'scroll');
    scroll.tabIndex = 0;
    ui = { card };
    if (long) {
      scroll.append(el('div', 'msg', '너무 길어요(문단 번역 버튼을 써 주세요)'));
      card.append(scroll);
    } else {
      ui.term = el('div', 'term');
      ui.out = el('div', 'out', '번역 중…');
      ui.out.setAttribute('role', 'status');
      ui.ctx = el('div', 'ctx');
      ui.ctx.hidden = true;
      ui.ctxBody = el('div', 'out', '');
      ui.ctxBody.setAttribute('role', 'status');
      ui.note = el('div', 'note');
      ui.ctx.append(el('div', 'ctx-title', '문맥 번역'), ui.ctxBody, ui.note);
      scroll.append(el('div', 'src', text), ui.term, ui.out, ui.ctx);
      ui.ctxBtn = button('문맥 번역', '문맥 번역: 앞뒤 문맥을 보고 AI 가 번역', () => askContext());
      ui.copyBtn = button('복사', '번역문 복사', () => copy());
      const foot = el('div', 'foot');
      foot.append(ui.ctxBtn, ui.copyBtn);
      card.append(scroll, foot);
    }
    shadow.append(style, card);
    document.documentElement.append(host);
  }

  async function askMt() {
    const my = seq;
    const r = await send({ type: 'mt', text: current.text, ...hint() });
    if (my !== seq) return;
    if (r?.translation) {
      current.mt = r.translation;
      ui.out.textContent = r.translation;
      const line = globalThis.readglossGlossary?.termLine(r.term) ?? '';
      ui.term.textContent = line;
      ui.term.classList.toggle('on', line !== '');
    } else {
      ui.out.className = 'out err';
      ui.out.textContent = errText(r);
    }
    place();
  }

  async function askContext() {
    if (ui.ctxBtn.getAttribute('aria-disabled') === 'true') return;
    const my = seq;
    const force = current.ctxAsked === true; // 두 번째 누름부터는 캐시를 건너뛰고 다시 번역한다
    current.ctxAsked = true;
    ui.ctxBtn.setAttribute('aria-disabled', 'true');
    ui.ctx.hidden = false;
    ui.ctxBody.className = 'out';
    ui.ctxBody.textContent = '번역 중…';
    ui.note.textContent = '';
    place();
    const r = await send({ type: 'translate-context', text: current.text, context: contextFor(current.range), force, ...hint() });
    if (my !== seq) return;
    ui.ctxBtn.removeAttribute('aria-disabled');
    if (r?.translation) {
      current.ctx = r.translation;
      ui.ctxBody.textContent = r.translation;
      ui.note.textContent = r.note ?? '';
    } else {
      ui.ctxBody.className = 'out err';
      ui.ctxBody.textContent = errText(r);
    }
    place();
  }

  // 가장 마지막에 얻은 번역(문맥 번역이 있으면 그것)을 클립보드로. 실패하면 조용히 둔다.
  async function copy() {
    const text = current.ctx ?? current.mt;
    if (!text) return;
    const my = seq;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    if (my !== seq) return;
    ui.copyBtn.textContent = '복사됨';
    setTimeout(() => my === seq && ui && (ui.copyBtn.textContent = '복사'), 1200);
  }

  const isUi = (n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-'); // 카드·패널·버튼·번역문

  function onSelect(path) {
    const sel = getSelection();
    if (!settings.selectionTranslate || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const root = elementOf(range.commonAncestorContainer);
    const active = document.activeElement;
    if (!root || root.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') || root.isContentEditable) return;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName)) && active.contains(root)) return;
    if (path.some(isUi) || isUi(root.closest('[data-readgloss]:not([data-readgloss="ann"]):not([data-readgloss="gloss"])'))) return;
    if (sel.toString().length > MAX_RAW) return;
    const text = selectedText(range);
    const cls = classify(text);
    if (cls.kind === 'none') return;
    const r = range.getBoundingClientRect();
    if (cls.kind === 'word') {
      const block = blockOf(range.startContainer);
      const { text: plain, offset } = plainTextAt(block, range.startContainer, range.startOffset);
      const at = plain.indexOf(cls.word, offset);
      const sentence = extractSentence(plain, at < 0 ? offset : at, cls.word.length);
      window.dispatchEvent(new CustomEvent('readgloss:lookup', { detail: { word: cls.word, sentence, rect: { left: r.left, top: r.top, bottom: r.bottom }, range: range.cloneRange() } }));
      return;
    }
    if (host) close();
    current = { text: cls.text, range: range.cloneRange(), anchor: { left: r.left + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY } };
    build(cls.text, cls.kind === 'long');
    place();
    if (cls.kind === 'phrase') askMt().catch(close);
  }

  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0 || e.detail !== 1) return; // 더블클릭(detail 2)은 content.js 의 사전 카드가 처리한다
      const path = e.composedPath();
      setTimeout(() => {
        try {
          onSelect(path);
        } catch {
          // 페이지를 깨뜨리지 않는다
        }
      }, 0); // 선택이 확정된 뒤(이미 고른 글을 다시 눌러 지워지는 경우 포함)에 읽는다
    },
    true,
  );
  document.addEventListener('mousedown', (e) => host && !e.composedPath().includes(host) && close(), true);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && host && close(), true);
})();
