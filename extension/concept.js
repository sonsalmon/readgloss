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

  // 칠한 범위 클릭
  function onDocumentClick(e) {
    const hit = findHit(e.clientX, e.clientY);
    if (!hit) return;

    const link = e.target.closest('a[href]');
    if (!link) {
      // 링크 안이 아니면 패널 '개념' 탭에서 상세 열기
      e.preventDefault();
      e.stopPropagation();
      closeCard();
      window.dispatchEvent(new CustomEvent('readgloss:open-panel', { detail: { tab: 'concepts', conceptId: hit.id } }));
    } else {
      // 링크 안이면 ⌥(alt)+클릭일 때만 열고 preventDefault
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        closeCard();
        window.dispatchEvent(new CustomEvent('readgloss:open-panel', { detail: { tab: 'concepts', conceptId: hit.id } }));
      }
      // 그 밖 클릭 동작은 막지 않는다
    }
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

  async function openForm(seed = {}) {
    closeForm();
    closeCard();

    const conceptId = seed.id || null;
    const initialName = (seed.name || '').trim().slice(0, 80);
    const scrapId = seed.scrapId || null;

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

    // 이름
    const nameField = document.createElement('div');
    nameField.className = 'field';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'label';
    nameLabel.textContent = '개념 이름 (1~80자)';
    const nameIn = document.createElement('input');
    nameIn.className = 'input';
    nameIn.type = 'text';
    nameIn.maxLength = 80;
    nameIn.value = initialName;
    nameField.append(nameLabel, nameIn);

    // 별칭
    const aliasField = document.createElement('div');
    aliasField.className = 'field';
    const aliasLabel = document.createElement('label');
    aliasLabel.className = 'label';
    aliasLabel.textContent = '별칭 (쉼표로 구분, 최대 5개)';
    const aliasIn = document.createElement('input');
    aliasIn.className = 'input';
    aliasIn.type = 'text';
    aliasIn.placeholder = '별칭1, 별칭2';
    aliasIn.value = Array.isArray(seed.aliases) ? seed.aliases.join(', ') : (seed.aliases || '');
    aliasField.append(aliasLabel, aliasIn);

    // 내 정의
    const defField = document.createElement('div');
    defField.className = 'field';
    const defLabel = document.createElement('label');
    defLabel.className = 'label';
    defLabel.textContent = '내 정의 (1~500자)';
    const defIn = document.createElement('textarea');
    defIn.className = 'textarea';
    defIn.rows = 3;
    defIn.maxLength = 500;
    defIn.placeholder = '내가 이해한 개념 정의';
    defIn.value = seed.definition || '';
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

      const definition = defIn.value.trim();
      if (!definition || definition.length > 500) {
        errEl.hidden = false;
        errEl.textContent = '내 정의는 1~500자여야 해요';
        defIn.focus();
        return;
      }

      const core = globalThis.readglossConcept;
      const aliases = core?.parseAliases ? core.parseAliases(aliasIn.value) : [];

      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';

      const payload = {
        type: 'concepts',
        op: 'save',
        name: cleanName,
        aliases,
        definition,
        related: [...relatedSet],
        task,
        scrapId,
      };
      if (conceptId) {
        payload.id = conceptId;
      }

      const res = await send(payload);

      saveBtn.disabled = false;
      saveBtn.textContent = '저장';

      // 409면 칸을 닫고 그 개념 상세를 연다
      if (res?.error === 'exists' && res?.id) {
        closeForm();
        window.dispatchEvent(new CustomEvent('readgloss:open-panel', { detail: { tab: 'concepts', conceptId: res.id } }));
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

    formCard.append(titleEl, nameField, aliasField, defField, relField, errEl, foot);

    // 키 처리: 카드·칸 안에서 친 키가 페이지·다른 기능(⌥S, 메모 시작 키)으로 새지 않게 stopPropagation
    formHost.addEventListener('keydown', (e) => {
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

    // 초기 포커스
    if (!initialName) nameIn.focus();
    else defIn.focus();
  }

  // --- saveLater: 칸 없이 바로 나중에 볼 것으로 저장 ---
  async function saveLater({ name, sentence, anchor }) {
    const cleanName = (name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!cleanName) return;

    let task = null;
    try {
      const g = await send({ type: 'scraps', op: 'guess', url: location.href });
      if (g && g.task && !g.ask) task = g.task;
    } catch {
      // 짐작 실패는 무시
    }

    const seen = {
      url: location.href,
      title: document.title || '',
      sentence: (sentence || '').slice(0, 300),
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
      conceptsCache = null;
      window.dispatchEvent(new CustomEvent('readgloss:concepts-updated', { detail: { id: res.concept?.id } }));
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

  // --- 외부 공개 API ---
  globalThis.readglossConceptPage = {
    paint,
    openForm,
    closeForm,
    closeCard,
    saveLater,
  };

  // --- 이벤트 리스너 등록 ---
  if (typeof document !== 'undefined') {
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onDocumentClick, true);
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
