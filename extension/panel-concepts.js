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

  let pendingOpenConceptId = null;
  let rerenderCurrentTab = null;

  // 패널 열기 시 conceptId 전달 받음
  window.addEventListener('readgloss:open-panel', (e) => {
    if (e.detail?.conceptId) {
      pendingOpenConceptId = e.detail.conceptId;
      if (typeof rerenderCurrentTab === 'function') {
        rerenderCurrentTab(pendingOpenConceptId);
      }
    }
  });

  function render(pane) {
    let conceptsList = [];
    let currentView = 'list'; // 'list' | 'detail'
    let selectedConceptId = pendingOpenConceptId || null;
    pendingOpenConceptId = null;
    let searchQuery = '';
    let statusMsg = '';
    let isError = false;

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

    async function loadConcepts() {
      const res = await send({ type: 'concepts', op: 'get' });
      if (res && Array.isArray(res.concepts)) {
        conceptsList = res.concepts;
        // 이름순 정렬
        conceptsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      } else {
        conceptsList = [];
      }
      draw();
    }

    rerenderCurrentTab = (conceptId) => {
      selectedConceptId = conceptId;
      currentView = 'detail';
      statusMsg = '';
      draw();
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
        if (!q) return true;
        if ((c.name || '').toLowerCase().includes(q)) return true;
        if (Array.isArray(c.aliases) && c.aliases.some((a) => a.toLowerCase().includes(q))) return true;
        if ((c.definition || '').toLowerCase().includes(q)) return true;
        return false;
      });

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
        def.textContent = c.definition || '';

        item.append(head, def);
        container.append(item);
      }
    }

    // --- 상세 화면 ---
    function renderDetailView(parent) {
      const concept = conceptsList.find((c) => c.id === selectedConceptId);
      if (!concept) {
        currentView = 'list';
        renderListView(parent);
        return;
      }

      // 상단 뒤로가기
      const nav = document.createElement('div');
      nav.className = 'detail-nav';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn-back';
      backBtn.type = 'button';
      backBtn.textContent = '← 목록';
      backBtn.onclick = () => {
        currentView = 'list';
        selectedConceptId = null;
        statusMsg = '';
        draw();
      };
      nav.append(backBtn);
      parent.append(nav);

      // 개념 제목
      const title = document.createElement('div');
      title.className = 'detail-title';
      title.textContent = concept.name;
      parent.append(title);

      // 정의 필드
      const defField = document.createElement('div');
      defField.className = 'detail-field';
      const defLabel = document.createElement('label');
      defLabel.className = 'detail-label';
      defLabel.textContent = '정의 (1~500자)';
      const defTextarea = document.createElement('textarea');
      defTextarea.className = 'detail-textarea';
      defTextarea.rows = 4;
      defTextarea.maxLength = 500;
      defTextarea.value = concept.definition || '';
      defField.append(defLabel, defTextarea);
      parent.append(defField);

      // 별칭 필드
      const aliasField = document.createElement('div');
      aliasField.className = 'detail-field';
      const aliasLabel = document.createElement('label');
      aliasLabel.className = 'detail-label';
      aliasLabel.textContent = '별칭 (쉼표로 구분, 최대 5개)';
      const aliasInput = document.createElement('input');
      aliasInput.className = 'detail-input';
      aliasInput.type = 'text';
      aliasInput.value = Array.isArray(concept.aliases) ? concept.aliases.join(', ') : '';
      aliasField.append(aliasLabel, aliasInput);
      parent.append(aliasField);

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
      saveBtn.onclick = async () => {
        const def = defTextarea.value.trim();
        if (!def || def.length > 500) {
          statusMsg = '정의는 1~500자여야 해요';
          isError = true;
          draw();
          return;
        }

        const core = globalThis.readglossConcept;
        const aliases = core?.parseAliases ? core.parseAliases(aliasInput.value) : [];

        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중…';

        const res = await send({
          type: 'concepts',
          op: 'save',
          id: concept.id,
          name: concept.name,
          aliases,
          definition: def,
          related: [...relatedSet],
        });

        saveBtn.disabled = false;
        saveBtn.textContent = '저장';

        if (res && !res.error) {
          statusMsg = '저장했어요';
          isError = false;
          window.dispatchEvent(new CustomEvent('readgloss:concepts-updated'));
          await loadConcepts();
        } else {
          statusMsg = res?.error || '저장하지 못했어요';
          isError = true;
          draw();
        }
      };

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

    loadConcepts();
  }

  // 탭 등록: id 'concepts', 제목 '개념', order 23
  (globalThis.readglossPanelTabs ||= []).push({
    id: 'concepts',
    title: '개념',
    order: 23,
    render,
  });
})();
