// 단어장 단어 칠하기 UI(T45b): 단어장 단어 탐색, Custom Highlight API 로 배경색 표시,
// 클릭 시 조건 만족 시 사전 카드를 연다. 페이지 DOM 은 전혀 건드리지 않는다.
(() => {
  if (typeof document === 'undefined') return;

  const core = globalThis.readglossSavedMarksCore;
  const S = globalThis.readglossSettings;
  if (!core || !S || !globalThis.chrome?.runtime?.id) return;

  const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption';
  const EXCLUDE = 'pre, kbd, samp, script, style, noscript, template, textarea, input, select, button, svg, [contenteditable]:not([contenteditable="false"]), [data-readgloss]';

  // 23-1: 단어장 readgloss-saved 반투명 바탕만 칠하고 글자색은 바꾸지 않는다
  const SAVED_CSS = '::highlight(readgloss-saved) { background-color: rgba(56, 189, 248, .22); }';

  let settings = S.normalize({});
  let pageOff = globalThis.readglossPageOff === true;
  let running = false;
  let io = null;
  let mo = null;
  let savedSheet = null;
  let savedStyleEl = null;

  let formMap = new Map(); // 형태 -> 원형 매핑
  const entriesByBlock = new Map(); // block -> [{ node, text, start, end, lemma, word, range }]
  let done = new WeakSet();

  // 켜짐 판정: savedMarks 가 켜져 있고, 사이트 허용 및 페이지 켬 조건 만족
  function isEnabled() {
    if (settings.savedMarks !== true) return false;
    const annotCore = globalThis.readglossAnnotate;
    if (typeof annotCore?.enabledHere === 'function') {
      return annotCore.enabledHere(settings, location.hostname, pageOff);
    }
    return settings.enabled === true && pageOff !== true && !S.siteBlocked(settings, location.hostname);
  }

  function ensureStyle() {
    if (typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets) {
      if (!savedSheet) {
        savedSheet = new CSSStyleSheet();
        savedSheet.replaceSync(SAVED_CSS);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, savedSheet];
      }
    } else if (!savedStyleEl) {
      savedStyleEl = document.createElement('style');
      savedStyleEl.textContent = SAVED_CSS;
      (document.head || document.documentElement).append(savedStyleEl);
    }
  }

  function clearBlockEntries(block) {
    entriesByBlock.delete(block);
  }

  function updateHighlights() {
    if (typeof Highlight === 'undefined' || !CSS?.highlights) return;
    if (!running) {
      CSS.highlights.delete('readgloss-saved');
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
    CSS.highlights.set('readgloss-saved', new Highlight(...allRanges));
  }

  // block 에 속한 직속 노드와 경계를 수집한다
  function collectBlockNodes(block) {
    const nodes = [];
    function walk(el) {
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) { // ELEMENT_NODE
          if (child.matches?.(EXCLUDE)) continue;
          if (child.matches?.(BLOCK)) {
            // 자식 BLOCK 요소: 경계 줄바꿈을 넣고, 자식 블록 내부는 순회하지 않는다
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
    if (!block.isConnected || !formMap || formMap.size === 0) return [];
    const nodes = collectBlockNodes(block);
    const { text: fullText, entries: offsetEntries } = core.buildNodeIndex(nodes);
    if (!fullText) return [];

    const matches = core.findSavedTokens(fullText, formMap);
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
          lemma: m.lemma,
          word: fullText.slice(m.start, m.end),
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

  function rescanAll() {
    for (const block of entriesByBlock.keys()) {
      if (block.isConnected) {
        entriesByBlock.set(block, scanBlock(block));
      } else {
        entriesByBlock.delete(block);
      }
    }
    updateHighlights();
  }

  // 단어장 원형 목록 가져오기
  async function loadWords() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'words', op: 'get' });
      const saved = res?.saved;
      const lemmas = Array.isArray(saved)
        ? saved.map((x) => x?.lemma || x).filter(Boolean)
        : Object.keys(saved ?? {});
      formMap = core.buildFormSet(lemmas);
      if (running) {
        rescanAll();
      }
    } catch {
      // 다리 미연결 등 오류 시 무시
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
  }

  function sync() {
    if (isEnabled()) {
      if (!running) start();
    } else {
      if (running) stop();
    }
  }

  // ---- 클릭 처리 (23-2) ----
  function findSavedAt(x, y) {
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

  function onClick(e) {
    if (!running || e.button !== 0) return;
    const path = e.composedPath();
    const inOurUi = path.some((n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-'));
    const sel = window.getSelection();
    const selectionEmpty = !sel || sel.isCollapsed;
    const link = e.target?.closest?.('a[href]');
    const inLink = Boolean(link);

    if (!core.shouldOpenOnClick({ inLink, altKey: e.altKey, inOurUi, selectionEmpty })) {
      return;
    }

    const hit = findSavedAt(e.clientX, e.clientY);
    if (!hit) return;

    if (inLink && e.altKey) {
      e.preventDefault();
    }

    // 23-2: 더블클릭 사전 카드를 그 낱말로 연다.
    // content.js가 사전 카드를 여는 공개 함수가 있으면 그것(globalThis.readglossDictCardUi 등),
    // 없으면 그 낱말 위치에 합성 dblclick을 보내지 말고 열지 않는다.
    const dictUi = globalThis.readglossDictCardUi;
    if (dictUi && typeof (dictUi.open || dictUi.openCard || dictUi.lookup) === 'function') {
      const openFn = dictUi.open || dictUi.openCard || dictUi.lookup;
      openFn({
        word: hit.entry.lemma || hit.entry.word,
        range: hit.entry.range,
        rect: hit.rect,
      });
    }
  }

  document.addEventListener('click', onClick, true);

  // 단어장이 변경되었을 때 다시 받아 다시 칠한다
  window.addEventListener('readgloss:words', () => {
    loadWords();
  });

  // 이 페이지 주석 끄기 토글 이벤트
  window.addEventListener('readgloss:pageoff', (e) => {
    pageOff = e.detail?.off === true;
    sync();
  });

  // 설정 변경 감시
  S.onChange((next) => {
    settings = next;
    sync();
  });

  // 초기 설정 및 단어장 로드
  S.load().then((s) => {
    settings = s;
    sync();
    loadWords();
  });
})();
