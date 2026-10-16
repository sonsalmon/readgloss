// 더블클릭 -> 사전 카드. DOM 접착만 한다. 판단 로직은 text.js(globalThis.readgloss)에 있다.
(() => {
  const { cleanSelection, extractSentence, positionBubble, plainTextAt, BLOCKED_SELECTOR } = globalThis.readgloss;

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요',
    'ai-failed': '뜻을 가져오지 못했어요. 다시 시도해 주세요',
    'dict-unavailable': '맥 사전 도우미가 아직 없어요. 터미널에서 cd ~/dev/readgloss && npm run build:dict 를 실행해 주세요',
    'dict-failed': '사전을 읽지 못했어요. 다시 시도해 주세요',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };

  const DARK = `--rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45);`;
  const CSS = `
    .card { --rg-bg: #ffffff; --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); --rg-radius: 10px;
      box-sizing: border-box; width: 340px; max-width: calc(100vw - 16px); overflow: hidden; border-radius: var(--rg-radius);
      background: var(--rg-bg); color: var(--rg-fg); border: 1px solid var(--rg-border); box-shadow: var(--rg-shadow);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .card { ${DARK} } }
    :host([data-theme="dark"]) .card { ${DARK} }
    .term { display: none; padding: 10px 16px 0; color: var(--rg-accent); font-size: 12px; font-weight: 600; word-break: keep-all; overflow-wrap: anywhere; }
    .term.on { display: block; }
    .scroll { max-height: 360px; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 8px; }
    .scroll:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    .msg { color: var(--rg-muted); padding-bottom: 6px; word-break: keep-all; overflow-wrap: anywhere; }
    .entry + .entry { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--rg-border); }
    .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
    .hnum { display: inline-grid; place-items: center; min-width: 18px; height: 18px; border-radius: 9px; background: var(--rg-accent-soft);
      color: var(--rg-accent); font-size: 11px; font-weight: 700; align-self: center; }
    .hw { font-size: 18px; font-weight: 700; }
    .pron { color: var(--rg-muted); font-size: 13px; }
    .etym { color: var(--rg-muted); font-size: 12px; margin-top: 2px; }
    .posrow { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
    .pos { padding: 0 8px; border-radius: 10px; background: var(--rg-accent-soft); color: var(--rg-accent); font-size: 12px; font-weight: 600; }
    .posnote { color: var(--rg-muted); font-size: 12px; }
    .sense { display: flex; gap: 6px; margin-top: 4px; }
    .num { flex: none; min-width: 1.4em; color: var(--rg-muted); font-variant-numeric: tabular-nums; }
    .stext { min-width: 0; word-break: keep-all; overflow-wrap: anywhere; }
    .ex { color: var(--rg-muted); font-size: 12.5px; margin-top: 2px; }
    .ai { margin: 2px 12px 0; padding: 6px 10px; border-radius: 8px; background: var(--rg-accent-soft); font-size: 13px; }
    .ai[hidden] { display: none; }
    .ai.err { background: none; color: var(--rg-muted); padding-left: 0; }
    .ai + .ai { margin-top: 6px; }
    .tops { display: flex; flex-direction: column; gap: 6px; padding: 10px 16px 0; }
    .tops[hidden] { display: none; }
    .tops .mine, .tops .acr { margin-bottom: 0; }
    .btn[hidden] { display: none; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px 12px; }
    .btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border);
      color: var(--rg-fg); font-size: 12.5px; line-height: 1.6; }
    .btn:hover { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .btn[aria-disabled="true"] { opacity: .55; cursor: default; }
    .links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 0 16px 12px; font-size: 11.5px; color: var(--rg-muted); }
    .links[hidden] { display: none; }
    .links a { all: unset; cursor: pointer; color: var(--rg-muted); text-decoration: underline; text-underline-offset: 2px; }
    .links a:hover { color: var(--rg-accent); }
    .links a:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .links .sep { color: var(--rg-muted); user-select: none; opacity: .7; }
  `;

  // 테마(설정 'theme'): auto 면 속성 없이 prefers-color-scheme, light·dark 면 호스트에 data-theme 로 강제
  let theme = 'auto';
  let glossary = 'auto'; // 설정 '분야 용어집'. 'off' 면 사전 요청에 host·domains 를 싣지 않는다
  let glossarySites = globalThis.readglossSettings?.DEFAULTS.glossarySites ?? []; // 용어집을 켤 사이트(설정을 읽기 전에는 기본 목록)
  try {
    globalThis.readglossSettings.load().then((s) => { theme = s.theme; glossary = s.glossary; glossarySites = s.glossarySites; }, () => {});
    globalThis.readglossSettings.onChange((s) => {
      theme = s.theme;
      glossary = s.glossary;
      glossarySites = s.glossarySites;
      if (host) applyTheme();
      toastTheme();
    });
  } catch { /* 설정을 못 읽으면 자동 */ }
  const applyTheme = () => (theme === 'auto' ? host.removeAttribute('data-theme') : host.setAttribute('data-theme', theme));

  // ---- 확인 메시지(토스트): 단어장 저장을 알리고 [메모] 를 받는다. 카드와 별개의 shadow host(카드가 곧 닫히므로). ----
  const TOAST_DARK = `--rg-bg: rgba(30,33,39,.85); --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45);`;
  const TOAST_CSS = `
    .pill { --rg-bg: rgba(255,255,255,.85); --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08);
      box-sizing: border-box; pointer-events: auto; display: flex; flex-direction: column; gap: 6px; max-width: calc(100vw - 32px);
      padding: 7px 12px; border-radius: 999px; background: var(--rg-bg); color: var(--rg-fg); border: 1px solid var(--rg-border);
      box-shadow: var(--rg-shadow); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; animation: rg-toast-in .18s ease-out both; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .pill { ${TOAST_DARK} } }
    :host([data-theme="dark"]) .pill { ${TOAST_DARK} }
    @keyframes rg-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes rg-toast-fade { from { opacity: 0; } to { opacity: 1; } }
    .pill.out { opacity: 0; transform: translateY(4px); transition: opacity .2s ease, transform .2s ease; }
    @media (prefers-reduced-motion: reduce) { .pill { animation: rg-toast-fade .18s ease-out both; } .pill.out { transform: none; } }
    .row { display: flex; align-items: center; gap: 8px; }
    .text { min-width: 0; word-break: keep-all; overflow-wrap: anywhere; }
    .memoBtn { all: unset; flex: none; cursor: pointer; padding: 1px 9px; border-radius: 999px; border: 1px solid var(--rg-border);
      color: var(--rg-accent); font-size: 12px; font-weight: 600; }
    .memoBtn:hover { background: var(--rg-accent-soft); border-color: var(--rg-accent); }
    .memoBtn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .pill.memo { border-radius: 12px; }
    .memobox { display: grid; gap: 4px; }
    .memobox[hidden] { display: none; }
    .memo { box-sizing: border-box; width: min(320px, calc(100vw - 56px)); min-height: 44px; resize: vertical; padding: 5px 8px;
      border-radius: 8px; border: 1px solid var(--rg-border); background: var(--rg-bg); color: var(--rg-fg); font: inherit; font-size: 13px; }
    .memo:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 1px; }
    .memo[aria-disabled="true"] { opacity: .7; }
    .err { color: #d1242f; font-size: 12px; }
    .err[hidden] { display: none; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .err { color: #ff7b72; } }
    :host([data-theme="dark"]) .err { color: #ff7b72; }
  `;
  const TOAST_MS = 3500; // 마우스를 올리거나 메모 창이 없을 때 사라지기까지
  let toastHost = null;
  let toastPill = null;
  let toastTimer = 0;
  let toastHover = false; // 마우스를 올린 동안은 사라지지 않는다
  let toastMemo = false; // 메모 창이 열린 동안은 사라지지 않는다
  let toastGen = 0; // 늦게 온 메모 응답을 버린다
  let toastKey = null; // 메시지가 떠 있는 동안 글자 키로 메모 칸을 여는 document 리스너

  const toastTheme = () => toastHost && (theme === 'auto' ? toastHost.removeAttribute('data-theme') : toastHost.setAttribute('data-theme', theme));
  const stopToastKey = () => {
    if (toastKey) document.removeEventListener('keydown', toastKey, true);
    toastKey = null;
  };

  // 확인 메시지 자리(순수 함수, 시험이 쓴다). anchor 는 화면 좌표 {left, top, right, bottom}. 아래에 화면 안으로 들어가면 아래, 아니면 위, 그것도 안 되면 아래 가운데.
  const TOAST_GAP = 8;
  const TOAST_BOTTOM = 24; // 아래 가운데일 때 화면 아래 여백(CSS bottom 과 같다)
  function toastPosition(anchor, size, viewport) {
    const { width: w, height: h } = size;
    const { width: vw, height: vh } = viewport;
    const center = { left: (vw - w) / 2, top: vh - TOAST_BOTTOM - h, placement: 'bottom-center' };
    const shown = !!anchor && anchor.right > 0 && anchor.bottom > 0 && anchor.left < vw && anchor.top < vh;
    if (!shown) return center;
    const left = Math.max(TOAST_GAP, Math.min(anchor.left, vw - w - TOAST_GAP)); // 오른쪽을 넘으면 왼쪽으로 민다
    const below = anchor.bottom + TOAST_GAP;
    if (below + h <= vh - TOAST_GAP) return { left, top: below, placement: 'below' };
    const above = anchor.top - TOAST_GAP - h;
    if (above >= TOAST_GAP) return { left, top: above, placement: 'above' };
    return center;
  }
  // 메모 칸을 여는 글자 키인가(순수 함수, 시험이 쓴다). 글자 한 개 또는 한글 입력기(Process). 스페이스·조합 키·입력칸 위는 아니다.
  // 우리 카드(readgloss-*, 닫힌 shadow)는 안의 입력칸이 path 에 안 보인다. 카드가 globalThis.readgloss<이름>Ui.isTyping() 을 주면 그 값만 보고(readglossSelectionUi: selection.js),
  // 없으면 host 가 path 에 있는 것만으로 막는다(selection-core 의 isOwnUiPath 와 같은 판정). 확인 메시지 자신은 막지 않는다.
  const EDITABLE_TAGS = ['input', 'textarea', 'select'];
  const isOwnCard = (n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-') && n.localName !== 'readgloss-toast';
  const cardTyping = (n) => {
    const ui = globalThis[`${n.localName.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Ui`];
    return typeof ui?.isTyping === 'function' ? ui.isTyping() === true : true;
  };
  function startsMemo(e, path = []) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!(e.key === 'Process' || (e.key?.length === 1 && e.key !== ' '))) return false;
    if (path.some((n) => EDITABLE_TAGS.includes(n?.localName) || n?.isContentEditable === true)) return false;
    return !path.some((n) => isOwnCard(n) && cardTyping(n));
  }
  // 확인 메시지를 붙일 자리: 범위·요소의 화면 위치. 크기가 0이면(접힌 범위 등) null -> 아래 가운데
  const rectOf = (x) => {
    const r = x?.getBoundingClientRect?.();
    return r && (r.width || r.height) ? r : null;
  };

  function scheduleToast(delay = TOAST_MS) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastHover || toastMemo) return; // 멈춤이 풀리면 다시 예약된다
      hideToast();
    }, delay);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    stopToastKey();
    const h = toastHost;
    const pill = toastPill;
    toastHost = toastPill = null;
    toastHover = toastMemo = false;
    if (!h) return;
    pill?.classList.add('out'); // 페이드 아웃 뒤 제거
    setTimeout(() => h.remove(), 220);
  }

  // text: 확인 문구. anchor: 붙일 화면 자리(rectOf 결과). onMemo: [메모] 버튼을 눌렀을 때. 메모 저장 성공은 error 칸 없는 응답, 실패는 { error }.
  function showToast({ text = '', onMemo, anchor, ms } = {}) {
    clearTimeout(toastTimer);
    stopToastKey();
    toastHost?.remove(); // 다시 show 하면 이전 메시지를 대체한다
    toastHost = toastPill = null;
    toastHover = toastMemo = false;
    const gen = ++toastGen;

    const h = document.createElement('readgloss-toast');
    h.style.cssText = 'all: initial; position: fixed; inset: auto 0 24px 0; z-index: 2147483647; display: flex; justify-content: center; pointer-events: none;';
    toastHost = h;
    toastTheme();
    const shadow = h.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = TOAST_CSS;
    const pill = el('div', 'pill');
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    toastPill = pill;
    const row = el('div', 'row');
    const textEl = el('span', 'text', text);
    row.append(textEl);
    const box = el('div', 'memobox');
    box.hidden = true;
    const ta = el('textarea', 'memo');
    ta.maxLength = 1000;
    ta.rows = 2;
    ta.placeholder = '메모 (Enter 저장 · Shift+Enter 줄바꿈)';
    ta.setAttribute('aria-label', '메모');
    const err = el('div', 'err');
    err.hidden = true;
    err.setAttribute('role', 'status');
    box.append(ta, err);
    pill.append(row, box);
    let memoBtn = null;
    if (typeof onMemo === 'function') {
      memoBtn = el('button', 'memoBtn', '메모');
      memoBtn.type = 'button';
      memoBtn.setAttribute('aria-label', '메모 남기기');
      memoBtn.addEventListener('click', (e) => { e.stopPropagation(); openMemo(); });
      row.append(memoBtn);
    }
    pill.addEventListener('mouseenter', () => { toastHover = true; clearTimeout(toastTimer); });
    pill.addEventListener('mouseleave', () => { toastHover = false; if (!toastMemo) scheduleToast(); });

    // 메시지가 떠 있는 동안 글자를 치면 메모 칸이 열리고 그 글자가 칸에 들어간다(preventDefault 하지 않는다: 키가 textarea 로 간다)
    function armKey() {
      if (typeof onMemo !== 'function') return;
      stopToastKey();
      toastKey = (e) => { if (startsMemo(e, e.composedPath())) openMemo(); };
      document.addEventListener('keydown', toastKey, true);
    }
    function failMemo(t) {
      err.hidden = false;
      err.textContent = t;
      ta.focus();
    }
    // 메시지 크기(메모 칸 포함)를 재서 자리를 정한다. 아래 공간이 모자라면 위로 다시 맞춘다.
    function placeToast() {
      const s = pill.getBoundingClientRect();
      const p = toastPosition(anchor, { width: s.width, height: s.height }, { width: document.documentElement.clientWidth, height: innerHeight });
      Object.assign(h.style, { top: `${p.top}px`, left: `${p.left}px`, right: 'auto', bottom: 'auto' });
    }
    function openMemo() {
      toastMemo = true;
      clearTimeout(toastTimer);
      stopToastKey(); // 메모 칸이 열리면 글자 키 리스너는 뗀다
      box.hidden = false;
      pill.classList.add('memo');
      if (memoBtn) memoBtn.hidden = true;
      placeToast();
      ta.focus(); // 이때만 포커스를 가져간다(처음 뜰 때는 안 가져간다)
    }
    function cancelMemo() {
      toastMemo = false;
      box.hidden = true;
      err.hidden = true;
      ta.value = '';
      ta.blur();
      pill.classList.remove('memo');
      if (memoBtn) memoBtn.hidden = false;
      armKey(); // 메시지가 아직 떠 있으니 글자 키로 다시 메모를 열 수 있게
      scheduleToast();
    }
    async function saveMemo() {
      const W = globalThis.readglossWords;
      ta.setAttribute('aria-disabled', 'true');
      let r;
      try {
        r = await onMemo(ta.value);
      } catch {
        r = { error: 'memo-failed' };
      }
      if (gen !== toastGen || toastHost !== h) return; // 그 사이 닫혔거나 새 메시지로 대체됨
      if (!W.memoOk(r)) {
        ta.removeAttribute('aria-disabled');
        return failMemo(W.memoErrorText(r)); // 실패면 창을 그대로 두고 짧은 오류 문구
      }
      toastMemo = false;
      box.remove();
      if (memoBtn) memoBtn.remove();
      pill.classList.remove('memo');
      textEl.textContent = '메모했어요'; // 잠깐 보이고 사라진다
      // 열린 패널이 목록을 다시 읽게 알린다. known·unknown 은 비워 주석(annotate.js)이 반응하지 않게 한다.
      window.dispatchEvent(new CustomEvent('readgloss:words', { detail: { known: [], unknown: [] } }));
      scheduleToast(1400);
    }
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 페이지 단축키로 새지 않게
      const k = globalThis.readglossWords.memoKey(e);
      if (k === 'save') { e.preventDefault(); saveMemo(); }
      else if (k === 'newline') { /* Shift+Enter: 기본 줄바꿈 */ }
      else if (e.key === 'Escape') { e.preventDefault(); cancelMemo(); }
    });
    for (const t of ['keypress', 'keyup']) ta.addEventListener(t, (e) => e.stopPropagation());

    shadow.append(style, pill);
    document.documentElement.append(h);
    placeToast();
    armKey();
    scheduleToast(ms ?? TOAST_MS); // ms: 짧게 떴다 사라질 확인(예: [나중에] 1.5초, 명세 13-1)
  }
  globalThis.readglossToast = { show: showToast, toastPosition, startsMemo, rectOf };

  let host = null;
  let ui = null; // { card, scroll, ai, aiBtn, saveBtn, knownBtn }
  let seq = 0; // 닫거나 새로 열 때마다 올려서 늦게 온 응답을 버린다
  let current = null; // { word, sentence, anchor, context?, source?, ai, aiWide, lemma, gloss, state, mine, acr, termKo, senseKo, firstSense }  lemma·gloss 는 /dict 응답, state 는 /words 응답, ai·aiWide 는 AI 문맥 뜻(짧은·넓은)

  // 사전·AI 가 준 글은 textContent 로만 넣는다(innerHTML 금지).
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildCard() {
    host = document.createElement('readgloss-card');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; left: 0; top: 0;';
    applyTheme();
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = el('style');
    style.textContent = CSS + (globalThis.readglossMydict?.CSS ?? ''); // 내 사전 입력칸 모양은 selection.js 가 올려 둔 것(그쪽이 나중에 로드돼도 카드는 사용자가 열 때 만든다)
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${current.word} 사전`);
    const tops = el('div', 'tops'); // 카드 맨 위: "내 사전: 뜻"·약어 줄
    tops.hidden = true;
    const mine = el('div', 'mine');
    mine.hidden = true;
    const acr = el('div', 'acr');
    acr.hidden = true;
    tops.append(mine, acr);
    const scroll = el('div', 'scroll');
    scroll.tabIndex = 0;
    const term = el('div', 'term'); // 분야 용어집 뜻("용어: 전치(행렬) · 수학") 또는 사전의 분야 표시 뜻("분야 뜻: 곱셈 · 수학"). 사전 결과가 오면 채운다
    const ai = el('div', 'ai');
    ai.hidden = true;
    ai.setAttribute('role', 'status');
    const aiWide = el('div', 'ai'); // [더 넓게 보기] 결과(앞 결과는 남긴다)
    aiWide.hidden = true;
    aiWide.setAttribute('role', 'status');

    const foot = el('div', 'foot');
    const aiBtn = el('button', 'btn');
    aiBtn.type = 'button';
    aiBtn.addEventListener('click', () => current && askAi());
    const mkWordBtn = (key) => {
      const b = el('button', 'btn');
      b.type = 'button';
      b.setAttribute('aria-disabled', 'true'); // 사전 결과(원형)가 오면 켠다
      b.addEventListener('click', () => current && toggleWord(key));
      return b;
    };
    const saveBtn = mkWordBtn('save');
    const conceptBtn = el('button', 'btn', '내 개념으로');
    conceptBtn.type = 'button';
    conceptBtn.setAttribute('aria-label', '내 개념으로 저장');
    conceptBtn.addEventListener('click', () => {
      if (!current) return;
      const name = current.lemma || current.word;
      const anchor = rectOf(current.range);
      globalThis.readglossConceptPage?.openForm({ name, anchor, range: current.range });
      getSelection().removeAllRanges();
      close();
    });
    const laterBtn = el('button', 'btn', '나중에');
    laterBtn.type = 'button';
    laterBtn.setAttribute('aria-label', '나중에 볼 것으로 저장');
    laterBtn.addEventListener('click', () => {
      if (!current) return;
      const name = current.word || current.lemma || '';
      const anchor = rectOf(current.range);
      const sentence = current.sentence || '';
      globalThis.readglossConceptPage?.saveLater({ name, sentence, anchor, range: current.range });
      getSelection().removeAllRanges();
      close();
    });
    const knownBtn = mkWordBtn('known');
    foot.append(saveBtn, conceptBtn, laterBtn, knownBtn, aiBtn);
    const links = el('div', 'links');
    ui = { card, tops, mine, acr, term, scroll, ai, aiWide, aiBtn, saveBtn, knownBtn, links };
    const md = globalThis.readglossMydict;
    const key = globalThis.readglossSelection.mydictKey(current.word); // 키 규칙에 안 맞으면 [내 사전에 추가] 를 숨긴다
    if (md && key) {
      ui.md = md.create({
        // 약어는 철자, 낱말은 다리가 준 원형(matrices → matrix): 주석의 data-lemma·다리 조회와 같은 키가 되게
        key: () => (current?.acr || !current?.lemma ? key : globalThis.readglossSelection.mydictKey(current.lemma) ?? key),
        spec: () => ({
          ko: globalThis.readglossSelection.bestMeaning({ wide: current?.aiWide, ai: current?.ai, acr: current?.acr?.ko, term: current?.termKo, sense: current?.senseKo, first: globalThis.readglossSelection.firstMeaning(current?.firstSense) }),
          exp: current?.acr?.exp ?? current?.mine?.exp,
          note: current?.mine?.note,
        }),
        resize: () => current && place(),
        // 패널의 저장 문장에서 연 카드는 그 문장을 저장한 페이지를, 지금 연 카드는 지금 페이지를 출처로 남긴다(sourceUrl 참고)
        source: () => ({ url: sourceUrl(), title: current.source?.title ?? document.title.slice(0, 200) }),
        onSaved: (ko) => current && paintMine({ ...current.mine, ko }),
      });
      foot.append(ui.md.btn);
    }
    if (ui.md) foot.append(ui.md.form);

    card.append(tops, term, scroll, ai, aiWide, foot, links);
    shadow.append(style, card);
    document.documentElement.append(host);
    paintAiBtn();
    paintWordButtons();
    renderDictLinks();
  }

  // 명세 22-1 사전 링크: YouGlish · 네이버 · Oxford · Cambridge (원형이 있으면 원형, 없으면 표면형)
  function renderDictLinks() {
    if (!ui?.links) return;
    const term = current?.lemma || current?.word || '';
    const list = globalThis.readglossSelection?.dictLinks?.(term) ?? [];
    ui.links.replaceChildren();
    if (!list.length) {
      ui.links.hidden = true;
      return;
    }
    ui.links.hidden = false;
    list.forEach((item, idx) => {
      if (idx > 0) ui.links.append(el('span', 'sep', '·'));
      const a = el('a', undefined, item.label);
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${item.label}에서 열기(새 탭)`);
      ui.links.append(a);
    });
  }

  function place() {
    const a = current.anchor;
    const rect = { left: a.left - scrollX, top: a.top - scrollY, bottom: a.bottom - scrollY };
    const size = ui.card.getBoundingClientRect();
    const p = positionBubble({
      rect,
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollX, scrollY },
      size,
    });
    host.style.left = `${p.left}px`;
    host.style.top = `${p.top}px`;
  }

  function showMessage(text) {
    ui.scroll.replaceChildren(el('div', 'msg', text));
    place();
  }

  // 표제어별 블록: 머리(번호·표제어·발음) / 품사 배지 + 번호 뜻 / 예문
  function renderEntries(entries) {
    const multi = entries.length > 1;
    const blocks = entries.map((e, i) => {
      const box = el('section', 'entry');
      const head = el('div', 'head');
      if (multi) head.append(el('span', 'hnum', String(e.homograph || i + 1)));
      head.append(el('span', 'hw', e.headword || current.word));
      if (e.pron) head.append(el('span', 'pron', e.pron));
      box.append(head);
      if (e.etym) box.append(el('div', 'etym', e.etym));
      let lastKey = null;
      for (const s of e.senses ?? []) {
        const key = `${s.pos}|${s.posNote}`;
        if (key !== lastKey) {
          lastKey = key;
          if (s.pos || s.posNote) {
            const row = el('div', 'posrow');
            if (s.pos) row.append(el('span', 'pos', s.pos));
            if (s.posNote) row.append(el('span', 'posnote', s.posNote));
            box.append(row);
          }
        }
        const line = el('div', 'sense');
        if (s.num != null) line.append(el('span', 'num', `${s.num}.`));
        const body = el('div', 'stext', s.text);
        for (const ex of s.examples ?? []) body.append(el('div', 'ex', ex));
        line.append(body);
        box.append(line);
      }
      return box;
    });
    ui.scroll.replaceChildren(...blocks);
    place();
  }

  // 카드의 단어장·알아요 버튼. 문구·동작 판단은 panel-words.js 의 순수 함수(readglossWords.buttonModel)가 한다.
  function paintWordButtons() {
    const m = globalThis.readglossWords.buttonModel({ saved: !!current.state?.saved[current.lemma], known: !!current.state?.known[current.lemma] });
    for (const [btn, b] of [[ui.saveBtn, m.save], [ui.knownBtn, m.known]]) {
      btn.textContent = b.text;
      btn.setAttribute('aria-label', b.label);
      if (current.state) btn.removeAttribute('aria-disabled');
    }
  }

  // 단어장·최근 기록에 남길 출처 주소: 패널의 저장 문장에서 연 카드는 그 문장을 저장한 페이지, 아니면 지금 페이지
  const sourceUrl = () => current.source?.url ?? location.href.slice(0, 2000);

  async function toggleWord(key) {
    if (!current.state || ui[`${key}Btn`].getAttribute('aria-disabled') === 'true') return;
    const W = globalThis.readglossWords;
    const my = seq;
    const op = W.buttonModel({ saved: !!current.state.saved[current.lemma], known: !!current.state.known[current.lemma] })[key].op;
    const lemma = current.lemma;
    const anchor = rectOf(current.range); // 확인 메시지 자리: 저장을 누른 순간의 단어 위치(응답 뒤엔 선택이 풀릴 수 있다)
    ui[`${key}Btn`].setAttribute('aria-disabled', 'true');
    const msg = W.messageFor(op, { lemma, word: current.word, gloss: current.gloss, sentence: current.sentence, url: sourceUrl() });
    if (op === 'save') {
      const headings = globalThis.readglossSelectionUi?.headingsFor?.(current.range?.startContainer ?? current.range) ?? [];
      msg.headings = headings;
    }
    const r = await send(msg);
    if (my !== seq) return;
    if (r?.known && r.saved) {
      current.state = r;
      const detail = W.wordEventDetail(op, current.lemma); // 저장·빼기까지 패널이 숫자·목록을 다시 읽게 알린다
      if (detail) window.dispatchEvent(new CustomEvent('readgloss:words', { detail })); // 이 페이지의 주석을 바로 걷거나 되살린다
      // 새로 저장했을 때만: 확인 메시지(+메모) -> 선택 해제 -> 카드 닫기. 빼기·알아요는 카드를 그대로 둔다.
      if (op === 'save') {
        globalThis.readglossToast?.show({
          text: '단어장에 추가됐어요!',
          anchor,
          onMemo: (memo) => send({ type: 'words', op: 'memo', lemma, memo }),
        });
        getSelection().removeAllRanges();
        close();
        return;
      }
    } else {
      ui.ai.hidden = false;
      ui.ai.className = 'ai err';
      ui.ai.textContent = MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;
    }
    paintWordButtons();
    place();
  }

  // 사전 결과가 오면: 원형을 받아 두고, 최근 찾은 단어에 조용히 남기고(실패해도 카드는 그대로), 단어장·알아요 상태를 받아 버튼을 켠다.
  async function loadWordState(r, my) {
    current.lemma = r.lemma;
    current.gloss = r.gloss ?? '';
    renderDictLinks();
    if (r.found) send({ type: 'words', op: 'history', lemma: r.lemma, word: current.word, gloss: current.gloss, sentence: current.sentence, url: sourceUrl() }).catch(() => {});
    const s = await send({ type: 'words', op: 'get' });
    if (my !== seq || !s?.known) return; // 상태를 못 받으면 버튼은 꺼진 채로 둔다
    current.state = s;
    paintWordButtons();
  }

  function close() {
    seq++;
    current = null;
    host?.remove();
    host = ui = null;
  }
  // 밖(단어장 형광펜 saved-marks.js)에서 그 낱말 범위로 사전 카드를 연다. 문장은 더블클릭과 같은 방식으로 자른다.
  function openFromRange({ range, rect } = {}) {
    if (!range) return;
    const picked = cleanSelection(range.toString());
    if (!picked) return;
    const block = blockOf(range.startContainer);
    const { text, offset } = plainTextAt(block, range.startContainer, range.startOffset);
    const sentence = extractSentence(text, offset + picked.start, picked.word.length);
    openCard(picked.word, sentence, rect ?? range.getBoundingClientRect(), range);
  }
  globalThis.readglossDictCardUi = { close, open: openFromRange };

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage({ ...message, page: { url: location.href.slice(0, 2000), title: document.title.slice(0, 200) } }); // page: 공부 기록용(T14)
    } catch {
      return { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }
  }

  async function askDict() {
    const my = ++seq;
    showMessage('찾는 중…');
    // nolog: 드래그로 연 카드(selection.js 가 detail.nolog 로 표시)는 공부 기록에 남기지 않는다. 더블클릭 카드는 남긴다.
    const r = await send({ type: 'dict', word: current.word, ...(current.nolog === true ? { nolog: true } : {}), ...(globalThis.readglossGlossary?.hint({ glossary, glossarySites }, document, location.hostname) ?? {}) });
    if (my !== seq) return;
    const line = (globalThis.readglossGlossary?.termLine(r?.term) ?? '') || (r?.sense?.ko ? `분야 뜻: ${r.sense.ko} · ${r.sense.tag}` : ''); // 용어가 없을 때만 다리가 준 분야 표시 뜻(sense)
    ui.term.textContent = line;
    ui.term.classList.toggle('on', line !== '');
    current.termKo = r?.term?.ko;
    current.senseKo = r?.sense?.ko;
    current.firstSense = r?.gloss || r?.entries?.[0]?.senses?.[0]?.text; // [내 사전에 추가] 의 마지막 기본 뜻 후보. 다리의 gloss 는 원형 항목 기준(matrices 의 첫 항목 '…의 복수형' 안내를 건너뜀)
    if (typeof r?.mine?.ko === 'string' && r.mine.ko) paintMine(r.mine);
    if (globalThis.readglossSelection.isAcronym(current.word)) showAcronym(r, my).catch(() => {});
    if (r?.found && r.entries?.length) renderEntries(r.entries);
    else if (r?.found === false) showMessage('사전에 없어요');
    else showMessage(MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`);
    if (typeof r?.lemma === 'string') loadWordState(r, my).catch(() => {});
  }

  // 사전 카드 맨 위 줄들(내 사전·약어)은 하나라도 있으면 보인다.
  const paintTops = () => (ui.tops.hidden = ui.mine.hidden && ui.acr.hidden);

  // 내 사전에 있는 단어: 카드 맨 위 "내 사전: 뜻" + 버튼은 [내 사전에 있음 ✓]
  function paintMine(mine) {
    current.mine = mine;
    ui.mine.hidden = false;
    ui.mine.textContent = `내 용어집: ${mine.ko}`;
    ui.md?.setHas(mine.ko);
    paintTops();
    place();
  }

  function paintAcronym() {
    const a = current.acr;
    const line = a ? globalThis.readglossSelection.acronymLine({ word: current.word, ...a }) : '';
    ui.acr.hidden = line === '';
    ui.acr.textContent = line;
    paintTops();
    place();
  }

  // 페이지 글 전체(너무 크면 단어가 있는 블록)에서 "(PCA)" 앞의 풀이를 찾는다.
  // ponytail: 대문자 약어를 더블클릭할 때마다 본문을 한 번 훑는다(40만 자까지). 느려지면 첫 결과를 페이지별로 캐시한다.
  function pageExpansion(word) {
    const { textOf, textExceeds } = globalThis.readglossParagraph;
    const isHidden = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName);
    const root = textExceeds(document.body, 400_000) ? blockOf(current.range?.startContainer ?? document.body) : document.body;
    return globalThis.readglossSelection.expandAcronym(textOf(root, { isHidden }), word);
  }

  // 전부 대문자 2~6자(PCA)면 약어 줄: 내 사전·약어집의 풀이, 없으면 페이지 글에서 찾은 풀이와 그 맥 번역.
  async function showAcronym(r, my) {
    const exp = r?.mine?.exp ?? r?.acronym?.exp; // 내 사전이 먼저
    if (exp) {
      current.acr = { exp, ko: r.mine?.ko ?? r.acronym?.ko };
      return paintAcronym();
    }
    const found = pageExpansion(current.word);
    if (!found) return;
    current.acr = { exp: found, page: true };
    paintAcronym();
    const t = await send({ type: 'mt', text: found, ...(globalThis.readglossGlossary?.hint({ glossary, glossarySites }, document, location.hostname) ?? {}) });
    if (my !== seq || !t?.translation) return;
    current.acr.ko = t.translation;
    paintAcronym();
  }

  // 저장 문장에서 연 카드(context 가 이미 주어짐)는 넓힐 글이 없어서 [더 넓게 보기] 단계가 없다.
  const aiStage = () => ({ done: current.ai !== undefined, wide: current.aiWide !== undefined || (current.context !== undefined && current.ai !== undefined) });

  function paintAiBtn() {
    const m = globalThis.readglossSelection.stageButton('ai', aiStage());
    ui.aiBtn.hidden = m.hidden;
    ui.aiBtn.textContent = m.text;
    ui.aiBtn.setAttribute('aria-label', m.label);
  }

  // [AI 문맥 뜻] -> 결과 뒤 [더 넓게 보기](글 앞뒤 6000자 + 목차) -> 숨김. 앞 결과는 남기고 아래에 넓은 결과를 보탠다.
  async function askAi() {
    if (ui.aiBtn.getAttribute('aria-disabled') === 'true') return;
    const my = seq;
    const wide = globalThis.readglossSelection.stageButton('ai', aiStage()).wide;
    const box = wide ? ui.aiWide : ui.ai;
    ui.aiBtn.setAttribute('aria-disabled', 'true');
    box.hidden = false;
    box.className = 'ai';
    box.textContent = wide ? '글 앞뒤와 목차를 넓게 보고 찾는 중…' : '가져오는 중…';
    place();
    const context = current.context ?? (current.range && globalThis.readglossContextFor?.(current.range, wide)); // selection.js 가 나중에 로드되므로 호출 때 참조한다
    const r = await send({ type: 'lookup', word: current.word, sentence: current.sentence, wide, ...(context && { context }) });
    if (my !== seq) return;
    ui.aiBtn.removeAttribute('aria-disabled');
    if (r?.gloss) {
      box.textContent = `${wide ? '넓은 문맥 · ' : ''}${current.word}: ${r.gloss}`;
      current[wide ? 'aiWide' : 'ai'] = r.gloss;
    } else {
      box.className = 'ai err';
      box.textContent = MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;
    }
    paintAiBtn();
    place();
  }

  function elementOf(node) {
    return node?.nodeType === 1 ? node : node?.parentElement;
  }

  // 글자가 놓인 가장 가까운 블록 상자(문장을 뽑을 범위)
  function blockOf(node) {
    for (let el = elementOf(node); el && el !== document.body; el = el.parentElement) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && !d.startsWith('ruby') && d !== 'contents') return el; // 자동 주석의 ruby(display: ruby)는 글 블록이 아니다
    }
    return document.body;
  }

  globalThis.readglossBlockOf = blockOf; // selection.js(드래그 번역)가 같은 블록 판정을 쓴다

  function onDblClick(e) {
    if (host && e.composedPath().includes(host)) return; // 카드 안
    if (e.composedPath().some((n) => n.localName === 'readgloss-ui' || n.localName === 'readgloss-toast')) return; // 떠 있는 버튼·패널·확인 메시지 안
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = elementOf(range.commonAncestorContainer);
    const target = elementOf(e.target);
    if (!el || el.isContentEditable || el.closest(BLOCKED_SELECTOR) || target?.closest(BLOCKED_SELECTOR)) return;
    const picked = cleanSelection(sel.toString());
    if (!picked) return;

    const block = blockOf(range.startContainer);
    const { text, offset } = plainTextAt(block, range.startContainer, range.startOffset); // 자동 주석의 rt 글자는 문장에 섞지 않는다
    const sentence = extractSentence(text, offset + picked.start, picked.word.length);
    openCard(picked.word, sentence, range.getBoundingClientRect(), range);
  }

  // rect: 뷰포트 좌표의 단어 사각형. range: 단어를 담은 선택(AI 문맥 뜻이 앞뒤 문맥을 뽑을 때 쓴다).
  // extras: 패널의 저장 문장에서 연 카드의 { context(그 문장), source(저장한 페이지) }. 페이지 글이 아니라 range 가 없다.
  function openCard(word, sentence, r, range, extras = {}) {
    if (host) close();
    current = { word, sentence, range: range?.cloneRange(), ...extras, anchor: { left: r.left + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY } };
    buildCard();
    askDict().catch(close); // 동기적으로 "찾는 중…" 부터 그린다
  }

  // 드래그 번역(selection.js)이 한 단어를 드래그하면 더블클릭과 같은 사전 카드를 그 자리에 연다.
  window.addEventListener('readgloss:lookup', (e) => {
    const d = e.detail;
    if (!globalThis.readgloss.isEnglishWord(d?.word) || typeof d.sentence !== 'string' || ![d.rect?.left, d.rect?.top, d.rect?.bottom].every(Number.isFinite)) return;
    try {
      openCard(d.word, d.sentence, d.rect, d.range, globalThis.readglossSelection.lookupExtras(d));
    } catch {
      // 페이지를 깨뜨리지 않는다
    }
  });

  document.addEventListener(
    'dblclick',
    (e) => {
      try {
        onDblClick(e);
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
    },
    true,
  );
  document.addEventListener('mousedown', (e) => host && !e.composedPath().includes(host) && !e.composedPath().some((n) => n.localName === 'readgloss-toast') && close(), true); // 확인 메시지(메모)를 누를 땐 카드를 닫지 않는다
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // 저장 완료 확인 메시지(readgloss-toast)가 열려 있고 메모 칸 입력 중이 아닐 때 Esc 로 바로 닫음
    if (toastHost && !toastMemo) {
      e.readglossCardClosed = true; // 패널·메모장 등이 같은 Escape 로 닫히지 않게 막음
      hideToast();
      return;
    }

    // 사전 카드(readgloss-card) Esc 로 닫기 및 글 선택 해제. 확인 메시지(메모) 안 Escape 는 무시
    if (host && !e.composedPath().some((n) => n.localName === 'readgloss-toast')) {
      e.readglossCardClosed = true; // 표시: 패널(panel.js)이 같은 Escape 로 같이 닫히지 않게
      try {
        window.getSelection?.()?.removeAllRanges?.();
      } catch {}
      close();
    }
  }, true);
})();
