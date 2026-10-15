// 메모장(T29b): 브라우저 안 메모장 UI 및 동작 접착.
// Shadow DOM host: readgloss-memo-pad, 화면 오른쪽 아래(기본 320x360) 또는 기억된 위치.
(() => {
  const HOST_TAG = 'readgloss-memo-pad';
  const FLASH_NAME = 'readgloss-scrap-flash';
  const DEFAULT_WIDTH = 320;
  const DEFAULT_HEIGHT = 360;
  const MARGIN = 24;

  function getDefaultAnchored() {
    return {
      ax: 'right',
      x: MARGIN,
      ay: 'bottom',
      y: MARGIN,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
  }

  function getDefaultRect() {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const memoCore = globalThis.readglossMemo;
    if (memoCore?.fromAnchored) {
      return memoCore.fromAnchored(getDefaultAnchored(), { vw, vh });
    }
    const left = Math.max(0, vw - DEFAULT_WIDTH - MARGIN);
    const top = Math.max(0, vh - DEFAULT_HEIGHT - MARGIN);
    return { left, top, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }

  let savedAnchored = getDefaultAnchored();
  let currentRect = getDefaultRect();

  function applyAnchored(anchored) {
    if (!anchored) return;
    const memoCore = globalThis.readglossMemo;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

    let target = anchored;
    if (!target.ax || !target.ay) {
      target = memoCore?.toAnchored ? memoCore.toAnchored(target, { vw, vh }) : target;
    }

    const clamped = memoCore?.fromAnchored
      ? memoCore.fromAnchored(target, { vw, vh })
      : (memoCore?.clampRect ? memoCore.clampRect(target, { vw, vh }) : target);
    currentRect = clamped;

    if (!host) return;

    host.style.position = 'fixed';
    host.style.width = `${clamped.width}px`;
    host.style.height = `${clamped.height}px`;

    const rawLeft = target.ax === 'right' ? vw - target.width - target.x : target.x;
    const rawTop = target.ay === 'bottom' ? vh - target.height - target.y : target.y;

    const isClampedX = clamped.left !== rawLeft || clamped.width !== target.width;
    const isClampedY = clamped.top !== rawTop || clamped.height !== target.height;

    if (isClampedX) {
      host.style.left = `${clamped.left}px`;
      host.style.right = 'auto';
    } else if (target.ax === 'right') {
      host.style.right = `${target.x}px`;
      host.style.left = 'auto';
    } else {
      host.style.left = `${target.x}px`;
      host.style.right = 'auto';
    }

    if (isClampedY) {
      host.style.top = `${clamped.top}px`;
      host.style.bottom = 'auto';
    } else if (target.ay === 'bottom') {
      host.style.bottom = `${target.y}px`;
      host.style.top = 'auto';
    } else {
      host.style.top = `${target.y}px`;
      host.style.bottom = 'auto';
    }
  }

  function applyRect(rect) {
    if (!rect) return;
    const memoCore = globalThis.readglossMemo;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const clamped = memoCore?.clampRect ? memoCore.clampRect(rect, { vw, vh }) : rect;
    currentRect = clamped;
    if (host) {
      host.style.position = 'fixed';
      host.style.left = `${clamped.left}px`;
      host.style.top = `${clamped.top}px`;
      host.style.width = `${clamped.width}px`;
      host.style.height = `${clamped.height}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
  }

  function finalizeRect() {
    const memoCore = globalThis.readglossMemo;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const clamped = memoCore?.clampRect ? memoCore.clampRect(currentRect, { vw, vh }) : currentRect;
    currentRect = clamped;
    if (memoCore?.toAnchored) {
      savedAnchored = memoCore.toAnchored(clamped, { vw, vh });
    }
    applyAnchored(savedAnchored);
    if (chrome?.storage?.local?.set) {
      chrome.storage.local.set({ memoPadRect: savedAnchored });
    }
  }

  function loadAndApplyRect(callback) {
    if (chrome?.storage?.local?.get) {
      chrome.storage.local.get(['memoPadRect'], (items) => {
        if (!chrome.runtime?.lastError && items?.memoPadRect) {
          const stored = items.memoPadRect;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
          const memoCore = globalThis.readglossMemo;
          if (!stored.ax || !stored.ay) {
            savedAnchored = memoCore?.toAnchored ? memoCore.toAnchored(stored, { vw, vh }) : stored;
          } else {
            savedAnchored = stored;
          }
          applyAnchored(savedAnchored);
        } else {
          savedAnchored = getDefaultAnchored();
          applyAnchored(savedAnchored);
        }
        if (typeof callback === 'function') callback();
      });
    } else {
      savedAnchored = savedAnchored || getDefaultAnchored();
      applyAnchored(savedAnchored);
      if (typeof callback === 'function') callback();
    }
  }

  function attachDragHandle(metaEl) {
    if (!metaEl) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    metaEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
      const memoCore = globalThis.readglossMemo;
      if (memoCore?.fromAnchored) {
        currentRect = memoCore.fromAnchored(savedAnchored, { vw, vh });
      }
      startLeft = currentRect.left;
      startTop = currentRect.top;
      try {
        metaEl.setPointerCapture(e.pointerId);
      } catch {}
      document.documentElement.style.userSelect = 'none';
    });

    metaEl.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      e.stopPropagation();
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      applyRect({
        left: startLeft + dx,
        top: startTop + dy,
        width: currentRect.width,
        height: currentRect.height,
      });
    });

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      e.stopPropagation();
      try {
        metaEl.releasePointerCapture(e.pointerId);
      } catch {}
      document.documentElement.style.userSelect = '';
      finalizeRect();
    };

    metaEl.addEventListener('pointerup', onPointerUp);
    metaEl.addEventListener('pointercancel', onPointerUp);

    for (const evt of ['mousedown', 'mousemove', 'mouseup', 'click']) {
      metaEl.addEventListener(evt, (e) => e.stopPropagation());
    }
  }

  function createResizeHandle() {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.textContent = '◢';
    handle.setAttribute('aria-label', '크기 조절');

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
      const memoCore = globalThis.readglossMemo;
      if (memoCore?.fromAnchored) {
        currentRect = memoCore.fromAnchored(savedAnchored, { vw, vh });
      }
      startW = currentRect.width;
      startH = currentRect.height;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}
      document.documentElement.style.userSelect = 'none';
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      e.stopPropagation();
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      applyRect({
        left: currentRect.left,
        top: currentRect.top,
        width: startW + dx,
        height: startH + dy,
      });
    });

    const onPointerUp = (e) => {
      if (!isResizing) return;
      isResizing = false;
      e.stopPropagation();
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}
      document.documentElement.style.userSelect = '';
      finalizeRect();
    };

    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);

    for (const evt of ['mousedown', 'mousemove', 'mouseup', 'click']) {
      handle.addEventListener(evt, (e) => e.stopPropagation());
    }

    return handle;
  }

  let resizeDebounceTimer = 0;
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        if (isOpen && host) {
          applyAnchored(savedAnchored);
        }
      }, 200);
    });
  }

  let host = null;
  let shadow = null;
  let isOpen = false;
  let currentMode = 'pad'; // 'pad' | 'list'
  let quotes = {}; // 소제목 key별 인용 보관 { [key]: { exact, prefix, suffix } }
  let currentTask = null; // 짐작된 할 일 id
  let currentTaskTitle = ''; // 짐작된 할 일 제목
  let typingTimer = 0;
  let drafts = {}; // 소제목 key별 쓰던 글 보관 { [key]: string }
  let editingMemo = null; // 다시 열기로 가져온 메모 { id, sectionKey } — 그 칸의 ⌘Enter 가 고침(edit)으로 보낸다
  let currentHeadings = []; // [{ key, text, level, el }]
  let currentMemos = []; // 이 페이지의 저장된 메모 목록
  let currentActiveKey = '_page'; // 현재 활성화된 소제목 key
  let lastTypedAt = 0; // 쓰는 칸에 마지막으로 입력한 시각(ms)
  let lastHeadingsCount = -1; // MutationObserver 개수 비교용
  let mutationDebounceTimer = 0;
  let observer = null;
  let lastScrollTime = 0;
  let scrollTimeout = 0;

  // content.js startsMemo 등에서 우리 메모장 입력 여부를 판정할 수 있도록 인터페이스 제공
  globalThis.readglossMemoPadUi = {
    isTyping: () => isOpen && currentMode === 'pad',
    reopen: (id) => reopenMemo(id),
  };

  const STYLE_TEXT = `
    :host {
      all: initial;
      position: fixed;
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
      position: relative;
      background: var(--card);
      color: var(--fg);
      border: 1px solid var(--acc);
      border-radius: 10px;
      padding: 10px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
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
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    .meta:active {
      cursor: grabbing;
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
    .sections-container {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      padding-right: 2px;
      gap: 2px;
    }
    .sec {
      padding: 6px 8px;
      border-top: 1px dashed var(--bd);
      border-radius: 6px;
      transition: background 0.15s;
      margin-bottom: 2px;
      box-sizing: border-box;
    }
    .sec:first-child {
      border-top: none;
    }
    .sec.on {
      background: var(--accbg);
    }
    .sec-title {
      font-size: 12px;
      color: var(--mut);
      font-weight: 600;
      margin-bottom: 4px;
      word-break: break-all;
    }
    .sec.on .sec-title {
      color: var(--acc);
    }
    .sec-memos {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 2px 0 4px 8px;
    }
    .sec-memo-line {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 4px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.4;
      word-break: break-all;
    }
    .sec-memo-line:hover {
      background: rgba(0, 0, 0, 0.05);
    }
    @media (prefers-color-scheme: dark) {
      .sec-memo-line:hover {
        background: rgba(255, 255, 255, 0.07);
      }
    }
    .sec-memo-text {
      flex: 1;
      min-width: 0;
    }
    .btn-del {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      font-size: 11px;
      color: var(--mut);
      padding: 0 4px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .btn-del:hover {
      color: var(--danger);
      background: var(--danger-bg);
    }
    .sec-quote {
      background: #FAEEDA;
      color: #633806;
      border-radius: 6px;
      padding: 4px 8px;
      margin: 2px 0 4px 8px;
      font-size: 12px;
      line-height: 1.4;
      display: flex;
      align-items: flex-start;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      box-sizing: border-box;
      width: calc(100% - 8px);
    }
    @media (prefers-color-scheme: dark) {
      .sec-quote {
        background: #412402;
        color: #FAC775;
      }
    }
    .sec-quote-text {
      flex: 1;
      min-width: 0;
      word-break: break-all;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .sec-quote.expanded .sec-quote-text {
      display: block;
      -webkit-line-clamp: unset;
      overflow: visible;
    }
    .sec-quote-del {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 0 2px;
      color: inherit;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .sec-quote-del:hover {
      opacity: 1;
    }
    .sec-memo-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .sec-memo-quote-line {
      background: #FAEEDA;
      color: #633806;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      line-height: 1.3;
      cursor: pointer;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-all;
      user-select: none;
    }
    @media (prefers-color-scheme: dark) {
      .sec-memo-quote-line {
        background: #412402;
        color: #FAC775;
      }
    }
    .sec-memo-quote-line:hover {
      opacity: 0.85;
    }
    .sec-textarea {
      width: calc(100% - 8px);
      box-sizing: border-box;
      min-height: 32px;
      border: 1px solid var(--bd);
      border-radius: 6px;
      background: var(--card);
      color: var(--fg);
      font: inherit;
      font-size: 12.5px;
      line-height: 1.4;
      padding: 4px 6px;
      margin: 2px 0 2px 8px;
      resize: none;
      outline: none;
      overflow-y: hidden;
      display: block;
    }
    .sec-textarea:focus {
      border-color: var(--acc);
    }
    .pad-textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 74px;
      border: 1px solid var(--bd);
      border-radius: 6px;
      background: transparent;
      color: var(--fg);
      font: inherit;
      font-size: 13px;
      line-height: 1.5;
      padding: 6px 8px;
      resize: none;
      outline: none;
      flex: 1;
    }
    .pad-textarea:focus {
      border-color: var(--acc);
    }
    .mut {
      color: var(--mut);
      font-size: 11.5px;
      user-select: none;
      word-break: keep-all;
      padding-right: 16px;
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
      flex: 1;
      min-height: 0;
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
    .resize-handle {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 14px;
      height: 14px;
      font-size: 11px;
      line-height: 14px;
      text-align: center;
      color: var(--mut);
      cursor: nwse-resize;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }
    .resize-handle:hover {
      color: var(--acc);
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
      applyAnchored(savedAnchored);
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

  // 메모장 위에 안내 배너 띄우기
  function showPadToastNotice(text, duration = 1500) {
    if (!shadow) return;
    const notice = document.createElement('div');
    notice.className = 'toast-notice';
    notice.textContent = text;
    notice.style.animationDuration = `${duration}ms`;
    shadow.append(notice);
    setTimeout(() => notice.remove(), duration);
  }

  // 페이지 소제목 모으기: 본문의 h1~h3(우리 노드 및 숨은 요소 제외)
  function collectHeadings() {
    const headings = [];
    const elements = document.querySelectorAll('h1, h2, h3');
    let seq = 0;
    for (const el of elements) {
      if (el.closest('[data-readgloss], readgloss-memo-pad, readgloss-ui, readgloss-card, readgloss-toast')) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const level = parseInt(el.tagName.slice(1), 10) || 1;
      const key = `h${seq}:${text.slice(0, 40)}`;
      headings.push({ key, text, level, el });
      seq++;
    }
    return headings;
  }

  // 그 소제목까지의 사슬(앞선 상위 level 소제목들 + 그 소제목, ≤3)
  function getHeadingChain(headings, targetKey) {
    if (!Array.isArray(headings) || headings.length === 0) return [];
    const idx = headings.findIndex((h) => h.key === targetKey);
    if (idx === -1) return [];
    const current = headings[idx];
    const chain = [current.text];
    let currentLevel = current.level;
    for (let i = idx - 1; i >= 0; i--) {
      if (headings[i].level < currentLevel) {
        chain.unshift(headings[i].text);
        currentLevel = headings[i].level;
        if (currentLevel === 1) break;
      }
    }
    return chain.slice(-3).map((t) => t.slice(0, 200));
  }

  // 맨 위 맥락 줄 구성: <할 일 제목> › <페이지 제목> (없는 칸은 뺌)
  function buildMetaText() {
    const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
    const taskTitle = currentTaskTitle || '';
    const parts = [taskTitle, pageTitle].filter(Boolean);
    return parts.join(' › ') || '메모장';
  }

  // 소제목 바로 아래 첫 문단 구하기
  function getParagraphAfterHeading(headingEl) {
    if (!headingEl) return null;
    const scrapPage = globalThis.readglossScrapPage;
    const scrapCore = globalThis.readglossScrap;
    const memoCore = globalThis.readglossMemo;
    if (!scrapPage?.buildTextIndex || !scrapCore?.quoteOf) {
      return null;
    }

    const selector = 'p, li, blockquote, dd, td';
    const candidates = document.querySelectorAll(selector);
    let chosenEl = null;

    for (const el of candidates) {
      if (el.closest('pre') || el.closest('[data-readgloss], readgloss-memo-pad, readgloss-ui, readgloss-card, readgloss-toast')) {
        continue;
      }
      if (headingEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        if ((el.textContent || '').trim().length > 0) {
          chosenEl = el;
          break;
        }
      }
    }

    if (!chosenEl) return null;

    const { fullText, nodes } = scrapPage.buildTextIndex();
    if (!fullText || !nodes.length) return null;

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

    if (startOffset === -1) return null;

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
  function saveDrafts() {
    chrome.runtime.sendMessage({
      type: 'memo-state-set',
      open: isOpen,
      drafts,
      quotes,
      rect: currentRect,
      text: Object.values(drafts).find(Boolean) || '',
    });
  }

  const BRIDGE_OFF_TEXT = '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요';

  function showSuccessMeta(msg = '메모했어요') {
    if (!shadow) return;
    const metaEl = shadow.querySelector('.meta');
    if (metaEl) {
      metaEl.classList.remove('error');
      metaEl.classList.add('success');
      metaEl.textContent = msg;
      setTimeout(() => {
        if (metaEl && isOpen && currentMode === 'pad') {
          metaEl.classList.remove('success');
          metaEl.textContent = buildMetaText();
        }
      }, 1500);
    }
  }

  function showErrorMeta(msg = '저장하지 못했어요') {
    if (!shadow) return;
    const metaEl = shadow.querySelector('.meta');
    if (metaEl) {
      metaEl.classList.remove('success');
      metaEl.classList.add('error');
      metaEl.textContent = msg;
      setTimeout(() => {
        if (metaEl && isOpen && currentMode === 'pad') {
          metaEl.classList.remove('error');
          metaEl.textContent = buildMetaText();
        }
      }, 3000);
    }
  }

  // 메모 고치기(다시 열기 뒤): 칸 글로 그 메모 글을 바꾼다(다리 op edit)
  async function performEdit(sectionKey, ta) {
    const text = (ta.value || '').trim().slice(0, 2000);
    if (!text) return false; // 빈 글로는 고치지 않는다(다리가 거절한다)
    const id = editingMemo.id;
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'memos', op: 'edit', id, text }, resolve);
    });
    if (res?.memo) {
      const idx = currentMemos.findIndex((m) => m.id === id);
      if (idx !== -1) currentMemos[idx] = res.memo;
      editingMemo = null;
      ta.value = '';
      drafts[sectionKey] = '';
      saveDrafts();
      rebuildSectionsUI();
      showSuccessMeta('고쳤어요');
      return true;
    }
    const errMsg = res?.error === 'bridge-off' ? BRIDGE_OFF_TEXT : '저장하지 못했어요';
    showErrorMeta(errMsg);
    return false;
  }

  // Ctrl/⌘+Z 로 마지막 메모 다시 열기(15-2): 메모장을 열고 그 메모 글을 소제목 칸 쓰는 칸으로 가져와 고친다
  function reopenMemo(id) {
    if (!id) return;
    chrome.runtime.sendMessage({ type: 'memos', op: 'get', url: location.href }, (res) => {
      if (chrome.runtime.lastError || !res || !Array.isArray(res.memos)) return;
      const memo = res.memos.find((m) => m.id === id);
      if (!memo) {
        showToastNotice('이 페이지에서 그 메모를 찾지 못했어요');
        return;
      }
      currentMemos = res.memos;
      openPad();
      const memoCore = globalThis.readglossMemo;
      const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
      const sections = memoCore?.buildSections ? memoCore.buildSections(currentHeadings, currentMemos, pageTitle) : [];
      const key = sections.find((sec) => (sec.memos || []).some((m) => m.id === id))?.key || '_page';
      editingMemo = { id, sectionKey: key };
      currentActiveKey = key;
      drafts[key] = memo.text || '';
      const ta = shadow?.querySelector(`.sec[data-key="${CSS.escape(key)}"] .sec-textarea`);
      if (ta) {
        ta.value = memo.text || '';
        autoResize(ta);
      }
      applyActiveSection(true, true);
    });
  }

  // 소제목 칸 기준 메모 저장 실행
  async function performSave(sectionKey, ta) {
    if (!ta) return false;
    if (editingMemo && editingMemo.sectionKey === sectionKey) return performEdit(sectionKey, ta);
    const rawText = ta.value.trim();
    const memoCore = globalThis.readglossMemo;
    const canSaveFn = memoCore?.canSave;
    const currentQuote = quotes[sectionKey] || null;
    const allowable = canSaveFn ? canSaveFn(rawText, currentQuote) : (Boolean(rawText) || Boolean(currentQuote));
    if (!allowable) return false; // 빈 글이고 인용도 없으면 저장하지 않음

    const text = (rawText || '').slice(0, 2000); // 인용만 있는 메모는 빈 글로 보낸다(다리가 허용)
    const headingsChain = getHeadingChain(currentHeadings, sectionKey);

    let para = null;
    let pos = 0;
    const hObj = currentHeadings.find((h) => h.key === sectionKey);
    if (hObj?.el) {
      const pInfo = getParagraphAfterHeading(hObj.el);
      if (pInfo) {
        para = pInfo.para;
        pos = pInfo.pos;
      }
    }
    if (!para) {
      const center = getCenterParagraph();
      para = center.para;
      pos = center.pos;
    }

    const pageTitle = (document.title || '').slice(0, 300);
    const currentUrl = location.href;
    const quote = currentQuote ? {
      exact: currentQuote.exact.slice(0, 1000),
      prefix: (currentQuote.prefix || '').slice(0, 64),
      suffix: (currentQuote.suffix || '').slice(0, 64),
    } : null;
    const task = currentTask || null;

    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'memos',
        op: 'save',
        text,
        url: currentUrl,
        title: pageTitle,
        headings: headingsChain,
        para,
        pos,
        quote,
        task,
      }, resolve);
    });

    if (res?.memo) {
      ta.value = '';
      autoResize(ta);
      drafts[sectionKey] = '';
      delete quotes[sectionKey];
      saveDrafts();

      currentMemos.push(res.memo);

      // DOM에 즉시 반영
      if (shadow) {
        const secEl = shadow.querySelector(`.sec[data-key="${CSS.escape(sectionKey)}"]`);
        if (secEl) {
          const qEl = secEl.querySelector('.sec-quote');
          qEl?.remove();

          const memosContainer = secEl.querySelector('.sec-memos');
          if (memosContainer) {
            memosContainer.append(createMemoLine(res.memo, sectionKey));
          }
        }
      }

      globalThis.readglossLastSave = { kind: 'memo', id: res.memo.id };
      showSuccessMeta('메모했어요');
      return true;
    } else {
      const errMsg = res?.error === 'bridge-off' ? BRIDGE_OFF_TEXT : '저장하지 못했어요';
      showErrorMeta(errMsg);
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
      const targetQuote = memo.quote || memo.para;
      if (targetQuote && scrapPage?.buildTextIndex && scrapCore?.findQuote && scrapPage?.offsetToRange) {
        const { fullText, nodes } = scrapPage.buildTextIndex();
        const match = scrapCore.findQuote(fullText, targetQuote, memo.pos);
        if (match) {
          const range = scrapPage.offsetToRange(nodes, match.start, match.end);
          if (range) {
            found = true;
            const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
              globalThis.readglossScrapPage?.ensureStyle?.();
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
        quote: memo.quote,
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

  function autoResize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(32, ta.scrollHeight)}px`;
  }

  function createMemoLine(m, sectionKey) {
    const wrap = document.createElement('div');
    wrap.className = 'sec-memo-wrap';

    if (m.quote && typeof m.quote.exact === 'string' && m.quote.exact.length > 0) {
      const qLine = document.createElement('div');
      qLine.className = 'sec-memo-quote-line';
      qLine.textContent = `“${m.quote.exact}”`;
      qLine.title = '인용 자리로 이동';
      qLine.onclick = () => jumpToMemo(m);
      wrap.append(qLine);
    }

    const line = document.createElement('div');
    line.className = 'sec-memo-line';

    const textEl = document.createElement('div');
    textEl.className = 'sec-memo-text';
    textEl.textContent = m.text || '';
    textEl.onclick = () => jumpToMemo(m);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-del';
    delBtn.type = 'button';
    delBtn.textContent = '지우기';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      removeMemo(m.id, () => {
        const idx = currentMemos.findIndex((item) => item.id === m.id);
        if (idx !== -1) currentMemos.splice(idx, 1);
        wrap.remove();
      });
    };

    line.append(textEl, delBtn);
    wrap.append(line);
    return wrap;
  }

  // 메모장 안에서 그 칸이 보이게 scrollTop 직접 계산 스크롤
  function scrollToActiveSection(activeEl, container) {
    if (!activeEl || !container) return;
    const cRect = container.getBoundingClientRect();
    const aRect = activeEl.getBoundingClientRect();

    if (aRect.top < cRect.top) {
      container.scrollTop -= (cRect.top - aRect.top);
    } else if (aRect.bottom > cRect.bottom) {
      container.scrollTop += (aRect.bottom - cRect.bottom);
    }
  }

  // 현재 활성 칸 스타일 및 포커스 적용. force 는 입력 직후 제한을 무시한다(칸을 다시 그린 뒤).
  // 페이지 입력칸에 커서가 있으면 force 여도 커서를 옮기지 않는다(메모장 화면 스크롤만).
  function applyActiveSection(moveCaret = true, force = false) {
    if (!shadow || !isOpen || currentMode !== 'pad') return;
    const sections = shadow.querySelectorAll('.sec');
    for (const sec of sections) {
      sec.classList.toggle('on', sec.dataset.key === currentActiveKey);
    }

    const activeEl = shadow.querySelector(`.sec[data-key="${CSS.escape(currentActiveKey)}"]`);
    const container = shadow.querySelector('.sections-container');
    if (activeEl && container) {
      scrollToActiveSection(activeEl, container);
    }

    if (moveCaret && activeEl) {
      const memoCore = globalThis.readglossMemo;
      const now = Date.now();
      const allowMove = force || (memoCore?.shouldMoveCaret ? memoCore.shouldMoveCaret(lastTypedAt, now) : (now - lastTypedAt >= 1500));
      const pageFieldFocused = memoCore?.isPageField ? memoCore.isPageField(document.activeElement) : false;
      if (allowMove && !pageFieldFocused) {
        const ta = activeEl.querySelector('.sec-textarea');
        if (ta) {
          ta.focus();
          const len = ta.value.length;
          ta.setSelectionRange(len, len);
        }
      }
    }
  }

  // activeSectionKey 계산 후 변경 시 갱신
  function updateActiveSection(moveCaret = true) {
    if (!isOpen || currentMode !== 'pad') return;
    const memoCore = globalThis.readglossMemo;
    const headingTops = currentHeadings.map((h) => ({
      key: h.key,
      top: h.el.getBoundingClientRect().top,
    }));
    const newKey = memoCore?.activeSectionKey ? memoCore.activeSectionKey(headingTops, window.innerHeight) : (currentHeadings[0]?.key || '_page');
    if (newKey !== currentActiveKey) {
      currentActiveKey = newKey;
      applyActiveSection(moveCaret);
    }
  }

  // 소제목 목록 UI 다시 그리기 (입력 내용 유지)
  function rebuildSectionsUI() {
    if (!shadow || !isOpen || currentMode !== 'pad') return;
    const container = shadow.querySelector('.sections-container');
    const prevScrollTop = container ? container.scrollTop : 0;

    // 현재 각 textarea의 내용을 drafts에 동기화
    const textareas = shadow.querySelectorAll('.sec-textarea');
    for (const ta of textareas) {
      const sec = ta.closest('.sec');
      const key = sec?.dataset?.key;
      if (key) drafts[key] = ta.value;
    }

    renderPadUI(shadow);

    const newContainer = shadow.querySelector('.sections-container');
    if (newContainer) newContainer.scrollTop = prevScrollTop;

    // 다시 그리면 커서가 사라지므로 쓰는 칸에 다시 넣는다(같은 칸이어도)
    applyActiveSection(true, true);
  }

  // 소제목 목록 변경 감지 (h1~h3 개수가 바뀔 때만, 500ms 묶음)
  function setupMutationObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(() => {
      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        if (!isOpen || currentMode !== 'pad') return;
        const newHeadings = collectHeadings();
        if (newHeadings.length !== lastHeadingsCount) {
          lastHeadingsCount = newHeadings.length;
          currentHeadings = newHeadings;
          rebuildSectionsUI();
        }
      }, 500);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // 스크롤 따라가기 (100ms 묶음)
  function onScroll() {
    if (!isOpen || currentMode !== 'pad') return;
    const now = Date.now();
    const remaining = 100 - (now - lastScrollTime);
    if (remaining <= 0) {
      lastScrollTime = now;
      clearTimeout(scrollTimeout);
      scrollTimeout = 0;
      updateActiveSection(true);
    } else if (!scrollTimeout) {
      scrollTimeout = setTimeout(() => {
        lastScrollTime = Date.now();
        scrollTimeout = 0;
        updateActiveSection(true);
      }, remaining);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // 작성 모드 렌더링 (소제목 칸 목록)
  function renderPadUI(root) {
    currentMode = 'pad';
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;

    const box = document.createElement('div');
    box.className = 'pad-box';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = buildMetaText();
    attachDragHandle(meta);

    // 키 이벤트 격리: 페이지 및 다른 기능으로 새지 않게 함
    for (const evtName of ['keydown', 'keypress', 'keyup']) {
      box.addEventListener(evtName, (e) => e.stopPropagation());
    }

    const sectionsContainer = document.createElement('div');
    sectionsContainer.className = 'sections-container';

    const memoCore = globalThis.readglossMemo;
    const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
    const sections = memoCore?.buildSections
      ? memoCore.buildSections(currentHeadings, currentMemos, pageTitle)
      : [{ key: '_page', text: pageTitle, level: 1, memos: currentMemos }];

    for (const s of sections) {
      const sec = document.createElement('div');
      sec.className = 'sec';
      sec.dataset.key = s.key;
      if (s.key === currentActiveKey) {
        sec.classList.add('on');
      }

      // 소제목 글 (level에 따라 들여쓰기 0/8/16px)
      const titleEl = document.createElement('div');
      titleEl.className = 'sec-title';
      titleEl.textContent = s.text || '(제목 없음)';
      const indent = Math.max(0, Math.min(2, (s.level || 1) - 1)) * 8;
      titleEl.style.paddingLeft = `${indent}px`;
      sec.append(titleEl);

      // 그 아래 저장된 메모 줄들
      const memosContainer = document.createElement('div');
      memosContainer.className = 'sec-memos';
      if (Array.isArray(s.memos)) {
        for (const m of s.memos) {
          memosContainer.append(createMemoLine(m, s.key));
        }
      }
      sec.append(memosContainer);

      // 그 칸의 인용이 있으면 쓰는 칸 바로 위에 노란 인용 줄 표시
      const qData = quotes[s.key];
      if (qData && typeof qData.exact === 'string' && qData.exact.length > 0) {
        const quoteEl = document.createElement('div');
        quoteEl.className = 'sec-quote';

        const quoteText = document.createElement('div');
        quoteText.className = 'sec-quote-text';
        quoteText.textContent = `“${qData.exact}”`;

        const quoteDel = document.createElement('button');
        quoteDel.className = 'sec-quote-del';
        quoteDel.type = 'button';
        quoteDel.setAttribute('aria-label', '인용 뺌');
        quoteDel.textContent = '✕';
        quoteDel.onclick = (e) => {
          e.stopPropagation();
          delete quotes[s.key];
          saveDrafts();
          quoteEl.remove();
        };

        quoteEl.onclick = (e) => {
          if (e.target === quoteDel) return;
          quoteEl.classList.toggle('expanded');
        };

        quoteEl.append(quoteText, quoteDel);
        sec.append(quoteEl);
      }

      // 맨 끝 쓰는 칸(textarea, 자동 높이)
      const ta = document.createElement('textarea');
      ta.className = 'sec-textarea';
      ta.maxLength = 2000;
      ta.placeholder = '메모할 내용을 적으세요...';
      ta.value = drafts[s.key] || '';
      autoResize(ta);

      ta.addEventListener('input', () => {
        lastTypedAt = Date.now();
        autoResize(ta);
        drafts[s.key] = ta.value;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          saveDrafts();
        }, 200);
      });

      sec.append(ta);
      sectionsContainer.append(sec);
    }

    const info = document.createElement('div');
    info.className = 'mut';
    info.textContent = '⌘Enter 저장 · Enter 줄바꿈 · Esc·⌥M 접기 · ⌥⇧M 지난 메모';

    // ⌘Enter 저장 · Esc 접기 · ⌥⇧M 목록: 메모장 안 어디에 포커스가 있어도 동작한다. 칸 밖이면 지금 칸 글을 쓴다.
    box.addEventListener('keydown', (e) => {
      const action = memoCore?.padKeyV2 ? memoCore.padKeyV2(e) : null;
      const key = e.target?.closest?.('.sec')?.dataset?.key || currentActiveKey;
      if (action === 'save') {
        e.preventDefault();
        performSave(key, box.querySelector(`.sec[data-key="${CSS.escape(key)}"] .sec-textarea`));
      } else if (action === 'newline') {
        if (e.target?.classList?.contains('sec-textarea')) setTimeout(() => autoResize(e.target), 0);
      } else if (action === 'fold') {
        e.preventDefault();
        closePad();
      } else if (e.altKey && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        openListUI(root);
      }
    });

    box.append(meta, sectionsContainer, info, createResizeHandle());
    root.append(style, box);
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
    newBtn.onclick = () => openPad();

    header.append(title, newBtn);

    const listContainer = document.createElement('div');
    listContainer.className = 'list-container';
    listContainer.textContent = '불러오는 중…';

    box.append(header, listContainer, createResizeHandle());
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
        const preview = memoCore?.previewText ? memoCore.previewText(m.text || m.quote?.exact || '', 80) : (m.text || '').slice(0, 80);
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

  // 노드가 우리 화면(readgloss-* host 또는 data-readgloss) 안인지 확인
  function isInsideOurHost(node) {
    if (!node) return false;
    let curr = node.nodeType === 1 ? node : node.parentElement;
    while (curr) {
      const tag = (curr.localName || curr.tagName || '').toLowerCase();
      if (tag.startsWith('readgloss-') || curr.hasAttribute?.('data-readgloss')) {
        return true;
      }
      if (curr.getRootNode && curr.getRootNode() instanceof ShadowRoot) {
        const hostEl = curr.getRootNode().host;
        const hostTag = (hostEl?.localName || hostEl?.tagName || '').toLowerCase();
        if (hostTag.startsWith('readgloss-') || hostEl?.hasAttribute?.('data-readgloss')) {
          return true;
        }
      }
      curr = curr.parentElement;
    }
    return false;
  }

  // 선택 시작 노드보다 앞선 마지막 h1~h3의 key 구하기 (소제목 모으기 결과와 같은 key)
  function findHeadingKeyForNode(startNode, headings) {
    if (!Array.isArray(headings) || headings.length === 0) return '_page';
    let targetKey = null;
    for (const h of headings) {
      if (!h.el) continue;
      if (h.el === startNode || (h.el.compareDocumentPosition(startNode) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        targetKey = h.key;
      }
    }
    return targetKey || headings[0]?.key || '_page';
  }

  // 메모장 열기
  function openPad(targetSectionKey) {
    isOpen = true;
    currentMode = 'pad';
    loadAndApplyRect();
    fetchTaskGuess();
    currentHeadings = collectHeadings();
    lastHeadingsCount = currentHeadings.length;
    setupMutationObserver();

    if (targetSectionKey) {
      currentActiveKey = targetSectionKey;
    }

    const root = ensureHost();
    renderPadUI(root);
    saveDrafts();

    // 초기 활성 칸 계산 및 스크롤/포커스. 칸 키가 그대로여도 쓰는 칸에 커서를 넣는다.
    if (targetSectionKey) {
      lastTypedAt = 0;
    } else {
      updateActiveSection(false);
    }
    applyActiveSection(true, true);

    // 열 때 다리 GET /memos?url= 로 메모 불러오기
    chrome.runtime.sendMessage({ type: 'memos', op: 'get', url: location.href }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      currentMemos = Array.isArray(res.memos) ? res.memos : [];
      if (isOpen && currentMode === 'pad') {
        rebuildSectionsUI();
        if (targetSectionKey) {
          applyActiveSection(true);
        }
      }
    });
  }

  // 메모장 접기(닫기)
  function closePad() {
    clearTimeout(typingTimer);
    editingMemo = null;
    if (shadow && currentMode === 'pad') {
      const textareas = shadow.querySelectorAll('.sec-textarea');
      for (const ta of textareas) {
        const sec = ta.closest('.sec');
        const key = sec?.dataset?.key;
        if (key) drafts[key] = ta.value;
      }
    }
    isOpen = false;
    currentMode = 'pad';
    removeHost();
    saveDrafts();
  }

  // 목록 모드로 열기
  function openList() {
    clearTimeout(typingTimer);
    if (shadow && currentMode === 'pad') {
      const textareas = shadow.querySelectorAll('.sec-textarea');
      for (const ta of textareas) {
        const sec = ta.closest('.sec');
        const key = sec?.dataset?.key;
        if (key) drafts[key] = ta.value;
      }
    }
    isOpen = true;
    currentMode = 'list';
    loadAndApplyRect();
    const root = ensureHost();
    openListUI(root);
    saveDrafts();
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
    currentHeadings = collectHeadings();
    lastHeadingsCount = currentHeadings.length;

    chrome.runtime.sendMessage({ type: 'memo-state-get' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (res.drafts && typeof res.drafts === 'object') {
        drafts = { ...res.drafts };
      }
      if (res.quotes && typeof res.quotes === 'object') {
        quotes = { ...res.quotes };
      }
      // 옛 상태의 text가 있으면 첫 칸 draft로 옮긴다
      if (typeof res.text === 'string' && res.text) {
        const firstKey = currentHeadings[0]?.key || '_page';
        if (!drafts[firstKey]) {
          drafts[firstKey] = res.text;
        }
      }
      if (res.open === true) {
        openPad();
      }
    });
  }

  // ⌥M with 고른 글 또는 토글 처리
  function handleMemoOpen() {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim().length > 0;

    let isOurHost = false;
    let range = null;
    if (hasSelection) {
      range = sel.getRangeAt(0);
      isOurHost = isInsideOurHost(range.startContainer) || isInsideOurHost(range.commonAncestorContainer);
    }

    if (hasSelection && !isOurHost) {
      // 1. 두 카드 close()
      globalThis.readglossSelectionUi?.close?.();
      globalThis.readglossDictCardUi?.close?.();

      // 2. 선택 범위로 quoteForRange 구하기 (반환은 { quote: {exact, prefix, suffix}, pos } | null)
      const q = globalThis.readglossScrapPage?.quoteForRange?.(range)?.quote;
      const extracted = q && typeof q.exact === 'string' && q.exact.length > 0
        ? { exact: q.exact, prefix: q.prefix || '', suffix: q.suffix || '' }
        : null;

      if (!extracted) {
        // 인용 없이 열고 메모장 위에 "이 글은 인용할 수 없어요" 1.5초
        if (!isOpen) {
          openPad();
        }
        showPadToastNotice('이 글은 인용할 수 없어요', 1500);
        return;
      }

      // 3. 고른 글이 든 소제목 칸 key 구하기 (닫힌 사이 바뀌었을 수 있어 지금 페이지 기준으로 다시 모은다)
      currentHeadings = collectHeadings();
      lastHeadingsCount = currentHeadings.length;
      const targetKey = findHeadingKeyForNode(range.startContainer, currentHeadings);

      // 4. 그 칸의 인용으로 quotes[key] = {exact, prefix, suffix}
      quotes[targetKey] = extracted;
      currentActiveKey = targetKey;
      saveDrafts();

      // 5. 접혀 있으면 연다. 칸 화면이 열려 있으면 토글하지 않고 그대로 두고 칸을 다시 그린다.
      //    목록(⌥⇧M) 화면이면 칸 화면으로 바꿔서 인용이 보이게 한다.
      if (isOpen && currentMode === 'pad') {
        rebuildSectionsUI();
        lastTypedAt = 0;
        applyActiveSection(true);
      } else {
        openPad(targetKey);
      }
      return;
    }

    // 선택이 비었으면 지금처럼 토글
    if (isOpen) {
      closePad();
    } else {
      openPad();
    }
  }

  // 단축키 커맨드(memo-open, memo-list) 메시지 리스너
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'memo-command') return;
    const cmd = msg.cmd;

    if (cmd === 'memo-open') {
      handleMemoOpen();
    } else if (cmd === 'memo-list') {
      openList();
    }
  });

  // 초기화
  function initMemoPad() {
    loadAndApplyRect();
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
