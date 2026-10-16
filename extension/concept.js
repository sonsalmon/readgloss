// extension/concept.js
// 페이지 내 개념 접착(T28): 개념어 회색 형광펜 칠하기, 마우스 호버 카드, 칠한 범위 클릭, [내 개념으로] 칸 열기.
// CSS Custom Highlight API(readgloss-concept)를 사용하며 페이지 DOM 글은 바꾸지 않는다.
(() => {
  const HIGHLIGHT_CONCEPT = 'readgloss-concept';
  const HIGHLIGHT_LATER = 'readgloss-later';
  const STYLE_ID = 'readgloss-concept-style';

  // 스타일 주입: ::highlight(readgloss-concept), ::highlight(readgloss-later)
  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ::highlight(${HIGHLIGHT_CONCEPT}) {
        background-color: rgba(136, 135, 128, 0.18);
      }
      ::highlight(${HIGHLIGHT_LATER}) {
        text-decoration: underline dotted rgba(136, 135, 128, 0.7);
      }
    `;
    (document.head || document.documentElement || document.body)?.append(style);
  }

  // 글자 오프셋 [startOffset, endOffset] -> DOM Range
  function offsetToRange(nodes, startOffset, endOffset) {
    if (typeof document === 'undefined' || startOffset >= endOffset || !nodes || !nodes.length) return null;
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

  let cachedTerms = []; // [{ id, term, later }]
  let conceptItems = []; // [{ id, range, later }]
  let conceptsCache = null; // GET /concepts 캐시 [{ id, name, aliases, definition, later, seen, related, appears }]

  // 다리 메시지 전송 헬퍼
  function send(msg) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.runtime?.id) return resolve({ error: 'no-runtime' });
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(res);
      });
    });
  }

  // GET /concepts 캐시 가져오기 (저장·삭제 시 무효화)
  async function getConceptsList(force = false) {
    if (conceptsCache && !force) return conceptsCache;
    const res = await send({ type: 'concepts', op: 'get' });
    if (res && Array.isArray(res.concepts)) {
      conceptsCache = res.concepts;
      return conceptsCache;
    }
    return [];
  }

  // Highlight API로 형광펜 적용
  function applyHighlights() {
    ensureStyle();
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;

    const definedRanges = conceptItems.filter((item) => !item.later).map((item) => item.range).filter(Boolean);
    const laterRanges = conceptItems.filter((item) => item.later).map((item) => item.range).filter(Boolean);

    if (definedRanges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_CONCEPT, new Highlight(...definedRanges));
    } else {
      CSS.highlights.delete(HIGHLIGHT_CONCEPT);
    }

    if (laterRanges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_LATER, new Highlight(...laterRanges));
    } else {
      CSS.highlights.delete(HIGHLIGHT_LATER);
    }
  }

  // 본문에서 개념어를 찾아 readgloss-concept(회색) 또는 readgloss-later(점선 밑줄)로 칠하기
  function paint(terms) {
    if (Array.isArray(terms)) {
      cachedTerms = terms;
    }
    if (!cachedTerms || cachedTerms.length === 0) {
      conceptItems = [];
      applyHighlights();
      return;
    }

    const scrapPage = globalThis.readglossScrapPage;
    const textInfo = scrapPage?.buildTextIndex ? scrapPage.buildTextIndex() : { fullText: '', nodes: [] };
    const { fullText, nodes } = textInfo;
    if (!fullText || !nodes.length) return;

    const core = globalThis.readglossConcept;
    if (!core?.findTerms) return;

    const { defined, later } = core.splitTerms ? core.splitTerms(cachedTerms) : { defined: cachedTerms, later: [] };
    const items = [];

    // 1. 설명 있는 개념 (readgloss-concept)
    if (defined.length > 0) {
      const defMatches = core.findTerms(fullText, defined);
      for (const m of defMatches) {
        const range = offsetToRange(nodes, m.start, m.end);
        if (range) {
          items.push({ id: m.id, range, later: false });
        }
      }
    }

    // 2. 설명 없는 개념 (readgloss-later)
    if (later.length > 0) {
      const laterMatches = core.findTerms(fullText, later);
      for (const m of laterMatches) {
        const range = offsetToRange(nodes, m.start, m.end);
        if (range) {
          items.push({ id: m.id, range, later: true });
        }
      }
    }

    conceptItems = items;
    applyHighlights();
  }

  // 좌표 (x, y)가 칠해진 개념어 Range 안에 있는지 확인
  function findHit(x, y) {
    for (const item of conceptItems) {
      const rects = item.range.getClientRects();
      for (const r of rects) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return { id: item.id, range: item.range, rect: r };
        }
      }
    }
    return null;
  }

  // --- 마우스 0.3초 머묾 카드 (Shadow DOM) ---
  let cardHost = null;
  let hoverTimer = 0;
  let activeHit = null;

  function closeCard() {
    clearTimeout(hoverTimer);
    if (cardHost) {
      cardHost.remove();
      cardHost = null;
    }
    activeHit = null;
  }

  async function showCard(hit) {
    if (cardHost) closeCard();
    activeHit = hit;

    const list = await getConceptsList();
    const concept = list.find((c) => c.id === hit.id);
    if (!concept || activeHit !== hit) return;

    cardHost = document.createElement('readgloss-concept-card');
    cardHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;';

    const shadow = cardHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --rg-bg: #ffffff;
        --rg-fg: #1f2328;
        --rg-mut: #656d76;
        --rg-border: #e3e0d8;
        --rg-chip: rgba(136, 135, 128, 0.15);
        --rg-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --rg-bg: #1e2127;
          --rg-fg: #e6e8eb;
          --rg-mut: #9aa3ad;
          --rg-border: #343a44;
          --rg-chip: rgba(136, 135, 128, 0.25);
          --rg-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
        }
      }
      .card {
        box-sizing: border-box;
        width: 280px;
        max-width: calc(100vw - 24px);
        padding: 10px 14px;
        border-radius: 8px;
        background: var(--rg-bg);
        color: var(--rg-fg);
        border: 1px solid var(--rg-border);
        box-shadow: var(--rg-shadow);
        font-size: 13px;
        line-height: 1.5;
        user-select: none;
      }
      .name {
        font-weight: 700;
        font-size: 14px;
        margin-bottom: 4px;
      }
      .def {
        margin-bottom: 6px;
        word-break: break-word;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 6px;
      }
      .chip {
        display: inline-block;
        background: var(--rg-chip);
        border-radius: 4px;
        padding: 1px 6px;
        font-size: 11.5px;
      }
      .first {
        font-size: 11px;
        color: var(--rg-mut);
        border-top: 1px solid var(--rg-border);
        padding-top: 4px;
        margin-top: 4px;
      }
      .btn-write {
        display: inline-block;
        margin-top: 6px;
        padding: 3px 10px;
        border-radius: 6px;
        border: 1px solid var(--rg-border);
        background: var(--rg-bg);
        color: var(--rg-fg);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        font-weight: 600;
      }
      .btn-write:hover {
        background: var(--rg-chip);
      }
    `;

    const card = document.createElement('div');
    card.className = 'card';

    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = concept.name || '';

    const isLater = concept.later === true || !concept.definition;

    if (isLater) {
      const defEl = document.createElement('div');
      defEl.className = 'def';
      defEl.textContent = '나중에 볼 것 · 아직 설명 없음';
      card.append(nameEl, defEl);

      const seenTitle = concept.seen?.title || concept.firstTitle;
      if (seenTitle) {
        const seenEl = document.createElement('div');
        seenEl.className = 'first';
        seenEl.textContent = `본 곳: ${seenTitle}`;
        card.append(seenEl);
      }

      const writeBtn = document.createElement('button');
      writeBtn.className = 'btn-write';
      writeBtn.type = 'button';
      writeBtn.textContent = '지금 쓰기';
      writeBtn.onclick = (e) => {
        e.stopPropagation();
        closeCard();
        openForm({
          id: concept.id,
          name: concept.name,
          aliases: concept.aliases,
          tags: concept.tags,
          definition: '',
          related: concept.related?.map((r) => r.name),
          anchor: hit.rect,
        });
      };
      card.append(writeBtn);
    } else {
      const defEl = document.createElement('div');
      defEl.className = 'def';
      defEl.textContent = concept.definition || '';

      card.append(nameEl, defEl);

      // 관련 개념 칩
      if (Array.isArray(concept.related) && concept.related.length > 0) {
        const chipsEl = document.createElement('div');
        chipsEl.className = 'chips';
        for (const r of concept.related) {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = r.name;
          chipsEl.append(chip);
        }
        card.append(chipsEl);
      }

      // 처음 나온 곳: <taskTitle> · <title>
      const firstAppear = Array.isArray(concept.appears) && concept.appears[0];
      if (firstAppear) {
        const firstEl = document.createElement('div');
        firstEl.className = 'first';
        const taskText = firstAppear.taskTitle || firstAppear.task || '인박스';
        const titleText = firstAppear.title || '페이지';
        firstEl.textContent = `처음 나온 곳: ${taskText} · ${titleText}`;
        card.append(firstEl);
      }
    }

    // 키 및 클릭 전파 방지
    cardHost.addEventListener('keydown', (e) => e.stopPropagation());
    cardHost.addEventListener('keyup', (e) => e.stopPropagation());
    cardHost.addEventListener('keypress', (e) => e.stopPropagation());

    shadow.append(style, card);
    (document.body || document.documentElement).append(cardHost);

    // 카드 위치 계산
    const cardRect = card.getBoundingClientRect();
    const anchor = hit.rect;
    const toastCore = globalThis.readglossToast;
    const pos = toastCore?.toastPosition
      ? toastCore.toastPosition(anchor, { width: cardRect.width, height: cardRect.height }, { width: document.documentElement.clientWidth, height: window.innerHeight })
      : { left: Math.max(8, anchor.left), top: anchor.bottom + 8 };

    cardHost.style.left = `${pos.left}px`;
    cardHost.style.top = `${pos.top}px`;

    // 카드 밖으로 나가면 닫기
    card.addEventListener('mouseleave', () => {
      closeCard();
    });
  }

  // 마우스 이동 시 호버 감지
  function onMouseMove(e) {
    const hit = findHit(e.clientX, e.clientY);
    if (hit) {
      if (activeHit?.id === hit.id) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        showCard(hit);
      }, 300);
    } else {
      clearTimeout(hoverTimer);
      if (cardHost) {
        const cr = cardHost.getBoundingClientRect();
        const inCard = e.clientX >= cr.left && e.clientX <= cr.right && e.clientY >= cr.top && e.clientY <= cr.bottom;
        if (!inCard) {
          closeCard();
        }
      }
    }
  }

  // 패널이 열려 있는지 판정
  function isPanelOpen() {
    const host = document.querySelector('readgloss-ui');
    return Boolean(host?.shadowRoot?.querySelector('.root')?.classList.contains('open'));
  }

  // 패널 닫기: 닫기 이벤트는 없어서 패널 ✕ 버튼(panel.js closePanel)을 누른다
  function requestClosePanel() {
    const host = document.querySelector('readgloss-ui');
    host?.shadowRoot?.querySelector('button.close')?.click();
  }

  // 표시 클릭이 상세를 열지 판정(순수 함수, 15-3·16-7)
  // 두 번째 클릭(더블클릭)이면 열지 않고 사전 카드 흐름에 넘긴다. 드래그로 글을 고른 때도 열지 않는다. 링크 안은 ⌥를 누른 때만 연다.
  function shouldOpenConceptOnClick({ clickCount = 1, selectionEmpty = true, inLink = false, altKey = false } = {}) {
    if (clickCount >= 2) return false;
    if (!selectionEmpty) return false;
    return !inLink || altKey;
  }

  let pressedConceptId = null; // mousedown 때 누른 표시의 개념 id
  let pressedWasOpen = false; // mousedown 때 상세가 이 개념으로 이미 열려 있었나
  let selectedOnMouseUp = false; // mouseup 때 글을 드래그로 골랐나
  let conceptOpenTimer = 0;

  // window 캡처 단계라 panel.js 의 바깥 mousedown 닫기(document 캡처)보다 먼저 본다. 그 전에 패널 상태를 잡아 둔다.
  function onWindowMouseDown(e) {
    const hit = findHit(e.clientX, e.clientY);
    pressedConceptId = hit?.id ?? null;
    pressedWasOpen = Boolean(hit) && isPanelOpen() && globalThis.readglossConceptPanelUi?.getCurrentConceptId?.() === hit.id;
    // 개념 표시 위 누름을 panel.js 가 알아보게 표시한다(패널은 열린 채 상세만 바뀐다). 같은 개념 토글 닫기는 여기서 한다.
    if (hit) e.readglossConceptHit = true;
  }

  function onWindowMouseUp() {
    selectedOnMouseUp = String(window.getSelection?.()?.toString() ?? '') !== '';
  }

  // 칠한 범위 클릭
  function onDocumentClick(e) {
    // 더블클릭의 두 번째 클릭이면 대기 중인 열기를 취소한다(어디를 눌렀든). 더블클릭은 사전 카드 흐름(content.js)이 받는다.
    if (e.detail >= 2) {
      clearTimeout(conceptOpenTimer);
      conceptOpenTimer = 0;
    }

    const hit = findHit(e.clientX, e.clientY);
    if (!hit) return;

    const link = e.target.closest('a[href]');
    const open = shouldOpenConceptOnClick({
      clickCount: e.detail,
      selectionEmpty: !selectedOnMouseUp,
      inLink: Boolean(link),
      altKey: e.altKey,
    });
    if (!open) return;

    e.preventDefault();
    e.stopPropagation();
    closeCard();

    // 250ms 기다렸다가 연다. 그 사이 두 번째 클릭이 오면 위에서 취소된다.
    // 같은 개념이 열려 있었으면 닫는다(16-7 토글). mousedown 에 패널이 이미 닫혔을 수 있어 mousedown 때 잡은 상태를 쓴다.
    const wasSameOpen = pressedWasOpen && pressedConceptId === hit.id;
    clearTimeout(conceptOpenTimer);
    conceptOpenTimer = setTimeout(() => {
      conceptOpenTimer = 0;
      if (wasSameOpen) {
        requestClosePanel();
        return;
      }
      // 새 상세 열기 (focusNew: true)
      window.dispatchEvent(new CustomEvent('readgloss:open-panel', {
        detail: { tab: 'concepts', conceptId: hit.id, focusNew: true },
      }));
    }, 250);
  }

  // --- [내 개념으로] 칸(Form) 열기 (Shadow DOM) ---
  let formHost = null;

  function closeForm() {
    if (formHost) {
      formHost.remove();
      formHost = null;
    }
  }

  // content.js startsMemo 등에서 호스트 태그 판정 시 타이핑 중으로 처리할 수 있도록 공개
  globalThis.readglossConceptFormUi = {
    isTyping: () => true,
  };
  globalThis.readglossConceptCardUi = {
    isTyping: () => false,
  };

  // 순수 함수: seen 전송 여부 판정 (FX-B)
  // (a) 새 개념을 만들 때(!conceptId -> isNew: true)
  // (b) seed에 고른 글 범위나 문장이 있을 때(hasRange: true 또는 hasSentence: true)
  function shouldSendSeen(params) {
    const { isNew, hasRange, hasSentence } = params || {};
    return Boolean(isNew || hasRange || hasSentence);
  }

  // 순수 함수: 기존 개념과 새 입력을 합치는 규칙 (FX-D)
  // definition: 옛 정의가 비면 새 정의, 둘 다 있으면 옛 정의 + 줄바꿈 + 새 정의(같은 줄은 한 번만). 500자 초과 시 tooLong: true
  // aliases·tags·related: 합집합(별칭 5개, 태그 5개, 관련 10개 상한)
  function mergeConcept(old, input) {
    const oldDef = (typeof old?.definition === 'string' ? old.definition : '').trim();
    const newDef = (typeof input?.definition === 'string' ? input.definition : '').trim();

    let definition = '';
    if (!oldDef) {
      definition = newDef;
    } else if (!newDef) {
      definition = oldDef;
    } else {
      const oldLines = oldDef.split('\n');
      const newLines = newDef.split('\n');
      const seenLines = new Set();
      const lines = [];
      for (const l of oldLines) {
        if (!seenLines.has(l)) {
          seenLines.add(l);
          lines.push(l);
        }
      }
      for (const l of newLines) {
        if (!seenLines.has(l)) {
          seenLines.add(l);
          lines.push(l);
        }
      }
      definition = lines.join('\n');
    }

    // aliases (최대 5개)
    const rawOldAliases = Array.isArray(old?.aliases) ? old.aliases : [];
    const rawInputAliases = Array.isArray(input?.aliases)
      ? input.aliases
      : (input?.aliases instanceof Set ? [...input.aliases] : []);
    const aliasSet = new Set();
    const aliases = [];
    for (const a of [...rawOldAliases, ...rawInputAliases]) {
      if (typeof a !== 'string') continue;
      const clean = a.trim().replace(/\s+/g, ' ');
      if (clean && !aliasSet.has(clean)) {
        aliasSet.add(clean);
        aliases.push(clean);
        if (aliases.length >= 5) break;
      }
    }

    // tags (최대 5개)
    const rawOldTags = Array.isArray(old?.tags) ? old.tags : [];
    const rawInputTags = Array.isArray(input?.tags)
      ? input.tags
      : (input?.tags instanceof Set ? [...input.tags] : []);
    const tagSet = new Set();
    const tags = [];
    for (const t of [...rawOldTags, ...rawInputTags]) {
      if (typeof t !== 'string') continue;
      const clean = t.trim().replace(/\s+/g, ' ');
      if (clean && !tagSet.has(clean)) {
        tagSet.add(clean);
        tags.push(clean);
        if (tags.length >= 5) break;
      }
    }

    // related (최대 10개, 객체 { id, name } 또는 문자열)
    const rawOldRelated = Array.isArray(old?.related) ? old.related : [];
    const rawInputRelated = Array.isArray(input?.related)
      ? input.related
      : (input?.related instanceof Set ? [...input.related] : []);
    const relSet = new Set();
    const related = [];
    for (const r of [...rawOldRelated, ...rawInputRelated]) {
      const val = typeof r === 'object' && r !== null ? r.name : r;
      if (typeof val !== 'string') continue;
      const clean = val.trim().replace(/\s+/g, ' ');
      if (clean && !relSet.has(clean)) {
        relSet.add(clean);
        related.push(clean);
        if (related.length >= 10) break;
      }
    }

    return {
      definition,
      aliases,
      tags,
      related,
      tooLong: definition.length > 500,
    };
  }

  async function openForm(seed = {}) {
    closeForm();
    closeCard();

    const conceptId = seed.id || null;
    const initialName = (seed.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const scrapId = seed.scrapId || null;

    const targetNode = seed.range?.startContainer ?? seed.range ?? (window.getSelection()?.anchorNode ?? document.body);
    const rawHeadings = Array.isArray(seed.headings)
      ? seed.headings
      : (globalThis.readglossSelectionUi?.headingsFor?.(targetNode) ?? []);
    const headings = rawHeadings
      .slice(-3)
      .map((h) => (typeof h === 'string' ? h.slice(0, 200).trimEnd() : ''))
      .filter(Boolean);

    // 할 일(task): seed에 task가 있으면 그것을 쓰고 guess를 하지 않는다.
    let task = null;
    if (seed && 'task' in seed) {
      task = seed.task ?? null;
    } else {
      // 할 일 짐작(guess): ask:true면 task 없이(null) 보낸다.
      try {
        const g = await send({ type: 'scraps', op: 'guess', url: location.href });
        if (g && g.task && !g.ask) task = g.task;
      } catch {
        // 짐작 실패는 무시
      }
    }

    // 관련 개념 자동완성을 위한 기존 개념 목록
    const existingConcepts = await getConceptsList();
    const existingNames = existingConcepts.map((c) => c.name);

    const currentConcept = conceptId ? existingConcepts.find((c) => c.id === conceptId) : null;
    const initialTags = Array.isArray(seed.tags)
      ? seed.tags
      : (Array.isArray(currentConcept?.tags) ? currentConcept.tags : []);
    const activeTags = new Set(initialTags);
    const DEFAULT_TAGS = ['다시 보기', '글감 후보', '헷갈림'];

    formHost = document.createElement('readgloss-concept-form');
    formHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;';

    const shadow = formHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --rg-bg: #ffffff;
        --rg-fg: #1f2328;
        --rg-mut: #656d76;
        --rg-border: #d0d7de;
        --rg-accent: #2f6feb;
        --rg-accent-soft: rgba(47, 111, 235, 0.10);
        --rg-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --rg-bg: #1e2127;
          --rg-fg: #e6e8eb;
          --rg-mut: #9aa3ad;
          --rg-border: #343a44;
          --rg-accent: #6b9bff;
          --rg-accent-soft: rgba(107, 155, 255, 0.14);
          --rg-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }
      }
      .form-card {
        box-sizing: border-box;
        width: 320px;
        max-width: calc(100vw - 20px);
        padding: 14px 16px;
        border-radius: 10px;
        background: var(--rg-bg);
        color: var(--rg-fg);
        border: 1px solid var(--rg-border);
        box-shadow: var(--rg-shadow);
        font-size: 13px;
        line-height: 1.5;
      }
      .title {
        font-weight: 700;
        font-size: 14px;
        margin-bottom: 10px;
      }
      .field {
        margin-bottom: 10px;
      }
      .label {
        display: block;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--rg-mut);
        margin-bottom: 3px;
      }
      .input, .textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 5px 8px;
        border-radius: 6px;
        border: 1px solid var(--rg-border);
        background: var(--rg-bg);
        color: var(--rg-fg);
        font: inherit;
        font-size: 13px;
      }
      .input:focus-visible, .textarea:focus-visible {
        outline: 2px solid var(--rg-accent);
        outline-offset: 1px;
      }
      .textarea {
        resize: vertical;
        min-height: 60px;
      }
      .chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 5px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: var(--rg-accent-soft);
        color: var(--rg-accent);
        padding: 2px 7px;
        border-radius: 12px;
        font-size: 11.5px;
        font-weight: 500;
      }
      .chip-del {
        border: none;
        background: none;
        cursor: pointer;
        padding: 0;
        font-size: 12px;
        line-height: 1;
        color: inherit;
      }
      .ac-list {
        margin: 2px 0 0 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--rg-border);
        border-radius: 6px;
        background: var(--rg-bg);
        max-height: 90px;
        overflow-y: auto;
      }
      .ac-item {
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
      }
      .ac-item:hover {
        background: var(--rg-accent-soft);
        color: var(--rg-accent);
      }
      .tag-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
      }
      .tag-chip {
        background: none;
        border: 1px solid var(--rg-border);
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 11.5px;
        cursor: pointer;
        color: var(--rg-mut);
        font-family: inherit;
        transition: all 0.15s;
      }
      .tag-chip:hover {
        background: rgba(0, 0, 0, 0.04);
      }
      .tag-chip.active {
        background: var(--rg-accent-soft);
        color: var(--rg-accent);
        border-color: var(--rg-accent);
        font-weight: 600;
      }
      .tag-chip.custom {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .tag-chip-del {
        border: none;
        background: none;
        cursor: pointer;
        padding: 0;
        font-size: 12px;
        line-height: 1;
        color: inherit;
      }
      .tag-input {
        box-sizing: border-box;
        width: 75px;
        padding: 2px 6px;
        border-radius: 12px;
        border: 1px dashed var(--rg-border);
        background: var(--rg-bg);
        color: var(--rg-fg);
        font: inherit;
        font-size: 11.5px;
      }
      .tag-input:focus-visible {
        outline: 2px solid var(--rg-accent);
        outline-offset: 1px;
        border-style: solid;
      }
      .foot {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 12px;
      }
      .btn {
        box-sizing: border-box;
        padding: 4px 12px;
        border-radius: 6px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
        border: 1px solid var(--rg-border);
        background: var(--rg-bg);
        color: var(--rg-fg);
      }
      .btn-primary {
        background: var(--rg-accent);
        color: #ffffff;
        border-color: var(--rg-accent);
        font-weight: 600;
      }
      .btn:hover {
        opacity: 0.9;
      }
      .err {
        color: #d1242f;
        font-size: 12px;
        margin-top: 4px;
      }
      .err[hidden] {
        display: none;
      }
    `;

    const formCard = document.createElement('div');
    formCard.className = 'form-card';

    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = conceptId ? '개념 고치기' : '내 개념으로';

    // 입력 칸 변수 (Tab 순서 이동에 상호 참조)
    const nameIn = document.createElement('input');
    const aliasIn = document.createElement('input');
    const defIn = document.createElement('textarea');

    // 이름
    const nameField = document.createElement('div');
    nameField.className = 'field';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'label';
    nameLabel.textContent = '개념 이름 (1~80자)';
    nameIn.className = 'input';
    nameIn.type = 'text';
    nameIn.maxLength = 80;
    nameIn.value = initialName;
    nameIn.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        aliasIn.focus();
        const len = aliasIn.value.length;
        aliasIn.setSelectionRange(len, len);
      }
    });
    nameField.append(nameLabel, nameIn);

    // 다른 이름
    const aliasField = document.createElement('div');
    aliasField.className = 'field';
    const aliasLabel = document.createElement('label');
    aliasLabel.className = 'label';
    aliasLabel.textContent = '다른 이름 (같은 개념의 다른 이름, 쉼표로 · 최대 5개)';
    aliasIn.className = 'input';
    aliasIn.type = 'text';
    aliasIn.placeholder = '접근 통제, AC';
    aliasIn.value = Array.isArray(seed.aliases) ? seed.aliases.join(', ') : (seed.aliases || '');
    aliasIn.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        defIn.focus();
        const len = defIn.value.length;
        defIn.setSelectionRange(len, len);
      } else if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        nameIn.focus();
        const len = nameIn.value.length;
        nameIn.setSelectionRange(len, len);
      }
    });
    aliasField.append(aliasLabel, aliasIn);

    // 태그 줄
    const tagField = document.createElement('div');
    tagField.className = 'field';
    const tagLabel = document.createElement('label');
    tagLabel.className = 'label';
    tagLabel.textContent = '태그 (최대 5개)';

    const tagRow = document.createElement('div');
    tagRow.className = 'tag-row';

    const tagInput = document.createElement('input');
    tagInput.className = 'tag-input';
    tagInput.type = 'text';
    tagInput.maxLength = 20;
    tagInput.placeholder = '+ 새 태그';

    function renderTags() {
      tagRow.replaceChildren();

      // 기본 태그 3개: 다시 보기, 글감 후보, 헷갈림 (눌러 켜고 끔)
      for (const dt of DEFAULT_TAGS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isActive = activeTags.has(dt);
        btn.className = `tag-chip ${isActive ? 'active' : ''}`;
        btn.textContent = dt;
        btn.onclick = (e) => {
          e.preventDefault();
          if (activeTags.has(dt)) {
            activeTags.delete(dt);
          } else {
            if (activeTags.size < 5) {
              activeTags.add(dt);
            }
          }
          renderTags();
        };
        tagRow.append(btn);
      }

      // 그 밖에 이 개념에 있는 태그 칩
      for (const t of activeTags) {
        if (DEFAULT_TAGS.includes(t)) continue;
        const chip = document.createElement('span');
        chip.className = 'tag-chip active custom';
        chip.textContent = t;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'tag-chip-del';
        delBtn.textContent = '×';
        delBtn.onclick = (e) => {
          e.preventDefault();
          activeTags.delete(t);
          renderTags();
        };
        chip.append(delBtn);
        tagRow.append(chip);
      }

      // 끝에 작은 입력칸 (Enter로 새 태그 추가, 1~20자, 5개 넘으면 안 받음)
      tagRow.append(tagInput);
    }

    tagInput.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const val = tagInput.value.trim().replace(/\s+/g, ' ');
        if (val.length >= 1 && val.length <= 20) {
          if (activeTags.size < 5) {
            activeTags.add(val);
            tagInput.value = '';
            renderTags();
            tagInput.focus();
          }
        }
      }
    });

    renderTags();
    tagField.append(tagLabel, tagRow);

    // 내 정의 (설명)
    const defField = document.createElement('div');
    defField.className = 'field';
    const defLabel = document.createElement('label');
    defLabel.className = 'label';
    defLabel.textContent = '내 정의 (비우면 나중에 볼 것 · 500자까지)';
    defIn.className = 'textarea';
    defIn.rows = 3;
    defIn.maxLength = 500;
    defIn.placeholder = '내가 이해한 개념 정의';
    const initialDef = seed.definition || '';
    defIn.value = globalThis.readglossMdList?.ensureStartsList ? globalThis.readglossMdList.ensureStartsList(initialDef) : initialDef;

    // 마크다운 목록 단축키: Enter, Shift+Enter, Tab, Shift+Tab (T48: 맨 바깥 줄 Shift+Tab은 다른 이름 칸으로)
    defIn.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const md = globalThis.readglossMdList;
      if (!md) return;

      let res = null;
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        res = md.onEnter(defIn.value, defIn.selectionStart, defIn.selectionEnd);
      } else if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        res = md.onShiftEnter(defIn.value, defIn.selectionStart, defIn.selectionEnd);
      } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        res = md.onTab(defIn.value, defIn.selectionStart, defIn.selectionEnd, false);
      } else if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const text = defIn.value;
        let start = Math.max(0, Math.min(defIn.selectionStart || 0, text.length));
        let end = Math.max(0, Math.min(defIn.selectionEnd || 0, text.length));
        if (start > end) [start, end] = [end, start];
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = text.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = text.length;
        const lines = text.slice(lineStart, lineEnd).split('\n');
        const hasIndent = lines.some((l) => /^ +/.test(l));

        if (!hasIndent) {
          e.preventDefault();
          aliasIn.focus();
          const len = aliasIn.value.length;
          aliasIn.setSelectionRange(len, len);
          return;
        }
        res = md.onTab(defIn.value, defIn.selectionStart, defIn.selectionEnd, true);
      }

      if (res) {
        e.preventDefault();
        defIn.value = res.value;
        defIn.setSelectionRange(res.selStart, res.selEnd);
        defIn.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    defField.append(defLabel, defIn);

    // 관련 개념
    const relField = document.createElement('div');
    relField.className = 'field';
    const relLabel = document.createElement('label');
    relLabel.className = 'label';
    relLabel.textContent = '관련 개념 (최대 10개)';
    const relIn = document.createElement('input');
    relIn.className = 'input';
    relIn.type = 'text';
    relIn.placeholder = '관련 개념 입력 후 선택';

    const acList = document.createElement('ul');
    acList.className = 'ac-list';
    acList.hidden = true;

    const chipList = document.createElement('div');
    chipList.className = 'chip-list';
    const relatedSet = new Set();
    if (Array.isArray(seed.related)) {
      for (const r of seed.related) {
        if (r) relatedSet.add(r);
      }
    }

    function renderRelatedChips() {
      chipList.replaceChildren();
      for (const name of relatedSet) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = name;
        const delBtn = document.createElement('button');
        delBtn.className = 'chip-del';
        delBtn.type = 'button';
        delBtn.textContent = '×';
        delBtn.onclick = () => {
          relatedSet.delete(name);
          renderRelatedChips();
        };
        chip.append(delBtn);
        chipList.append(chip);
      }
    }
    renderRelatedChips();

    relIn.addEventListener('input', () => {
      const q = relIn.value.trim().toLowerCase();
      if (!q) {
        acList.hidden = true;
        return;
      }
      const candidates = existingNames.filter((n) => n.toLowerCase().includes(q) && !relatedSet.has(n)).slice(0, 5);
      if (candidates.length === 0) {
        acList.hidden = true;
        return;
      }
      acList.replaceChildren();
      for (const c of candidates) {
        const li = document.createElement('li');
        li.className = 'ac-item';
        li.textContent = c;
        li.onmousedown = (e) => {
          e.preventDefault();
          if (relatedSet.size < 10) {
            relatedSet.add(c);
            renderRelatedChips();
          }
          relIn.value = '';
          acList.hidden = true;
        };
        acList.append(li);
      }
      acList.hidden = false;
    });

    relIn.addEventListener('blur', () => {
      setTimeout(() => {
        acList.hidden = true;
      }, 150);
    });

    relField.append(relLabel, relIn, acList, chipList);

    // 에러 표시
    const errEl = document.createElement('div');
    errEl.className = 'err';
    errEl.hidden = true;

    // 버튼 줄 [저장] [취소]
    const foot = document.createElement('div');
    foot.className = 'foot';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = '취소';
    cancelBtn.onclick = closeForm;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.type = 'button';
    saveBtn.textContent = '저장';

    async function handleSave() {
      errEl.hidden = true;
      const cleanName = nameIn.value.trim().replace(/\s+/g, ' ');
      if (!cleanName || cleanName.length > 80) {
        errEl.hidden = false;
        errEl.textContent = '이름은 1~80자여야 해요';
        nameIn.focus();
        return;
      }

      const rawDef = defIn.value;
      const definition = globalThis.readglossMdList?.cleanForSave
        ? globalThis.readglossMdList.cleanForSave(rawDef)
        : rawDef.trim();
      if (definition.length > 500) {
        errEl.hidden = false;
        errEl.textContent = '내 정의는 500자 이하여야 해요';
        defIn.focus();
        return;
      }

      const core = globalThis.readglossConcept;
      const aliases = core?.parseAliases ? core.parseAliases(aliasIn.value) : [];

      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';

      const isNew = !conceptId;
      const hasRange = Boolean(seed.range);
      const hasSentence = Boolean(seed.sentence && String(seed.sentence).trim().length > 0);
      const sendSeen = shouldSendSeen({ isNew, hasRange, hasSentence });

      const seen = {
        url: seed.url || location.href,
        title: seed.title !== undefined ? seed.title : (document.title || ''),
        sentence: (seed.sentence || '').slice(0, 300),
        ...(headings.length > 0 ? { headings } : {}),
      };

      const payload = {
        type: 'concepts',
        op: 'save',
        name: cleanName,
        aliases,
        tags: [...activeTags],
        definition,
        related: [...relatedSet],
        task,
        scrapId,
        ...(sendSeen ? { seen } : {}),
      };
      if (conceptId) {
        payload.id = conceptId;
      }

      const res = await send(payload);

      saveBtn.disabled = false;
      saveBtn.textContent = '저장';

      // 409면 기존 개념에 합쳐 다시 저장한다 (FX-D)
      if (res?.error === 'exists' && res?.id) {
        let old = null;
        try {
          const getRes = await send({ type: 'concepts', op: 'get' });
          if (Array.isArray(getRes?.concepts)) {
            old = getRes.concepts.find((c) => c.id === res.id) || null;
          }
        } catch {
          // get 실패 시 null 유지
        }

        if (!old) {
          // 옛 개념을 못 읽으면 합치지 않는다(새 글만으로 덮어쓰면 옛 정의가 사라진다). 칸은 열어 둔다.
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          errEl.hidden = false;
          errEl.textContent = '같은 이름 개념을 읽지 못했어요 — 다시 눌러 주세요';
          return;
        }

        const merged = mergeConcept(old, {
          definition,
          aliases,
          tags: [...activeTags],
          related: [...relatedSet],
        });

        if (merged.tooLong) {
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          errEl.hidden = false;
          errEl.textContent = '합치면 500자를 넘어요 — 줄여 주세요';
          defIn.focus();
          return;
        }

        const oldHasTask = Boolean(old?.task || old?.firstTask);
        const oldHasScrap = Boolean(old?.scrapId || (Array.isArray(old?.appears) && old.appears.length > 0));

        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중…';

        const mergePayload = {
          type: 'concepts',
          op: 'save',
          id: res.id,
          name: cleanName,
          aliases: merged.aliases,
          tags: merged.tags,
          definition: merged.definition,
          related: merged.related,
          // 옛 값이 있으면 키를 빼서 다리가 옛 값을 지킨다
          ...(oldHasTask ? {} : { task }),
          ...(oldHasScrap ? {} : { scrapId }),
        };

        const mergeRes = await send(mergePayload);

        saveBtn.disabled = false;
        saveBtn.textContent = '저장';

        if (mergeRes && !mergeRes.error) {
          const id = mergeRes.concept?.id || res.id;
          const anchor = seed.anchor;
          closeForm();
          conceptsCache = null; // 캐시 무효화

          // 개념 저장 직후 패널 등 다른 뷰가 즉시 최신 상태를 반영하도록 이벤트 발송
          window.dispatchEvent(new CustomEvent('readgloss:concepts-updated', { detail: { id } }));
          if (id) globalThis.readglossLastSave = { kind: 'concept', id };

          // 저장 확인 토스트
          globalThis.readglossToast?.show({
            text: '기존 개념에 더했어요',
            anchor,
          });

          // 다시 칠하기
          chrome.runtime.sendMessage({ type: 'concepts', op: 'names' }, (r) => {
            if (r?.terms) paint(r.terms);
          });
          return;
        }

        errEl.hidden = false;
        errEl.textContent = mergeRes?.error || '저장하지 못했어요';
        return;
      }

      if (res && !res.error) {
        // 저장 응답은 concept 키 안에 든다(bridge/server.mjs /concepts save 응답)
        const id = res.concept?.id;
        const anchor = seed.anchor;
        closeForm();
        conceptsCache = null; // 캐시 무효화

        // 개념 저장 직후 패널 등 다른 뷰가 즉시 최신 상태를 반영하도록 이벤트 발송
        window.dispatchEvent(new CustomEvent('readgloss:concepts-updated', { detail: { id } }));
        // 방금 저장한 것 기억(Ctrl/⌘+Z로 다시 열기, 15-2). 이벤트 뒤에 둔다(시험이 저장 블록 첫 } 전 발송을 본다)
        if (id) globalThis.readglossLastSave = { kind: 'concept', id };

        // 저장 확인 토스트
        globalThis.readglossToast?.show({
          text: '개념을 저장했어요',
          anchor,
        });

        // 다시 칠하기
        chrome.runtime.sendMessage({ type: 'concepts', op: 'names' }, (r) => {
          if (r?.terms) paint(r.terms);
        });
        return;
      }

      errEl.hidden = false;
      errEl.textContent = res?.error || '저장하지 못했어요';
    }

    saveBtn.onclick = handleSave;
    foot.append(cancelBtn, saveBtn);

    formCard.append(titleEl, nameField, aliasField, tagField, defField, relField, errEl, foot);

    // 키 처리: 카드·칸 안에서 친 키가 페이지·다른 기능(⌥S, 메모 시작 키)으로 새지 않게 stopPropagation
    formHost.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && e.readglossCardClosed) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeForm();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    });
    formHost.addEventListener('keypress', (e) => e.stopPropagation());
    formHost.addEventListener('keyup', (e) => e.stopPropagation());

    shadow.append(style, formCard);
    (document.body || document.documentElement).append(formHost);

    // 폼 위치 잡기
    const formRect = formCard.getBoundingClientRect();
    const anchor = seed.anchor;
    const toastCore = globalThis.readglossToast;
    const pos = anchor && toastCore?.toastPosition
      ? toastCore.toastPosition(anchor, { width: formRect.width, height: formRect.height }, { width: document.documentElement.clientWidth, height: window.innerHeight })
      : { left: Math.max(16, (window.innerWidth - formRect.width) / 2), top: Math.max(16, (window.innerHeight - formRect.height) / 2) };

    formHost.style.left = `${pos.left}px`;
    formHost.style.top = `${pos.top}px`;

    // 초기 포커스: 처음 커서는 이름 칸(글 끝) (T48)
    nameIn.focus();
    const len = nameIn.value.length;
    nameIn.setSelectionRange(len, len);
  }

  // --- saveLater: 칸 없이 바로 나중에 볼 것으로 저장 ---
  async function saveLater({ name, sentence, anchor, range }) {
    const cleanName = (name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!cleanName) return;

    let task = null;
    try {
      const g = await send({ type: 'scraps', op: 'guess', url: location.href });
      if (g && g.task && !g.ask) task = g.task;
    } catch {
      // 짐작 실패는 무시
    }

    const targetNode = range?.startContainer ?? range ?? (window.getSelection()?.anchorNode ?? document.body);
    const headings = globalThis.readglossSelectionUi?.headingsFor?.(targetNode) ?? [];

    const seen = {
      url: location.href,
      title: document.title || '',
      sentence: (sentence || '').slice(0, 300),
      ...(headings.length > 0 ? { headings } : {}),
    };

    const res = await send({
      type: 'concepts',
      op: 'save',
      name: cleanName,
      definition: '',
      seen,
      task,
    });

    if (res?.error === 'exists') {
      globalThis.readglossToast?.show({
        text: '이미 있어요',
        ms: 1500,
        anchor,
      });
      return;
    }

    if (res && !res.error) {
      const id = res.concept?.id;
      conceptsCache = null;
      window.dispatchEvent(new CustomEvent('readgloss:concepts-updated', { detail: { id } }));
      if (id) globalThis.readglossLastSave = { kind: 'concept', id };
      globalThis.readglossToast?.show({
        text: '나중에 볼 것에 넣었어요',
        ms: 1500,
        anchor,
      });
      chrome.runtime.sendMessage({ type: 'concepts', op: 'names' }, (r) => {
        if (r?.terms) paint(r.terms);
      });
    } else {
      globalThis.readglossToast?.show({
        text: res?.error || '저장하지 못했어요',
        anchor,
      });
    }
  }

  // --- 방금 저장한 것 다시 열기 (Ctrl+Z / ⌘Z, 15-2) ---
  // Ctrl+Z 또는 ⌘Z (수정키 하나만, Shift 없음)
  function isReopenShortcut(e) {
    if (!e) return false;
    // 한글 자판에서도 되도록 물리 키(code)를 먼저 본다
    const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z';
    if (!isZ || e.shiftKey) return false;
    const isCtrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    const isMetaOnly = e.metaKey && !e.ctrlKey && !e.altKey;
    return isCtrlOnly || isMetaOnly;
  }

  // 이벤트 경로에 input·textarea·select·contenteditable·우리 host(readgloss-*)가 있으면 무시(원래 되돌리기)
  function shouldIgnoreReopenEvent(path) {
    if (!Array.isArray(path)) return false;
    for (const el of path) {
      if (!el || el.nodeType !== 1) continue;
      const tag = (el.localName || el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable || (el.hasAttribute?.('contenteditable') && el.getAttribute('contenteditable') !== 'false')) {
        return true;
      }
      if (tag.startsWith('readgloss-')) return true;
    }
    return false;
  }

  function onDocumentKeyDown(e) {
    if (!isReopenShortcut(e)) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (shouldIgnoreReopenEvent(path)) return;

    const last = globalThis.readglossLastSave;
    if (!last || !last.id) return;

    e.preventDefault();

    if (last.kind === 'concept') {
      window.dispatchEvent(new CustomEvent('readgloss:open-panel', {
        detail: { tab: 'concepts', conceptId: last.id, focusNew: true },
      }));
    } else if (last.kind === 'memo') {
      globalThis.readglossMemoPadUi?.reopen?.(last.id);
    }
  }

  // --- 외부 공개 API ---
  globalThis.readglossConceptPage = {
    paint,
    openForm,
    closeForm,
    closeCard,
    saveLater,
    shouldSendSeen,
    mergeConcept,
  };

  globalThis.readglossConceptReopen = {
    isReopenShortcut,
    shouldIgnoreReopenEvent,
    shouldOpenConceptOnClick,
    isPanelOpen,
    requestClosePanel,
  };

  // --- 이벤트 리스너 등록 ---
  if (typeof document !== 'undefined') {
    document.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mousedown', onWindowMouseDown, true);
    window.addEventListener('mouseup', onWindowMouseUp, true);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeyDown); // capture 아님
    window.addEventListener('readgloss:concepts-updated', () => {
      conceptsCache = null;
      chrome.runtime.sendMessage({ type: 'concepts', op: 'names' }, (r) => {
        if (r?.terms) paint(r.terms);
      });
    });
  }

  // --- 10초 재시도 관찰자 (scrap.js 와 동일 방식) ---
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
      }, 500);
    });

    retryObserver.observe(target, { childList: true, subtree: true, characterData: true });

    stopTimer = setTimeout(() => {
      stopRetryObserver();
    }, 10_000);
  }

  // --- 페이지 로드 시 초기화 ---
  function initPageConcepts() {
    if (!globalThis.chrome?.runtime?.id) return;
    chrome.runtime.sendMessage({ type: 'concepts', op: 'names' }, (r) => {
      if (chrome.runtime.lastError || !r || r.error) return;
      const terms = Array.isArray(r.terms) ? r.terms : [];
      if (terms.length > 0) {
        paint(terms);
        startRetryObserver();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPageConcepts, { once: true });
    } else {
      initPageConcepts();
    }
  }
})();
