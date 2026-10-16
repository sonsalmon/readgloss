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

  let isDocked = false; // 붙인 상태 여부
  let dockWidthValue = 360; // 붙이기 폭 (기본 360, 260~50vw)
  let originalMarginRight = null; // 붙이기 전 본문 오른쪽 마진
  let preStudyDockState = null; // 공부 모드 전 상태 { open, docked }
  let studyMode = false; // 공부 모드 진행 여부
  let isComposing = false; // 한글 조합 중 여부
  let returnFocusTimer = 0; // 쓰는 칸 기본 포커스 타이머

  function saveDockState() {
    if (chrome?.storage?.local?.set) {
      const memoCore = globalThis.readglossMemo;
      const state = memoCore?.dockStateToSave
        ? memoCore.dockStateToSave({ studyMode, preStudyDockState, isDocked, dockWidthValue })
        : { on: (studyMode && preStudyDockState) ? Boolean(preStudyDockState.docked) : isDocked, width: dockWidthValue };
      chrome.storage.local.set({ memoPadDock: state });
    }
  }

  function syncPageMargin() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (originalMarginRight === null) {
      originalMarginRight = document.documentElement.style.marginRight || '';
    }
    const memoCore = globalThis.readglossMemo;
    const target = memoCore?.pageMarginFor
      ? memoCore.pageMarginFor({ open: isOpen, docked: isDocked, width: dockWidthValue, original: originalMarginRight })
      : (isOpen && isDocked ? `${dockWidthValue}px` : (originalMarginRight || ''));
    document.documentElement.style.marginRight = target;
  }

  function applyDock(width) {
    isDocked = true;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const memoCore = globalThis.readglossMemo;
    const w = memoCore?.dockWidth ? memoCore.dockWidth(width ?? dockWidthValue, vw) : (width ?? dockWidthValue ?? 360);
    dockWidthValue = w;

    syncPageMargin();

    if (host) {
      host.style.position = 'fixed';
      host.style.top = '0px';
      host.style.right = '0px';
      host.style.left = 'auto';
      host.style.bottom = 'auto';
      host.style.height = '100vh';
      host.style.width = `${w}px`;
    }
    updateDockUI();
  }

  function undockPad() {
    isDocked = false;
    syncPageMargin();
    applyAnchored(savedAnchored);
    saveDockState();
    updateDockUI();
  }

  function toggleDock() {
    if (isDocked) {
      undockPad();
    } else {
      applyDock(dockWidthValue);
      saveDockState();
    }
  }

  function updateDockUI() {
    if (!shadow) return;
    const btn = shadow.querySelector('.btn-dock');
    if (btn) {
      btn.textContent = isDocked ? '띄우기' : '붙이기';
      btn.setAttribute('aria-label', isDocked ? '떠 있는 창으로 띄우기' : '오른쪽에 붙이기');
    }
    const cornerHandle = shadow.querySelector('.resize-handle');
    if (cornerHandle) {
      cornerHandle.style.display = isDocked ? 'none' : 'flex';
    }
    const dockHandle = shadow.querySelector('.dock-resize-handle');
    if (dockHandle) {
      dockHandle.style.display = isDocked ? 'block' : 'none';
    }
    const padBox = shadow.querySelector('.pad-box');
    if (padBox) {
      padBox.classList.toggle('docked', isDocked);
    }
  }

  function loadAndApplyRect(callback) {
    if (chrome?.storage?.local?.get) {
      chrome.storage.local.get(['memoPadRect', 'memoPadDock'], (items) => {
        if (!chrome.runtime?.lastError && items?.memoPadDock) {
          if (!studyMode) {
            isDocked = Boolean(items.memoPadDock.on);
          }
          if (typeof items.memoPadDock.width === 'number' && Number.isFinite(items.memoPadDock.width)) {
            dockWidthValue = items.memoPadDock.width;
          }
        }
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
        } else {
          savedAnchored = getDefaultAnchored();
        }
        if (isDocked) {
          applyDock(dockWidthValue);
        } else {
          applyAnchored(savedAnchored);
        }
        syncPageMargin();
        if (typeof callback === 'function') callback();
      });
    } else {
      savedAnchored = savedAnchored || getDefaultAnchored();
      if (isDocked) {
        applyDock(dockWidthValue);
      } else {
        applyAnchored(savedAnchored);
      }
      syncPageMargin();
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
      if (e.button !== 0 || isDocked) return;
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

  function createDockResizeHandle() {
    const handle = document.createElement('div');
    handle.className = 'dock-resize-handle';
    handle.setAttribute('aria-label', '폭 조절');
    handle.style.display = isDocked ? 'block' : 'none';

    let isResizing = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      isResizing = true;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}
      document.documentElement.style.userSelect = 'none';
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      e.stopPropagation();
      e.preventDefault();
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const rawW = vw - e.clientX;
      const memoCore = globalThis.readglossMemo;
      const w = memoCore?.dockWidth ? memoCore.dockWidth(rawW, vw) : Math.max(260, Math.min(rawW, vw * 0.5));
      dockWidthValue = w;
      if (host) {
        host.style.width = `${w}px`;
      }
      syncPageMargin();
    });

    const onPointerUp = (e) => {
      if (!isResizing) return;
      isResizing = false;
      e.stopPropagation();
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}
      document.documentElement.style.userSelect = '';
      saveDockState();
    };

    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);

    for (const evt of ['mousedown', 'mousemove', 'mouseup', 'click']) {
      handle.addEventListener(evt, (e) => e.stopPropagation());
    }

    return handle;
  }

  function createResizeHandle() {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.textContent = '◢';
    handle.setAttribute('aria-label', '크기 조절');
    if (isDocked) handle.style.display = 'none';

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
          if (isDocked) {
            applyDock(dockWidthValue);
          } else {
            applyAnchored(savedAnchored);
          }
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
  let stash = {}; // 다시 열기로 고치는 동안 그 칸이 쓰던 글 { [key]: string } — 고치기를 마치거나 그만두면 되돌린다
  let editingMemo = null; // 다시 열기로 가져온 메모 { id, sectionKey } — 그 칸의 ⌘Enter 가 고침(edit)으로 보낸다
  let currentHeadings = []; // [{ key, text, level, el }]
  let currentMemos = []; // 이 페이지의 저장된 메모 목록
  let currentPageItems = []; // 이 페이지의 모든 모양 항목 목록 (메모, 스크랩, 개념, 나중에, 단어, 구문장)
  let pendingCodeLangKey = null; // 다시 그린 뒤 언어 고르기에 커서를 줄 칸 키(S1)
  let activeConceptEditId = null; // 인라인 편집기가 열려 있는 개념 id
  let activeScrapEditId = null; // 인라인 편집기가 열려 있는 스크랩 id (한 번에 하나만 열림)
  let conceptSaveTimers = {}; // 개념 id별 0.8초 자동 저장 타이머
  let pendingConceptSaves = {}; // 개념 id별 대기 중인 저장 콜백
  let currentActiveKey = '_page'; // 현재 활성화된 소제목 key
  let lastTypedAt = 0; // 쓰는 칸에 마지막으로 입력한 시각(ms)
  let lastHeadingsCount = -1; // MutationObserver 개수 비교용
  let mutationDebounceTimer = 0;
  let observer = null;
  let lastScrollTime = 0;
  let scrollTimeout = 0;
  let studyTimeTimer = null; // 메모장 상단 오늘 시간 1초 갱신 타이머

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
      overflow: hidden;
    }
    .pad-box.docked {
      border-radius: 0;
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
      justify-content: space-between;
      gap: 6px;
      transition: background 0.15s, color 0.15s;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      flex-shrink: 0;
    }
    .meta-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta-time {
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      flex-shrink: 0;
      opacity: 0.9;
      user-select: none;
      -webkit-user-select: none;
    }
    .btn-dock {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      padding: 1px 7px;
      border-radius: 4px;
      border: 1px solid currentColor;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
      opacity: 0.85;
      line-height: 1.4;
      user-select: none;
    }
    .btn-dock:hover {
      opacity: 1;
      background: rgba(0, 0, 0, 0.08);
    }
    .dock-resize-handle {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 6px;
      cursor: ew-resize;
      z-index: 10;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    .dock-resize-handle:hover {
      background: var(--acc);
      opacity: 0.4;
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
    .sec.sec-toc-row {
      padding: 2px 4px;
      cursor: pointer;
    }
    .sec.sec-toc-row:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    @media (prefers-color-scheme: dark) {
      .sec.sec-toc-row:hover {
        background: rgba(255, 255, 255, 0.06);
      }
    }
    .sec-toc-btn {
      all: unset;
      box-sizing: border-box;
      display: block;
      width: 100%;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.5;
      color: var(--mut);
      border-radius: 4px;
      padding: 2px 4px;
      word-break: break-all;
    }
    .sec-toc-btn:focus-visible,
    .sec-toc-btn:focus {
      outline: 2px solid var(--acc);
      outline-offset: -1px;
    }
    .sec-toc-title {
      color: var(--fg);
      font-weight: 500;
    }
    .sec-toc-meta {
      color: var(--mut);
      font-weight: normal;
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
    .sec-shape-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .sec-shape-line {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 11.5px;
      color: var(--mut);
      line-height: 1.4;
      word-break: break-all;
      user-select: none;
      cursor: pointer;
    }
    .sec-shape-line:hover {
      background: rgba(0, 0, 0, 0.04);
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .sec-shape-line:hover {
        background: rgba(255, 255, 255, 0.05);
      }
    }
    .sec-shape-line.concept-line.active {
      background: var(--accbg);
      color: var(--acc);
      font-weight: 500;
    }
    .sec-shape-text {
      flex: 1;
      min-width: 0;
    }
    .concept-inline-edit {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 2px 0 4px 8px;
      padding: 6px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--acc);
      box-sizing: border-box;
    }
    .concept-edit-textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 48px;
      border: 1px solid var(--bd);
      border-radius: 4px;
      background: var(--card);
      color: var(--fg);
      font: inherit;
      font-size: 12px;
      line-height: 1.4;
      padding: 4px 6px;
      resize: none;
      outline: none;
    }
    .concept-edit-textarea:focus {
      border-color: var(--acc);
    }
    .concept-edit-mut {
      font-size: 11px;
      color: var(--mut);
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
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
    .sec-quote-content {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
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
    .sec-quote-trans {
      font-size: 11px;
      opacity: 0.75;
      line-height: 1.3;
      word-break: break-all;
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
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 4px;
      word-break: break-all;
      user-select: none;
      position: relative;
    }
    @media (prefers-color-scheme: dark) {
      .sec-memo-quote-line {
        background: #412402;
        color: #FAC775;
      }
    }
    .sec-memo-quote-text {
      flex: 1;
      min-width: 0;
      cursor: pointer;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .sec-memo-quote-del {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      padding: 0 2px;
      color: inherit;
      opacity: 0;
      flex-shrink: 0;
    }
    .sec-memo-quote-line:hover .sec-memo-quote-del,
    .sec-memo-quote-del:focus,
    .sec-memo-quote-del:focus-visible {
      opacity: 0.7;
    }
    .sec-memo-quote-del:hover {
      opacity: 1;
    }
    .sec-quote.code-quote,
    .sec-memo-quote-line.code-quote {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .sec-quote.code-block .sec-quote-text,
    .sec-memo-quote-line.code-block .sec-memo-quote-text {
      white-space: pre;
      overflow-x: auto;
      display: block;
      -webkit-line-clamp: unset;
    }
    .sec-quote.table-quote .sec-quote-text,
    .sec-memo-quote-line.table-quote .sec-memo-quote-text {
      display: block;
      -webkit-line-clamp: unset;
      overflow: visible;
    }
    .sec-quote-table-wrap {
      overflow-x: auto;
      max-width: 100%;
      margin: 2px 0;
    }
    .sec-quote-table {
      font-size: 0.85em;
      line-height: 1.35;
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
    }
    .sec-quote-table th,
    .sec-quote-table td {
      border: 1px solid var(--bd);
      padding: 2px 6px;
      text-align: left;
      vertical-align: top;
      max-width: 16em;
    }
    .sec-quote-table th {
      background: var(--bg);
      font-weight: 600;
    }
    .table-quote-code,
    .sec-quote-table code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.9em;
      background: rgba(0, 0, 0, 0.05);
      padding: 1px 3px;
      border-radius: 3px;
    }
    @media (prefers-color-scheme: dark) {
      .table-quote-code,
      .sec-quote-table code {
        background: rgba(255, 255, 255, 0.1);
      }
    }
    .sec-quote-lang-select {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      padding: 1px 4px;
      border: 1px solid var(--bd);
      border-radius: 4px;
      background: var(--card);
      color: var(--fg);
      margin-bottom: 2px;
      align-self: flex-start;
      cursor: pointer;
    }
    .sec-quote-lang-badge {
      font-size: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--mut);
      padding: 0 4px;
      border-radius: 3px;
      background: rgba(0, 0, 0, 0.08);
      margin-right: 4px;
      vertical-align: middle;
      display: inline-block;
    }
    @media (prefers-color-scheme: dark) {
      .sec-quote-lang-badge {
        background: rgba(255, 255, 255, 0.12);
      }
    }
    .sec-shape-line.scrap-line {
      cursor: pointer;
    }
    .sec-shape-line.scrap-line.active {
      background: var(--accbg);
      color: var(--acc);
      font-weight: 500;
    }
    .scrap-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-right: 4px;
      flex-shrink: 0;
      vertical-align: middle;
      user-select: none;
    }
    .scrap-badge-bar {
      display: inline-block;
      width: 3px;
      height: 10px;
      background: #eab308;
      border-radius: 1px;
    }
    .scrap-badge-label {
      font-size: 10.5px;
      color: var(--mut);
      font-weight: 500;
    }
    .scrap-memo-text {
      font-size: 11px;
      color: var(--mut);
      line-height: 1.3;
      margin: 1px 0 2px 14px;
      word-break: break-all;
    }
    .scrap-inline-edit {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 2px 0 4px 8px;
      padding: 6px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--acc);
      box-sizing: border-box;
    }
    .scrap-edit-textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 48px;
      border: 1px solid var(--bd);
      border-radius: 4px;
      background: var(--card);
      color: var(--fg);
      font: inherit;
      font-size: 12px;
      line-height: 1.4;
      padding: 4px 6px;
      resize: none;
      outline: none;
    }
    .scrap-edit-textarea:focus {
      border-color: var(--acc);
    }
    .scrap-edit-mut {
      font-size: 11px;
      color: var(--mut);
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sec-textarea {
      width: calc(100% - 8px);
      box-sizing: border-box;
      min-height: 90px;
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
      outline: 2px solid var(--acc);
      outline-offset: 0;
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
      flex-shrink: 0;
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
      if (isDocked) {
        applyDock(dockWidthValue);
      } else {
        applyAnchored(savedAnchored);
      }
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
      stash,
      quotes,
      rect: currentRect,
      text: Object.values(drafts).find(Boolean) || '',
    });
  }

  const BRIDGE_OFF_TEXT = '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요';

  // 메모장 위 줄 오늘 공부 시간 표시 갱신 (T40b)
  function updateStudyTimeUI() {
    if (!shadow || !isOpen || currentMode !== 'pad') return;
    const timeEl = shadow.querySelector('.meta-time');
    if (!timeEl) return;
    const st = globalThis.readglossStudyTime;
    if (!st || typeof st.pageSecondsToday !== 'function') {
      timeEl.textContent = '';
      timeEl.style.display = 'none';
      return;
    }
    const sec = st.pageSecondsToday();
    const counting = typeof st.isCounting === 'function' ? st.isCounting() : false;
    const icon = counting ? '⏱' : '⏸';
    const memoCore = globalThis.readglossMemo;
    const clock = memoCore?.formatClock ? memoCore.formatClock(sec) : '';
    timeEl.textContent = `${icon} ${clock}`;
    timeEl.style.display = '';
  }

  // 메모장이 열려 있을 때만 1초마다 갱신하는 타이머 시작
  function startStudyTimeTimer() {
    stopStudyTimeTimer();
    updateStudyTimeUI();
    studyTimeTimer = setInterval(updateStudyTimeUI, 1000);
  }

  // 메모장이 닫히면 타이머 멈춤
  function stopStudyTimeTimer() {
    if (studyTimeTimer) {
      clearInterval(studyTimeTimer);
      studyTimeTimer = null;
    }
  }

  function updateMetaText(text) {
    if (!shadow) return;
    const metaTitle = shadow.querySelector('.meta-title');
    if (metaTitle) {
      metaTitle.textContent = text;
    } else {
      const metaEl = shadow.querySelector('.meta');
      if (metaEl) metaEl.textContent = text;
    }
  }

  function showSuccessMeta(msg = '메모했어요') {
    if (!shadow) return;
    const metaEl = shadow.querySelector('.meta');
    if (metaEl) {
      metaEl.classList.remove('error');
      metaEl.classList.add('success');
      updateMetaText(msg);
      setTimeout(() => {
        if (metaEl && isOpen && currentMode === 'pad') {
          metaEl.classList.remove('success');
          updateMetaText(buildMetaText());
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
      updateMetaText(msg);
      setTimeout(() => {
        if (metaEl && isOpen && currentMode === 'pad') {
          metaEl.classList.remove('error');
          updateMetaText(buildMetaText());
        }
      }, 3000);
    }
  }

  // 다시 열기로 가져온 메모 고치기를 마치거나 그만둔다: 그 칸 쓰는 칸을 보관한 초안으로 되돌린다(없으면 빈 칸)
  function endEdit() {
    if (!editingMemo) return;
    const key = editingMemo.sectionKey;
    drafts[key] = stash[key] || '';
    delete stash[key];
    editingMemo = null;
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
      const pIdx = currentPageItems.findIndex((item) => item.kind === 'memo' && item.id === id);
      if (pIdx !== -1) currentPageItems[pIdx].text = res.memo.text;
      endEdit();
      ta.value = drafts[sectionKey] || '';
      autoResize(ta);
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
      endEdit(); // 고치던 것이 있으면 그만두고 그 칸 초안을 되돌린 뒤 다음 메모를 가져온다
      currentMemos = res.memos;
      openPad();
      const memoCore = globalThis.readglossMemo;
      const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
      const sections = memoCore?.buildSections ? memoCore.buildSections(currentHeadings, currentMemos, pageTitle) : [];
      const key = sections.find((sec) => (sec.memos || []).some((m) => m.id === id))?.key || '_page';
      // 칸에 쓰던 글은 메모 글로 덮기 전에 보관한다(고치기를 마치거나 그만두면 되돌린다)
      const prevDraft = drafts[key] || '';
      if (prevDraft) stash[key] = prevDraft;
      editingMemo = { id, sectionKey: key };
      currentActiveKey = key;
      drafts[key] = memo.text || '';
      rebuildSectionsUI();
    });
  }

  // 커서 자리에 글 넣기 (Ctrl+Z 실행 취소가 되도록 execCommand 우선, fallback은 setRangeText)
  function insertTextAtCursor(ta, text) {
    if (!ta) return;
    ta.focus();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {}
    if (!inserted) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.setRangeText(text, start, end, 'end');
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
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
      exact: currentQuote.exact.slice(0, currentQuote.table ? 4000 : 1000),
      prefix: (currentQuote.prefix || '').slice(0, 64),
      suffix: (currentQuote.suffix || '').slice(0, 64),
      ...(currentQuote.translation ? { translation: currentQuote.translation.slice(0, 2000) } : {}),
      ...(currentQuote.code ? {
        code: {
          lang: (currentQuote.code.lang === '자동' ? '' : (currentQuote.code.lang || '')).slice(0, 20),
          block: Boolean(currentQuote.code.block),
        },
      } : {}),
      ...(currentQuote.table ? { table: currentQuote.table } : {}),
      ...(currentQuote.source === 'tutor' ? {
        source: 'tutor',
        tutor: {
          date: currentQuote.tutor?.date || '',
          time: currentQuote.tutor?.time || '',
          title: currentQuote.tutor?.title || '',
        },
      } : {}),
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
      currentPageItems.push({
        kind: 'memo',
        id: res.memo.id,
        text: res.memo.text,
        quote: res.memo.quote,
        headings: res.memo.headings,
        ts: res.memo.ts,
        url: res.memo.url,
      });

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
    if (!ta || ta.localName !== 'textarea') return; // 쓰는 칸이 아니면(예: 메모장 host) 높이를 건드리지 않는다
    const memoCore = globalThis.readglossMemo;
    const container = shadow?.querySelector('.sections-container');
    const listHeight = container ? container.clientHeight : 300;

    let lineHeight = 20;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(ta);
        const parsed = parseFloat(cs.lineHeight);
        if (Number.isFinite(parsed) && parsed > 0) lineHeight = parsed;
      } catch {}
    }

    ta.style.height = 'auto';
    const sh = ta.scrollHeight;
    const h = memoCore?.textareaHeight
      ? memoCore.textareaHeight({ scrollHeight: sh, lineHeight, listHeight })
      : Math.min(Math.max(sh, 5 * lineHeight), listHeight > 0 ? listHeight / 2 : 5 * lineHeight);

    ta.style.height = `${h}px`;
    if (sh > h) {
      ta.style.overflowY = 'auto';
    } else {
      ta.style.overflowY = 'hidden';
    }
  }

  // 표 인용 표시를 위한 작은 <table> 요소 생성 (T50)
  // DOM은 textContent로만 만들며 innerHTML은 쓰지 않는다.
  function renderTableElement(tableData) {
    if (!tableData || typeof tableData !== 'object') return null;
    const wrap = document.createElement('div');
    wrap.className = 'sec-quote-table-wrap';

    const table = document.createElement('table');
    table.className = 'sec-quote-table';

    const renderCellNodes = (container, text) => {
      const s = typeof text === 'string' ? text : (text == null ? '' : String(text));
      if (!s) return;
      const regex = /(?:``([\s\S]*?)``|`([^`\r\n]*?)`)/g;
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(s)) !== null) {
        if (match.index > lastIndex) {
          container.append(document.createTextNode(s.slice(lastIndex, match.index)));
        }
        const codeText = match[1] !== undefined ? match[1] : match[2];
        const codeEl = document.createElement('code');
        codeEl.className = 'table-quote-code';
        codeEl.textContent = codeText;
        container.append(codeEl);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < s.length) {
        container.append(document.createTextNode(s.slice(lastIndex)));
      }
    };

    if (tableData.head && Array.isArray(tableData.head)) {
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      for (const h of tableData.head) {
        const th = document.createElement('th');
        renderCellNodes(th, h);
        tr.append(th);
      }
      thead.append(tr);
      table.append(thead);
    }

    if (Array.isArray(tableData.rows)) {
      const tbody = document.createElement('tbody');
      for (const row of tableData.rows) {
        const tr = document.createElement('tr');
        if (Array.isArray(row)) {
          for (const c of row) {
            const td = document.createElement('td');
            renderCellNodes(td, c);
            tr.append(td);
          }
        }
        tbody.append(tr);
      }
      table.append(tbody);
    }

    wrap.append(table);
    return wrap;
  }

  function createMemoLine(m, sectionKey) {
    const wrap = document.createElement('div');
    wrap.className = 'sec-memo-wrap';

    if (m.quote && typeof m.quote.exact === 'string' && m.quote.exact.length > 0) {
      const qLine = document.createElement('div');
      qLine.className = 'sec-memo-quote-line';
      if (m.quote.code) {
        qLine.classList.add('code-quote');
        if (m.quote.code.block) {
          qLine.classList.add('code-block');
        }
      }

      const qText = document.createElement('div');
      qText.className = 'sec-memo-quote-text';

      const dropBtn = document.createElement('button');
      dropBtn.className = 'sec-memo-quote-del';
      dropBtn.type = 'button';
      dropBtn.setAttribute('aria-label', '인용 뺌');
      dropBtn.textContent = '✕';
      dropBtn.onclick = (e) => {
        e.stopPropagation();
        const currentText = (m.text || '').trim();
        if (!currentText) {
          showPadToastNotice('글이 없는 메모는 인용을 뺄 수 없어요', 1500);
          return;
        }
        chrome.runtime.sendMessage({
          type: 'memos',
          op: 'edit',
          id: m.id,
          text: m.text,
          dropQuote: true,
        }, (res) => {
          if (res?.memo) {
            m.quote = null;
            const idx = currentMemos.findIndex((item) => item.id === m.id);
            if (idx !== -1) currentMemos[idx] = res.memo;
            const pIdx = currentPageItems.findIndex((item) => item.kind === 'memo' && item.id === m.id);
            if (pIdx !== -1) {
              currentPageItems[pIdx].quote = null;
            }
            qLine.remove();
            showSuccessMeta('고쳤어요');
          } else {
            const errMsg = res?.error === 'bridge-off' ? BRIDGE_OFF_TEXT : '저장하지 못했어요';
            showErrorMeta(errMsg);
          }
        });
      };

      if (m.quote.table) {
        qLine.classList.add('table-quote');
        const tableEl = renderTableElement(m.quote.table);
        if (tableEl) {
          qText.append(tableEl);
        }
        qText.title = '인용 자리로 이동';
        qText.onclick = (e) => {
          if (e.target === dropBtn) return;
          jumpToMemo(m);
        };
      } else if (m.quote.source === 'tutor') {
        const timeStr = m.quote.tutor?.time || '';
        let isExpanded = false;
        const renderText = () => {
          qText.textContent = isExpanded ? `❝ 튜터 ${timeStr}\n${m.quote.exact}` : `❝ 튜터 ${timeStr} · ${m.quote.exact.slice(0, 60)}${m.quote.exact.length > 60 ? '…' : ''}`;
        };
        renderText();
        qText.title = '전문 펼치기/접기';
        qText.onclick = (e) => {
          if (e.target === dropBtn) return;
          isExpanded = !isExpanded;
          if (isExpanded) {
            qText.style.webkitLineClamp = 'unset';
            qText.style.whiteSpace = 'pre-wrap';
          } else {
            qText.style.webkitLineClamp = '2';
            qText.style.whiteSpace = '';
          }
          renderText();
        };
      } else if (m.quote.code) {
        qText.textContent = m.quote.exact;
        if (m.quote.code.lang) {
          const langBadge = document.createElement('span');
          langBadge.className = 'sec-quote-lang-badge';
          langBadge.textContent = m.quote.code.lang;
          qText.prepend(langBadge);
        }
        qText.title = '인용 자리로 이동';
        qText.onclick = (e) => {
          if (e.target === dropBtn) return;
          jumpToMemo(m);
        };
      } else {
        qText.textContent = `“${m.quote.exact}”`;
        qText.title = '인용 자리로 이동';
        qText.onclick = (e) => {
          if (e.target === dropBtn) return;
          jumpToMemo(m);
        };
      }

      qLine.append(qText, dropBtn);
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
        const pIdx = currentPageItems.findIndex((item) => item.kind === 'memo' && item.id === m.id);
        if (pIdx !== -1) currentPageItems.splice(pIdx, 1);
        wrap.remove();
      });
    };

    line.append(textEl, delBtn);
    wrap.append(line);
    return wrap;
  }

  // 대기 중인 개념 자동 저장 즉시 전송
  function flushPendingConceptSave(conceptId) {
    if (!conceptId) return;
    if (conceptSaveTimers[conceptId]) {
      clearTimeout(conceptSaveTimers[conceptId]);
      delete conceptSaveTimers[conceptId];
    }
    if (typeof pendingConceptSaves[conceptId] === 'function') {
      const saveFn = pendingConceptSaves[conceptId];
      delete pendingConceptSaves[conceptId];
      saveFn();
    }
  }

  // 개념 그 자리 편집기 닫기 (Esc 또는 같은 줄 다시 누름)
  function closeConceptInlineEdit(conceptId) {
    if (!conceptId) return;
    flushPendingConceptSave(conceptId);
    if (activeConceptEditId === conceptId) {
      activeConceptEditId = null;
    }
    if (shadow) {
      const editBox = shadow.querySelector(`.concept-inline-edit[data-id="${CSS.escape(conceptId)}"]`);
      editBox?.remove();
      const lineEl = shadow.querySelector(`.sec-shape-line.concept-line[data-id="${CSS.escape(conceptId)}"]`);
      lineEl?.classList.remove('active');
    }
  }

  // 개념 그 자리 편집기 열기 / 토글 (16-3)
  function toggleConceptInlineEdit(item, lineEl) {
    if (!item || !lineEl) return;
    const id = item.id;
    if (activeConceptEditId === id) {
      closeConceptInlineEdit(id);
      return;
    }
    if (activeConceptEditId) {
      closeConceptInlineEdit(activeConceptEditId);
    }

    activeConceptEditId = id;
    lineEl.classList.add('active');

    const editBox = document.createElement('div');
    editBox.className = 'concept-inline-edit';
    editBox.dataset.id = id;

    const ta = document.createElement('textarea');
    ta.className = 'concept-edit-textarea';
    ta.maxLength = 500;
    ta.placeholder = '개념 정의를 적으세요...';

    const initialDef = item.definition || '';
    ta.value = globalThis.readglossMdList?.ensureStartsList ? globalThis.readglossMdList.ensureStartsList(initialDef) : initialDef;
    autoResize(ta);

    // 0.8초 자동 저장 (16-3)
    const performConceptSave = () => {
      const cleanDef = globalThis.readglossMdList?.cleanForSave ? globalThis.readglossMdList.cleanForSave(ta.value) : ta.value;
      const related = Array.isArray(item.related)
        ? item.related.map((r) => (typeof r === 'string' ? r : r?.name)).filter(Boolean)
        : [];
      const saveMsg = {
        type: 'concepts',
        op: 'save',
        id: item.id,
        name: item.name,
        aliases: item.aliases || [],
        tags: item.tags || [],
        definition: cleanDef,
        related,
      };
      // seen 은 다리 검사(title·sentence 문자열 필수)에 맞춰 채우고, 없으면 보내지 않는다(옛 값 유지)
      if (item.seen?.url) {
        saveMsg.seen = {
          url: item.seen.url,
          title: item.seen.title || '',
          sentence: item.seen.sentence || '',
          ...(Array.isArray(item.seen.headings) ? { headings: item.seen.headings } : {}),
        };
      }
      chrome.runtime.sendMessage(saveMsg, (res) => {
        if (res?.concept) {
          item.definition = cleanDef;
          item.rawConcept = res.concept;
          item.kind = cleanDef ? 'concept' : 'later';
          const textEl = lineEl.querySelector('.sec-shape-text');
          const memoCore = globalThis.readglossMemo;
          if (textEl && memoCore?.formatShapeLine) {
            textEl.textContent = memoCore.formatShapeLine(item);
          }
          globalThis.readglossLastSave = { kind: 'concept', id: item.id };
          window.dispatchEvent(new CustomEvent('readgloss:concepts-updated'));
        }
      });
    };

    ta.addEventListener('input', () => {
      autoResize(ta);
      clearTimeout(conceptSaveTimers[id]);
      pendingConceptSaves[id] = performConceptSave;
      conceptSaveTimers[id] = setTimeout(() => {
        flushPendingConceptSave(id);
      }, 800);
    });

    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        pendingConceptSaves[id] = performConceptSave;
        closeConceptInlineEdit(id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeConceptInlineEdit(id);
        return;
      }
      const md = globalThis.readglossMdList;

      if (res) {
        e.preventDefault();
        ta.value = res.value;
        ta.setSelectionRange(res.selStart, res.selEnd);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const mutInfo = document.createElement('div');
    mutInfo.className = 'concept-edit-mut';
    mutInfo.textContent = '0.8초 자동 저장 · Esc 닫기';

    editBox.append(ta, mutInfo);
    lineEl.after(editBox);

    setTimeout(() => {
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }, 0);
  }

  // 스크랩 인라인 편집기 닫기 (Esc 또는 같은 줄 다시 누름, T45c)
  function closeScrapInlineEdit(scrapId) {
    if (!scrapId) return;
    if (activeScrapEditId === scrapId) {
      activeScrapEditId = null;
    }
    if (shadow) {
      const editBox = shadow.querySelector(`.scrap-inline-edit[data-id="${CSS.escape(scrapId)}"]`);
      editBox?.remove();
      const lineEl = shadow.querySelector(`.sec-shape-line.scrap-line[data-id="${CSS.escape(scrapId)}"]`);
      lineEl?.classList.remove('active');
    }
  }

  // 스크랩 인라인 편집기 열기 / 토글 (T45c)
  function toggleScrapInlineEdit(item, lineEl, wrap) {
    if (!item || !lineEl || !wrap) return;
    const id = item.id;
    if (activeScrapEditId === id) {
      closeScrapInlineEdit(id);
      return;
    }
    if (activeScrapEditId) {
      closeScrapInlineEdit(activeScrapEditId);
    }
    if (activeConceptEditId) {
      closeConceptInlineEdit(activeConceptEditId);
    }

    activeScrapEditId = id;
    lineEl.classList.add('active');

    const editBox = document.createElement('div');
    editBox.className = 'scrap-inline-edit';
    editBox.dataset.id = id;

    const ta = document.createElement('textarea');
    ta.className = 'scrap-edit-textarea';
    ta.maxLength = 1000;
    ta.placeholder = '스크랩 메모를 적으세요...';
    ta.value = item.memo || '';
    autoResize(ta);

    const performScrapMemoSave = () => {
      const memoText = ta.value.trim().slice(0, 1000);
      chrome.runtime.sendMessage({
        type: 'scraps',
        op: 'memo',
        id: item.id,
        memo: memoText,
      }, (res) => {
        if (res?.scraps || res?.ok) {
          item.memo = memoText;
          const pIdx = currentPageItems.findIndex((i) => i.kind === 'scrap' && i.id === item.id);
          if (pIdx !== -1) {
            currentPageItems[pIdx].memo = memoText;
          }
          closeScrapInlineEdit(id);
          // 줄 아래에 메모 한 줄 표시 갱신
          let memoLine = wrap.querySelector('.scrap-memo-text');
          if (memoText) {
            if (!memoLine) {
              memoLine = document.createElement('div');
              memoLine.className = 'scrap-memo-text';
              wrap.append(memoLine);
            }
            memoLine.textContent = `↳ ${memoText}`;
          } else if (memoLine) {
            memoLine.remove();
          }
          showSuccessMeta('메모했어요');
        } else {
          const errMsg = res?.error === 'bridge-off' ? BRIDGE_OFF_TEXT : '저장하지 못했어요';
          showErrorMeta(errMsg);
        }
      });
    };

    ta.addEventListener('input', () => {
      autoResize(ta);
    });

    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        performScrapMemoSave();
        return;
      }
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        e.readglossCardClosed = true;
        closeScrapInlineEdit(id);
        return;
      }
    });

    const mutInfo = document.createElement('div');
    mutInfo.className = 'scrap-edit-mut';
    mutInfo.textContent = '⌘Enter 저장 · Esc 닫기';

    editBox.append(ta, mutInfo);
    lineEl.after(editBox);

    setTimeout(() => {
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }, 0);
  }

  // 모양 줄 렌더링 (메모 줄과 같은 목록, 시간 순서, 작고 옅게, 메모 줄과 구별)
  function createShapeLine(item, sectionKey) {
    if (item.kind === 'memo') {
      return createMemoLine(item, sectionKey);
    }

    const wrap = document.createElement('div');
    wrap.className = 'sec-shape-wrap';

    const line = document.createElement('div');
    line.className = 'sec-shape-line';

    const memoCore = globalThis.readglossMemo;
    const textEl = document.createElement('div');
    textEl.className = 'sec-shape-text';
    textEl.textContent = memoCore?.formatShapeLine ? memoCore.formatShapeLine(item) : (item.text || item.name || '');

    if (item.kind === 'concept' || item.kind === 'later') {
      line.classList.add('concept-line');
      line.dataset.id = item.id;
      line.dataset.conceptId = item.id;
      line.onclick = () => toggleConceptInlineEdit(item, line);
    } else if (item.kind === 'scrap') {
      line.classList.add('scrap-line');
      line.dataset.id = item.id;

      const badge = document.createElement('span');
      badge.className = 'scrap-badge';
      const bar = document.createElement('span');
      bar.className = 'scrap-badge-bar';
      const lbl = document.createElement('span');
      lbl.className = 'scrap-badge-label';
      lbl.textContent = '스크랩';
      badge.append(bar, lbl);
      line.prepend(badge);

      line.onclick = () => toggleScrapInlineEdit(item, line, wrap);
    }

    line.append(textEl);
    wrap.append(line);

    if (item.kind === 'scrap' && item.memo) {
      const memoEl = document.createElement('div');
      memoEl.className = 'scrap-memo-text';
      memoEl.textContent = `↳ ${item.memo}`;
      wrap.append(memoEl);
    }

    // 이미 열려 있던 편집기면 다시 연결
    if (activeConceptEditId === item.id) {
      setTimeout(() => {
        if (activeConceptEditId === item.id && shadow && !wrap.querySelector('.concept-inline-edit')) {
          activeConceptEditId = null;
          toggleConceptInlineEdit(item, line);
        }
      }, 0);
    }
    if (activeScrapEditId === item.id) {
      setTimeout(() => {
        if (activeScrapEditId === item.id && shadow && !wrap.querySelector('.scrap-inline-edit')) {
          activeScrapEditId = null;
          toggleScrapInlineEdit(item, line, wrap);
        }
      }, 0);
    }

    return wrap;
  }

  // !이름 / ?이름 커맨드 처리 (16-3)
  function handleConceptCommand(sectionKey, ta, cmd) {
    if (!cmd || !ta) return;
    chrome.runtime.sendMessage({ type: 'concepts', op: 'get' }, (res) => {
      const conceptsList = Array.isArray(res?.concepts) ? res.concepts : [];
      const cleanName = cmd.name.trim().toLowerCase();
      const existing = conceptsList.find((c) => {
        if (c.name && c.name.trim().toLowerCase() === cleanName) return true;
        if (Array.isArray(c.aliases)) {
          return c.aliases.some((a) => a && a.trim().toLowerCase() === cleanName);
        }
        return false;
      });

      if (existing) {
        // 이미 있는 개념: 새로 만들지 않는다
        // 그 페이지 칸에 그 개념 줄이 있으면 그 줄 편집을 열고
        const lineEl = shadow?.querySelector(`.sec-shape-line.concept-line[data-id="${CSS.escape(existing.id)}"]`);
        if (lineEl) {
          const item = currentPageItems.find((i) => (i.kind === 'concept' || i.kind === 'later') && i.id === existing.id);
          if (item) {
            toggleConceptInlineEdit(item, lineEl);
            lineEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
          }
        }
        // 없으면 globalThis.readglossConceptPage.openForm 으로 연다
        globalThis.readglossConceptPage?.openForm?.({
          id: existing.id,
          name: existing.name,
          aliases: existing.aliases || [],
          tags: existing.tags || [],
          definition: existing.definition || '',
          related: Array.isArray(existing.related)
            ? existing.related.map((r) => (typeof r === 'string' ? r : r?.name)).filter(Boolean)
            : [],
        });
        return;
      }

      // 없으면 ! -> 개념 저장, ? -> 정의 빈 개념 저장
      const cleanDef = cmd.kind === 'concept'
        ? (globalThis.readglossMdList?.cleanForSave ? globalThis.readglossMdList.cleanForSave(cmd.definition) : cmd.definition)
        : '';
      const headingsChain = getHeadingChain(currentHeadings, sectionKey);
      const seen = {
        url: location.href,
        title: (document.title || '').slice(0, 300),
        sentence: '',
        headings: headingsChain,
      };

      chrome.runtime.sendMessage({
        type: 'concepts',
        op: 'save',
        name: cmd.name,
        definition: cleanDef,
        seen,
      }, (saveRes) => {
        if (saveRes?.concept) {
          ta.value = '';
          drafts[sectionKey] = '';
          autoResize(ta);
          saveDrafts();

          const c = saveRes.concept;
          const isLater = !c.definition || c.definition.trim() === '';
          const newItem = {
            kind: isLater ? 'later' : 'concept',
            id: c.id,
            name: c.name || cmd.name,
            definition: c.definition || cleanDef,
            aliases: c.aliases || [],
            tags: c.tags || [],
            related: c.related || [],
            seen: c.seen || seen,
            headings: c.seen?.headings || headingsChain,
            ts: c.ts || Date.now(),
            rawConcept: c,
          };
          currentPageItems.push(newItem);
          rebuildSectionsUI();
          globalThis.readglossLastSave = { kind: 'concept', id: c.id };
          window.dispatchEvent(new CustomEvent('readgloss:concepts-updated'));
          showSuccessMeta(isLater ? '나중에 볼 것에 넣었어요' : '개념을 저장했어요');
        } else {
          const errMsg = saveRes?.error === 'bridge-off' ? BRIDGE_OFF_TEXT : '저장하지 못했어요';
          showErrorMeta(errMsg);
        }
      });
    });
  }

  // 4가지 모양 데이터(메모, 스크랩, 개념, 단어/구) 불러오기 (2번 명세)
  function loadPageShapesAndMemos(targetSectionKey) {
    const memoCore = globalThis.readglossMemo;
    const targetUrl = memoCore?.normalizeUrl ? memoCore.normalizeUrl(location.href) : location.href;

    const pMemos = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'memos', op: 'get', url: location.href }, (res) => {
        if (chrome.runtime.lastError || !res || !Array.isArray(res.memos)) resolve([]);
        else resolve(res.memos);
      });
    });

    const pScraps = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'scraps', op: 'get' }, (res) => {
        if (chrome.runtime.lastError || !res || !Array.isArray(res.scraps)) resolve([]);
        else resolve(res.scraps);
      });
    });

    const pConcepts = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'concepts', op: 'get' }, (res) => {
        if (chrome.runtime.lastError || !res || !Array.isArray(res.concepts)) resolve([]);
        else resolve(res.concepts);
      });
    });

    const pWords = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'words', op: 'get' }, (res) => {
        if (chrome.runtime.lastError || !res) resolve({ saved: {}, phrases: {} });
        else resolve(res);
      });
    });

    Promise.all([pMemos, pScraps, pConcepts, pWords]).then(([memosList, scrapsList, conceptsList, wordsObj]) => {
      currentMemos = Array.isArray(memosList) ? memosList : [];

      const memoItems = currentMemos.map((m) => ({
        kind: 'memo',
        id: m.id,
        text: m.text || '',
        quote: m.quote || null,
        headings: m.headings || [],
        ts: m.ts || 0,
        url: m.url || '',
      }));

      const scrapItems = (Array.isArray(scrapsList) ? scrapsList : [])
        .filter((s) => targetUrl && memoCore?.normalizeUrl && memoCore.normalizeUrl(s.url) === targetUrl)
        .map((s) => ({
          kind: 'scrap',
          id: s.id,
          quote: s.quote,
          text: s.quote?.exact || '',
          memo: s.memo || '',
          headings: s.headings || [],
          pos: s.pos || 0,
          ts: s.ts || 0,
          url: s.url,
        }));

      const conceptItems = (Array.isArray(conceptsList) ? conceptsList : [])
        .filter((c) => targetUrl && memoCore?.normalizeUrl && memoCore.normalizeUrl(c.seen?.url) === targetUrl)
        .map((c) => {
          const isLater = !c.definition || c.definition.trim() === '' || Boolean(c.later);
          return {
            kind: isLater ? 'later' : 'concept',
            id: c.id,
            name: c.name || '',
            definition: c.definition || '',
            aliases: c.aliases || [],
            tags: c.tags || [],
            related: c.related || [],
            seen: c.seen,
            headings: c.seen?.headings || [],
            ts: c.ts || 0,
            rawConcept: c,
          };
        });

      const savedWords = Object.entries(wordsObj?.saved || {})
        .filter(([, w]) => targetUrl && memoCore?.normalizeUrl && memoCore.normalizeUrl(w.url) === targetUrl)
        .map(([lemma, w]) => ({
          kind: 'word',
          id: `w_${lemma}`,
          lemma,
          word: w.word || lemma,
          gloss: w.gloss || '',
          sentence: w.sentence || '',
          headings: w.headings || [],
          ts: w.ts || 0,
          url: w.url,
        }));

      const phraseWords = Object.entries(wordsObj?.phrases || {})
        .filter(([, p]) => targetUrl && memoCore?.normalizeUrl && memoCore.normalizeUrl(p.url) === targetUrl)
        .map(([id, p]) => ({
          kind: 'phrase',
          id,
          text: p.text || '',
          translation: p.translation || '',
          sentence: p.sentence || '',
          headings: p.headings || [],
          ts: p.ts || 0,
          url: p.url,
        }));

      currentPageItems = [
        ...memoItems,
        ...scrapItems,
        ...conceptItems,
        ...savedWords,
        ...phraseWords,
      ];

      if (isOpen && currentMode === 'pad') {
        rebuildSectionsUI();
        if (targetSectionKey) {
          applyActiveSection(true);
        }
      }
      pendingCodeLangKey = null;
    });
  }

  // 메모장 안에서 그 칸이 보이게 scrollIntoView 및 scrollTop 계산
  function scrollToActiveSection(activeEl, container) {
    if (!activeEl || !container) return;
    try {
      activeEl.scrollIntoView({ block: 'nearest' });
    } catch {}
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
          ta.focus({ preventScroll: true });
          const len = ta.value.length;
          ta.setSelectionRange(len, len);
        }
      }
      // 코드 블록 인용 직후: 언어 고르기에 커서. 비우기는 열기 뒤 불러오기·다시 그리기가 끝난 다음(S1)
      if (pendingCodeLangKey) {
        shadow.querySelector(`.sec[data-key="${CSS.escape(pendingCodeLangKey)}"] .sec-quote-lang-select`)?.focus();
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
      // 쓰는 중(쓰는 칸에 포커스가 있고 마지막 입력 뒤 1.5초 안)에는 지금 칸을 바꾸지 않는다.
      const activeTextarea = shadow?.querySelector(`.sec[data-key="${CSS.escape(currentActiveKey)}"] .sec-textarea`);
      const typingFocused = Boolean(activeTextarea && shadow?.activeElement === activeTextarea);
      const msSinceInput = lastTypedAt > 0 ? (Date.now() - lastTypedAt) : Infinity;
      const allowSwitch = memoCore?.shouldSwitchSection
        ? memoCore.shouldSwitchSection({ typingFocused, msSinceInput })
        : (!typingFocused || msSinceInput >= 1500);

      if (!allowSwitch) return;

      // 칸 전환으로 없어지면 activeConceptEditId·activeScrapEditId를 비운다(대기 중 저장은 즉시 보냄, FX-F 5번)
      if (activeConceptEditId) {
        closeConceptInlineEdit(activeConceptEditId);
      }
      if (activeScrapEditId) {
        closeScrapInlineEdit(activeScrapEditId);
      }

      currentActiveKey = newKey;
      rebuildSectionsUI();
    }
  }

  // 소제목 목록 UI 다시 그리기 (입력 내용 유지)
  function rebuildSectionsUI() {
    if (!shadow || !isOpen || currentMode !== 'pad') return;
    const container = shadow.querySelector('.sections-container');
    const prevScrollTop = container ? container.scrollTop : 0;

    // 다시 그리기 전 메모장 내부 포커스 여부 및 현재 활성 요소 (FX-F 3번)
    const padHadFocus = checkPadHasFocus();
    const docActive = document.activeElement;

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

    // 포커스 복귀 여부 판정 (16-6, FX-F 3번):
    // 메모장 안에 이미 커서가 있었을 때만 무조건 되돌리고,
    // 아니면 기본 포커스 판정(shouldReturnFocus·getActiveKind)을 거쳐 허용될 때만 포커스
    const sel = window.getSelection();
    const selectionCollapsed = sel ? sel.isCollapsed : true;
    const cardOpen = isCardOpen();
    const activeKind = getActiveKind(docActive);
    const memoCore = globalThis.readglossMemo;
    const shouldFocus = memoCore?.shouldFocusOnRebuild
      ? memoCore.shouldFocusOnRebuild({ padHadFocus, selectionCollapsed, cardOpen, activeKind, padOpen: isOpen })
      : (padHadFocus || (selectionCollapsed && !cardOpen && activeKind === 'none'));

    applyActiveSection(shouldFocus, padHadFocus);
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

  // 목차 줄을 누르면: 본문의 그 소제목 요소를 scrollIntoView({behavior:'smooth', block:'start'}),
  // 그 칸을 지금 칸으로, 쓰는 칸에 focus({preventScroll:true}), 커서는 글 끝.
  function switchToSection(targetKey) {
    const hObj = currentHeadings.find((h) => h.key === targetKey);
    if (hObj?.el) {
      try {
        hObj.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        hObj.el.scrollIntoView();
      }
    } else if (targetKey === '_page') {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }
    }

    if (targetKey !== currentActiveKey && activeConceptEditId) {
      closeConceptInlineEdit(activeConceptEditId);
    }
    if (targetKey !== currentActiveKey && activeScrapEditId) {
      closeScrapInlineEdit(activeScrapEditId);
    }

    currentActiveKey = targetKey;
    lastTypedAt = 0;
    rebuildSectionsUI();

    const activeEl = shadow?.querySelector(`.sec[data-key="${CSS.escape(targetKey)}"]`);
    const ta = activeEl?.querySelector('.sec-textarea');
    if (ta) {
      ta.focus({ preventScroll: true });
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }

  // 작성 모드 렌더링 (소제목 칸 목록)
  // 쓰는 칸이 비었거나 커서가 맨 앞일 때 Backspace → 그 칸 인용만 뺀다(23-4). 키 처리는 상자 keydown 한 곳에서.
  function dropQuoteOnBackspace(e) {
    const ta = e.target;
    if (!ta?.classList?.contains('sec-textarea')) return false;
    const key = ta.closest('.sec')?.dataset?.key;
    if (!key) return false;
    const memoCore = globalThis.readglossMemo;
    const hasQuote = Boolean(quotes[key]?.exact);
    const shouldDrop = memoCore?.shouldDropQuoteOnBackspace?.({
      key: e.key, composing: e.isComposing,
      mods: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
      value: ta.value, selStart: ta.selectionStart, selEnd: ta.selectionEnd, hasQuote,
    });
    if (!shouldDrop) return false;
    e.preventDefault();
    delete quotes[key];
    saveDrafts();
    const curStart = ta.selectionStart;
    const curEnd = ta.selectionEnd;
    rebuildSectionsUI();
    const newTa = shadow?.querySelector(`.sec[data-key="${CSS.escape(key)}"] .sec-textarea`);
    if (newTa) {
      newTa.focus();
      try { newTa.setSelectionRange(curStart, curEnd); } catch {}
    }
    return true;
  }

  function renderPadUI(root) {
    currentMode = 'pad';
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;

    const box = document.createElement('div');
    box.className = 'pad-box';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const metaTitle = document.createElement('span');
    metaTitle.className = 'meta-title';
    metaTitle.textContent = buildMetaText();

    const metaTime = document.createElement('span');
    metaTime.className = 'meta-time';

    const dockBtn = document.createElement('button');
    dockBtn.type = 'button';
    dockBtn.className = 'btn-dock';
    dockBtn.textContent = isDocked ? '띄우기' : '붙이기';
    dockBtn.setAttribute('aria-label', isDocked ? '떠 있는 창으로 띄우기' : '오른쪽에 붙이기');
    dockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDock();
    });
    dockBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    dockBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    meta.append(metaTitle, metaTime, dockBtn);
    attachDragHandle(meta);

    // 키 이벤트 격리: 페이지 및 다른 기능으로 새지 않게 함
    for (const evtName of ['keydown', 'keypress', 'keyup']) {
      box.addEventListener(evtName, (e) => e.stopPropagation());
    }

    const sectionsContainer = document.createElement('div');
    sectionsContainer.className = 'sections-container';

    const memoCore = globalThis.readglossMemo;
    const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
    const baseSections = memoCore?.buildSections
      ? memoCore.buildSections(currentHeadings, currentMemos, pageTitle)
      : [{ key: '_page', text: pageTitle, level: 1, memos: currentMemos }];
    const sections = memoCore?.assignToSections
      ? memoCore.assignToSections(baseSections, currentPageItems)
      : baseSections;

    for (const s of sections) {
      const sec = document.createElement('div');
      sec.className = 'sec';
      sec.dataset.key = s.key;
      const isActive = s.key === currentActiveKey;
      const indent = Math.max(0, Math.min(2, (s.level || 1) - 1)) * 8;

      if (isActive) {
        // 지금 칸만 펼침: 소제목 글, 그 칸 줄들, 쓰는 칸
        sec.classList.add('on');

        const titleEl = document.createElement('div');
        titleEl.className = 'sec-title';
        titleEl.textContent = s.text || '(제목 없음)';
        titleEl.style.paddingLeft = `${indent}px`;
        sec.append(titleEl);

        const memosContainer = document.createElement('div');
        memosContainer.className = 'sec-memos';
        const itemsToRender = Array.isArray(s.items) && s.items.length > 0 ? s.items : (Array.isArray(s.memos) ? s.memos : []);
        for (const item of itemsToRender) {
          memosContainer.append(createShapeLine(item, s.key));
        }
        sec.append(memosContainer);

        const qData = quotes[s.key];
        if (qData && typeof qData.exact === 'string' && qData.exact.length > 0) {
          const quoteEl = document.createElement('div');
          quoteEl.className = 'sec-quote';
          if (qData.code) {
            quoteEl.classList.add('code-quote');
            if (qData.code.block) {
              quoteEl.classList.add('code-block');
            }
          }

          const quoteContent = document.createElement('div');
          quoteContent.className = 'sec-quote-content';

          let langSelect = null;
          if (qData.code?.block) {
            langSelect = document.createElement('select');
            langSelect.className = 'sec-quote-lang-select';
            langSelect.setAttribute('aria-label', '코드 언어 선택');
            const langList = memoCore?.CODE_LANG_LIST || [
              '자동', 'plaintext', 'bash', 'python', 'javascript', 'typescript',
              'json', 'html', 'css', 'sql', 'c', 'cpp', 'java', 'go', 'rust',
              'powershell', 'yaml', 'http',
            ];
            for (const lang of langList) {
              const opt = document.createElement('option');
              opt.value = lang;
              opt.textContent = lang;
              langSelect.append(opt);
            }
            langSelect.value = qData.code.lang || '자동';
            langSelect.addEventListener('change', () => {
              const val = langSelect.value === '자동' ? '' : langSelect.value;
              qData.code.lang = val;
              saveDrafts();
              const taEl = sec.querySelector('.sec-textarea');
              if (taEl) taEl.focus();
            });
            quoteContent.append(langSelect);
          }

          const quoteText = document.createElement('div');
          quoteText.className = 'sec-quote-text';

          const isTutor = qData.source === 'tutor';
          const timeStr = qData.tutor?.time || '';

          if (qData.table) {
            quoteEl.classList.add('table-quote');
            const tableEl = renderTableElement(qData.table);
            if (tableEl) {
              quoteText.append(tableEl);
            }
            quoteEl.onclick = (e) => {
              if (e.target === quoteDel) return;
            };
          } else if (isTutor) {
            let isExpanded = false;
            const renderQuoteText = () => {
              quoteText.textContent = isExpanded ? `❝ 튜터 ${timeStr}\n${qData.exact}` : `❝ 튜터 ${timeStr} · ${qData.exact.slice(0, 60)}${qData.exact.length > 60 ? '…' : ''}`;
            };
            renderQuoteText();
            quoteEl.onclick = (e) => {
              if (e.target === quoteDel) return;
              isExpanded = !isExpanded;
              quoteEl.classList.toggle('expanded', isExpanded);
              if (isExpanded) {
                quoteText.style.whiteSpace = 'pre-wrap';
              } else {
                quoteText.style.whiteSpace = '';
              }
              renderQuoteText();
            };
          } else if (qData.code?.block) {
            quoteText.textContent = qData.exact;
            quoteEl.onclick = (e) => {
              if (e.target === quoteDel || e.target === langSelect) return;
            };
          } else if (qData.code) {
            quoteText.textContent = qData.exact;
            quoteEl.onclick = (e) => {
              if (e.target === quoteDel) return;
              quoteEl.classList.toggle('expanded');
            };
          } else {
            quoteText.textContent = `“${qData.exact}”`;
            quoteEl.onclick = (e) => {
              if (e.target === quoteDel) return;
              quoteEl.classList.toggle('expanded');
            };
          }

          quoteContent.append(quoteText);

          if (qData.translation && typeof qData.translation === 'string' && qData.translation.trim()) {
            const quoteTrans = document.createElement('div');
            quoteTrans.className = 'sec-quote-trans';
            quoteTrans.textContent = qData.translation.trim();
            quoteContent.append(quoteTrans);
          }

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

          quoteEl.append(quoteContent, quoteDel);
          sec.append(quoteEl);
        }

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

        ta.addEventListener('paste', async (e) => {
          const pastedText = e.clipboardData?.getData('text/plain') || '';
          const cleanText = pastedText.trim().replace(/\s+/g, ' ');

          // 공백 정리해 15자 미만이면 기본 동작
          if (cleanText.length < 15) return;

          // 15자 이상이면 기본 동작을 막음
          e.preventDefault();

          // 1. 시작 시점 상태 캡처: 대상 칸 key 고정 (FX-F 1번)
          const memoCore = globalThis.readglossMemo;
          const targetKey = memoCore?.targetKeyOnPaste ? memoCore.targetKeyOnPaste(s.key, currentActiveKey) : s.key;
          const initialDocActive = document.activeElement;
          const initialShadowActive = shadow?.activeElement;
          lastTypedAt = Date.now();

          // 기다리는 동안 lastTypedAt을 갱신해 칸 전환을 막는다 (17-1 "쓰는 중" 규칙)
          const keepAliveInterval = setInterval(() => {
            lastTypedAt = Date.now();
          }, 200);

          // 비동기 응답 뒤 포커스 복원 여부 판정 (FX-F 2번)
          const canRestoreFocus = () => {
            const curDocActive = document.activeElement;
            const curShadowActive = shadow?.activeElement;
            const isPage = memoCore?.isPageField ? memoCore.isPageField(curDocActive) : false;
            const activeKind = getActiveKind(curDocActive);
            if (memoCore?.shouldRestorePasteFocus) {
              return memoCore.shouldRestorePasteFocus({
                initialDocActive,
                currentDocActive: curDocActive,
                initialShadowActive,
                currentShadowActive: curShadowActive,
                isPageField: isPage,
                activeKind,
              });
            }
            if (isPage || activeKind === 'our-host') return false;
            if (initialDocActive && curDocActive && initialDocActive !== curDocActive) return false;
            if (initialShadowActive && curShadowActive && initialShadowActive !== curShadowActive) return false;
            return true;
          };

          try {
            // 1. 본문에 그 글이 있는지 검색 (본문 색인·quoteOf 재사용, 공백 정리 비교)
            let inPage = false;
            let pageQuote = null;
            const scrapPage = globalThis.readglossScrapPage;
            const scrapCore = globalThis.readglossScrap;

            if (scrapPage?.buildTextIndex) {
              const { fullText } = scrapPage.buildTextIndex();
              if (fullText) {
                const words = cleanText.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                try {
                  const re = new RegExp(words.join('\\s+'));
                  const m = re.exec(fullText);
                  if (m) {
                    inPage = true;
                    const start = m.index;
                    const end = m.index + m[0].length;
                    const q = scrapCore?.quoteOf ? scrapCore.quoteOf(fullText, start, end) : { exact: m[0], prefix: '', suffix: '' };
                    pageQuote = {
                      exact: q.exact.slice(0, 1000),
                      prefix: (q.prefix || '').slice(0, 64),
                      suffix: (q.suffix || '').slice(0, 64),
                    };
                  }
                } catch {}
              }
            }

            if (inPage && pageQuote) {
              const hadQuote = Boolean(quotes[targetKey] && quotes[targetKey].exact);
              quotes[targetKey] = pageQuote;
              saveDrafts();
              rebuildSectionsUI();
              if (hadQuote) {
                showPadToastNotice('인용을 바꿨어요', 2000);
              }
              return;
            }

            // 2. 없으면 tutor-quote를 묻는다 (최대 1.5초, 넘으면 못 찾음)
            let tutorRes = null;
            try {
              const fetchPromise = new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'tutor-quote', text: pastedText }, (res) => {
                  resolve(res);
                });
              });
              const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => resolve({ found: false, timeout: true }), 1500);
              });
              tutorRes = await Promise.race([fetchPromise, timeoutPromise]);
            } catch {
              tutorRes = { found: false };
            }

            const tutorFound = Boolean(tutorRes && tutorRes.found);
            const decision = memoCore?.classifyPaste
              ? memoCore.classifyPaste({ text: pastedText, inPage: false, tutorFound })
              : (tutorFound ? 'tutor' : 'text');

            if (decision === 'tutor') {
              const hadQuote = Boolean(quotes[targetKey] && quotes[targetKey].exact);
              quotes[targetKey] = {
                exact: cleanText.slice(0, 1000),
                prefix: '',
                suffix: '',
                source: 'tutor',
                tutor: {
                  date: tutorRes.date,
                  time: tutorRes.time,
                  title: tutorRes.title,
                },
              };
              saveDrafts();
              rebuildSectionsUI();
              if (hadQuote) {
                showPadToastNotice('인용을 바꿨어요', 2000);
              }
            } else {
              // 3. 그냥 글: 그 칸 쓰는 칸이 지금 화면에 있으면 거기 커서 자리에, 없으면 drafts 끝에 붙임
              const targetSec = shadow?.querySelector(`.sec[data-key="${CSS.escape(targetKey)}"]`);
              const targetTa = targetSec?.querySelector('.sec-textarea');
              if (targetTa) {
                if (canRestoreFocus()) {
                  insertTextAtCursor(targetTa, pastedText);
                } else {
                  const start = targetTa.selectionStart ?? targetTa.value.length;
                  const end = targetTa.selectionEnd ?? targetTa.value.length;
                  targetTa.setRangeText(pastedText, start, end, 'end');
                  drafts[targetKey] = targetTa.value;
                  targetTa.dispatchEvent(new Event('input', { bubbles: true }));
                }
              } else {
                drafts[targetKey] = (drafts[targetKey] || '') + pastedText;
                saveDrafts();
              }
            }
          } finally {
            clearInterval(keepAliveInterval);
            lastTypedAt = Date.now();
          }
        });

        sec.append(ta);
      } else {
        // 다른 칸은 목차 한 줄: 소제목 글 · N분 · 메모 N · 쓰던 글이 있으면 "쓰는 중"
        sec.classList.add('sec-toc-row');

        const memoCount = Array.isArray(s.memos)
          ? s.memos.length
          : (Array.isArray(s.items) ? s.items.filter((i) => i.kind === 'memo').length : 0);
        const draftText = drafts[s.key] || '';
        const hasDraft = draftText.trim().length > 0;

        const st = globalThis.readglossStudyTime;
        const headingChain = getHeadingChain(currentHeadings, s.key);
        const headingSec = (st && typeof st.sectionSeconds === 'function') ? st.sectionSeconds(headingChain) : 0;
        const minutes = headingSec >= 60 ? Math.floor(headingSec / 60) : 0;

        const fullLabel = memoCore?.tocLabel
          ? memoCore.tocLabel({ title: s.text || '(제목 없음)', minutes, memoCount, hasDraft })
          : (s.text || '(제목 없음)');

        const tocBtn = document.createElement('button');
        tocBtn.type = 'button';
        tocBtn.className = 'sec-toc-btn';
        tocBtn.setAttribute('aria-label', fullLabel);
        tocBtn.style.paddingLeft = `${indent + 4}px`;

        const titleEl = document.createElement('b');
        titleEl.className = 'sec-toc-title';
        titleEl.textContent = s.text || '(제목 없음)';
        tocBtn.append(titleEl);

        const metaParts = [];
        if (minutes > 0) metaParts.push(`${minutes}분`);
        if (memoCount > 0) metaParts.push(`메모 ${memoCount}`);
        if (hasDraft) metaParts.push('쓰는 중');
        if (metaParts.length > 0) {
          const metaSpan = document.createElement('span');
          metaSpan.className = 'sec-toc-meta';
          metaSpan.textContent = ` · ${metaParts.join(' · ')}`;
          tocBtn.append(metaSpan);
        }

        tocBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          switchToSection(s.key);
        });
        tocBtn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            switchToSection(s.key);
          }
        });

        sec.append(tocBtn);
      }

      sectionsContainer.append(sec);
    }

    const info = document.createElement('div');
    info.className = 'mut';
    info.textContent = '⌘Enter 저장 · Enter 줄바꿈 · Esc·⌥M 접기 · ⌥⇧M 지난 메모';

    // ⌘Enter 저장 · Esc 접기 · ⌥⇧M 목록: 메모장 안 어디에 포커스가 있어도 동작한다. 칸 밖이면 지금 칸 글을 쓴다.
    box.addEventListener('keydown', (e) => {
      if (e.target?.classList?.contains('sec-quote-lang-select') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          const sec = e.target.closest('.sec');
          const ta = sec?.querySelector('.sec-textarea');
          if (ta) ta.focus();
          return;
        }
      }
      if (e.key === 'Backspace' && dropQuoteOnBackspace(e)) return;
      if ((e.key === 'Escape' || e.key === 'Esc') && e.readglossCardClosed) return;
      const action = memoCore?.padKeyV2 ? memoCore.padKeyV2(e) : null;
      const key = e.target?.closest?.('.sec')?.dataset?.key || currentActiveKey;
      if (action === 'save') {
        e.preventDefault();
        const ta = box.querySelector(`.sec[data-key="${CSS.escape(key)}"] .sec-textarea`);
        const cmd = memoCore?.parseConceptCommand ? memoCore.parseConceptCommand(ta?.value || '') : null;
        if (cmd) {
          handleConceptCommand(key, ta, cmd);
        } else {
          performSave(key, ta);
        }
      } else if (action === 'newline') {
        // 대상을 지금 잡아 둔다: 이벤트가 끝난 뒤 e.target 은 메모장 host 로 바뀌어(shadow 재지정) host 높이를 망가뜨린다
        const ta = e.target;
        if (ta?.classList?.contains('sec-textarea')) setTimeout(() => autoResize(ta), 0);
      } else if (action === 'fold') {
        if (e.readglossCardClosed) return;
        e.preventDefault();
        if (activeConceptEditId) {
          closeConceptInlineEdit(activeConceptEditId);
        } else if (activeScrapEditId) {
          closeScrapInlineEdit(activeScrapEditId);
        } else {
          closePad();
        }
      } else if (e.altKey && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        openListUI(root);
      }
    });

    const resizeHandle = createResizeHandle();
    if (isDocked) resizeHandle.style.display = 'none';

    const dockHandle = createDockResizeHandle();

    box.append(dockHandle, meta, sectionsContainer, info, resizeHandle);
    if (isDocked) box.classList.add('docked');
    root.append(style, box);
    updateStudyTimeUI();
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
    syncPageMargin();
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

    // 열 때 모든 모양 불러오기 (2번 명세)
    loadPageShapesAndMemos(targetSectionKey);

    // 메모장이 열려 있을 때 오늘 공부 시간 1초 갱신 타이머 시작 (T40b)
    startStudyTimeTimer();
  }

  // 메모장 접기(닫기)
  function closePad() {
    pendingCodeLangKey = null;
    clearTimeout(typingTimer);
    clearTimeout(returnFocusTimer);
    stopStudyTimeTimer();
    if (activeConceptEditId) {
      closeConceptInlineEdit(activeConceptEditId);
    }
    if (activeScrapEditId) {
      closeScrapInlineEdit(activeScrapEditId);
    }
    if (shadow && currentMode === 'pad') {
      const textareas = shadow.querySelectorAll('.sec-textarea');
      for (const ta of textareas) {
        const sec = ta.closest('.sec');
        const key = sec?.dataset?.key;
        if (key) drafts[key] = ta.value;
      }
    }
    endEdit(); // 고치는 중 닫으면 그만둔 것이다: 칸을 보관한 초안으로 되돌린다
    isOpen = false;
    currentMode = 'pad';
    syncPageMargin();
    removeHost();
    saveDrafts();
  }

  // 목록 모드로 열기
  function openList() {
    clearTimeout(typingTimer);
    stopStudyTimeTimer();
    if (activeConceptEditId) {
      closeConceptInlineEdit(activeConceptEditId);
    }
    if (activeScrapEditId) {
      closeScrapInlineEdit(activeScrapEditId);
    }
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
      // 고치던 중 새로고침했으면 고치기는 그만둔 것이다(고치는 상태는 저장하지 않는다): 보관한 초안을 칸으로 되돌린다
      if (res.stash && typeof res.stash === 'object') {
        for (const k of Object.keys(res.stash)) {
          if (res.stash[k]) drafts[k] = res.stash[k];
        }
      }
      stash = {};
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

  // 코드 인용 블록 언어 고르기(select)로 포커스
  function focusCodeLangSelect(sectionKey) {
    if (!shadow) return;
    setTimeout(() => {
      const secEl = shadow.querySelector(`.sec[data-key="${CSS.escape(sectionKey)}"]`);
      const selEl = secEl?.querySelector('.sec-quote-lang-select');
      if (selEl) {
        selEl.focus();
      }
    }, 0);
  }

  // 인용을 소제목 칸에 붙이고 메모장을 열거나 갱신 (T45c 계약)
  function attachQuote(quote, anchorNode, { focusCodeLang = false } = {}) {
    if (!quote) return;
    currentHeadings = collectHeadings();
    lastHeadingsCount = currentHeadings.length;
    const targetKey = findHeadingKeyForNode(anchorNode, currentHeadings);

    quotes[targetKey] = quote;
    currentActiveKey = targetKey;
    saveDrafts();

    if (isOpen && currentMode === 'pad') {
      rebuildSectionsUI();
      lastTypedAt = 0;
      applyActiveSection(true);
      if (focusCodeLang) {
        focusCodeLangSelect(targetKey);
      }
    } else {
      // 닫힌 메모장: 열린 뒤 다시 그리기가 커서를 쓰는 칸으로 옮기므로 키를 기억해 그 뒤에 언어 고르기로 보낸다
      if (focusCodeLang) pendingCodeLangKey = targetKey;
      openPad(targetKey);
      if (focusCodeLang) {
        focusCodeLangSelect(targetKey);
      }
    }
  }

  // 표 칸 안의 글 추출: code·kbd·samp 요소는 백틱(글에 백틱 있으면 이중 백틱)으로 감싸고 나머지는 textContent (T50)
  function extractTableCellText(cell) {
    if (!cell) return '';
    let result = '';
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        result += node.nodeValue || '';
        return;
      }
      if (node.nodeType === 1) {
        const tag = (node.localName || node.tagName || '').toLowerCase();
        if (tag === 'code' || tag === 'kbd' || tag === 'samp') {
          const t = node.textContent || '';
          if (t.includes('`')) {
            result += `\`\`${t}\`\``;
          } else {
            result += `\`${t}\``;
          }
          return;
        }
        for (let child = node.firstChild; child; child = child.nextSibling) {
          walk(child);
        }
      }
    }
    walk(cell);
    return result;
  }

  // ⌥M with 고른 글 또는 토글 처리 (scrap: Tab 경로에서 스크랩 동시 실행)
  function handleMemoOpen({ scrap = false } = {}) {
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim().length > 0;

    let isOurHost = false;
    let range = null;
    if (hasSelection) {
      range = sel.getRangeAt(0);
      isOurHost = isInsideOurHost(range.startContainer) || isInsideOurHost(range.commonAncestorContainer);
    }

    if (hasSelection && !isOurHost) {
      // 1. 두 카드 close() — 닫으면 번역이 비므로 close 전에 현재 번역을 읽어 둔다
      const selTrans = globalThis.readglossSelectionUi?.currentTranslation?.() || '';
      globalThis.readglossSelectionUi?.close?.();
      globalThis.readglossDictCardUi?.close?.();

      // 2. 선택 범위로 quoteForRange 구하기 (반환은 { quote: {exact, prefix, suffix}, pos } | null)
      const q = globalThis.readglossScrapPage?.quoteForRange?.(range)?.quote;
      const existing = globalThis.readglossScrapPage?.findExisting?.(q?.exact);
      const translation = existing?.translation || selTrans || '';
      const extracted = q && typeof q.exact === 'string' && q.exact.length > 0
        ? {
            exact: q.exact,
            prefix: q.prefix || '',
            suffix: q.suffix || '',
            ...(translation ? { translation } : {}),
          }
        : null;

      if (!extracted) {
        // 인용 없이 열고 메모장 위에 "이 글은 인용할 수 없어요" 1.5초
        if (!isOpen) {
          openPad();
        }
        showPadToastNotice('이 글은 인용할 수 없어요', 1500);
        return;
      }

      // 표 인용 검사 (T50): 범위 시작·끝의 closest('table')이 같은 표면 rowsInfo를 구성하여 표 인용 생성
      if (range) {
        const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
        const startTable = startEl?.closest('table');
        const endTable = endEl?.closest('table');
        if (startTable && endTable && startTable === endTable) {
          const rowsInfo = [];
          for (const tr of startTable.rows) {
            const selected = range.intersectsNode(tr);
            const inThead = tr.parentElement?.localName === 'thead';
            const cells = [];
            for (const cell of tr.cells) {
              const th = cell.localName === 'th';
              const text = extractTableCellText(cell);
              cells.push({ text, th });
            }
            rowsInfo.push({ cells, inThead, selected });
          }
          const memoCore = globalThis.readglossMemo;
          const tableResult = memoCore?.tableQuoteFrom ? memoCore.tableQuoteFrom(rowsInfo) : null;
          if (tableResult?.table) {
            extracted.table = tableResult.table;
            delete extracted.translation;
            if (tableResult.truncated) {
              showPadToastNotice('표가 커서 일부만 담았어요(30줄·8칸·칸 300자까지)', 2000);
            }
          }
        }
      }

      // 3. 드래그 + Tab 경로: 인용을 붙이기 전에(기다리지 말고 동시에) scrapRange 호출
      if (scrap && range) {
        const cloned = range.cloneRange();
        Promise.resolve(globalThis.readglossSelectionUi?.scrapRange?.(cloned, { translation }))
          .then((res) => {
            if (!res || !res.ok) {
              showPadToastNotice('스크랩은 못 했어요(인용은 붙음)', 2000);
            }
          })
          .catch(() => {
            showPadToastNotice('스크랩은 못 했어요(인용은 붙음)', 2000);
          });
      }

      // 4. 공통 함수를 통해 인용 붙이고 열기 (T45c)
      attachQuote(extracted, range.startContainer);
      return;
    }

    // 선택이 비었으면 지금처럼 토글
    if (isOpen) {
      closePad();
    } else {
      openPad();
    }
  }

  // 앞뒤 빈 줄만 정리 (내부 줄바꿈 및 들여쓰기는 보존)
  function trimBlankLines(str) {
    if (typeof str !== 'string') return '';
    const lines = str.split(/\r?\n/);
    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.join('\n');
  }

  // 선택 범위의 가장 가까운 pre·code 요소(자기·조상)들의 class를 모음
  function collectCodeClasses(node) {
    const classes = [];
    let curr = node && (node.nodeType === 1 ? node : node.parentElement);
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const tag = (curr.localName || curr.tagName || '').toLowerCase();
      if (tag === 'pre' || tag === 'code') {
        if (curr.className && typeof curr.className === 'string') {
          classes.push(curr.className);
        }
      }
      curr = curr.parentElement;
    }
    return classes;
  }

  // 단축키 커맨드(memo-open, memo-list) 및 고른 글 단축키(Tab = 인용, D = 개념, C = 코드 인용) (T48, T49)
  document.addEventListener('keydown', (e) => {
    // 값싼 걸러내기(N8): 단축키 키가 아니면 getSelection·composedPath 계산 없이 바로 나간다
    const k = e.key;
    if (k !== 'Tab' && k !== 'd' && k !== 'D' && k !== 'ㅇ' && k !== 'c' && k !== 'C' && k !== 'ㅊ'
      && e.code !== 'KeyD' && e.code !== 'KeyC') return;
    const sel = window.getSelection();
    const hasSelection = Boolean(sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim().length > 0);
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const inOurUi = path.some((n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-'));
    const memoCore = globalThis.readglossMemo;
    // shadow DOM 안 편집 영역도 입력칸으로 본다(N6)
    const pageField = (memoCore?.isPageField ? memoCore.isPageField(document.activeElement) : false)
      || path.some((n) => n?.isContentEditable === true
        || ['input', 'textarea', 'select'].includes(String(n?.localName || '').toLowerCase()));

    const action = memoCore?.shortcutAction?.(e, { hasSelection, pageField, inOurUi });

    if (!action) return;

    if (action === 'tab-quote') {
      e.preventDefault();
      e.stopPropagation();
      handleMemoOpen({ scrap: true });
    } else if (action === 'concept') {
      e.preventDefault();
      e.stopPropagation();
      globalThis.readglossSelectionUi?.close?.();
      globalThis.readglossDictCardUi?.close?.();

      const rawText = sel.toString();
      const name = rawText.trim().replace(/\s+/g, ' ').slice(0, 80);
      const range = sel.getRangeAt(0);
      const anchor = globalThis.readglossToast?.rectOf ? globalThis.readglossToast.rectOf(range) : undefined;
      const existing = globalThis.readglossScrapPage?.findExisting?.(name);
      const scrapId = existing?.id ?? undefined;

      let sentence = '';
      if (range) {
        try {
          const blockOf = globalThis.readglossBlockOf;
          const block = blockOf ? blockOf(range.startContainer) : null;
          if (block && globalThis.readgloss?.plainTextAt && globalThis.readgloss?.extractSentence) {
            const { text: plain, offset } = globalThis.readgloss.plainTextAt(block, range.startContainer, range.startOffset);
            sentence = globalThis.readgloss.extractSentence(plain, offset, name.length);
          }
        } catch {}
      }

      const seed = {
        name,
        range,
        anchor,
        ...(scrapId ? { scrapId } : {}),
        ...(sentence ? { sentence } : {}),
      };

      globalThis.readglossConceptPage?.openForm?.(seed);
    } else if (action === 'code') {
      e.preventDefault();
      e.stopPropagation();
      globalThis.readglossSelectionUi?.close?.();
      globalThis.readglossDictCardUi?.close?.();

      const rawText = sel.toString();
      const codeText = trimBlankLines(rawText);
      if (!codeText) return;

      if (codeText.length > 1000) {
        showToastNotice('인용하기엔 너무 길어요');
        return;
      }

      const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      const startNode = range?.startContainer;
      const kind = memoCore?.codeQuoteKind ? memoCore.codeQuoteKind(codeText) : 'inline';
      const isBlock = kind === 'block';
      const classes = collectCodeClasses(startNode);
      const guessedLang = memoCore?.guessCodeLang ? memoCore.guessCodeLang(classes) : '';

      const q = range ? globalThis.readglossScrapPage?.quoteForRange?.(range)?.quote : null;
      const prefix = q?.prefix || '';
      const suffix = q?.suffix || '';

      const codeQuote = {
        exact: codeText,
        prefix,
        suffix,
        code: {
          lang: guessedLang || '',
          block: isBlock,
        },
      };

      attachQuote(codeQuote, startNode, { focusCodeLang: isBlock });
    }
  }, true);

  // 개념 저장 뒤 메모장에 바로 보이기 (T48)
  window.addEventListener('readgloss:concepts-updated', (e) => {
    // 메모장 안 자동 저장이 쏘는 이벤트(detail 없음)는 무시한다: 다시 그리면 커서가 끝으로 튄다.
    // 개념 편집기가 열려 있는 동안에도 다시 그리지 않는다.
    if (!e.detail?.id || activeConceptEditId) return;
    if (isOpen && currentMode === 'pad') {
      loadPageShapesAndMemos();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'memo-command') return;
    const cmd = msg.cmd;

    if (cmd === 'memo-open') {
      handleMemoOpen();
    } else if (cmd === 'memo-list') {
      openList();
    }
  });

  // ---------------------------------------------------------------------------
  // 쓰는 칸 기본 포커스 (T34b, FX-C)
  // 본문 mouseup·keyup·selectionchange 뒤 0.3초에 조건이 모두 참이면 쓰는 칸으로 포커스 복귀
  // ---------------------------------------------------------------------------

  function isCardOpen() {
    const cardSelectors = [
      'readgloss-selection',
      'readgloss-card',
      'readgloss-concept-form',
      'readgloss-concept-card',
      'readgloss-scrap-bar',
      'readgloss-scrap-card',
      'readgloss-struct-card',
    ];
    for (const sel of cardSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        if (el.hidden || el.style.display === 'none' || el.style.visibility === 'hidden') continue;
        try {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
        } catch {}
        return true;
      }
    }
    return false;
  }

  function getActiveKind(activeEl) {
    if (!activeEl || activeEl === document.body || activeEl === document.documentElement) {
      return 'none';
    }
    const tag = (activeEl.localName || activeEl.tagName || '').toLowerCase();
    if (tag === 'iframe') {
      return 'page-field';
    }
    if (activeEl.shadowRoot && !tag.startsWith('readgloss-')) {
      return 'page-field';
    }
    const memoCore = globalThis.readglossMemo;
    if (memoCore?.isPageField && memoCore.isPageField(activeEl)) {
      return 'page-field';
    }
    if (activeEl.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName)) {
      return 'page-field';
    }
    const otherHostTags = [
      'readgloss-ui',
      'readgloss-concept-form',
      'readgloss-toast',
      'readgloss-concept-card',
      'readgloss-scrap-bar',
      'readgloss-scrap-card',
      'readgloss-struct-card',
    ];
    let curr = activeEl;
    while (curr) {
      const curTag = (curr.localName || curr.tagName || '').toLowerCase();
      if (otherHostTags.includes(curTag)) {
        return 'our-host';
      }
      if (curr.getRootNode && curr.getRootNode() instanceof ShadowRoot) {
        curr = curr.getRootNode().host;
        continue;
      }
      curr = curr.parentElement;
    }
    return 'none';
  }

  function checkPadHasFocus() {
    if (!host) return false;
    if (document.activeElement === host) return true;
    if (shadow?.activeElement) return true;
    if (host.contains(document.activeElement)) return true;
    return false;
  }

  function focusActiveTextarea() {
    if (!shadow || !isOpen || currentMode !== 'pad') return;
    const activeEl = shadow.querySelector(`.sec[data-key="${CSS.escape(currentActiveKey)}"]`);
    const ta = activeEl?.querySelector('.sec-textarea') || shadow.querySelector('.sec.on .sec-textarea') || shadow.querySelector('.sec-textarea');
    if (ta) {
      ta.focus({ preventScroll: true });
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }

  function scheduleReturnFocus() {
    if (!isOpen || currentMode !== 'pad' || isComposing) return;
    clearTimeout(returnFocusTimer);
    returnFocusTimer = setTimeout(() => {
      if (!isOpen || currentMode !== 'pad' || isComposing) return;
      const sel = window.getSelection();
      const selectionCollapsed = sel ? sel.isCollapsed : true;
      const cardOpen = isCardOpen();
      const activeKind = getActiveKind(document.activeElement);
      const padHasFocus = checkPadHasFocus();
      const memoCore = globalThis.readglossMemo;
      const should = memoCore?.shouldReturnFocus
        ? memoCore.shouldReturnFocus({ selectionCollapsed, cardOpen, activeKind, padHasFocus, padOpen: isOpen })
        : (selectionCollapsed && !cardOpen && !padHasFocus && activeKind === 'none');
      if (should) {
        focusActiveTextarea();
      }
    }, 300);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('mouseup', scheduleReturnFocus);
    document.addEventListener('keyup', scheduleReturnFocus);
    document.addEventListener('selectionchange', scheduleReturnFocus);
    document.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    document.addEventListener('compositionend', () => {
      isComposing = false;
      scheduleReturnFocus();
    });
  }

  // ---------------------------------------------------------------------------
  // 공부 모드(setStudyMode): on이면 열고 붙인다, off면 붙이기 전 상태로 (저장값 바꾸지 않음)
  // ---------------------------------------------------------------------------
  function setStudyMode(on) {
    const nextOn = Boolean(on);
    if (nextOn) {
      studyMode = true;
      if (preStudyDockState === null) {
        preStudyDockState = { open: isOpen, docked: isDocked };
      }
      if (!isOpen) {
        openPad();
      }
      if (!isDocked) {
        applyDock(dockWidthValue);
      }
      syncPageMargin();
    } else {
      studyMode = false;
      if (preStudyDockState) {
        const { open: wasOpen, docked: wasDocked } = preStudyDockState;
        preStudyDockState = null;
        isDocked = wasDocked;
        if (!wasDocked) {
          applyAnchored(savedAnchored);
          updateDockUI();
        } else {
          applyDock(dockWidthValue);
        }
        if (!wasOpen && isOpen) {
          closePad();
        }
      } else {
        if (isDocked) {
          isDocked = false;
          applyAnchored(savedAnchored);
          updateDockUI();
        }
      }
      syncPageMargin();
    }
  }

  globalThis.readglossMemoPad = globalThis.readglossMemoPad || {};
  globalThis.readglossMemoPad.attachQuote = attachQuote;
  globalThis.readglossMemoPad.setStudyMode = setStudyMode;
  globalThis.readglossMemoPad.syncPageMargin = syncPageMargin;
  globalThis.readglossMemoPad.getActiveKind = getActiveKind;
  globalThis.readglossMemoPad.isCardOpen = isCardOpen;

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
