// "스크랩북" 패널 탭(T25). 순서 22.
// 할 일(제목 · 개수) → 페이지(제목, depth만큼 들여쓰기) → 소제목 → 문장(옅은 노랑 배경)·번역·메모. 맨 아래 "인박스".
// 지금 페이지의 스크랩 중 readglossScrapPage.found 에 없는 것은 "페이지에서 못 찾음".
// 스크랩마다 [할 일 바꾸기](guess 의 candidates + 인박스) [메모] [지우기].
// 문장 클릭 시 같은 페이지면 scrollTo + 깜빡임(1.2초) + 넘김 막대, 다른 페이지면 scrap-jump.
(() => {
  // ---- 순수 뷰 헬퍼 ----
  function isNotFound(scrap, currentUrl, foundSet) {
    if (!scrap || !scrap.url || !currentUrl) return false;
    const core = globalThis.readglossScrap;
    const normScrapUrl = core?.normalizeUrl ? core.normalizeUrl(scrap.url) : scrap.url;
    const normCurUrl = core?.normalizeUrl ? core.normalizeUrl(currentUrl) : currentUrl;
    if (normScrapUrl !== normCurUrl) return false;
    return !(foundSet && foundSet.has(scrap.id));
  }

  globalThis.readglossScrapPanel = {
    isNotFound,
  };

  const CSS = `
    .scraps-container {
      font-size: 13px;
      line-height: 1.5;
      color: var(--rg-text, #222);
      padding: 8px 12px;
    }
    .scraps-empty {
      color: var(--rg-muted, #777);
      text-align: center;
      padding: 32px 16px;
    }
    .task-group {
      margin-bottom: 20px;
    }
    .task-title {
      font-size: 14px;
      font-weight: 600;
      padding: 6px 0;
      border-bottom: 1px solid var(--rg-border, #eee);
      margin: 0 0 10px 0;
      color: var(--rg-text, #111);
    }
    .page-group {
      margin-bottom: 12px;
    }
    .page-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--rg-muted, #555);
      margin: 0 0 6px 0;
    }
    .section-headings {
      font-size: 12px;
      color: var(--rg-muted, #888);
      margin: 0 0 6px 0;
    }
    .scrap-card {
      background: var(--rg-card-bg, #fff);
      border: 1px solid var(--rg-border, #e5e5e5);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .scrap-sentence {
      background-color: #FAEEDA;
      color: #222;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-block;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .scrap-sentence:hover {
      filter: brightness(0.96);
    }
    .not-found-badge {
      display: inline-block;
      font-size: 11px;
      color: #c53030;
      background: #fed7d7;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .scrap-translation {
      font-size: 12px;
      color: var(--rg-text, #333);
      margin-top: 4px;
    }
    .scrap-memo {
      font-size: 12px;
      color: var(--rg-muted, #666);
      background: var(--rg-sub-bg, #f7f7f7);
      padding: 3px 6px;
      border-radius: 3px;
      margin-top: 4px;
      word-break: break-word;
    }
    .scrap-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      font-size: 11px;
    }
    .scrap-btn {
      background: none;
      border: 1px solid var(--rg-border, #ddd);
      border-radius: 3px;
      padding: 2px 6px;
      cursor: pointer;
      color: var(--rg-text, #444);
    }
    .scrap-btn:hover {
      background: var(--rg-hover, #f0f0f0);
    }
    .scrap-btn-danger:hover {
      background: #fee2e2;
      color: #b91c1c;
      border-color: #fca5a5;
    }
    .memo-form {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .memo-input {
      width: 100%;
      box-sizing: border-box;
      font-size: 12px;
      padding: 4px;
      border: 1px solid var(--rg-border, #ccc);
      border-radius: 3px;
      resize: vertical;
    }
    .task-select-form {
      margin-top: 6px;
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .task-select {
      font-size: 12px;
      padding: 2px 4px;
      border: 1px solid var(--rg-border, #ccc);
      border-radius: 3px;
      max-width: 180px;
    }
  `;

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) el.setAttribute(k, String(v));
    }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === 'string') el.append(document.createTextNode(c));
      else el.append(c);
    }
    return el;
  }

  function render(container, ctx) {
    if (typeof document === 'undefined') return;

    const root = h('div', { class: 'scraps-container' });
    const style = h('style', { text: CSS });
    container.replaceChildren(style, root);

    let state = { scraps: [], tasks: {} };
    let editingMemoId = null;
    let movingTaskId = null;
    let moveCandidates = [];

    const pageUrl = () => {
      const core = globalThis.readglossScrap;
      const raw = typeof location !== 'undefined' ? location.href : '';
      return core?.normalizeUrl ? core.normalizeUrl(raw) : raw;
    };

    async function loadData() {
      root.replaceChildren(h('div', { class: 'scraps-empty', text: '불러오는 중…' }));
      const res = await ctx.send({ type: 'scraps', op: 'get' });
      if (!res || res.error) {
        root.replaceChildren(h('div', { class: 'scraps-empty', text: '스크랩을 불러오지 못했어요.' }));
        return;
      }
      state = {
        scraps: Array.isArray(res.scraps) ? res.scraps : [],
        tasks: res.tasks && typeof res.tasks === 'object' ? res.tasks : {},
      };
      draw();
    }

    function onSentenceClick(scrap) {
      const cur = pageUrl();
      const targetUrl = globalThis.readglossScrap?.normalizeUrl ? globalThis.readglossScrap.normalizeUrl(scrap.url) : scrap.url;

      if (cur && targetUrl && cur === targetUrl) {
        // 같은 페이지면 스크롤 + 1.2초 깜빡임 + 넘김 막대
        globalThis.readglossScrapPage?.scrollTo?.(scrap.id);
        globalThis.readglossScrapPage?.openBar?.(scrap.id, scrap.task);
      } else {
        // 다른 페이지면 scrap-jump 메시지 전송
        chrome.runtime.sendMessage({
          type: 'scrap-jump',
          url: scrap.url,
          id: scrap.id,
          task: scrap.task,
        });
      }
    }

    async function onStartMove(scrap) {
      if (movingTaskId === scrap.id) {
        movingTaskId = null;
        draw();
        return;
      }
      movingTaskId = scrap.id;
      moveCandidates = [];
      draw();

      const guessRes = await ctx.send({ type: 'scraps', op: 'guess', url: scrap.url });
      const candidates = Array.isArray(guessRes?.candidates) ? guessRes.candidates : [];
      moveCandidates = candidates;
      draw();
    }

    async function onApplyMove(scrap, newTask) {
      movingTaskId = null;
      await ctx.send({
        type: 'scraps',
        op: 'move',
        id: scrap.id,
        task: newTask,
      });
      loadData();
    }

    async function onSaveMemo(scrap, memo) {
      editingMemoId = null;
      await ctx.send({
        type: 'scraps',
        op: 'memo',
        id: scrap.id,
        memo,
      });
      loadData();
    }

    async function onRemoveScrap(scrap) {
      await ctx.send({
        type: 'scraps',
        op: 'remove',
        id: scrap.id,
      });
      globalThis.readglossScrapPage?.unpaint?.(scrap.id);
      loadData();
    }

    function draw() {
      const core = globalThis.readglossScrap;
      if (!core?.buildTree) {
        root.replaceChildren(h('div', { class: 'scraps-empty', text: '스크랩 모듈을 불러오는 중…' }));
        return;
      }

      const tree = core.buildTree(state.scraps, state.tasks);
      if (!tree || tree.length === 0) {
        root.replaceChildren(h('div', { class: 'scraps-empty', text: '아직 스크랩한 문장이 없어요. 웹페이지에서 문장을 드래그한 뒤 카드에서 [스크랩]을 눌러 보세요.' }));
        return;
      }

      const curUrl = pageUrl();
      const foundSet = globalThis.readglossScrapPage?.found;

      const taskNodes = [];
      for (const group of tree) {
        const groupEl = h('div', { class: 'task-group' });
        const titleText = `${group.title} · ${group.count}개`;
        groupEl.append(h('h3', { class: 'task-title', text: titleText }));

        for (const page of group.pages) {
          const indent = Math.max(0, page.depth || 0) * 16;
          const pageEl = h('div', { class: 'page-group', style: `padding-left: ${indent}px;` });
          pageEl.append(h('div', { class: 'page-title', text: page.title || page.url }));

          for (const section of page.sections) {
            if (section.headings && section.headings.length > 0) {
              pageEl.append(h('div', { class: 'section-headings', text: section.headings.join(' › ') }));
            }

            for (const item of section.items) {
              const card = h('div', { class: 'scrap-card' });

              // 문장 및 못 찾음 표시
              const exactText = item.quote?.exact || '(인용문 없음)';
              const sentenceSpan = h('span', {
                class: 'scrap-sentence',
                text: exactText,
                title: '클릭하여 해당 위치로 이동',
                onclick: () => onSentenceClick(item),
              });
              card.append(sentenceSpan);

              if (isNotFound(item, curUrl, foundSet)) {
                card.append(h('span', { class: 'not-found-badge', text: '페이지에서 못 찾음' }));
              }

              // 번역
              if (item.translation) {
                card.append(h('div', { class: 'scrap-translation', text: item.translation }));
              }

              // 메모
              if (item.memo && editingMemoId !== item.id) {
                card.append(h('div', { class: 'scrap-memo', text: item.memo }));
              }

              // 메모 편집 폼
              if (editingMemoId === item.id) {
                const memoInput = h('textarea', { class: 'memo-input', rows: '2' });
                memoInput.value = item.memo || '';
                const saveMemoBtn = h('button', {
                  class: 'scrap-btn',
                  type: 'button',
                  text: '저장',
                  onclick: () => onSaveMemo(item, memoInput.value.trim()),
                });
                const cancelMemoBtn = h('button', {
                  class: 'scrap-btn',
                  type: 'button',
                  text: '취소',
                  onclick: () => {
                    editingMemoId = null;
                    draw();
                  },
                });
                const form = h('div', { class: 'memo-form' }, memoInput, h('div', { style: 'display:flex;gap:4px;' }, saveMemoBtn, cancelMemoBtn));
                card.append(form);
              }

              // 할 일 바꾸기 폼
              if (movingTaskId === item.id) {
                const select = h('select', { class: 'task-select' });

                // 후보 목록 구성 (candidates + 인박스)
                const options = [];
                const seenIds = new Set();
                for (const c of moveCandidates) {
                  if (c?.id && !seenIds.has(c.id)) {
                    seenIds.add(c.id);
                    options.push({ id: c.id, title: c.title || c.id });
                  }
                }
                options.push({ id: null, title: '인박스' });

                for (const opt of options) {
                  const optEl = h('option', { value: opt.id ?? '__inbox__' }, opt.title);
                  if ((opt.id ?? null) === (item.task ?? null)) {
                    optEl.selected = true;
                  }
                  select.append(optEl);
                }

                const moveOkBtn = h('button', {
                  class: 'scrap-btn',
                  type: 'button',
                  text: '변경',
                  onclick: () => {
                    const val = select.value === '__inbox__' ? null : select.value;
                    onApplyMove(item, val);
                  },
                });
                const moveCancelBtn = h('button', {
                  class: 'scrap-btn',
                  type: 'button',
                  text: '취소',
                  onclick: () => {
                    movingTaskId = null;
                    draw();
                  },
                });

                const moveForm = h('div', { class: 'task-select-form' }, select, moveOkBtn, moveCancelBtn);
                card.append(moveForm);
              }

              // 버튼 줄 [할 일 바꾸기] [메모] [지우기]
              const actions = h('div', { class: 'scrap-actions' },
                h('button', {
                  class: 'scrap-btn',
                  type: 'button',
                  text: '할 일 바꾸기',
                  onclick: () => onStartMove(item),
                }),
                h('button', {
                  class: 'scrap-btn',
                  type: 'button',
                  text: '메모',
                  onclick: () => {
                    editingMemoId = editingMemoId === item.id ? null : item.id;
                    draw();
                  },
                }),
                h('button', {
                  class: 'scrap-btn scrap-btn-danger',
                  type: 'button',
                  text: '지우기',
                  onclick: () => onRemoveScrap(item),
                })
              );
              card.append(actions);

              pageEl.append(card);
            }
          }

          groupEl.append(pageEl);
        }

        taskNodes.push(groupEl);
      }

      root.replaceChildren(...taskNodes);
    }

    loadData();
  }

  (globalThis.readglossPanelTabs ||= []).push({
    id: 'scraps',
    title: '스크랩북',
    order: 22,
    render,
  });
})();
