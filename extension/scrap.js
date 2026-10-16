// 페이지 스크랩 접착(T24): 형광펜 칠하기·걷기, 페이지 열 때 다시 칠하기, 10초 재시도.
// CSS Custom Highlight API(readgloss-scrap)를 사용하며 페이지 DOM 글은 바꾸지 않는다.
(() => {
  const HIGHLIGHT_NAME = 'readgloss-scrap';
  const FLASH_NAME = 'readgloss-scrap-flash';
  const STYLE_ID = 'readgloss-scrap-style';

  // 스타일 주입: ::highlight(readgloss-scrap) (23-1: 배경만 칠하고 글자색은 정하지 않는다)
  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        background-color: rgba(250, 204, 21, .28);
      }
      ::highlight(${FLASH_NAME}) {
        background-color: rgba(250, 204, 21, .55);
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
    if (activeCardScrapId === id) closeCard();
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

  // 테마(설정 'theme') 동기화
  let theme = 'auto';
  try {
    globalThis.readglossSettings?.load?.().then((s) => {
      if (s?.theme) theme = s.theme;
      if (cardHost) {
        if (theme === 'light' || theme === 'dark') cardHost.setAttribute('data-theme', theme);
        else cardHost.removeAttribute('data-theme');
      }
    }, () => {});
    globalThis.readglossSettings?.onChange?.((s) => {
      if (s?.theme) theme = s.theme;
      if (cardHost) {
        if (theme === 'light' || theme === 'dark') cardHost.setAttribute('data-theme', theme);
        else cardHost.removeAttribute('data-theme');
      }
    });
  } catch {}

  // --- 스크랩 카드(Scrap Card, 23-2) ---
  const CARD_DARK = `--rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45);`;
  const CARD_CSS = `
    .card {
      --rg-bg: #ffffff;
      --rg-fg: #1f2328;
      --rg-muted: #656d76;
      --rg-border: #e3e6ea;
      --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10);
      --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08);
      --rg-radius: 8px;
      box-sizing: border-box;
      width: 290px;
      max-width: calc(100vw - 20px);
      padding: 10px 12px;
      border-radius: var(--rg-radius);
      background: var(--rg-bg);
      color: var(--rg-fg);
      border: 1px solid var(--rg-border);
      box-shadow: var(--rg-shadow);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .card { ${CARD_DARK} } }
    :host([data-theme="dark"]) .card { ${CARD_DARK} }
    .meta {
      font-size: 12px;
      color: var(--rg-muted);
      margin-bottom: 6px;
      word-break: keep-all;
    }
    .memo-line {
      font-size: 12.5px;
      color: var(--rg-fg);
      background: var(--rg-accent-soft);
      padding: 4px 8px;
      border-radius: 4px;
      margin-bottom: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .trans-line {
      font-size: 12.5px;
      color: var(--rg-fg);
      background: var(--rg-accent-soft);
      padding: 4px 8px;
      border-radius: 4px;
      margin-bottom: 8px;
      word-break: keep-all;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .trans-line.err {
      color: var(--rg-muted);
      background: transparent;
      font-size: 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .btn {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 5px;
      border: 1px solid var(--rg-border);
      font-size: 12px;
      line-height: 1.4;
      color: var(--rg-fg);
    }
    .btn:hover {
      background: var(--rg-accent-soft);
      border-color: var(--rg-accent);
      color: var(--rg-accent);
    }
    .btn:focus-visible {
      outline: 2px solid var(--rg-accent);
    }
    .btn-danger:hover {
      background: #fee2e2;
      color: #b91c1c;
      border-color: #fca5a5;
    }
    .memobox {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .memobox[hidden] {
      display: none;
    }
    .memo-input {
      box-sizing: border-box;
      width: 100%;
      min-height: 48px;
      padding: 5px 8px;
      border-radius: 5px;
      border: 1px solid var(--rg-border);
      background: var(--rg-bg);
      color: var(--rg-fg);
      font: inherit;
      font-size: 12px;
      resize: vertical;
    }
    .memo-input:focus-visible {
      outline: 2px solid var(--rg-accent);
    }
  `;

  let cardHost = null;
  let activeCardScrapId = null;
  let isMemoBoxOpen = false;
  let cachedTasks = {};

  function closeCard() {
    isMemoBoxOpen = false;
    if (cardHost) {
      cardHost.remove();
      cardHost = null;
      activeCardScrapId = null;
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

  function openCard(id) {
    closeCard();
    const scrap = knownScraps.get(id);
    const range = scrapRanges.get(id);
    if (!scrap || !range) return;

    activeCardScrapId = id;
    isMemoBoxOpen = false;

    const host = document.createElement('readgloss-scrap-card');
    cardHost = host;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    if (theme === 'light' || theme === 'dark') {
      host.setAttribute('data-theme', theme);
    }
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CARD_CSS;

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '스크랩');

    // 내용: "스크랩 · M월 D일 · 할 일 제목" (글은 textContent, FX-L 5)
    const meta = document.createElement('div');
    meta.className = 'meta';
    let datePart = '';
    if (scrap.ts) {
      const d = new Date(scrap.ts);
      if (!isNaN(d.getTime())) {
        datePart = ` · ${d.getMonth() + 1}월 ${d.getDate()}일`;
      }
    }
    const getTaskTitle = (tId) => (tId ? (cachedTasks[tId] || tId) : '인박스');
    meta.textContent = `스크랩${datePart} · ${getTaskTitle(scrap.task)}`;
    card.append(meta);

    // 번역 있으면 한 줄 (글은 textContent)
    let transEl = null;
    function renderTranslation(text) {
      if (text && text.trim()) {
        if (!transEl) {
          transEl = document.createElement('div');
          transEl.className = 'trans-line';
          if (memoEl) memoEl.before(transEl);
          else actions.before(transEl);
        }
        transEl.textContent = text.trim();
        transEl.classList.remove('err');
      } else if (transEl) {
        transEl.remove();
        transEl = null;
      }
    }

    function showTransError(msg) {
      if (!transEl) {
        transEl = document.createElement('div');
        transEl.className = 'trans-line err';
        if (memoEl) memoEl.before(transEl);
        else actions.before(transEl);
      }
      transEl.textContent = msg;
      transEl.classList.add('err');
      placeCard(card, anchorRect);
    }

    if (scrap.translation && scrap.translation.trim()) {
      transEl = document.createElement('div');
      transEl.className = 'trans-line';
      transEl.textContent = scrap.translation.trim();
      card.append(transEl);
    }

    // 메모 있으면 한 줄 (글은 textContent)
    let memoEl = null;
    if (scrap.memo && scrap.memo.trim()) {
      memoEl = document.createElement('div');
      memoEl.className = 'memo-line';
      memoEl.textContent = scrap.memo.trim();
      card.append(memoEl);
    }

    // 버튼 줄: [인용 Tab] [번역] [문맥 번역] [메모] [스크랩 취소] (글은 textContent)
    const actions = document.createElement('div');
    actions.className = 'actions';

    const quoteBtn = document.createElement('button');
    quoteBtn.type = 'button';
    quoteBtn.className = 'btn';
    quoteBtn.textContent = '인용 Tab';
    quoteBtn.addEventListener('click', () => {
      const quote = {
        exact: scrap.quote?.exact ?? '',
        prefix: scrap.quote?.prefix ?? '',
        suffix: scrap.quote?.suffix ?? '',
        ...(scrap.translation ? { translation: scrap.translation } : {}),
      };
      globalThis.readglossMemoPad?.attachQuote(quote, range.startContainer);
      closeCard();
    });

    function saveTranslation(translation) {
      scrap.translation = translation;
      update({ ...scrap, translation });
      chrome.runtime.sendMessage({
        type: 'scraps',
        op: 'translation',
        id: scrap.id,
        translation,
      });
    }

    const mtBtn = document.createElement('button');
    mtBtn.type = 'button';
    mtBtn.className = 'btn';
    mtBtn.textContent = '번역';
    mtBtn.addEventListener('click', () => {
      const text = scrap.quote?.exact ?? '';
      if (!text) return;
      mtBtn.setAttribute('aria-disabled', 'true');
      ctxBtn.setAttribute('aria-disabled', 'true');
      renderTranslation('번역 중…');
      placeCard(card, anchorRect);

      chrome.runtime.sendMessage({ type: 'mt', text }, (res) => {
        mtBtn.removeAttribute('aria-disabled');
        ctxBtn.removeAttribute('aria-disabled');
        if (cardHost !== host || activeCardScrapId !== id) return;
        if (res && res.translation) {
          renderTranslation(res.translation);
          saveTranslation(res.translation);
          placeCard(card, anchorRect);
        } else {
          showTransError(res?.error === 'bridge-off' ? '다리가 꺼져 있어요' : '번역 실패');
        }
      });
    });

    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'btn';
    ctxBtn.textContent = '문맥 번역';
    ctxBtn.addEventListener('click', () => {
      const text = scrap.quote?.exact ?? '';
      if (!text) return;
      ctxBtn.setAttribute('aria-disabled', 'true');
      mtBtn.setAttribute('aria-disabled', 'true');
      renderTranslation('문맥 번역 중…');
      placeCard(card, anchorRect);

      let context = '';
      if (globalThis.readglossContextFor && range) {
        try {
          context = globalThis.readglossContextFor(range) || '';
        } catch {}
      }

      chrome.runtime.sendMessage({ type: 'translate-context', text, context }, (res) => {
        ctxBtn.removeAttribute('aria-disabled');
        mtBtn.removeAttribute('aria-disabled');
        if (cardHost !== host || activeCardScrapId !== id) return;
        if (res && res.translation) {
          renderTranslation(res.translation);
          saveTranslation(res.translation);
          placeCard(card, anchorRect);
        } else {
          showTransError(res?.error === 'bridge-off' ? '다리가 꺼져 있어요' : '문맥 번역 실패');
        }
      });
    });

    const memoBtn = document.createElement('button');
    memoBtn.type = 'button';
    memoBtn.className = 'btn';
    memoBtn.textContent = '메모';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-danger';
    cancelBtn.textContent = '스크랩 취소';
    cancelBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'scraps', op: 'remove', id: scrap.id }, (res) => {
        if (res && !res.error) {
          unpaint(scrap.id);
          closeCard();
        }
      });
    });

    actions.append(quoteBtn, mtBtn, ctxBtn, memoBtn, cancelBtn);
    card.append(actions);

    // 메모 입력 영역: 작은 textarea + ⌘Enter 저장
    const memoBox = document.createElement('div');
    memoBox.className = 'memobox';
    memoBox.hidden = true;

    const memoInput = document.createElement('textarea');
    memoInput.className = 'memo-input';
    memoInput.rows = 2;
    memoInput.placeholder = '메모 (⌘Enter 저장)';
    memoInput.value = scrap.memo || '';

    memoBox.append(memoInput); // FX-L 1: memoInput 붙이기

    function saveMemoAction() {
      const newMemo = memoInput.value.trim();
      chrome.runtime.sendMessage({ type: 'scraps', op: 'memo', id: scrap.id, memo: newMemo }, (res) => {
        if (res && !res.error) {
          update({ ...scrap, memo: newMemo });
          closeCard();
        }
      });
    }

    memoInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveMemoAction();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        memoBox.hidden = true;
        isMemoBoxOpen = false;
        placeCard(card, anchorRect);
        memoBtn.focus();
      }
    });

    const rects = range.getClientRects();
    const anchorRect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();

    memoBtn.addEventListener('click', () => {
      if (memoBox.hidden) {
        memoInput.value = scrap.memo || '';
        memoBox.hidden = false;
        isMemoBoxOpen = true;
        placeCard(card, anchorRect);
        memoInput.focus();
      } else {
        memoBox.hidden = true;
        isMemoBoxOpen = false;
        placeCard(card, anchorRect);
      }
    });

    card.append(memoBox);

    shadow.append(style, card);
    (document.body || document.documentElement).append(host);
    placeCard(card, anchorRect);

    // FX-L 5, 7: 카드를 열 때 scraps get 으로 최신 메모와 tasks(할 일 표)를 다시 받는다
    chrome.runtime.sendMessage({ type: 'scraps', op: 'get' }, (res) => {
      if (chrome.runtime.lastError || !res || res.error) return;
      if (res.tasks && typeof res.tasks === 'object') {
        cachedTasks = res.tasks;
      }
      const fresh = Array.isArray(res.scraps) ? res.scraps.find((s) => s.id === id) : null;
      if (fresh) {
        scrap.memo = fresh.memo || '';
        if (fresh.translation !== undefined) scrap.translation = fresh.translation || '';
        if (fresh.task !== undefined) scrap.task = fresh.task;
        knownScraps.set(id, { ...knownScraps.get(id), memo: scrap.memo, translation: scrap.translation, task: scrap.task });
      }

      if (cardHost === host && activeCardScrapId === id) {
        meta.textContent = `스크랩${datePart} · ${getTaskTitle(scrap.task)}`;
        if (scrap.translation && scrap.translation.trim()) {
          renderTranslation(scrap.translation.trim());
        } else if (transEl) {
          transEl.remove();
          transEl = null;
        }
        if (scrap.memo && scrap.memo.trim()) {
          if (!memoEl) {
            memoEl = document.createElement('div');
            memoEl.className = 'memo-line';
            actions.before(memoEl);
          }
          memoEl.textContent = scrap.memo.trim();
        } else if (memoEl) {
          memoEl.remove();
          memoEl = null;
        }
        if (memoBox.hidden) {
          memoInput.value = scrap.memo || '';
        }
        placeCard(card, anchorRect);
      }
    });
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
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.some((n) => n?.localName === 'readgloss-memo-pad')) return;
    if (e.key === 'Escape') {
      closeBar();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    // 막대가 있고 이벤트 경로에 입력칸·편집 영역·우리 확장 화면(막대 자신 외)이 없을 때만 키보드 ← →
    // 무시하는 경우엔 preventDefault·stopPropagation 을 하지 않는다(다른 화면의 키 처리를 막지 않는다)
    const sel = globalThis.readglossSelection;
    const isTyping = sel?.isTypingPath ? sel.isTypingPath(path, e.isComposing) : false;
    if (isTyping || sel?.isOwnUiPath?.(path, barHost)) return;

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

  // 메모·할 일 바꾸기 뒤 이 페이지 기억(knownScraps)을 맞춘다. 이 페이지에 없는 스크랩이면 아무것도 안 한다.
  function update(scrap) {
    if (scrap?.id && knownScraps.has(scrap.id)) {
      knownScraps.set(scrap.id, { ...knownScraps.get(scrap.id), ...scrap });
    }
  }

  // 지우기 뒤 형광펜을 걷고 기억에서 뺀다 (다리 응답이 성공했을 때만 부른다)
  function remove(id) {
    unpaint(id);
  }

  globalThis.readglossScrapPage = {
    ensureStyle, // 메모장·스크랩북 깜빡임도 이 스타일이 있어야 보인다(스크랩 없는 페이지 포함)
    paint,
    unpaint,
    update,
    remove,
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
    openCard,
    closeCard,
  };

  // --- 스크랩 형광펜 클릭 및 키 이벤트 접착(23-2, FX-L 6) ---
  if (typeof document !== 'undefined') {
    let clickTimer = 0;
    let pendingHitId = null;

    // document click (capture): 선택이 비어 있고, 우리 화면 밖, 스크랩 Range 안, 링크면 ⌥클릭
    document.addEventListener(
      'click',
      (e) => {
        const sel = window.getSelection?.();
        const selectionEmpty = !sel || sel.isCollapsed || !sel.toString().trim();
        if (!selectionEmpty) return;

        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const inOurUi = path.some((el) => {
          if (!el || el.nodeType !== 1) return false;
          const tag = (el.tagName || el.localName || '').toLowerCase();
          return tag.startsWith('readgloss-') || Boolean(el.matches?.('[data-readgloss]'));
        });
        if (inOurUi) return;

        const rectsById = new Map();
        for (const [id, range] of scrapRanges.entries()) {
          if (range && range.startContainer?.isConnected) {
            rectsById.set(id, range.getClientRects());
          }
        }

        const hitId = globalThis.readglossScrap?.scrapHitAt?.(rectsById, e.clientX, e.clientY);
        if (!hitId) return;

        const targetEl = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
        const link = targetEl?.closest?.('a[href]');
        const inLink = Boolean(link);
        if (inLink && !e.altKey) return;
        if (inLink && e.altKey) {
          e.preventDefault();
        }

        // FX-L 6: 형광펜 클릭은 250ms 기다렸다가 그 사이 dblclick이 없을 때만 카드를 연다
        clearTimeout(clickTimer);
        pendingHitId = hitId;
        clickTimer = setTimeout(() => {
          clickTimer = 0;
          if (pendingHitId) {
            const targetId = pendingHitId;
            pendingHitId = null;
            const curSel = window.getSelection?.();
            if (curSel && !curSel.isCollapsed && curSel.toString().trim()) return;
            openCard(targetId);
          }
        }, 250);
      },
      true,
    );

    // 더블클릭 시 스크랩 카드 열기 대기 취소
    document.addEventListener(
      'dblclick',
      () => {
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = 0;
          pendingHitId = null;
        }
      },
      true,
    );

    // 밖 클릭으로 닫힘
    document.addEventListener(
      'mousedown',
      (e) => {
        if (cardHost && !e.composedPath().includes(cardHost)) {
          closeCard();
        }
      },
      true,
    );

    // Esc: e.readglossCardClosed가 이미 참이면 무시, 아니면 닫고 표시를 세운다
    // Tab: 카드가 열려 있을 때 Tab(Shift·조합키 없이, 입력칸 아님) -> attachQuote 후 카드 닫기, preventDefault
    document.addEventListener(
      'keydown',
      (e) => {
        if (!cardHost) return;

        if (e.key === 'Escape') {
          if (e.readglossCardClosed) return;
          e.preventDefault();
          e.readglossCardClosed = true;
          closeCard();
          return;
        }

        if (e.key === 'Tab') {
          if (isMemoBoxOpen) return; // FX-L 1: 메모 칸이 열려 있는 동안은 Tab 인용 안 함
          if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
          const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
          const isInput = path.some(
            (n) => /^(input|textarea|select)$/i.test(n?.localName || n?.tagName || '') || n?.isContentEditable === true,
          );
          if (isInput) return;

          e.preventDefault();
          const scrap = knownScraps.get(activeCardScrapId);
          const range = scrapRanges.get(activeCardScrapId);
          if (scrap && range) {
            const quote = {
              exact: scrap.quote?.exact ?? '',
              prefix: scrap.quote?.prefix ?? '',
              suffix: scrap.quote?.suffix ?? '',
              ...(scrap.translation ? { translation: scrap.translation } : {}),
            };
            globalThis.readglossMemoPad?.attachQuote(quote, range.startContainer);
          }
          closeCard();
        }
      },
      true,
    );
  }

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
      if (r.tasks && typeof r.tasks === 'object') {
        cachedTasks = r.tasks;
      }
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
