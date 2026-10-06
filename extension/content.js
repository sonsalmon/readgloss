// 더블클릭 -> 사전 카드. DOM 접착만 한다. 판단 로직은 text.js(globalThis.readgloss)에 있다.
(() => {
  const { cleanSelection, extractSentence, positionBubble, plainTextAt, BLOCKED_SELECTOR } = globalThis.readgloss;

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요',
    'ai-failed': '뜻을 가져오지 못했어요. 다시 시도해 주세요',
    'dict-unavailable': '맥 사전 도우미가 아직 없어요. 터미널에서 cd ~/dev/readgloss && npm run build:dict 를 실행해 주세요',
    'dict-failed': '사전을 읽지 못했어요. 다시 시도해 주세요',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };

  const CSS = `
    .card { --rg-bg: #ffffff; --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); --rg-radius: 10px;
      box-sizing: border-box; width: 340px; max-width: calc(100vw - 16px); overflow: hidden; border-radius: var(--rg-radius);
      background: var(--rg-bg); color: var(--rg-fg); border: 1px solid var(--rg-border); box-shadow: var(--rg-shadow);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .card { --rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
        --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45); }
    }
    .scroll { max-height: 360px; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 8px; }
    .scroll:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    .msg { color: var(--rg-muted); padding-bottom: 6px; word-break: keep-all; overflow-wrap: anywhere; }
    .entry + .entry { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--rg-border); }
    .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
    .hnum { display: inline-grid; place-items: center; min-width: 18px; height: 18px; border-radius: 9px; background: var(--rg-accent-soft);
      color: var(--rg-accent); font-size: 11px; font-weight: 700; align-self: center; }
    .hw { font-size: 18px; font-weight: 700; }
    .pron { color: var(--rg-muted); font-size: 13px; }
    .etym { color: var(--rg-muted); font-size: 12px; margin-top: 2px; }
    .posrow { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
    .pos { padding: 0 8px; border-radius: 10px; background: var(--rg-accent-soft); color: var(--rg-accent); font-size: 12px; font-weight: 600; }
    .posnote { color: var(--rg-muted); font-size: 12px; }
    .sense { display: flex; gap: 6px; margin-top: 4px; }
    .num { flex: none; min-width: 1.4em; color: var(--rg-muted); font-variant-numeric: tabular-nums; }
    .stext { min-width: 0; word-break: keep-all; overflow-wrap: anywhere; }
    .ex { color: var(--rg-muted); font-size: 12.5px; margin-top: 2px; }
    .ai { margin: 2px 12px 0; padding: 6px 10px; border-radius: 8px; background: var(--rg-accent-soft); font-size: 13px; }
    .ai[hidden] { display: none; }
    .ai.err { background: none; color: var(--rg-muted); padding-left: 0; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px 12px; }
    .btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border);
      color: var(--rg-fg); font-size: 12.5px; line-height: 1.6; }
    .btn:hover { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .btn[aria-disabled="true"] { opacity: .55; cursor: default; }
  `;

  let host = null;
  let ui = null; // { card, scroll, ai, aiBtn }
  let seq = 0; // 닫거나 새로 열 때마다 올려서 늦게 온 응답을 버린다
  let current = null; // { word, sentence, anchor, aiAsked }

  // 사전·AI 가 준 글은 textContent 로만 넣는다(innerHTML 금지).
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildCard() {
    host = document.createElement('readgloss-card');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; left: 0; top: 0;';
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = el('style');
    style.textContent = CSS;
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${current.word} 사전`);
    const scroll = el('div', 'scroll');
    scroll.tabIndex = 0;
    const ai = el('div', 'ai');
    ai.hidden = true;
    ai.setAttribute('role', 'status');

    const foot = el('div', 'foot');
    const aiBtn = el('button', 'btn', 'AI 문맥 뜻');
    aiBtn.type = 'button';
    aiBtn.setAttribute('aria-label', 'AI로 이 문장 속 뜻 보기');
    aiBtn.addEventListener('click', () => current && askAi());
    const naver = el('a', 'btn', '네이버에서 열기');
    naver.href = `https://en.dict.naver.com/#/search?query=${encodeURIComponent(current.word)}`;
    naver.target = '_blank';
    naver.rel = 'noopener noreferrer';
    naver.setAttribute('aria-label', '네이버 사전에서 열기(새 탭)');
    foot.append(aiBtn, naver);

    card.append(scroll, ai, foot);
    shadow.append(style, card);
    document.documentElement.append(host);
    ui = { card, scroll, ai, aiBtn };
  }

  function place() {
    const a = current.anchor;
    const rect = { left: a.left - scrollX, top: a.top - scrollY, bottom: a.bottom - scrollY };
    const size = ui.card.getBoundingClientRect();
    const p = positionBubble({
      rect,
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollX, scrollY },
      size,
    });
    host.style.left = `${p.left}px`;
    host.style.top = `${p.top}px`;
  }

  function showMessage(text) {
    ui.scroll.replaceChildren(el('div', 'msg', text));
    place();
  }

  // 표제어별 블록: 머리(번호·표제어·발음) / 품사 배지 + 번호 뜻 / 예문
  function renderEntries(entries) {
    const multi = entries.length > 1;
    const blocks = entries.map((e, i) => {
      const box = el('section', 'entry');
      const head = el('div', 'head');
      if (multi) head.append(el('span', 'hnum', String(e.homograph || i + 1)));
      head.append(el('span', 'hw', e.headword || current.word));
      if (e.pron) head.append(el('span', 'pron', e.pron));
      box.append(head);
      if (e.etym) box.append(el('div', 'etym', e.etym));
      let lastKey = null;
      for (const s of e.senses ?? []) {
        const key = `${s.pos}|${s.posNote}`;
        if (key !== lastKey) {
          lastKey = key;
          if (s.pos || s.posNote) {
            const row = el('div', 'posrow');
            if (s.pos) row.append(el('span', 'pos', s.pos));
            if (s.posNote) row.append(el('span', 'posnote', s.posNote));
            box.append(row);
          }
        }
        const line = el('div', 'sense');
        if (s.num != null) line.append(el('span', 'num', `${s.num}.`));
        const body = el('div', 'stext', s.text);
        for (const ex of s.examples ?? []) body.append(el('div', 'ex', ex));
        line.append(body);
        box.append(line);
      }
      return box;
    });
    ui.scroll.replaceChildren(...blocks);
    place();
  }

  function close() {
    seq++;
    current = null;
    host?.remove();
    host = ui = null;
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }
  }

  async function askDict() {
    const my = ++seq;
    showMessage('찾는 중…');
    const r = await send({ type: 'dict', word: current.word });
    if (my !== seq) return;
    if (r?.found && r.entries?.length) renderEntries(r.entries);
    else if (r?.found === false) showMessage('사전에 없어요');
    else showMessage(MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`);
  }

  async function askAi() {
    if (ui.aiBtn.getAttribute('aria-disabled') === 'true') return;
    const my = seq;
    const force = current.aiAsked === true; // 두 번째 누름부터는 캐시를 건너뛰고 다시 묻는다
    current.aiAsked = true;
    ui.aiBtn.setAttribute('aria-disabled', 'true');
    ui.ai.hidden = false;
    ui.ai.className = 'ai';
    ui.ai.textContent = '가져오는 중…';
    place();
    const r = await send({ type: 'lookup', word: current.word, sentence: current.sentence, force });
    if (my !== seq) return;
    ui.aiBtn.removeAttribute('aria-disabled');
    if (r?.gloss) ui.ai.textContent = `${current.word}: ${r.gloss}`;
    else {
      ui.ai.className = 'ai err';
      ui.ai.textContent = MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;
    }
    place();
  }

  function elementOf(node) {
    return node?.nodeType === 1 ? node : node?.parentElement;
  }

  // 글자가 놓인 가장 가까운 블록 상자(문장을 뽑을 범위)
  function blockOf(node) {
    for (let el = elementOf(node); el && el !== document.body; el = el.parentElement) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && !d.startsWith('ruby') && d !== 'contents') return el; // 자동 주석의 ruby(display: ruby)는 글 블록이 아니다
    }
    return document.body;
  }

  function onDblClick(e) {
    if (host && e.composedPath().includes(host)) return; // 카드 안
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = elementOf(range.commonAncestorContainer);
    const target = elementOf(e.target);
    if (!el || el.isContentEditable || el.closest(BLOCKED_SELECTOR) || target?.closest(BLOCKED_SELECTOR)) return;
    const picked = cleanSelection(sel.toString());
    if (!picked) return;

    const block = blockOf(range.startContainer);
    const { text, offset } = plainTextAt(block, range.startContainer, range.startOffset); // 자동 주석의 rt 글자는 문장에 섞지 않는다
    const sentence = extractSentence(text, offset + picked.start, picked.word.length);
    const r = range.getBoundingClientRect();

    if (host) close();
    current = { word: picked.word, sentence, aiAsked: false, anchor: { left: r.left + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY } };
    buildCard();
    askDict().catch(close); // 동기적으로 "찾는 중…" 부터 그린다
  }

  document.addEventListener(
    'dblclick',
    (e) => {
      try {
        onDblClick(e);
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
    },
    true,
  );
  document.addEventListener('mousedown', (e) => host && !e.composedPath().includes(host) && close(), true);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && host && close(), true);
})();
