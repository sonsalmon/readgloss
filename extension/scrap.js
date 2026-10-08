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
  // 스크랩 위치로 스크롤하고 깜빡임 효과
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
      }, 1500);
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
        if (knownScraps.size > 0 && found.size >= knownScraps.size) {
          stopRetryObserver();
        }
      }, 500);
    });

    retryObserver.observe(target, { childList: true, subtree: true, characterData: true });

    stopTimer = setTimeout(() => {
      stopRetryObserver();
    }, 10_000);
  }

  function initPageScraps() {
    if (!globalThis.chrome?.runtime?.id || typeof location === 'undefined') return;
    chrome.runtime.sendMessage({ type: 'scraps', op: 'get', url: location.href }, (r) => {
      if (chrome.runtime.lastError || !r || r.error) return;
      const list = Array.isArray(r.scraps) ? r.scraps : [];
      if (!list.length) return;
      paint(list);

      // 아직 못 찾은 스크랩이 있으면 MutationObserver 로 10초까지 재시도(디바운스 500ms)
      if (found.size < knownScraps.size) {
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
