// 더블클릭 -> 말풍선. DOM 접착만 한다. 판단 로직은 text.js(globalThis.readgloss)에 있다.
(() => {
  const { cleanSelection, extractSentence, positionBubble, BLOCKED_SELECTOR } = globalThis.readgloss;

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요',
    'ai-failed': '뜻을 가져오지 못했어요. 다시 시도해 주세요',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };

  const CSS = `
    .bubble { box-sizing: border-box; max-width: 280px; padding: 8px 10px; border-radius: 8px;
      background: #1f2430; color: #f4f6fb; font: 14px/1.4 system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.35); }
    .gloss { font-size: 15px; font-weight: 600; word-break: keep-all; overflow-wrap: anywhere; }
    .loading { font-weight: 400; opacity: .75; }
    .error { font-size: 13px; font-weight: 400; color: #ffd9a8; }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 12px; opacity: .85; }
    .row[hidden] { display: none; }
    .word { font-style: italic; }
    button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 4px; border: 1px solid #5b6478; color: #cfd6e6; font-size: 12px; }
    button:hover, button:focus-visible { background: #343b4d; }
  `;

  let host = null;
  let ui = null; // { bubble, gloss, row, word }
  let seq = 0; // 닫거나 새로 열 때마다 올려서 늦게 온 응답을 버린다
  let current = null; // { word, sentence, anchor }

  function buildBubble() {
    host = document.createElement('readgloss-bubble');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; left: 0; top: 0;';
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = document.createElement('style');
    style.textContent = CSS;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.setAttribute('role', 'status');
    const gloss = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'row';
    const word = document.createElement('span');
    word.className = 'word';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '이 문장으로 다시 묻기';
    button.addEventListener('click', () => current && ask(true));
    row.append(word, button);
    bubble.append(gloss, row);
    shadow.append(style, bubble);
    document.documentElement.append(host);
    ui = { bubble, gloss, row, word };
  }

  function place() {
    const a = current.anchor;
    const rect = { left: a.left - scrollX, top: a.top - scrollY, bottom: a.bottom - scrollY };
    const size = ui.bubble.getBoundingClientRect();
    const p = positionBubble({
      rect,
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollX, scrollY },
      size,
    });
    host.style.left = `${p.left}px`;
    host.style.top = `${p.top}px`;
  }

  function show(text, cls, { retry = true } = {}) {
    ui.gloss.textContent = text;
    ui.gloss.className = `gloss ${cls}`;
    ui.row.hidden = !retry;
    ui.word.textContent = current.word;
    place();
  }

  function close() {
    seq++;
    current = null;
    host?.remove();
    host = ui = null;
  }

  async function ask(force) {
    const my = ++seq;
    show('가져오는 중…', 'loading', { retry: false });
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: 'lookup', word: current.word, sentence: current.sentence, force });
    } catch {
      r = { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }
    if (my !== seq) return;
    if (r?.gloss) show(r.gloss, '');
    else show(MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`, 'error', { retry: r?.error !== 'bridge-off' });
  }

  function elementOf(node) {
    return node?.nodeType === 1 ? node : node?.parentElement;
  }

  // 글자가 놓인 가장 가까운 블록 상자(문장을 뽑을 범위)
  function blockOf(node) {
    for (let el = elementOf(node); el && el !== document.body; el = el.parentElement) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && d !== 'contents') return el;
    }
    return document.body;
  }

  function onDblClick(e) {
    if (host && e.composedPath().includes(host)) return; // 말풍선 안
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = elementOf(range.commonAncestorContainer);
    const target = elementOf(e.target);
    if (!el || el.isContentEditable || el.closest(BLOCKED_SELECTOR) || target?.closest(BLOCKED_SELECTOR)) return;
    const picked = cleanSelection(sel.toString());
    if (!picked) return;

    const block = blockOf(range.startContainer);
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const sentence = extractSentence(block.textContent, before.toString().length + picked.start, picked.word.length);
    const r = range.getBoundingClientRect();

    if (host) close();
    buildBubble();
    current = { word: picked.word, sentence, anchor: { left: r.left + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY } };
    ask(false).catch(close); // 동기적으로 "가져오는 중…" 부터 그린다
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
