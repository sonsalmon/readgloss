// extension/panel-concepts.js
// "개념" 패널 탭(T28). 순서 23.
// 목록: 이름순, 검색 칸, 개념마다 "나온 곳 N".
// 상세: 정의·별칭·관련 개념 고치기, 나온 곳 목록(누르면 scrap-jump 또는 scrollTo), [지우기].
// readgloss:open-panel detail에 conceptId가 오면 그 상세를 연다.
(() => {
  const CSS = `
    .concepts-container {
      font-size: 13px;
      line-height: 1.5;
      color: var(--rg-text, var(--rg-fg, #222));
      padding: 10px 14px;
    }
    .concepts-search-row {
      margin-bottom: 12px;
    }
    .filter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
    }
    .tag-chip {
      background: none;
      border: 1px solid var(--rg-border, #d0d7de);
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 11.5px;
      cursor: pointer;
      color: var(--rg-muted, #656d76);
      font-family: inherit;
      transition: all 0.15s;
    }
    .tag-chip:hover {
      background: var(--rg-hover, rgba(0, 0, 0, 0.04));
    }
    .tag-chip.active {
      background: var(--rg-accent-soft, rgba(47, 111, 235, 0.10));
      color: var(--rg-accent, #2f6feb);
      border-color: var(--rg-accent, #2f6feb);
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
      border: 1px dashed var(--rg-border, #d0d7de);
      background: var(--rg-bg, #fff);
      color: var(--rg-fg, inherit);
      font: inherit;
      font-size: 11.5px;
    }
    .tag-input:focus-visible {
      outline: 2px solid var(--rg-accent, #2f6feb);
      outline-offset: 1px;
      border-style: solid;
    }
    .filter-chip {
      background: none;
      border: 1px solid var(--rg-border, #d0d7de);
      border-radius: 14px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
      color: var(--rg-muted, #656d76);
      transition: all 0.15s;
    }
    .filter-chip:hover {
      background: var(--rg-hover, rgba(0, 0, 0, 0.04));
    }
    .filter-chip.active {
      background: var(--rg-accent-soft, rgba(47, 111, 235, 0.10));
      color: var(--rg-accent, #2f6feb);
      border-color: var(--rg-accent, #2f6feb);
      font-weight: 600;
    }
    .detail-seen-row {
      margin-bottom: 12px;
      font-size: 12.5px;
      color: var(--rg-muted, #656d76);
    }
    .detail-seen-link {
      color: var(--rg-accent, #2f6feb);
      text-decoration: underline;
      cursor: pointer;
    }
    .detail-seen-link:hover {
      opacity: 0.8;
    }
    .concepts-search {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--rg-border, #d0d7de);
      background: var(--rg-bg, #fff);
      color: var(--rg-fg, inherit);
      font: inherit;
      font-size: 13px;
    }
    .concepts-search:focus-visible {
      outline: 2px solid var(--rg-accent, #2f6feb);
      outline-offset: 1px;
    }
    .concepts-empty {
      color: var(--rg-muted, #656d76);
      text-align: center;
      padding: 32px 16px;
    }
    .concept-item {
      background: var(--rg-card-bg, var(--rg-bg, #fff));
      border: 1px solid var(--rg-border, #e3e0d8);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .concept-item:hover {
      background: var(--rg-hover, rgba(0, 0, 0, 0.03));
      border-color: var(--rg-accent, #2f6feb);
    }
    .concept-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 4px;
    }
    .concept-name {
      font-weight: 700;
      font-size: 14px;
      color: var(--rg-fg, #111);
    }
    .concept-count {
      font-size: 11.5px;
      color: var(--rg-muted, #656d76);
    }
    .concept-def-preview {
      font-size: 12.5px;
      color: var(--rg-muted, #555);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      word-break: break-word;
    }
    .detail-nav {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .btn-back {
      background: none;
      border: 1px solid var(--rg-border, #ddd);
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 12px;
      cursor: pointer;
      color: var(--rg-fg, inherit);
    }
    .btn-back:hover {
      background: var(--rg-hover, #f0f0f0);
    }
    .detail-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--rg-fg, #111);
      margin-bottom: 12px;
      word-break: break-word;
    }
    .detail-field {
      margin-bottom: 12px;
    }
    .detail-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--rg-muted, #656d76);
      margin-bottom: 4px;
    }
    .detail-input, .detail-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--rg-border, #ccc);
      background: var(--rg-bg, #fff);
      color: var(--rg-fg, inherit);
      font: inherit;
      font-size: 13px;
    }
    .detail-input:focus-visible, .detail-textarea:focus-visible {
      outline: 2px solid var(--rg-accent, #2f6feb);
      outline-offset: 1px;
    }
    .detail-textarea {
      resize: vertical;
      min-height: 80px;
    }
    .detail-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 5px;
    }
    .detail-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--rg-accent-soft, rgba(47, 111, 235, 0.10));
      color: var(--rg-accent, #2f6feb);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11.5px;
      font-weight: 500;
    }
    .detail-chip-del {
      border: none;
      background: none;
      cursor: pointer;
      padding: 0;
      font-size: 12px;
      line-height: 1;
      color: inherit;
    }
    .detail-ac-list {
      margin: 2px 0 0 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--rg-border, #ccc);
      border-radius: 6px;
      background: var(--rg-bg, #fff);
      max-height: 100px;
      overflow-y: auto;
    }
    .detail-ac-item {
      padding: 5px 8px;
      cursor: pointer;
      font-size: 12px;
    }
    .detail-ac-item:hover {
      background: var(--rg-accent-soft, rgba(47, 111, 235, 0.10));
      color: var(--rg-accent, #2f6feb);
    }
    .detail-actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
      margin-bottom: 16px;
    }
    .btn-action {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      cursor: pointer;
      border: 1px solid var(--rg-border, #ccc);
      background: var(--rg-bg, #fff);
      color: var(--rg-fg, inherit);
    }
    .btn-primary {
      background: var(--rg-accent, #2f6feb);
      color: #fff;
      border-color: var(--rg-accent, #2f6feb);
      font-weight: 600;
    }
    .btn-danger {
      color: #b91c1c;
      border-color: #fca5a5;
    }
    .btn-danger:hover {
      background: #fee2e2;
    }
    .appears-section {
      border-top: 1px solid var(--rg-border, #eee);
      padding-top: 12px;
      margin-top: 12px;
    }
    .appears-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--rg-fg, #111);
      margin-bottom: 8px;
    }
    .appear-card {
      background: var(--rg-sub-bg, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--rg-border, #e5e5e5);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .appear-card:hover {
      background: var(--rg-hover, rgba(0, 0, 0, 0.05));
    }
    .appear-path {
      font-size: 11px;
      color: var(--rg-muted, #777);
      margin-bottom: 3px;
    }
    .appear-sentence {
      font-size: 12px;
      color: var(--rg-fg, #222);
      word-break: break-word;
    }
    .status-msg {
      font-size: 12px;
      color: var(--rg-accent, #2f6feb);
      margin-top: 4px;
    }
    .status-err {
      color: #d1242f;
    }
  `;

  // 오래된 비동기 응답 버리기: 요청 번호를 두고 마지막 응답만 유효하게 판정하는 순수 헬퍼
  function latestOnly(fn) {
    let latestSeq = 0;
    if (typeof fn === 'function') {
      return async function (...args) {
        const seq = ++latestSeq;
        const res = await fn(...args);
        if (seq !== latestSeq) {
          return { stale: true, seq };
        }
        return { stale: false, seq, res };
      };
    }
    return {
      next() {
        latestSeq += 1;
        return latestSeq;
      },
      isLatest(seq) {
        return seq === latestSeq;
      },
      current() {
        return latestSeq;
      },
      reset() {
        latestSeq = 0;
      },
    };
  }

  let pendingOpenConceptId = null;
  let pendingFocusNew = false;
  let rerenderCurrentTab = null;
  let hasRendered = false;
  let loadConcepts = null;
  let conceptsBusy = () => false; // 상세에 저장 안 된 변경이 있거나 칸에 포커스가 있나 (render 가 정한다)

  if (typeof window !== 'undefined') {
    // 패널 열기 시 conceptId 전달 받음. panel.js 의 open-panel 리스너보다 먼저 와야 막 열린 패널이 이 id 를 놓치지 않는다(capture).
    window.addEventListener('readgloss:open-panel', (e) => {
      if (e.detail?.conceptId) {
        pendingOpenConceptId = e.detail.conceptId;
        pendingFocusNew = e.detail?.focusNew === true;
        if (typeof rerenderCurrentTab === 'function') {
          rerenderCurrentTab(pendingOpenConceptId, pendingFocusNew);
        }
        // 패널이 닫혀 있었으면 panel.js 가 같은 이벤트 안에서 render 를 불러 이 id 를 쓰고 비운다.
        // 이미 열려 있었으면 render 가 안 불리니, 이벤트가 끝난 뒤 남은 id 를 비워 다음 열기 때 옛 상세가 뜨지 않게 한다.
        queueMicrotask(() => {
          pendingOpenConceptId = null;
          pendingFocusNew = false;
        });
      }
    }, { capture: true });

    // 개념 갱신 이벤트 수신: 탭이 한 번이라도 그려졌으면 즉시 loadConcepts()로 목록을 다시 받아 지금 화면을 다시 그린다
    window.addEventListener('readgloss:concepts-updated', (e) => {
      // 상세에서 자동 저장한 것이면 다시 그리지 않는다(입력 중인 칸이 날아간다). 목록은 뒤로 갈 때 받는다.
      if (e.detail?.fromDetail) return;
      if (hasRendered && typeof loadConcepts === 'function') {
        // 상세에 저장 안 된 변경이 있거나 칸에 포커스가 있으면 화면은 그대로 두고 목록 자료만 새로 받아 둔다
        loadConcepts({ quiet: conceptsBusy() });
      }
    });
  }

  function render(pane) {
    hasRendered = true;
    let conceptsList = [];
    let isLoading = true; // 목록을 받는 중이면 상세 대신 "불러오는 중"을 보인다
    let targetConceptId = pendingOpenConceptId || null; // 열어 달라고 받은 id: 목록을 받은 뒤 상세로 연다
    pendingOpenConceptId = null;
    let focusNewOnLoad = pendingFocusNew;
    pendingFocusNew = false;
    let detailKeyHandler = null; // 상세의 Esc·⌘Enter 리스너. 다시 그릴 때 이전 것을 뗀다
    let selectedConceptId = targetConceptId;
    let currentView = targetConceptId ? 'detail' : 'list'; // 'list' | 'detail'
    let detailHasWork = () => false; // 상세가 그려지면 renderDetailView 가 채운다(저장 안 된 변경·저장 중·자동 저장 대기)
    conceptsBusy = () => currentView === 'detail' && (detailHasWork() || pane.matches(':focus-within'));
    let filterMode = 'all'; // 'all' | 'defined' | 'later'
    let searchQuery = '';
    let statusMsg = '';
    let isError = false;

    // 오래된 비동기 응답 버리기용 요청 번호 관리자
    const loadSeq = latestOnly();

    // 통신 헬퍼
    function send(msg) {
      return new Promise((resolve) => {
        if (!globalThis.chrome?.runtime?.id) return resolve({ error: 'no-runtime' });
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(res);
        });
      });
    }

    loadConcepts = async function (opts) {
      const reqId = loadSeq.next();
      // quiet: 상세 작업 중 다른 곳에서 저장된 경우. 화면은 그대로 두고 목록 자료만 받는다(로딩 중이면 평소대로)
      const quiet = opts?.quiet === true && !isLoading;
      if (!quiet) isLoading = true;
      let res = await send({ type: 'concepts', op: 'get' });
      // 다른 요청이 발생했으면 이전 응답은 버린다
      if (!loadSeq.isLatest(reqId)) return;

      if (res && Array.isArray(res.concepts)) {
        conceptsList = res.concepts;
        // 이름순 정렬
        conceptsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      } else {
        conceptsList = [];
      }
      if (quiet) return; // 화면은 그대로 둔다

      // 열 id가 목록에 없으면(방금 만든 개념) 한 번 더 받아 온 뒤 상세를 그린다
      const openId = targetConceptId;
      if (openId && !conceptsList.some((c) => c.id === openId)) {
        res = await send({ type: 'concepts', op: 'get' });
        if (!loadSeq.isLatest(reqId)) return;
        if (res && Array.isArray(res.concepts)) {
          conceptsList = res.concepts;
          conceptsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }
      }

      isLoading = false;
      targetConceptId = null;

      if (openId && conceptsList.some((c) => c.id === openId)) {
        selectedConceptId = openId;
        currentView = 'detail';
      }
      draw();

      if (focusNewOnLoad && currentView === 'detail') {
        focusNewOnLoad = false;
        applyDetailFocusNew();
      }
    };

    function applyDetailFocusNew(textarea) {
      const ta = textarea || pane.querySelector('.detail-textarea');
      if (!ta) return;
      if (globalThis.readglossMdList?.appendNewItem) {
        const { value, caret } = globalThis.readglossMdList.appendNewItem(ta.value);
        ta.value = value;
        ta.setSelectionRange(caret, caret);
      }
      ta.focus({ preventScroll: true });
    }

    // 패널 닫기: 닫기 이벤트는 없어서 패널 ✕ 버튼을 누른다
    function requestClosePanel() {
      const host = document.querySelector('readgloss-ui');
      host?.shadowRoot?.querySelector('button.close')?.click();
    }

    // 목록으로: 목록을 새로 받아 그린다(상세에서 자동 저장한 이름·설명이 목록에 보이게)
    function goToList() {
      currentView = 'list';
      targetConceptId = null; // 로딩 중에 누르면 열 예정이던 상세로 되돌아가지 않게
      selectedConceptId = null;
      statusMsg = '';
      loadConcepts();
    }

    // 16-7 토글용: 지금 상세가 열린 개념 id (이 탭이 떠 있을 때만)
    globalThis.readglossConceptPanelUi = {
      getCurrentConceptId: () => (currentView === 'detail' && pane.isConnected ? selectedConceptId : null),
    };

    rerenderCurrentTab = (conceptId, focusNew) => {
      // 16-7: 같은 개념이 열려 있으면 여는 움직임(애니메이션)을 다시 하지 않는다
      if (currentView === 'detail' && selectedConceptId === conceptId) {
        if (focusNew) {
          applyDetailFocusNew();
        }
        return;
      }
      targetConceptId = conceptId;
      selectedConceptId = conceptId;
      currentView = 'detail';
      focusNewOnLoad = focusNew === true;
      statusMsg = '';
      isLoading = true;
      draw(); // 목록을 받는 동안 "불러오는 중"
      loadConcepts();
    };

    function draw() {
      pane.replaceChildren();

      const style = document.createElement('style');
      style.textContent = CSS;
      pane.append(style);

      const container = document.createElement('div');
      container.className = 'concepts-container';

      if (currentView === 'detail' && selectedConceptId) {
        renderDetailView(container);
      } else {
        renderListView(container);
      }

      pane.append(container);
    }

    // --- 목록 화면 ---
    function renderListView(parent) {
      parent.replaceChildren();

      // 거르기 칩: 전체 · 내 개념 · 나중에 볼 것 (N) + 쓰인 태그마다 #<태그> (N)
      const laterCount = conceptsList.filter((c) => c.later === true || !c.definition).length;
      const chipsRow = document.createElement('div');
      chipsRow.className = 'filter-chips';

      const chipsData = [
        { key: 'all', label: '전체' },
        { key: 'defined', label: '내 개념' },
        { key: 'later', label: `나중에 볼 것 (${laterCount})` },
      ];

      // 사용된 태그별 개수 집계
      const tagCounts = new Map();
      for (const c of conceptsList) {
        if (Array.isArray(c.tags)) {
          for (const t of c.tags) {
            if (t) {
              tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
          }
        }
      }

      // 태그 이름순 정렬 후 칩 추가
      const sortedTags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));
      for (const t of sortedTags) {
        chipsData.push({
          key: `tag:${t}`,
          label: `#${t} (${tagCounts.get(t)})`,
        });
      }

      for (const cd of chipsData) {
        const btn = document.createElement('button');
        btn.className = `filter-chip ${filterMode === cd.key ? 'active' : ''}`;
        btn.type = 'button';
        btn.textContent = cd.label;
        btn.onclick = () => {
          filterMode = cd.key;
          renderListView(parent);
        };
        chipsRow.append(btn);
      }
      parent.append(chipsRow);

      const searchRow = document.createElement('div');
      searchRow.className = 'concepts-search-row';

      const searchInput = document.createElement('input');
      searchInput.className = 'concepts-search';
      searchInput.type = 'text';
      searchInput.placeholder = '개념 검색…';
      searchInput.value = searchQuery;
      searchInput.oninput = () => {
        searchQuery = searchInput.value;
        renderFilteredList(listContainer);
      };
      searchRow.append(searchInput);
      parent.append(searchRow);

      const listContainer = document.createElement('div');
      renderFilteredList(listContainer);
      parent.append(listContainer);
    }

    function renderFilteredList(container) {
      container.replaceChildren();

      const q = searchQuery.trim().toLowerCase();
      const filtered = conceptsList.filter((c) => {
        const isLater = c.later === true || !c.definition;
        if (filterMode === 'defined' && isLater) return false;
        if (filterMode === 'later' && !isLater) return false;
        if (filterMode.startsWith('tag:')) {
          const targetTag = filterMode.slice(4);
          if (!Array.isArray(c.tags) || !c.tags.includes(targetTag)) return false;
        }

        if (!q) return true;
        if ((c.name || '').toLowerCase().includes(q)) return true;
        if (Array.isArray(c.aliases) && c.aliases.some((a) => a.toLowerCase().includes(q))) return true;
        if ((c.definition || '').toLowerCase().includes(q)) return true;
        if (Array.isArray(c.tags) && c.tags.some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });

      // 나중에 볼 것은 ts 오름차순(오래된 것 먼저)
      if (filterMode === 'later') {
        filtered.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      } else {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'concepts-empty';
        empty.textContent = conceptsList.length === 0 ? '저장된 개념이 없어요' : '검색 결과가 없어요';
        container.append(empty);
        return;
      }

      for (const c of filtered) {
        const item = document.createElement('div');
        item.className = 'concept-item';
        item.onclick = () => {
          selectedConceptId = c.id;
          currentView = 'detail';
          statusMsg = '';
          draw();
        };

        const head = document.createElement('div');
        head.className = 'concept-head';

        const name = document.createElement('span');
        name.className = 'concept-name';
        name.textContent = c.name;

        const count = document.createElement('span');
        count.className = 'concept-count';
        const appearsCount = Array.isArray(c.appears) ? c.appears.length : 0;
        count.textContent = `나온 곳 ${appearsCount}`;

        head.append(name, count);

        const def = document.createElement('div');
        def.className = 'concept-def-preview';
        const isLater = c.later === true || !c.definition;
        if (isLater) {
          def.textContent = c.seen?.title ? `본 곳: ${c.seen.title}` : '아직 설명 없음';
        } else {
          def.textContent = c.definition || '';
        }

        item.append(head, def);
        container.append(item);
      }
    }

    // --- 상세 화면 ---
    function renderDetailView(parent) {
      // 목록을 아직 못 받았으면 목록 화면으로 되돌리지 말고 "불러오는 중"을 보인다.
      if (isLoading) {
        const loading = document.createElement('div');
        loading.className = 'concepts-empty';
        loading.textContent = '개념을 불러오는 중…';
        parent.append(loading);
        return;
      }

      const concept = conceptsList.find((c) => c.id === selectedConceptId);
      if (!concept) {
        currentView = 'list';
        selectedConceptId = null;
        renderListView(parent);
        return;
      }

      // 자동 저장 상수 및 상태 관리 (15-3)
      const AUTO_SAVE_DELAY = 800; // 0.8초 디바운스
      let autoSaveTimer = 0;
      let isSaving = false;
      let pendingSaveAgain = false;
      let pendingCloseOnSuccess = false;
      let pendingClosePanelOnSuccess = false;
      let isDirty = false;
      detailHasWork = () => isDirty || Boolean(autoSaveTimer) || isSaving;

      // 상단 뒤로가기
      const nav = document.createElement('div');
      nav.className = 'detail-nav';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn-back';
      backBtn.type = 'button';
      backBtn.textContent = '← 목록';
      backBtn.onclick = () => {
        if (isDirty || autoSaveTimer || isSaving) {
          doSave({ closeOnSuccess: true });
        } else {
          goToList();
        }
      };

      const saveIndicator = document.createElement('span');
      saveIndicator.className = 'save-status';
      saveIndicator.style.cssText = 'font-size: 11.5px; color: var(--rg-muted, #656d76); margin-left: auto;';

      nav.append(backBtn, saveIndicator);
      parent.append(nav);

      // 개념 제목
      const title = document.createElement('div');
      title.className = 'detail-title';
      title.textContent = concept.name;
      parent.append(title);

      // 나중에 볼 것(later)이면 "본 곳: <제목>" 줄 표시 (누르면 지금 탭에서 열기)
      // 데이터 출처: 변경 기록 13의 정본은 concept.seen { title, url, sentence } 이며, firstTitle/firstUrl은 변경 기록 11 스크랩 연동 개념의 하위 호환 fallback
      const isLater = concept.later === true || !concept.definition;
      const seenTitle = concept.seen?.title || concept.firstTitle;
      const seenUrl = concept.seen?.url || concept.firstUrl;

      if (isLater && seenTitle) {
        const seenRow = document.createElement('div');
        seenRow.className = 'detail-seen-row';
        seenRow.textContent = '본 곳: ';
        const seenLink = document.createElement('span');
        seenLink.className = 'detail-seen-link';
        seenLink.textContent = seenTitle;
        if (seenUrl) {
          seenLink.onclick = () => {
            chrome.runtime.sendMessage({
              type: 'open-url',
              url: seenUrl,
            });
          };
        }
        seenRow.append(seenLink);
        parent.append(seenRow);
      }

      // 정의 필드
      const defField = document.createElement('div');
      defField.className = 'detail-field';
      const defLabel = document.createElement('label');
      defLabel.className = 'detail-label';
      defLabel.textContent = '내 정의 (비우면 나중에 볼 것 · 500자까지)';
      const defTextarea = document.createElement('textarea');
      defTextarea.className = 'detail-textarea';
      defTextarea.rows = 4;
      defTextarea.maxLength = 500;
      const initialDef = concept.definition || '';
      defTextarea.value = globalThis.readglossMdList?.ensureStartsList
        ? globalThis.readglossMdList.ensureStartsList(initialDef)
        : initialDef;

      // 마크다운 목록 단축키: Enter, Shift+Enter, Tab, Shift+Tab
      defTextarea.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const md = globalThis.readglossMdList;
        if (!md) return;

        let res = null;
        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          res = md.onEnter(defTextarea.value, defTextarea.selectionStart, defTextarea.selectionEnd);
        } else if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          res = md.onShiftEnter(defTextarea.value, defTextarea.selectionStart, defTextarea.selectionEnd);
        } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          res = md.onTab(defTextarea.value, defTextarea.selectionStart, defTextarea.selectionEnd, false);
        } else if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          res = md.onTab(defTextarea.value, defTextarea.selectionStart, defTextarea.selectionEnd, true);
        }

        if (res) {
          e.preventDefault();
          defTextarea.value = res.value;
          defTextarea.setSelectionRange(res.selStart, res.selEnd);
          defTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      defField.append(defLabel, defTextarea);
      parent.append(defField);

      // 다른 이름 필드
      const aliasField = document.createElement('div');
      aliasField.className = 'detail-field';
      const aliasLabel = document.createElement('label');
      aliasLabel.className = 'detail-label';
      aliasLabel.textContent = '다른 이름 (같은 개념의 다른 이름, 쉼표로 · 최대 5개)';
      const aliasInput = document.createElement('input');
      aliasInput.className = 'detail-input';
      aliasInput.type = 'text';
      aliasInput.placeholder = '접근 통제, AC';
      aliasInput.value = Array.isArray(concept.aliases) ? concept.aliases.join(', ') : '';
      aliasField.append(aliasLabel, aliasInput);
      parent.append(aliasField);

      // 태그 필드
      const tagField = document.createElement('div');
      tagField.className = 'detail-field';
      const tagLabel = document.createElement('label');
      tagLabel.className = 'detail-label';
      tagLabel.textContent = '태그 (최대 5개)';

      const tagRow = document.createElement('div');
      tagRow.className = 'tag-row';

      const DEFAULT_TAGS = ['다시 보기', '글감 후보', '헷갈림'];
      const activeTags = new Set(Array.isArray(concept.tags) ? concept.tags : []);

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
            triggerAutoSave();
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
            triggerAutoSave();
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
          const cleanT = tagInput.value.trim().replace(/\s+/g, ' ');
          if (cleanT.length >= 1 && cleanT.length <= 20) {
            if (activeTags.size < 5) {
              activeTags.add(cleanT);
              tagInput.value = '';
              renderTags();
              triggerAutoSave();
              tagInput.focus();
            }
          }
        }
      });

      renderTags();
      tagField.append(tagLabel, tagRow);
      parent.append(tagField);

      // 관련 개념 필드
      const relField = document.createElement('div');
      relField.className = 'detail-field';
      const relLabel = document.createElement('label');
      relLabel.className = 'detail-label';
      relLabel.textContent = '관련 개념 (최대 10개)';

      const relInput = document.createElement('input');
      relInput.className = 'detail-input';
      relInput.type = 'text';
      relInput.placeholder = '관련 개념 입력 후 선택';

      const acList = document.createElement('ul');
      acList.className = 'detail-ac-list';
      acList.hidden = true;

      const chipList = document.createElement('div');
      chipList.className = 'detail-chips';

      const relatedSet = new Set((concept.related || []).map((r) => r.name));
      const existingNames = conceptsList.filter((c) => c.id !== concept.id).map((c) => c.name);

      function renderChips() {
        chipList.replaceChildren();
        for (const name of relatedSet) {
          const chip = document.createElement('span');
          chip.className = 'detail-chip';
          chip.textContent = name;
          const delBtn = document.createElement('button');
          delBtn.className = 'detail-chip-del';
          delBtn.type = 'button';
          delBtn.textContent = '×';
          delBtn.onclick = () => {
            relatedSet.delete(name);
            renderChips();
            triggerAutoSave();
          };
          chip.append(delBtn);
          chipList.append(chip);
        }
      }

      relInput.oninput = () => {
        const q = relInput.value.trim().toLowerCase();
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
          li.className = 'detail-ac-item';
          li.textContent = c;
          li.onmousedown = (e) => {
            e.preventDefault();
            if (relatedSet.size < 10) {
              relatedSet.add(c);
              renderChips();
              triggerAutoSave();
            }
            relInput.value = '';
            acList.hidden = true;
          };
          acList.append(li);
        }
        acList.hidden = false;
      };

      relInput.onblur = () => {
        setTimeout(() => {
          acList.hidden = true;
        }, 150);
      };

      renderChips();
      relField.append(relLabel, relInput, acList, chipList);
      parent.append(relField);

      // 상태 메시지
      if (statusMsg) {
        const msgEl = document.createElement('div');
        msgEl.className = `status-msg ${isError ? 'status-err' : ''}`;
        msgEl.textContent = statusMsg;
        parent.append(msgEl);
      }

      // 동작 버튼 줄 [저장] [지우기]
      const actions = document.createElement('div');
      actions.className = 'detail-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn-action btn-primary';
      saveBtn.type = 'button';
      saveBtn.textContent = '저장';

      // 저장 실행 함수: cleanForSave 적용, 진행 중이면 다음으로 미룸, 0.8초 디바운스
      async function doSave(opts = {}) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = 0;

        if (opts.closeOnSuccess) pendingCloseOnSuccess = true;
        if (opts.closePanelOnSuccess) pendingClosePanelOnSuccess = true;

        if (isSaving) {
          pendingSaveAgain = true;
          return;
        }

        const rawDef = defTextarea.value;
        const def = globalThis.readglossMdList?.cleanForSave
          ? globalThis.readglossMdList.cleanForSave(rawDef)
          : rawDef.trim();

        if (def.length > 500) {
          saveIndicator.textContent = '정의는 500자 이하여야 해요';
          saveIndicator.style.color = '#d1242f';
          return;
        }

        const core = globalThis.readglossConcept;
        const aliases = core?.parseAliases ? core.parseAliases(aliasInput.value) : [];

        isSaving = true;
        saveIndicator.textContent = '저장 중…';
        saveIndicator.style.color = 'var(--rg-muted, #656d76)';
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중…';

        const res = await send({
          type: 'concepts',
          op: 'save',
          id: concept.id,
          name: concept.name,
          aliases,
          tags: [...activeTags],
          definition: def,
          related: [...relatedSet],
        });

        isSaving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';

        if (res && !res.error) {
          isDirty = false;
          globalThis.readglossLastSave = { kind: 'concept', id: concept.id };
          window.dispatchEvent(new CustomEvent('readgloss:concepts-updated', { detail: { id: concept.id, fromDetail: true } }));

          saveIndicator.textContent = '저장됨';
          saveIndicator.style.color = 'var(--rg-muted, #656d76)';
          setTimeout(() => {
            if (saveIndicator.textContent === '저장됨') {
              saveIndicator.textContent = '';
            }
          }, 1500);

          if (pendingSaveAgain) {
            pendingSaveAgain = false;
            doSave();
            return;
          }

          if (pendingClosePanelOnSuccess) {
            pendingClosePanelOnSuccess = false;
            requestClosePanel();
            return;
          }

          if (pendingCloseOnSuccess) {
            pendingCloseOnSuccess = false;
            goToList();
            return;
          }
        } else {
          saveIndicator.textContent = res?.error || '저장하지 못했어요';
          saveIndicator.style.color = '#d1242f';
        }
      }

      function triggerAutoSave() {
        isDirty = true;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
          doSave();
        }, AUTO_SAVE_DELAY);
      }

      // 입력 변경 시 자동 저장 트리거
      defTextarea.addEventListener('input', triggerAutoSave);
      aliasInput.addEventListener('input', triggerAutoSave);

      saveBtn.onclick = () => doSave();

      // Esc: 대기 중 저장을 즉시 보내고 상세를 닫는다 (목록으로). ⌘Enter: 즉시 저장 + 패널 닫기 (15-3)
      function onDetailKeyDown(e) {
        if (!pane.isConnected) {
          window.removeEventListener('keydown', onDetailKeyDown, true);
          return;
        }
        if (currentView !== 'detail' || selectedConceptId !== concept.id) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const isInsidePanel = path.some((el) => (el?.localName || el?.tagName || '').toLowerCase() === 'readgloss-ui');
        if (!isInsidePanel) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (isDirty || autoSaveTimer || isSaving) {
            doSave({ closeOnSuccess: true });
          } else {
            goToList();
          }
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          doSave({ closePanelOnSuccess: true });
        }
      }

      if (detailKeyHandler) window.removeEventListener('keydown', detailKeyHandler, true);
      detailKeyHandler = onDetailKeyDown;
      window.addEventListener('keydown', detailKeyHandler, true);

      // focusNew: true로 상세가 열리면 설명 칸 끝에 새 '- '를 넣고 커서 배치 (15-3)
      if (focusNewOnLoad) {
        focusNewOnLoad = false;
        setTimeout(() => applyDetailFocusNew(defTextarea), 0);
      }

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-action btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = '지우기';
      delBtn.onclick = async () => {
        delBtn.disabled = true;
        delBtn.textContent = '지우는 중…';

        const res = await send({
          type: 'concepts',
          op: 'remove',
          id: concept.id,
        });

        if (res && !res.error) {
          window.dispatchEvent(new CustomEvent('readgloss:concepts-updated'));
          currentView = 'list';
          selectedConceptId = null;
          statusMsg = '';
          await loadConcepts();
        } else {
          delBtn.disabled = false;
          delBtn.textContent = '지우기';
          statusMsg = res?.error || '지우지 못했어요';
          isError = true;
          draw();
        }
      };

      actions.append(saveBtn, delBtn);
      parent.append(actions);

      // 나온 곳 목록
      const appears = Array.isArray(concept.appears) ? concept.appears : [];
      if (appears.length > 0) {
        const appearsSection = document.createElement('div');
        appearsSection.className = 'appears-section';

        const appearsTitle = document.createElement('div');
        appearsTitle.className = 'appears-title';
        appearsTitle.textContent = `나온 곳 (${appears.length}개)`;
        appearsSection.append(appearsTitle);

        for (const a of appears) {
          const card = document.createElement('div');
          card.className = 'appear-card';

          const pathEl = document.createElement('div');
          pathEl.className = 'appear-path';
          const taskText = a.taskTitle || a.task || '인박스';
          const titleText = a.title || '페이지';
          pathEl.textContent = `${taskText} › ${titleText}`;

          const sentEl = document.createElement('div');
          sentEl.className = 'appear-sentence';
          sentEl.textContent = a.exact ? `“${a.exact}”` : '';

          card.append(pathEl, sentEl);

          card.onclick = () => {
            const currentUrl = location.href;
            const core = globalThis.readglossScrap;
            const normCur = core?.normalizeUrl ? core.normalizeUrl(currentUrl) : currentUrl;
            const normTarget = core?.normalizeUrl ? core.normalizeUrl(a.url) : a.url;

            if (normCur && normTarget && normCur === normTarget) {
              // 같은 페이지면 scrollTo
              globalThis.readglossScrapPage?.scrollTo(a.scrapId);
            } else {
              // 다른 페이지면 scrap-jump
              chrome.runtime.sendMessage({
                type: 'scrap-jump',
                url: a.url,
                id: a.scrapId,
                task: a.task,
              });
            }
          };

          appearsSection.append(card);
        }

        parent.append(appearsSection);
      }
    }

    if (currentView === 'detail') draw(); // 상세로 열 때는 바로 "불러오는 중"을 보인다
    loadConcepts();
  }

  // 탭 등록: id 'concepts', 제목 '개념', order 23
  (globalThis.readglossPanelTabs ||= []).push({
    id: 'concepts',
    title: '개념',
    order: 23,
    render,
  });

  // 브라우저 및 테스트(Node) 환경 노출
  if (typeof globalThis !== 'undefined') {
    globalThis.readglossConceptRefresh = { latestOnly };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { latestOnly };
  }
})();
