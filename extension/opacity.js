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

  // 순수 함수: 개별 host 투명도 판정(T39)
  // hovered 거나 typing 중이면 1, 아니면 base 값
  function hostOpacity({ hovered, typing, base = 1 } = {}) {
    if (hovered || typing) return 1;
    return typeof base === 'number' ? base : 1;
  }

  globalThis.readglossOpacity = {
    HOST_TAGS,
    HOST_SELECTOR,
    TIMEOUT_MS,
    hostOpacity,
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
  const hostLastInput = new Map();
  let currentHoveredHost = null;

  function ensureStyleSheet() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    const rules = HOST_TAGS.map((tag) => `
      ${tag} {
        opacity: var(--rg-alpha-${tag}, var(--rg-ui-alpha, 1)) !important;
        transition: opacity 0.15s ease-out;
      }
    `).join('\n');
    style.textContent = rules;
    (document.head || document.documentElement).append(style);
  }

  function applyToDocument() {
    ensureStyleSheet();
    const { uiAlpha, inputAlpha } = computeAlpha(curSettings, _internalState);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--rg-ui-alpha', String(uiAlpha));
    rootStyle.setProperty('--rg-input-alpha', String(inputAlpha));

    const base = Math.min(1, Math.max(0.4, (Number(curSettings.opacityUi) || 100) / 100));
    const now = Date.now();

    for (const tag of HOST_TAGS) {
      const isHovered = currentHoveredHost === tag;
      const lastInput = hostLastInput.get(tag) || 0;
      const isTyping = (now - lastInput) < TIMEOUT_MS;
      const alpha = hostOpacity({ hovered: isHovered, typing: isTyping, base });
      rootStyle.setProperty(`--rg-alpha-${tag}`, String(alpha));
    }
  }

  function scheduleDimCheck(delay = TIMEOUT_MS) {
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => {
      const now = Date.now();
      stateAfter({ type: 'timer' }, now);
      applyToDocument();
      let minRemaining = Infinity;
      for (const [tag, lastInput] of hostLastInput.entries()) {
        const remaining = TIMEOUT_MS - (now - lastInput);
        if (remaining > 0 && remaining < minRemaining) {
          minRemaining = remaining;
        }
      }
      if (minRemaining < Infinity) {
        scheduleDimCheck(minRemaining);
      }
    }, Math.max(0, delay));
  }

  function findHostTagInPath(path) {
    if (!Array.isArray(path)) return null;
    for (const node of path) {
      const tag = (node?.localName || node?.tagName)?.toLowerCase();
      if (HOST_TAGS.includes(tag)) {
        return tag;
      }
    }
    return null;
  }

  // 1. 메모장 열림 감지 (MutationObserver): 메모장 열린 직후 메모장만 1.5초간 진함
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if ((n.localName || n.tagName)?.toLowerCase() === 'readgloss-memo-pad') {
          hostLastInput.set('readgloss-memo-pad', Date.now());
          stateAfter({ type: 'memo-open' }, Date.now());
          applyToDocument();
          scheduleDimCheck(TIMEOUT_MS);
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true });

  // 2. 마우스 진입 / 퇴장 감지 (호스트마다 따로 진해짐)
  document.addEventListener('mouseover', (e) => {
    const hostTag = findHostTagInPath(e.composedPath());
    if (hostTag !== currentHoveredHost) {
      currentHoveredHost = hostTag;
      if (hostTag === 'readgloss-memo-pad') {
        stateAfter({ type: 'memo-enter' }, Date.now());
      } else if (_internalState.mouseInMemo) {
        stateAfter({ type: 'memo-leave' }, Date.now());
      }
      applyToDocument();
    }
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!currentHoveredHost) return;
    const related = e.relatedTarget;
    const relatedPath = related ? (typeof related.composedPath === 'function' ? related.composedPath() : [related]) : [];
    const relatedHostTag = findHostTagInPath(relatedPath);
    if (relatedHostTag !== currentHoveredHost) {
      const prevHost = currentHoveredHost;
      currentHoveredHost = relatedHostTag;
      if (prevHost === 'readgloss-memo-pad') {
        stateAfter({ type: 'memo-leave' }, Date.now());
        const elapsed = Date.now() - (_internalState.lastInputAt || 0);
        const remaining = TIMEOUT_MS - elapsed;
        if (remaining > 0) {
          scheduleDimCheck(remaining);
        }
      }
      applyToDocument();
    }
  }, true);

  // 3. 호스트 내부 input 이벤트 (마지막 input 뒤 1.5초 안 해당 host 만 진함)
  document.addEventListener('input', (e) => {
    const hostTag = findHostTagInPath(e.composedPath());
    if (hostTag) {
      const now = Date.now();
      hostLastInput.set(hostTag, now);
      if (hostTag === 'readgloss-memo-pad') {
        stateAfter({ type: 'memo-input' }, now);
      }
      applyToDocument();
      scheduleDimCheck(TIMEOUT_MS);
    }
  }, true);

  // 4. 본문 mousedown 감지: 모두 설정 값으로 복귀
  document.addEventListener('mousedown', (e) => {
    if (!hasOurHostInPath(e.composedPath())) {
      currentHoveredHost = null;
      hostLastInput.clear();
      stateAfter({ type: 'page-mousedown' }, Date.now());
      applyToDocument();
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
