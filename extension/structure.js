// 문장 구조 UI(T42b): 전치사 + 관계사 구절 탐색, Custom Highlight API 로 밑줄 표시,
// 클릭 시 250ms 대기 후 구조 카드(readgloss-struct-card)를 띄운다. 페이지 DOM 은 전혀 건드리지 않는다.
(() => {
  if (typeof document === 'undefined') return;

  const core = globalThis.readglossStructureCore;
  const S = globalThis.readglossSettings;
  const A = globalThis.readglossAnnotate;
  if (!core || !S || !globalThis.chrome?.runtime?.id) return;

  const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption';
  const EXCLUDE = 'pre, kbd, samp, script, style, noscript, template, textarea, input, select, button, svg, [contenteditable]:not([contenteditable="false"]), [data-readgloss]';

  const BRIDGE_OFF_MSG = '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요';
  const STRUCT_CSS = '::highlight(readgloss-struct) { text-decoration: underline dotted; text-decoration-color: #9d72e7; text-underline-offset: .25em; }';

  const DARK_VARS = `--rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45);`;
  const CARD_CSS = `
    .card {
      --rg-bg: #ffffff; --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); --rg-radius: 10px;
      box-sizing: border-box; width: 360px; max-width: calc(100vw - 16px); overflow: hidden; border-radius: var(--rg-radius);
      background: var(--rg-bg); color: var(--rg-fg); border: 1px solid var(--rg-border); box-shadow: var(--rg-shadow);
      font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif;
      padding: 12px 14px 14px;
    }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .card { ${DARK_VARS} } }
    :host([data-theme="dark"]) .card { ${DARK_VARS} }
    * { box-sizing: border-box; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-size: 14px; font-weight: 700; color: var(--rg-fg); }
    .close { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; color: var(--rg-muted); font-size: 14px; }
    .close:hover { background: var(--rg-accent-soft); color: var(--rg-fg); }
    .close:focus-visible { outline: 2px solid var(--rg-accent); }
    .body { display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; overscroll-behavior: contain; }
    .loading, .msg { color: var(--rg-muted); font-size: 13px; padding: 4px 0; word-break: keep-all; }
    .skeleton-box { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 8px; background: var(--rg-accent-soft); }
    .skeleton-list { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: baseline; }
    .sk-item { display: inline-flex; align-items: baseline; gap: 4px; }
    .role-chip { display: inline-block; padding: 1px 6px; border-radius: 4px; background: var(--rg-bg); border: 1px solid var(--rg-border); color: var(--rg-accent); font-size: 11px; font-weight: 600; line-height: 1.4; }
    .sk-text { font-size: 13px; color: var(--rg-fg); }
    .section { display: flex; flex-direction: column; gap: 2px; }
    .label { font-size: 11px; font-weight: 700; color: var(--rg-muted); }
    .val { font-size: 13px; color: var(--rg-fg); word-break: keep-all; }
    .stats { font-size: 11.5px; color: var(--rg-muted); margin-top: 2px; }
    .foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--rg-border); }
    .btn { all: unset; cursor: pointer; padding: 4px 12px; border-radius: 7px; border: 1px solid var(--rg-border); font-size: 12.5px; font-weight: 500; color: var(--rg-fg); }
    .btn:hover:not(:disabled) { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); }
    .btn:disabled { opacity: .6; cursor: default; }
  `;

  let settings = S.normalize({});
  let pageOff = globalThis.readglossPageOff === true;
  let running = false;
  let io = null;
  let mo = null;
  let structSheet = null;
  let structStyleEl = null;

  const entriesByBlock = new Map(); // block -> [{ node, text, start, end, phrase, range }]
  let done = new WeakSet();

  let cardHost = null;
  let currentRequestId = 0;
  let clickTimer = 0;
  let pendingHit = null;

  // 켜짐 판정: structureHints 가 켜져 있고, 사이트 허용 및 페이지 켬 조건 만족(FX-J 5)
  function isEnabled() {
    if (settings.structureHints !== true) return false;
    const annotCore = globalThis.readglossAnnotate;
    if (typeof annotCore?.enabledHere === 'function') {
      return annotCore.enabledHere(settings, location.hostname, pageOff);
    }
    return settings.enabled === true && pageOff !== true && !S.siteBlocked(settings, location.hostname);
  }

  function ensureStyle() {
    if (typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets) {
      if (!structSheet) {
        structSheet = new CSSStyleSheet();
        structSheet.replaceSync(STRUCT_CSS);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, structSheet];
      }
    } else if (!structStyleEl) {
      structStyleEl = document.createElement('style');
      structStyleEl.textContent = STRUCT_CSS;
      (document.head || document.documentElement).append(structStyleEl);
    }
  }

  function clearBlockEntries(block) {
    entriesByBlock.delete(block);
  }

  function updateHighlights() {
    if (typeof Highlight === 'undefined' || !CSS?.highlights) return;
    if (!running) {
      CSS.highlights.delete('readgloss-struct');
      return;
    }
    const allRanges = [];
    for (const list of entriesByBlock.values()) {
      for (const e of list) {
        const isConnected = e.startNode ? e.startNode.isConnected : e.node?.isConnected;
        if (e.range && isConnected) {
          allRanges.push(e.range);
        }
      }
    }
    CSS.highlights.set('readgloss-struct', new Highlight(...allRanges));
  }

  // block 에 속한 직속 노드와 경계를 수집한다(FX-J 2)
  function collectBlockNodes(block) {
    const nodes = [];
    function walk(el) {
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) { // ELEMENT_NODE
          if (child.matches?.(EXCLUDE)) continue;
          if (child.matches?.(BLOCK)) {
            // 자식 BLOCK 요소: 경계 줄바꿈을 넣고, 자식 블록 내부는 순회하지 않는다(FX-J 2)
            nodes.push({ isBoundary: true, node: child });
            continue;
          }
          if (child.tagName?.toLowerCase() === 'br') {
            nodes.push({ isBoundary: true, node: child });
            continue;
          }
          walk(child);
        } else if (child.nodeType === 3) { // TEXT_NODE
          const p = child.parentElement;
          if (!p || p.closest(EXCLUDE)) continue;
          if (p.closest(BLOCK) !== block) continue;
          if (child.nodeValue) {
            nodes.push({ node: child, text: child.nodeValue });
          }
        }
      }
    }
    walk(block);
    return nodes;
  }

  function scanBlock(block) {
    if (!block.isConnected) return [];
    const nodes = collectBlockNodes(block);
    const { text: fullText, entries: offsetEntries } = core.buildNodeIndex(nodes);
    if (!fullText) return [];

    const matches = core.findPhrases(fullText);
    const entries = [];
    for (const m of matches) {
      const loc = core.resolveNodeOffsets(offsetEntries, m.start, m.end);
      if (!loc) continue;
      try {
        const range = new Range();
        range.setStart(loc.startNode, loc.startOffset);
        range.setEnd(loc.endNode, loc.endOffset);
        entries.push({
          startNode: loc.startNode,
          endNode: loc.endNode,
          node: loc.startNode,
          text: fullText,
          start: m.start,
          end: m.end,
          phrase: m.phrase,
          range,
        });
      } catch {
        // range 생성 실패 시 건너뜀
      }
    }
    return entries;
  }

  function onIntersect(records) {
    let changed = false;
    for (const r of records) {
      if (r.isIntersecting) {
        if (!done.has(r.target)) {
          done.add(r.target);
          const entries = scanBlock(r.target);
          if (entries.length) {
            entriesByBlock.set(r.target, entries);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      updateHighlights();
    }
  }

  function track(block) {
    if (io && running && block.isConnected && !done.has(block)) {
      io.observe(block);
    }
  }

  function retrack(block) {
    if (io && running && block.isConnected) {
      clearBlockEntries(block);
      done.delete(block);
      io.unobserve(block);
      io.observe(block);
    }
  }

  function onMutations(records) {
    const dirty = new Set();
    for (const r of records) {
      if (r.target?.closest?.('[data-readgloss]')) continue;
      const block = (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest(BLOCK);
      if (block) dirty.add(block);
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) {
          if (n.matches?.(BLOCK)) dirty.add(n);
          n.querySelectorAll?.(BLOCK).forEach((b) => dirty.add(b));
          const up = n.closest?.(BLOCK);
          if (up) dirty.add(up);
        }
      }
      for (const n of r.removedNodes || []) {
        if (n.nodeType === 1) {
          const unreg = (b) => {
            io?.unobserve(b);
            clearBlockEntries(b);
            done.delete(b);
          };
          if (n.matches?.(BLOCK)) unreg(n);
          n.querySelectorAll?.(BLOCK).forEach(unreg);
        }
      }
    }
    if (dirty.size) {
      for (const b of dirty) {
        retrack(b);
      }
      updateHighlights();
    }
  }

  function start() {
    if (running || !document.body) return;
    running = true;
    ensureStyle();
    io = new IntersectionObserver(onIntersect, { rootMargin: '100% 0px' });
    mo = new MutationObserver(onMutations);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelectorAll(BLOCK).forEach(track);
  }

  function stop() {
    if (!running) return;
    running = false;
    io?.disconnect();
    mo?.disconnect();
    io = mo = null;
    entriesByBlock.clear();
    done = new WeakSet();
    updateHighlights();
    closeCard();
  }

  function sync() {
    if (isEnabled()) {
      if (!running) start();
    } else {
      if (running) stop();
    }
  }

  // ---- 클릭 및 카드 제어 ----
  function findStructAt(x, y) {
    if (!running) return null;
    for (const [block, list] of entriesByBlock.entries()) {
      if (!block.isConnected) continue;
      for (const entry of list) {
        const isConnected = entry.startNode ? entry.startNode.isConnected : entry.node?.isConnected;
        if (!isConnected || !entry.range) continue;
        const rects = entry.range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return { entry, rect: r, block };
          }
        }
      }
    }
    return null;
  }

  function closeCard() {
    if (cardHost) {
      cardHost.remove();
      cardHost = null;
    }
  }

  function placeCard(cardEl, anchorRect) {
    if (!cardHost) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const size = cardEl.getBoundingClientRect();
    const GAP = 8;
    const MARGIN = 10;
    let left = Math.max(MARGIN, Math.min(anchorRect.left, vw - size.width - MARGIN));
    let top = anchorRect.bottom + GAP;
    if (top + size.height > vh - MARGIN) {
      if (anchorRect.top - GAP - size.height >= MARGIN) {
        top = anchorRect.top - GAP - size.height;
      } else {
        top = Math.max(MARGIN, vh - size.height - MARGIN);
      }
    }
    cardHost.style.left = `${left}px`;
    cardHost.style.top = `${top}px`;
  }

  async function openCard({ entry, rect, block }) {
    closeCard();
    const reqId = ++currentRequestId;

    const sentence = core.sentenceAround(entry.text, entry.start, entry.end);
    const phrase = entry.phrase;

    cardHost = document.createElement('readgloss-struct-card');
    const myHost = cardHost;
    cardHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    const shadow = cardHost.attachShadow({ mode: 'closed' });

    if (settings.theme === 'light' || settings.theme === 'dark') {
      cardHost.setAttribute('data-theme', settings.theme);
    }

    const style = document.createElement('style');
    style.textContent = CARD_CSS;

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '문장 구조 풀이');

    const head = document.createElement('div');
    head.className = 'head';
    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = '문장 구조';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.addEventListener('click', closeCard);
    head.append(titleEl, closeBtn);

    const body = document.createElement('div');
    body.className = 'body';
    const loadingEl = document.createElement('div');
    loadingEl.className = 'loading';
    loadingEl.textContent = '풀이를 불러오는 중…';
    body.append(loadingEl);

    card.append(head, body);
    shadow.append(style, card);
    document.documentElement.append(cardHost);
    placeCard(card, rect);

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'structure',
        sentence,
        phrase,
        title: core.truncateTitle(document.title, 300),
      });

      if (reqId !== currentRequestId || !cardHost || cardHost !== myHost) return;

      if (!res || res.error) {
        body.replaceChildren();
        const errEl = document.createElement('div');
        errEl.className = 'msg';
        errEl.textContent = res?.error === 'bridge-off' ? BRIDGE_OFF_MSG : '풀이를 가져오지 못했어요';
        body.append(errEl);
        placeCard(card, rect);
        return;
      }

      body.replaceChildren();

      // 뼈대 (역할 칩 + 영어 조각)
      if (Array.isArray(res.skeleton) && res.skeleton.length) {
        const skBox = document.createElement('div');
        skBox.className = 'skeleton-box';
        const skLabel = document.createElement('div');
        skLabel.className = 'label';
        skLabel.textContent = '문장 뼈대';
        const skList = document.createElement('div');
        skList.className = 'skeleton-list';
        for (const item of res.skeleton) {
          const skItem = document.createElement('span');
          skItem.className = 'sk-item';
          const chip = document.createElement('span');
          chip.className = 'role-chip';
          chip.textContent = item.role;
          const text = document.createElement('span');
          text.className = 'sk-text';
          text.textContent = item.text;
          skItem.append(chip, text);
          skList.append(skItem);
        }
        skBox.append(skLabel, skList);
        body.append(skBox);
      }

      // 구절 풀이
      if (res.phrase) {
        const phSec = document.createElement('div');
        phSec.className = 'section';
        const phLabel = document.createElement('div');
        phLabel.className = 'label';
        phLabel.textContent = '구절 풀이';
        const phVal = document.createElement('div');
        phVal.className = 'val';
        phVal.textContent = res.phrase;
        phSec.append(phLabel, phVal);
        body.append(phSec);
      }

      // 문장 번역
      if (res.ko) {
        const koSec = document.createElement('div');
        koSec.className = 'section';
        const koLabel = document.createElement('div');
        koLabel.className = 'label';
        koLabel.textContent = '문장 번역';
        const koVal = document.createElement('div');
        koVal.className = 'val';
        koVal.textContent = res.ko;
        koSec.append(koLabel, koVal);
        body.append(koSec);
      }

      // 구조 연 횟수
      const statsEl = document.createElement('div');
      statsEl.className = 'stats';
      statsEl.textContent = `이 구조를 연 횟수 ${Number(res.opened) || 1}번`;
      body.append(statsEl);

      // 하단 문장 저장 버튼
      const foot = document.createElement('div');
      foot.className = 'foot';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn';
      saveBtn.type = 'button';
      saveBtn.textContent = '문장 저장';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        const curUrl = typeof location !== 'undefined' && /^https?:\/\//i.test(location.href) ? location.href : '';
        const saved = await chrome.runtime.sendMessage({
          type: 'words',
          op: 'save-phrase',
          text: sentence,
          translation: res.ko || '',
          kind: 'sentence',
          url: curUrl,
          title: core.truncateTitle(document.title, 200),
        });
        if (saved && !saved.error) {
          saveBtn.textContent = '✓ 문장 저장됨';
        } else {
          saveBtn.textContent = '저장 실패';
          saveBtn.disabled = false;
        }
      });
      foot.append(saveBtn);
      card.append(foot);

      placeCard(card, rect);
    } catch {
      if (reqId !== currentRequestId || !cardHost || cardHost !== myHost) return;
      body.replaceChildren();
      const errEl = document.createElement('div');
      errEl.className = 'msg';
      errEl.textContent = '풀이를 가져오지 못했어요';
      body.append(errEl);
      placeCard(card, rect);
    }
  }

  // ---- 이벤트 리스너(클릭, 더블클릭, Esc, 밖 클릭) ----
  document.addEventListener('click', (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const inOurUi = path.some((el) => {
      if (!el || el.nodeType !== 1) return false;
      const tag = (el.tagName || '').toLowerCase();
      return tag.startsWith('readgloss-') || Boolean(el.matches?.('[data-readgloss]'));
    });

    const sel = window.getSelection();
    const selectionEmpty = !sel || sel.isCollapsed || !sel.toString().trim();

    const targetEl = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
    const link = targetEl?.closest?.('a[href]');
    const inLink = Boolean(link);

    const hit = findStructAt(e.clientX, e.clientY);
    if (hit) {
      const allow = core.shouldOpenOnClick({
        inLink,
        altKey: e.altKey,
        inOurUi,
        selectionEmpty,
      });
      if (!allow) return;

      if (inLink && e.altKey) {
        e.preventDefault();
      }

      clearTimeout(clickTimer);
      pendingHit = hit;
      clickTimer = setTimeout(() => {
        clickTimer = 0;
        if (pendingHit) {
          const target = pendingHit;
          pendingHit = null;
          const curSel = window.getSelection();
          if (curSel && !curSel.isCollapsed && curSel.toString().trim()) return;
          openCard(target);
        }
      }, 250);
    }
  }, true);

  document.addEventListener('dblclick', () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = 0;
      pendingHit = null;
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (cardHost && !e.composedPath().includes(cardHost)) {
      closeCard();
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cardHost) {
      if (e.readglossCardClosed) return;
      e.preventDefault();
      e.readglossCardClosed = true;
      closeCard();
    }
  }, true);

  // ---- 설정 동기화 ----
  S.load().then((s) => {
    settings = s;
    sync();
  }, () => {});

  S.onChange((s) => {
    settings = s;
    if (cardHost && (s.theme === 'light' || s.theme === 'dark')) {
      cardHost.setAttribute('data-theme', s.theme);
    } else if (cardHost) {
      cardHost.removeAttribute('data-theme');
    }
    sync();
  });

  window.addEventListener('readgloss:pageoff', (e) => {
    pageOff = e.detail?.off === true;
    sync();
  });
})();
