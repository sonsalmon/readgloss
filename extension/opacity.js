// extension/opacity.js
// 투명도 두 가지·읽는 동안 흐리게(T34a, 명세 16-6).
// 우리 화면 host(메모장·카드·패널 등) 전체에 투명도를 걸고, documentElement 에 --rg-ui-alpha, --rg-input-alpha CSS 변수를 설정한다.
// 순수 함수(stateAfter, computeAlpha 등)는 globalThis.readglossOpacity 로 공개되어 node 시험에서도 쓸 수 있다.
(() => {
  const HOST_TAGS = Object.freeze([
    'readgloss-memo-pad',
    'readgloss-selection',
    'readgloss-card',
    'readgloss-ui',
    'readgloss-panel',
    'readgloss-concept-card',
    'readgloss-concept-form',
    'readgloss-toast',
  ]);
  const HOST_SELECTOR = HOST_TAGS.join(', ');
  const STYLE_ID = 'readgloss-opacity-style';
  const TIMEOUT_MS = 1500;

  // 순수 함수: 초기 상태
  function createInitialState({ dimWhileReading = true, now = 0 } = {}) {
    return {
      dimWhileReading: Boolean(dimWhileReading),
      solid: false,
      isSolid: false,
      mouseInMemo: false,
      lastInputAt: now,
    };
  }

  // 순수 함수: 이벤트 발생 후 상태 전이
  // stateAfter(event, now) 꼴과 stateAfter(prev, event, now) 꼴 둘 다 지원한다.
  let _internalState = createInitialState();

  function stateAfter(arg1, arg2, arg3) {
    let prev, event, now;
    if (arg2 === undefined || typeof arg2 === 'number') {
      prev = _internalState;
      event = arg1;
      now = typeof arg2 === 'number' ? arg2 : Date.now();
    } else {
      prev = arg1 || _internalState;
      event = arg2;
      now = typeof arg3 === 'number' ? arg3 : Date.now();
    }

    const next = { ...prev };
    const type = event?.type;

    if (type === 'settings-change' || event?.dimWhileReading !== undefined) {
      if (typeof event.dimWhileReading === 'boolean') {
        next.dimWhileReading = event.dimWhileReading;
      }
    }

    if (!next.dimWhileReading) {
      // 읽는 동안 흐리게가 꺼져 있으면 진해지지 않고 항상 false(설정 값 그대로)
      next.solid = false;
      next.isSolid = false;
      if (arg2 === undefined || typeof arg2 === 'number') _internalState = next;
      return next;
    }

    if (type === 'memo-open') {
      next.solid = true;
      next.isSolid = true;
    } else if (type === 'memo-enter' || type === 'mouseenter') {
      next.mouseInMemo = true;
      next.solid = true;
      next.isSolid = true;
    } else if (type === 'memo-leave' || type === 'mouseleave') {
      next.mouseInMemo = false;
      if (now - (next.lastInputAt || 0) >= TIMEOUT_MS) {
        next.solid = false;
        next.isSolid = false;
      }
    } else if (type === 'memo-input' || type === 'input') {
      next.lastInputAt = now;
      next.solid = true;
      next.isSolid = true;
    } else if (type === 'timer' || type === 'timeout' || type === 'check-dim') {
      if (!next.mouseInMemo && now - (next.lastInputAt || 0) >= TIMEOUT_MS) {
        next.solid = false;
        next.isSolid = false;
      }
    } else if (type === 'page-mousedown' || type === 'mousedown') {
      next.mouseInMemo = false;
      next.solid = false;
      next.isSolid = false;
    }

    if (arg2 === undefined || typeof arg2 === 'number') _internalState = next;
    return next;
  }

  // 순수 함수: 설정과 상태로부터 적용할 alpha 값(0.40 ~ 1.00) 계산
  function computeAlpha(settings = {}, state = {}) {
    const isSolid = Boolean(state.solid || state.isSolid);
    const dimWhileReading = state.dimWhileReading !== false && settings.dimWhileReading !== false;

    if (!dimWhileReading || !isSolid) {
      const uiAlpha = Math.min(1, Math.max(0.4, (Number(settings.opacityUi) || 100) / 100));
      const inputAlpha = Math.min(1, Math.max(0.4, (Number(settings.opacityInput) || 100) / 100));
      return { uiAlpha, inputAlpha, isSolid: false };
    }

    // 메모 중(진함, 100%)
    return { uiAlpha: 1, inputAlpha: 1, isSolid: true };
  }

  // 순수 함수: 우리 호스트 태그인지 검사
  function isOurHostTag(tagName) {
    if (typeof tagName !== 'string') return false;
    return HOST_TAGS.includes(tagName.toLowerCase());
  }

  // 순수 함수: 경로에 우리 호스트가 있는지 검사
  function hasOurHostInPath(path) {
    if (!Array.isArray(path)) return false;
    return path.some((node) => isOurHostTag(node?.localName || node?.tagName));
  }

  // 순수 함수: 경로에 메모장 호스트(readgloss-memo-pad)가 있는지 검사
  function hasMemoHostInPath(path) {
    if (!Array.isArray(path)) return false;
    return path.some((node) => (node?.localName || node?.tagName)?.toLowerCase() === 'readgloss-memo-pad');
  }

  globalThis.readglossOpacity = {
    HOST_TAGS,
    HOST_SELECTOR,
    TIMEOUT_MS,
    createInitialState,
    stateAfter,
    computeAlpha,
    isOurHostTag,
    hasOurHostInPath,
    hasMemoHostInPath,
    get internalState() { return _internalState; },
    resetInternalState: (init) => { _internalState = createInitialState(init); },
  };

  if (typeof document === 'undefined') return; // node 시험 환경: 여기까지

  // =================== DOM 접착 (브라우저 환경) ===================
  let curSettings = globalThis.readglossSettings?.DEFAULTS ?? {
    opacityInput: 100,
    opacityUi: 100,
    dimWhileReading: true,
  };
  let dimTimer = 0;

  function ensureStyleSheet() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      ${HOST_SELECTOR} {
        opacity: var(--rg-ui-alpha, 1) !important;
        transition: opacity 0.15s ease-out;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function applyToDocument() {
    ensureStyleSheet();
    const { uiAlpha, inputAlpha } = computeAlpha(curSettings, _internalState);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--rg-ui-alpha', String(uiAlpha));
    rootStyle.setProperty('--rg-input-alpha', String(inputAlpha));
  }

  function scheduleDimCheck(delay = TIMEOUT_MS) {
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => {
      const now = Date.now();
      const prevSolid = _internalState.solid;
      stateAfter({ type: 'timer' }, now);
      if (prevSolid !== _internalState.solid) {
        applyToDocument();
      }
    }, Math.max(0, delay));
  }

  function dispatchState(event) {
    const now = Date.now();
    const prevSolid = _internalState.solid;
    stateAfter(event, now);
    if (prevSolid !== _internalState.solid) {
      applyToDocument();
    }
  }

  // 1. 메모장 열림 감지 (MutationObserver)
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if ((n.localName || n.tagName)?.toLowerCase() === 'readgloss-memo-pad') {
          dispatchState({ type: 'memo-open' });
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true });

  // 2. 마우스 진입 / 퇴장 감지
  let isMouseOverMemo = false;

  document.addEventListener('mouseover', (e) => {
    const inMemo = hasMemoHostInPath(e.composedPath());
    if (inMemo && !isMouseOverMemo) {
      isMouseOverMemo = true;
      dispatchState({ type: 'memo-enter' });
    }
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!isMouseOverMemo) return;
    const relatedInMemo = hasMemoHostInPath(e.relatedTarget ? [e.relatedTarget] : []);
    if (!relatedInMemo) {
      isMouseOverMemo = false;
      dispatchState({ type: 'memo-leave' });
      const elapsed = Date.now() - (_internalState.lastInputAt || 0);
      const remaining = TIMEOUT_MS - elapsed;
      if (remaining > 0) {
        scheduleDimCheck(remaining);
      }
    }
  }, true);

  // 3. 메모장 쓰는 칸 input 이벤트 (composed 라 document 에서 받음)
  document.addEventListener('input', (e) => {
    if (hasMemoHostInPath(e.composedPath())) {
      dispatchState({ type: 'memo-input' });
      if (!isMouseOverMemo) {
        scheduleDimCheck(TIMEOUT_MS);
      }
    }
  }, true);

  // 4. 본문 mousedown 감지: 경로에 우리 host 가 없음
  document.addEventListener('mousedown', (e) => {
    if (!hasOurHostInPath(e.composedPath())) {
      isMouseOverMemo = false;
      dispatchState({ type: 'page-mousedown' });
    }
  }, true);

  // 5. 설정 불러오기 및 실시간 변경 리스너
  try {
    globalThis.readglossSettings?.load().then((s) => {
      curSettings = s;
      _internalState.dimWhileReading = s.dimWhileReading;
      applyToDocument();
    }, () => {});
    globalThis.readglossSettings?.onChange((s) => {
      curSettings = s;
      _internalState.dimWhileReading = s.dimWhileReading;
      applyToDocument();
    });
  } catch {}

  applyToDocument();
})();
