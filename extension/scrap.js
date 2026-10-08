// 페이지 스크랩 접착(T24): 형광펜 칠하기·걷기, 페이지 열 때 다시 칠하기, 10초 재시도.
// CSS Custom Highlight API(readgloss-scrap)를 사용하며 페이지 DOM 글은 바꾸지 않는다.
(() => {
  const HIGHLIGHT_NAME = 'readgloss-scrap';
  const FLASH_NAME = 'readgloss-scrap-flash';
  const STYLE_ID = 'readgloss-scrap-style';

  // 스타일 주입: ::highlight(readgloss-scrap){background-color:#FAEEDA}
  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        background-color: #FAEEDA;
      }
      ::highlight(${FLASH_NAME}) {
        background-color: #F7D070;
      }
    `;
    (document.head || document.documentElement || document.body)?.append(style);
  }

  // 요소 하나가 색인에서 빠지는지(규칙은 scrap-core.js skipsIndex). 자식까지 통째로 건너뛴다.
  function skipEl(n) {
    const skips = globalThis.readglossScrap?.skipsIndex;
    if (!skips) return false;
    const ce = n.getAttribute('contenteditable');
    return skips({ localName: n.localName, readgloss: n.getAttribute('data-readgloss'), editable: ce != null && ce !== 'false' });
  }

  // 본문 글 색인(fullText, nodes). 글 모으기 규칙은 scrap-core.js indexText 가 정한다(br·블록 경계에 공백, kbd·samp 포함).
  function buildTextIndex(root = (typeof document !== 'undefined' ? (document.body || document.documentElement) : null)) {
    if (!root || typeof document === 'undefined') return { fullText: '', nodes: [] };
    return globalThis.readglossScrap.indexText(root, skipEl);
  }

  // 글자 오프셋 [startOffset, endOffset] -> DOM Range
  function offsetToRange(nodes, startOffset, endOffset) {
    if (typeof document === 'undefined' || startOffset >= endOffset || !nodes.length) return null;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;

    for (const item of nodes) {
      if (!startNode && startOffset >= item.start && startOffset <= item.end) {
        startNode = item.node;
        startNodeOffset = startOffset - item.start;
      }
      if (endOffset >= item.start && endOffset <= item.end) {
        endNode = item.node;
        endNodeOffset = endOffset - item.start;
        break;
      }
    }
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      return range;
    } catch {
      return null;
    }
  }

  // 선택 Range 에서 quote({ exact, prefix, suffix })와 pos(글자 오프셋) 추출
  function quoteForRange(range) {
    if (!range) return null;
    const { fullText, nodes } = buildTextIndex();
    // 시작·끝 자리를 색인에서 못 찾으면(건너뛴 요소 안 등) 추측하지 않고 null: 호출부가 스크랩을 거절한다
    const start = globalThis.readglossScrap.endpointIndex(nodes, range.startContainer, range.startOffset, true);
    const end = globalThis.readglossScrap.endpointIndex(nodes, range.endContainer, range.endOffset, false);
    if (start === -1 || end === -1 || start >= end) return null;

    const core = globalThis.readglossScrap;
    const quote = core?.quoteOf ? core.quoteOf(fullText, start, end) : { exact: fullText.slice(start, end), prefix: '', suffix: '' };
    return { quote, pos: start };
  }

  const knownScraps = new Map(); // id -> scrap
  const scrapRanges = new Map(); // id -> Range
  const found = new Set(); // Set<id>

  // Highlight API 로 형광펜 칠하기
  function applyHighlights() {
    ensureStyle();
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const ranges = [...scrapRanges.values()];
    if (ranges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }

  // 이 페이지 주소(정규화). 칠하기·찾기는 이 주소의 스크랩만 다룬다.
  const pageUrl = () => globalThis.readglossSelection?.normalizeUrl(location.href) ?? '';

  // 스크랩 목록 형광펜 칠하기(이 페이지 것만)
  function paint(scraps) {
    if (scraps) {
      const list = globalThis.readglossScrap.scrapsOnPage(Array.isArray(scraps) ? scraps : [scraps], pageUrl());
      for (const s of list) {
        if (s?.id) knownScraps.set(s.id, s);
      }
    }
    const { fullText, nodes } = buildTextIndex();
    if (!fullText) return;

    const core = globalThis.readglossScrap;
    for (const s of knownScraps.values()) {
      if (!s?.quote?.exact) continue;
      const res = core?.findQuote ? core.findQuote(fullText, s.quote, s.pos) : null;
      if (res) {
        const range = offsetToRange(nodes, res.start, res.end);
        if (range) {
          scrapRanges.set(s.id, range);
          found.add(s.id);
          continue;
        }
      }
      scrapRanges.delete(s.id);
      found.delete(s.id);
    }
    applyHighlights();
  }

  // 스크랩 하나 형광펜 걷기
  function unpaint(id) {
    knownScraps.delete(id);
    scrapRanges.delete(id);
    found.delete(id);
    applyHighlights();
  }

  let flashTimer = 0;
  // 스크랩 위치로 스크롤하고 깜빡임 효과 (1.2초)
  function scrollTo(id) {
    const range = scrapRanges.get(id);
    if (!range || !found.has(id)) return false;
    const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
      clearTimeout(flashTimer);
      CSS.highlights.set(FLASH_NAME, new Highlight(range));
      flashTimer = setTimeout(() => {
        CSS.highlights.delete(FLASH_NAME);
      }, 1200);
    }
    return true;
  }

  // 선택 문장과 일치하는 기존 스크랩 찾기
  function findExisting(text) {
    const core = globalThis.readglossScrap;
    const exact = core.normText(text);
    if (!exact) return null;
    for (const s of core.scrapsOnPage([...knownScraps.values()], pageUrl())) {
      if (core.normText(s.quote?.exact) === exact) return s;
    }
    return null;
  }

  // --- 넘김 막대(Navigation Bar) ---
  let barHost = null;
  let barScraps = []; // 같은 할 일의 스크랩들 (orderInTask 순서)
  let barIndex = 0; // 현재 스크랩 인덱스
  let barTask = null;

  function closeBar() {
    if (barHost) {
      barHost.remove();
      barHost = null;
    }
    window.removeEventListener('keydown', onBarKeyDown, true);
  }

  function renderBarUI(shadow) {
    const n = barIndex + 1;
    const N = barScraps.length || 1;

    const barEl = document.createElement('div');
    barEl.className = 'rg-scrap-bar';

    const label = document.createElement('span');
    label.className = 'rg-bar-label';
    label.textContent = `스크랩 ${n} / ${N}`;

    const prevBtn = document.createElement('button');
    prevBtn.className = 'rg-bar-btn';
    prevBtn.type = 'button';
    prevBtn.textContent = '←';
    prevBtn.title = '이전 스크랩 (← 키)';
    prevBtn.disabled = barIndex <= 0;
    prevBtn.onclick = () => goToBarIndex(barIndex - 1);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'rg-bar-btn';
    nextBtn.type = 'button';
    nextBtn.textContent = '→';
    nextBtn.title = '다음 스크랩 (→ 키)';
    nextBtn.disabled = barIndex >= barScraps.length - 1;
    nextBtn.onclick = () => goToBarIndex(barIndex + 1);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rg-bar-btn rg-bar-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = '닫기';
    closeBtn.onclick = closeBar;

    barEl.append(label, prevBtn, nextBtn, closeBtn);
    shadow.replaceChildren(barEl);

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483645;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .rg-scrap-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        background: #ffffff;
        color: #222222;
        padding: 6px 14px;
        border-radius: 20px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08);
        font-size: 13px;
        user-select: none;
      }
      .rg-bar-label {
        font-weight: 500;
        white-space: nowrap;
      }
      .rg-bar-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 3px 7px;
        border-radius: 4px;
        font-size: 13px;
        color: #444;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.1s;
      }
      .rg-bar-btn:hover:not(:disabled) {
        background: #f0f0f0;
        color: #000;
      }
      .rg-bar-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rg-bar-close {
        margin-left: 2px;
        font-size: 12px;
      }
    `;
    shadow.append(style);
  }

  function goToBarIndex(idx) {
    if (idx < 0 || idx >= barScraps.length) return;
    barIndex = idx;
    if (barHost?.shadowRoot) {
      renderBarUI(barHost.shadowRoot);
    }
    const target = barScraps[barIndex];
    if (!target) return;

    const cur = pageUrl();
    const core = globalThis.readglossScrap;
    const targetUrl = core?.normalizeUrl ? core.normalizeUrl(target.url) : target.url;

    if (cur && targetUrl && cur === targetUrl) {
      scrollTo(target.id);
    } else {
      // 다른 페이지면 scrap-jump 메시지 전송
      chrome.runtime.sendMessage({
        type: 'scrap-jump',
        url: target.url,
        id: target.id,
        task: target.task,
      });
    }
  }

  function onBarKeyDown(e) {
    if (!barHost) return;
    if (e.key === 'Escape') {
      closeBar();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    // 막대가 있고 이벤트 경로에 입력칸·편집 영역이 없을 때만 키보드 ← →
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const isTyping = globalThis.readglossSelection?.isTypingPath
      ? globalThis.readglossSelection.isTypingPath(path, e.isComposing)
      : false;
    if (isTyping) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'ArrowLeft') {
      goToBarIndex(barIndex - 1);
    } else if (e.key === 'ArrowRight') {
      goToBarIndex(barIndex + 1);
    }
  }

  function openBar(id, task) {
    if (typeof document === 'undefined') return;

    // 다리에서 전체 스크랩을 가져와 같은 할 일 스크랩들을 orderInTask 순서로 구성
    chrome.runtime.sendMessage({ type: 'scraps', op: 'get' }, (res) => {
      const allScraps = Array.isArray(res?.scraps) ? res.scraps : [...knownScraps.values()];
      const core = globalThis.readglossScrap;
      const targetTask = task !== undefined ? task : (knownScraps.get(id)?.task ?? null);
      const ordered = core?.orderInTask ? core.orderInTask(allScraps, targetTask) : allScraps;

      barScraps = ordered.length > 0 ? ordered : (id && knownScraps.get(id) ? [knownScraps.get(id)] : []);
      const idx = barScraps.findIndex((s) => s.id === id);
      barIndex = idx >= 0 ? idx : 0;
      barTask = targetTask;

      if (!barHost) {
        barHost = document.createElement('readgloss-scrap-bar');
        barHost.attachShadow({ mode: 'open' });
        document.documentElement.append(barHost);
        window.addEventListener('keydown', onBarKeyDown, true);
      }
      renderBarUI(barHost.shadowRoot);
    });
  }

  // 이 페이지 첫 스크랩부터 넘김 막대 열기
  function openFirstBar() {
    const list = globalThis.readglossScrap?.scrapsOnPage([...knownScraps.values()], pageUrl());
    if (list && list.length > 0) {
      const first = list[0];
      scrollTo(first.id);
      openBar(first.id, first.task);
    }
  }

  // --- pendingScrap 대기 및 이동 ---
  let pendingTarget = null; // { id, url, task }

  function tryJumpPending() {
    if (!pendingTarget) return;
    if (found.has(pendingTarget.id)) {
      const target = pendingTarget;
      pendingTarget = null;
      scrollTo(target.id);
      openBar(target.id, target.task);
    }
  }

  globalThis.readglossScrapPage = {
    paint,
    unpaint,
    scrollTo,
    found,
    get scraps() {
      return [...knownScraps.values()];
    },
    findExisting,
    quoteForRange,
    buildTextIndex,
    offsetToRange,
    openBar,
    openFirstBar,
    closeBar,
  };

  // --- 페이지 로드 시 GET /scraps?url= 및 10초 재시도 관찰자 ---
  let retryObserver = null;
  let retryTimer = 0;
  let stopTimer = 0;

  function stopRetryObserver() {
    clearTimeout(retryTimer);
    clearTimeout(stopTimer);
    if (retryObserver) {
      retryObserver.disconnect();
      retryObserver = null;
    }
  }

  function startRetryObserver() {
    if (retryObserver || typeof MutationObserver === 'undefined') return;
    const target = document.body || document.documentElement;
    if (!target) return;

    retryObserver = new MutationObserver(() => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        paint();
        tryJumpPending();
        if (knownScraps.size > 0 && found.size >= knownScraps.size && !pendingTarget) {
          stopRetryObserver();
        }
      }, 500);
    });

    retryObserver.observe(target, { childList: true, subtree: true, characterData: true });

    stopTimer = setTimeout(() => {
      stopRetryObserver();
    }, 10_000);
  }

  // 새 페이지에서 background 에 대기 중인 점프를 묻는다(background 가 꺼내 주고 지움). 주소가 다르면 쓰지 않는다.
  function checkPendingOnLoad() {
    if (typeof location === 'undefined') return;
    chrome.runtime.sendMessage({ type: 'scrap-pending' }, (res) => {
      if (chrome.runtime.lastError || !res?.pending) return;
      const core = globalThis.readglossScrap;
      const valid = core?.checkPendingScrap ? core.checkPendingScrap(res.pending, location.href) : null;
      if (!valid) return;
      pendingTarget = valid;
      tryJumpPending();
    });
  }

  function initPageScraps() {
    if (!globalThis.chrome?.runtime?.id || typeof location === 'undefined') return;

    checkPendingOnLoad();

    chrome.runtime.sendMessage({ type: 'scraps', op: 'get', url: location.href }, (r) => {
      if (chrome.runtime.lastError || !r || r.error) return;
      const list = Array.isArray(r.scraps) ? r.scraps : [];
      if (!list.length) return;
      paint(list);
      tryJumpPending();

      // 아직 못 찾은 스크랩이 있거나 pendingScrap 을 기다리는 중이면 MutationObserver 로 10초까지 재시도
      if (found.size < knownScraps.size || pendingTarget) {
        startRetryObserver();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPageScraps, { once: true });
    } else {
      initPageScraps();
    }
  }
})();
