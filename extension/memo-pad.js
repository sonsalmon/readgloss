// 메모장(T29b): 브라우저 안 메모장 UI 및 동작 접착.
// Shadow DOM host: readgloss-memo-pad, 화면 오른쪽 아래 고정(가로 320px).
(() => {
  const HOST_TAG = 'readgloss-memo-pad';
  const FLASH_NAME = 'readgloss-scrap-flash';

  let host = null;
  let shadow = null;
  let isOpen = false;
  let currentMode = 'pad'; // 'pad' | 'list'
  let savedSelection = null; // 메모장을 열 때 기억한 선택 글
  let currentTask = null; // 짐작된 할 일 id
  let currentTaskTitle = ''; // 짐작된 할 일 제목
  let typingTimer = 0;
  let currentDraft = ''; // 쓰던 글 보관

  // content.js startsMemo 등에서 우리 메모장 입력 여부를 판정할 수 있도록 인터페이스 제공
  globalThis.readglossMemoPadUi = {
    isTyping: () => isOpen && currentMode === 'pad',
  };

  const STYLE_TEXT = `
    :host {
      all: initial;
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 320px;
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", sans-serif;
      font-size: 13px;
      line-height: 1.5;
      box-sizing: border-box;
      --bg: #fbfaf7;
      --fg: #222222;
      --mut: #666666;
      --card: #ffffff;
      --bd: #e3e0d8;
      --acc: #534AB7;
      --accbg: #EEEDFE;
      --danger: #d1242f;
      --danger-bg: #fee2e2;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #1b1b1a;
        --fg: #eeeeee;
        --mut: #aaaaaa;
        --card: #252524;
        --bd: #3a3936;
        --acc: #AFA9EC;
        --accbg: #26215C;
        --danger: #ff7b72;
        --danger-bg: rgba(209, 36, 47, 0.2);
      }
    }
    .pad-box {
      background: var(--card);
      color: var(--fg);
      border: 1px solid var(--acc);
      border-radius: 10px;
      padding: 10px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .meta {
      background: var(--accbg);
      color: var(--acc);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
      font-weight: 500;
      word-break: break-all;
      min-height: 18px;
      display: flex;
      align-items: center;
      transition: background 0.15s, color 0.15s;
    }
    .meta.success {
      background: #e6f4ea;
      color: #137333;
    }
    .meta.error {
      background: var(--danger-bg);
      color: var(--danger);
    }
    @media (prefers-color-scheme: dark) {
      .meta.success {
        background: #133924;
        color: #81c995;
      }
    }
    .pad-textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 74px;
      max-height: 220px;
      border: 1px solid var(--bd);
      border-radius: 6px;
      background: transparent;
      color: var(--fg);
      font: inherit;
      font-size: 13px;
      line-height: 1.5;
      padding: 6px 8px;
      resize: vertical;
      outline: none;
    }
    .pad-textarea:focus {
      border-color: var(--acc);
    }
    .mut {
      color: var(--mut);
      font-size: 11.5px;
      user-select: none;
      word-break: keep-all;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--bd);
      padding-bottom: 6px;
      margin-bottom: 4px;
    }
    .header-title {
      font-weight: 600;
      font-size: 13px;
    }
    .btn {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--bd);
      background: transparent;
      color: var(--fg);
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn:hover {
      background: var(--accbg);
      border-color: var(--acc);
      color: var(--acc);
    }
    .btn-danger:hover {
      background: var(--danger-bg);
      border-color: var(--danger);
      color: var(--danger);
    }
    .list-container {
      max-height: 280px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 2px;
    }
    .memo-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--bd);
      background: var(--bg);
      cursor: pointer;
      transition: border-color 0.1s;
    }
    .memo-item:hover {
      border-color: var(--acc);
    }
    .memo-info {
      min-width: 0;
      flex: 1;
      font-size: 12px;
      line-height: 1.4;
      word-break: break-all;
    }
    .memo-empty {
      color: var(--mut);
      text-align: center;
      padding: 24px 8px;
      font-size: 12.5px;
    }
    .toast-notice {
      position: absolute;
      top: -36px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      animation: fadeInOut 2s ease forwards;
    }
    @keyframes fadeInOut {
      0% { opacity: 0; transform: translate(-50%, 4px); }
      15% { opacity: 1; transform: translate(-50%, 0); }
      85% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -4px); }
    }
  `;

  function ensureHost() {
    if (!host) {
      host = document.createElement(HOST_TAG);
      shadow = host.attachShadow({ mode: 'open' });
      document.documentElement.append(host);
    }
    return shadow;
  }

  function removeHost() {
    if (host) {
      host.remove();
      host = null;
      shadow = null;
    }
  }

  // 안내 배너 잠깐 띄우기
  function showToastNotice(text) {
    if (globalThis.readglossToast?.show) {
      globalThis.readglossToast.show({ text });
      return;
    }
    if (!shadow) return;
    const notice = document.createElement('div');
    notice.className = 'toast-notice';
    notice.textContent = text;
    shadow.append(notice);
    setTimeout(() => notice.remove(), 2000);
  }

  // 지금 화면 위 1/3 선 이하 중 마지막 소제목 텍스트
  function getHeadingText() {
    const headings = [...document.querySelectorAll('h1, h2, h3')].map((h) => ({
      text: (h.textContent || '').replace(/\s+/g, ' ').trim(),
      top: h.getBoundingClientRect().top,
    })).filter((h) => h.text.length > 0);

    const memoCore = globalThis.readglossMemo;
    const cur = memoCore?.currentHeading ? memoCore.currentHeading(headings, window.innerHeight) : null;
    if (!cur) return '';
    return typeof cur === 'string' ? cur : cur.text || '';
  }

  // 맨 위 맥락 줄 구성: <할 일 제목> › <페이지 제목> › <지금 소제목> (없는 칸은 뺌)
  function buildMetaText() {
    const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
    const headingText = getHeadingText();
    const taskTitle = currentTaskTitle || '';

    const parts = [taskTitle, pageTitle, headingText].filter(Boolean);
    return parts.join(' › ');
  }

  // 화면 가운데 문단 및 para, pos 구하기
  function getCenterParagraph() {
    const scrapPage = globalThis.readglossScrapPage;
    const scrapCore = globalThis.readglossScrap;
    const memoCore = globalThis.readglossMemo;
    if (!scrapPage?.buildTextIndex || !scrapCore?.quoteOf) {
      return { para: null, pos: 0 };
    }

    const vh = window.innerHeight;
    const selector = 'p, li, blockquote, dd, td, h1, h2, h3, h4, h5, h6';
    const elements = [...document.querySelectorAll(selector)];
    const candidates = [];
    const blocks = [];

    for (const el of elements) {
      if (el.closest('pre') || el.closest('readgloss-memo-pad, readgloss-ui, readgloss-card, readgloss-toast, [data-readgloss]')) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < vh) {
        if ((el.textContent || '').trim().length > 0) {
          candidates.push(el);
          blocks.push({ top: rect.top, bottom: rect.bottom });
        }
      }
    }

    const chosenIdx = memoCore?.pickCenterBlock ? memoCore.pickCenterBlock(blocks, vh) : -1;
    if (chosenIdx === -1 || !candidates[chosenIdx]) {
      return { para: null, pos: 0 };
    }

    const chosenEl = candidates[chosenIdx];
    const { fullText, nodes } = scrapPage.buildTextIndex();
    if (!fullText || !nodes.length) return { para: null, pos: 0 };

    let startOffset = -1;
    let curr = chosenEl;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const walker = document.createTreeWalker(curr, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const item = nodes.find((n) => n.node === textNode);
        if (item) {
          startOffset = item.start;
          break;
        }
        textNode = walker.nextNode();
      }
      if (startOffset !== -1) break;
      curr = curr.parentElement;
    }

    if (startOffset === -1) {
      const mid = nodes[Math.floor(nodes.length / 2)];
      startOffset = mid ? mid.start : 0;
    }

    // 끝: 그 블록 글의 끝과 시작+300자 중 작은 쪽(블록을 넘어 옆 글을 가져오지 않게)
    let blockEnd = -1;
    for (const item of nodes) {
      if (chosenEl.contains(item.node) && item.end > blockEnd) blockEnd = item.end;
    }
    const endOffset = Math.min(blockEnd > startOffset ? blockEnd : fullText.length, startOffset + 300, fullText.length);
    const quote = scrapCore.quoteOf(fullText, startOffset, endOffset);
    const exact = memoCore?.centerParagraphText ? memoCore.centerParagraphText(quote.exact) : quote.exact.slice(0, 300);

    return {
      para: {
        exact,
        prefix: quote.prefix || '',
        suffix: quote.suffix || '',
      },
      pos: startOffset,
    };
  }

  // background 에 쓰던 글 저장
  function saveDraft(text) {
    currentDraft = text || '';
    chrome.runtime.sendMessage({
      type: 'memo-state-set',
      open: isOpen,
      text: currentDraft,
    });
  }

  const BRIDGE_OFF_TEXT = '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요';

  // 메모 저장 실행
  async function performSave() {
    if (!shadow) return false;
    const ta = shadow.querySelector('.pad-textarea');
    if (!ta) return false;
    const rawText = ta.value.trim();
    if (!rawText) return false; // 빈 글은 저장하지 않음

    const text = rawText.slice(0, 2000);
    const metaEl = shadow.querySelector('.meta');
    const headingText = getHeadingText();
    const headings = headingText ? [headingText.slice(0, 200)] : [];
    const pageTitle = (document.title || '').slice(0, 300);
    const currentUrl = location.href;
    const { para, pos } = getCenterParagraph();
    const selection = savedSelection || null;
    const task = currentTask || null;

    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'memos',
        op: 'save',
        text,
        url: currentUrl,
        title: pageTitle,
        headings,
        para,
        pos,
        selection,
        task,
      }, resolve);
    });

    if (res?.memo) {
      ta.value = '';
      currentDraft = '';
      saveDraft('');
      savedSelection = null; // 둘째 메모부터는 처음 열 때 고른 글을 다시 쓰지 않음
      if (metaEl) {
        metaEl.classList.remove('error');
        metaEl.classList.add('success');
        metaEl.textContent = '메모했어요';
        setTimeout(() => {
          if (metaEl && isOpen && currentMode === 'pad') {
            metaEl.classList.remove('success');
            metaEl.textContent = buildMetaText();
          }
        }, 1500);
      }
      return true;
    } else {
      const errMsg = res?.error === 'bridge-off' ? BRIDGE_OFF_TEXT : '저장하지 못했어요';
      if (metaEl) {
        metaEl.classList.remove('success');
        metaEl.classList.add('error');
        metaEl.textContent = errMsg;
      }
      return false;
    }
  }

  // 메모 위치로 이동 (같은 페이지면 스크롤+깜빡임, 다른 페이지면 memo-jump)
  function jumpToMemo(memo) {
    if (!memo) return;
    const memoCore = globalThis.readglossMemo;
    const scrapCore = globalThis.readglossScrap;
    const scrapPage = globalThis.readglossScrapPage;
    const curUrl = memoCore?.normalizeUrl ? memoCore.normalizeUrl(location.href) : location.href;
    const targetUrl = memoCore?.normalizeUrl ? memoCore.normalizeUrl(memo.url) : memo.url;

    if (curUrl && targetUrl && curUrl === targetUrl) {
      let found = false;
      if (memo.para && scrapPage?.buildTextIndex && scrapCore?.findQuote && scrapPage?.offsetToRange) {
        const { fullText, nodes } = scrapPage.buildTextIndex();
        const match = scrapCore.findQuote(fullText, memo.para, memo.pos);
        if (match) {
          const range = scrapPage.offsetToRange(nodes, match.start, match.end);
          if (range) {
            found = true;
            const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
              CSS.highlights.set(FLASH_NAME, new Highlight(range));
              setTimeout(() => {
                CSS.highlights.delete(FLASH_NAME);
              }, 1200);
            }
          }
        }
      }
      if (!found) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToastNotice('그 문단을 찾지 못했어요');
      }
    } else {
      chrome.runtime.sendMessage({
        type: 'memo-jump',
        url: memo.url,
        id: memo.id,
        para: memo.para,
        pos: memo.pos,
      });
    }
  }

  // 메모 지우기
  async function removeMemo(id, onDone) {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'memos', op: 'remove', id }, resolve);
    });
    if (res?.ok && typeof onDone === 'function') {
      onDone();
    }
  }

  // 작성 모드 렌더링
  function renderPadUI(root, initialText = '') {
    currentMode = 'pad';
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;

    const box = document.createElement('div');
    box.className = 'pad-box';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = buildMetaText();

    const ta = document.createElement('textarea');
    ta.className = 'pad-textarea';
    ta.maxLength = 2000;
    ta.placeholder = '메모할 내용을 적으세요...';
    ta.value = initialText || '';

    // 키 이벤트 격리: 페이지 및 다른 기능으로 새지 않게 함
    for (const evtName of ['keydown', 'keypress', 'keyup']) {
      box.addEventListener(evtName, (e) => e.stopPropagation());
    }

    ta.addEventListener('keydown', (e) => {
      const memoCore = globalThis.readglossMemo;
      const action = memoCore?.padKey ? memoCore.padKey(e) : null;

      if (action === 'save') {
        e.preventDefault();
        performSave();
      } else if (action === 'newline') {
        // Shift+Enter 는 기본 줄바꿈 허용
      } else if (action === 'fold') {
        e.preventDefault();
        closePad();
      } else if (e.altKey && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        openListUI(root);
      }
    });

    ta.addEventListener('input', () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        saveDraft(ta.value);
      }, 200);
    });

    const info = document.createElement('div');
    info.className = 'mut';
    info.textContent = 'Enter 저장 · Shift+Enter 줄바꿈 · Esc 접기 · ⌥⇧M 지난 메모';

    box.append(meta, ta, info);
    root.append(style, box);

    // 포커스
    setTimeout(() => ta.focus(), 0);
  }

  // 목록 모드 렌더링
  async function openListUI(root) {
    currentMode = 'list';
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;

    const box = document.createElement('div');
    box.className = 'pad-box';

    for (const evtName of ['keydown', 'keypress', 'keyup']) {
      box.addEventListener(evtName, (e) => e.stopPropagation());
    }

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePad();
      }
    });

    const header = document.createElement('div');
    header.className = 'header-row';

    const title = document.createElement('div');
    title.className = 'header-title';
    title.textContent = '지난 메모';

    const newBtn = document.createElement('button');
    newBtn.className = 'btn';
    newBtn.type = 'button';
    newBtn.textContent = '새 메모';
    newBtn.onclick = () => renderPadUI(root, currentDraft);

    header.append(title, newBtn);

    const listContainer = document.createElement('div');
    listContainer.className = 'list-container';
    listContainer.textContent = '불러오는 중…';

    box.append(header, listContainer);
    root.append(style, box);

    // ⌥⇧M 직후 목록에 포커스를 줌 (Esc가 바로 동작)
    box.tabIndex = -1;
    setTimeout(() => box.focus(), 0);

    // 다리에서 메모 목록 가져오기
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'memos', op: 'get' }, resolve);
    });

    const memoCore = globalThis.readglossMemo;
    const allMemos = Array.isArray(res?.memos) ? res.memos : [];
    const ordered = memoCore?.orderForList ? memoCore.orderForList(allMemos, location.href) : allMemos;

    if (!ordered.length) {
      listContainer.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'memo-empty';
      empty.textContent = '저장된 메모가 없어요.';
      listContainer.append(empty);
      return;
    }

    function renderListItems() {
      listContainer.replaceChildren();
      if (!ordered.length) {
        const empty = document.createElement('div');
        empty.className = 'memo-empty';
        empty.textContent = '저장된 메모가 없어요.';
        listContainer.append(empty);
        return;
      }
      for (const m of ordered) {
        const item = document.createElement('div');
        item.className = 'memo-item';

        const infoText = document.createElement('div');
        infoText.className = 'memo-info';
        const dateStr = memoCore?.formatDateMD ? memoCore.formatDateMD(m.ts) : '';
        const titleStr = m.title || m.url || '';
        const preview = memoCore?.previewText ? memoCore.previewText(m.text, 80) : m.text.slice(0, 80);
        infoText.textContent = `${dateStr} · ${titleStr} · ${preview}`;
        infoText.onclick = () => jumpToMemo(m);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger';
        delBtn.type = 'button';
        delBtn.textContent = '지우기';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          removeMemo(m.id, () => {
            const idx = ordered.indexOf(m);
            if (idx !== -1) ordered.splice(idx, 1);
            renderListItems();
          });
        };

        item.append(infoText, delBtn);
        listContainer.append(item);
      }
    }

    renderListItems();
  }

  // 할 일 짐작 요청
  function fetchTaskGuess() {
    chrome.runtime.sendMessage({ type: 'scraps', op: 'guess', url: location.href }, (r) => {
      if (chrome.runtime.lastError || !r) return;
      if (r.ask === true) {
        currentTask = null;
        currentTaskTitle = '';
      } else {
        currentTask = r.task || null;
        const matched = r.candidates?.find((c) => c.id === r.task);
        currentTaskTitle = matched ? matched.title : (r.task || '');
      }
      if (shadow && isOpen && currentMode === 'pad') {
        const meta = shadow.querySelector('.meta');
        if (meta && !meta.classList.contains('success')) {
          meta.textContent = buildMetaText();
        }
      }
    });
  }

  // 메모장 열기
  function openPad(initialText) {
    isOpen = true;
    savedSelection = window.getSelection()?.toString()?.trim()?.slice(0, 1000) || null;
    fetchTaskGuess();
    const root = ensureHost();
    const text = initialText !== undefined ? initialText : currentDraft;
    currentDraft = text;
    renderPadUI(root, text);
    chrome.runtime.sendMessage({ type: 'memo-state-set', open: true, text });
  }

  // 메모장 접기(닫기)
  function closePad() {
    clearTimeout(typingTimer);
    if (shadow && currentMode === 'pad') {
      const ta = shadow.querySelector('.pad-textarea');
      if (ta) currentDraft = ta.value;
    }
    isOpen = false;
    currentMode = 'pad';
    removeHost();
    chrome.runtime.sendMessage({ type: 'memo-state-set', open: false, text: currentDraft });
  }

  // 목록 모드로 열기
  function openList() {
    clearTimeout(typingTimer);
    if (shadow && currentMode === 'pad') {
      const ta = shadow.querySelector('.pad-textarea');
      if (ta) currentDraft = ta.value;
    }
    isOpen = true;
    const root = ensureHost();
    openListUI(root);
    chrome.runtime.sendMessage({ type: 'memo-state-set', open: true, text: currentDraft });
  }

  // 다른 페이지에서 점프해 온 경우 (memo-pending 확인)
  function checkPendingMemoOnLoad() {
    if (typeof location === 'undefined') return;
    chrome.runtime.sendMessage({ type: 'memo-pending' }, (res) => {
      if (chrome.runtime.lastError || !res?.pending) return;
      const pending = res.pending;
      const memoCore = globalThis.readglossMemo;
      const cur = memoCore?.normalizeUrl ? memoCore.normalizeUrl(location.href) : location.href;
      const target = memoCore?.normalizeUrl ? memoCore.normalizeUrl(pending.url) : pending.url;
      if (cur && target && cur === target) {
        jumpToMemo(pending);
      }
    });
  }

  // 페이지 로드 시 탭별 세션 상태 복원
  function restoreStateOnLoad() {
    chrome.runtime.sendMessage({ type: 'memo-state-get' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (typeof res.text === 'string') {
        currentDraft = res.text;
      }
      if (res.open === true) {
        openPad(res.text || '');
      }
    });
  }

  // 단축키 커맨드(memo-open, memo-list) 메시지 리스너
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'memo-command') return;
    const cmd = msg.cmd;

    if (cmd === 'memo-open') {
      if (isOpen && currentMode === 'pad') {
        performSave(); // 성공하면 performSave 가 글을 비우고, 실패하면 글을 그대로 둔다
      } else if (isOpen && currentMode === 'list') {
        if (shadow) renderPadUI(shadow, currentDraft);
      } else {
        openPad();
      }
    } else if (cmd === 'memo-list') {
      openList();
    }
  });

  // 초기화
  function initMemoPad() {
    checkPendingMemoOnLoad();
    restoreStateOnLoad();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initMemoPad, { once: true });
    } else {
      initMemoPad();
    }
  }
})();
