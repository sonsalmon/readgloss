// 떠 있는 버튼 · 퀵 메뉴 · 오른쪽 패널 · 설정 탭(T6b). classic script, 전역 readglossPanelCore(순수 함수·표) 와 readglossPanelTabs(탭 등록 배열).
// 위쪽은 DOM 이 없어도 도는 순수 로직이고(node --test 가 같은 파일을 쓴다), document 가 없으면 거기서 끝난다.
(() => {
  const DEFAULT_TOP = 60;
  const MIN_TOP = 40;
  const MAX_SITES = 200;
  const LEVELS = () => globalThis.readglossSettings.LEVELS;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
  // 'annotation.sizePct', 70 -> { annotation: { sizePct: 70 } }
  const patchFor = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);

  // 탭: id·render 가 있는 것만, 같은 id 는 먼저 등록된 것, order 순(같으면 등록 순, order 없으면 맨 뒤)
  function sortTabs(tabs) {
    const seen = new Set();
    const ok = (Array.isArray(tabs) ? tabs : []).filter((t) => {
      if (!isObj(t) || typeof t.id !== 'string' || typeof t.render !== 'function' || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    return ok.sort((a, b) => (Number.isFinite(a.order) ? a.order : Infinity) - (Number.isFinite(b.order) ? b.order : Infinity) || 0);
  }

  // 탭 pane 을 먼저 붙인 뒤 그린다: 미리보기 같은 그리기 코드가 isConnected 로 문서 안의 노드만 믿기 때문. 그리다 던지면 fallback() 노드로 바꾼다.
  function mountPane(parent, pane, render, fallback) {
    parent.append(pane);
    try {
      render(pane);
    } catch {
      pane.replaceChildren(fallback());
    }
  }

  const levelIndex = (level) => {
    const i = LEVELS().indexOf(level);
    return i < 0 ? 3 : i; // 모르는 값은 기본 C1
  };
  const levelAt = (i) => LEVELS()[Math.min(4, Math.max(0, Math.round(i)))];

  // 슬라이더 표. min·max·step 은 슬라이더 위치(단위가 다르면 to·from 으로 설정값과 오간다). 허용 범위는 settings-core 와 같다(테스트가 대조).
  const RANGES = [
    { path: 'level', min: 0, max: 4, step: 1, to: levelIndex, from: levelAt },
    { path: 'maxPerParagraph', min: 0, max: 10, step: 1 },
    { path: 'annotation.sizePct', min: 40, max: 100, step: 5 },
    { path: 'annotation.opacityPct', min: 30, max: 100, step: 5 },
    // 뜻 높이는 -0.5~0.3em 을 정수 -10~6 단계(0.05em)로 — 소수 슬라이더의 부동소수 오차를 피한다
    { path: 'annotation.liftEm', min: -10, max: 6, step: 1, to: (v) => Math.round(v / 0.05), from: (n) => Math.round(n * 5) / 100 },
    { path: 'opacityInput', min: 40, max: 100, step: 5 },
    { path: 'opacityUi', min: 40, max: 100, step: 5 },
    { path: 'video.fontPct', min: 60, max: 160, step: 10 },
  ];
  const CHOICES = [
    { path: 'repeat', options: [['page', '페이지에서 한 번'], ['paragraph', '문단마다 첫 등장'], ['always', '매번']] },
    { path: 'annotation.position', options: [['top', '단어 위'], ['none', '없음']] },
    { path: 'annotation.color', options: [['text', '본문색'], ['accent', '강조색'], ['custom', '직접']] },
    { path: 'annotation.weight', options: [['light', '얇게'], ['normal', '보통'], ['bold', '굵게']] },
    { path: 'mark', options: [['none', '없음'], ['color', '글자색'], ['underline', '점선 밑줄'], ['background', '옅은 배경']] },
    { path: 'theme', options: [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']] },
    { path: 'glossary', options: [['auto', '자동'], ['off', '끄기']] },
    { path: 'video.hide', options: [['off', '끔'], ['hard', '어려운 단어'], ['all', '문장 전체']] },
    { path: 'video.slowRate', options: [[0.5, '0.5배'], [0.6, '0.6배'], [0.7, '0.7배'], [0.75, '0.75배'], [0.8, '0.8배'], [0.9, '0.9배']] },
  ];
  const TOGGLES = [{ path: 'enabled' }, { path: 'selectionTranslate' }, { path: 'floatingButton.show' }, { path: 'dimWhileReading' }, { path: 'structureHints' }, { path: 'savedMarks' },
    { path: 'video.subs' }, { path: 'video.ko' }, { path: 'video.hard' }, { path: 'video.hoverPause' }, { path: 'video.autoCC' }, { path: 'video.pauseEach' }];

  // 슬라이더가 준 값(문자열 가능) -> 설정 patch. 범위·단계로 고치고, 숫자가 아니면 null.
  function sliderPatch(spec, raw) {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const snapped = Math.round(Math.min(spec.max, Math.max(spec.min, n)) / spec.step) * spec.step;
    return patchFor(spec.path, spec.from ? spec.from(snapped) : snapped);
  }
  const sliderValue = (spec, settings) => (spec.to ? spec.to(getPath(settings, spec.path)) : getPath(settings, spec.path));

  // 끌 사이트 입력: 공백·프로토콜·경로·포트를 걷고 소문자로. 도메인 글자(와 * . - _)만 남으면 통과, 아니면 ''.
  function cleanSite(raw) {
    if (typeof raw !== 'string') return '';
    const s = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
    return /^[a-z0-9*][a-z0-9*._-]*$/.test(s) ? s : '';
  }
  function addSite(sites, raw) {
    const s = cleanSite(raw);
    return !s || sites.includes(s) || sites.length >= MAX_SITES ? [...sites] : [...sites, s];
  }
  const removeSite = (sites, site) => sites.filter((s) => s !== site);

  // 기본값 복원 patch: 끌 사이트(sites)만 남기고 전부 기본값(용어집을 켤 사이트도 기본 목록으로). 복사본을 돌려준다.
  function resetPatch(defaults) {
    const { sites, ...rest } = defaults;
    return structuredClone(rest);
  }

  // 버튼 세로 위치: 40px 이상, (창 높이-40px) 이하
  function clampTop(top, vh) {
    if (!Number.isFinite(top)) return DEFAULT_TOP;
    return Math.min(Math.max(MIN_TOP, vh - 40), Math.max(MIN_TOP, Math.round(top)));
  }
  const dragTop = ({ startTop, startY, y, vh }) => clampTop(startTop + (y - startY), vh);

  // 저장 patch 모으기: 객체는 키별로, 배열·값은 나중 것이 덮는다
  function mergePatch(a, b) {
    const out = { ...(isObj(a) ? a : {}) };
    for (const k of Object.keys(b)) out[k] = isObj(b[k]) && isObj(out[k]) ? mergePatch(out[k], b[k]) : b[k];
    return out;
  }

  // 패널 위에 뜬 사전 카드(content.js 의 readgloss-card, 저장된 문장에서 더블클릭해 연 것), 확인 메시지(readgloss-toast), 개념 칸(readgloss-concept-form), 개념 카드(readgloss-concept-card), 메모장(readgloss-memo-pad)을 눌러도 패널은 닫지 않는다.
  // 영상 자막 층(readgloss-subs)도 그렇다: [영상] 탭 대본을 연 채 자막 낱말을 누를 수 있게(27-5).
  const isCardPath = (path) => Array.isArray(path) && path.some((n) => n?.localName === 'readgloss-card' || n?.localName === 'readgloss-struct-card' || n?.localName === 'readgloss-subs');
  const isToastPath = (path) => Array.isArray(path) && path.some((n) => n?.localName === 'readgloss-toast');
  const isConceptPath = (path) => Array.isArray(path) && path.some((n) => n?.localName === 'readgloss-concept-form' || n?.localName === 'readgloss-concept-card');
  const isMemoPath = (path) => Array.isArray(path) && path.some((n) => n?.localName === 'readgloss-memo-pad');

  // 전체 번역 퀵 메뉴 문구. 전체 번역의 상태만 보고 정한다(손으로 번역한 문단은 메뉴 상태에 영향을 주지 않는다).
  // running -> 진행 중·멈추기, 한 번 돌리고 아직 안 걷음(started) -> 걷기, 그 밖 -> 시작. blocked 면 잠깐 안내.
  function pageTranslateMenu(s) {
    s = s ?? {};
    const failed = Number(s.failed) || 0;
    const failText = failed > 0 ? ` (실패 ${failed})` : '';
    if (s.blocked === true) return { text: '이 페이지에서는 꺼져 있어요', busy: false, title: '' };
    if (s.running === true) return { text: `전체 번역 중 ${Number(s.done) || 0}/${Number(s.total) || 0} · 멈추기${failText}`, busy: true, title: '' };
    return {
      text: (s.started === true ? '전체 번역 걷기' : '페이지 전체 번역') + failText,
      busy: false,
      title: s.reason === 'failures' ? '실패가 이어져 멈췄어요' : '',
    };
  }
  const pageTranslateAction = (s) => (s?.running === true ? 'stop' : s?.started === true ? 'clear' : 'start');

  const studyModeText = (on) => (on ? '공부 모드 끄기' : '공부 모드');
  const studyModeToggle = (on) => !on;

  const themeAttr = (theme) => (theme === 'light' || theme === 'dark' ? theme : null); // auto 는 속성 없음(prefers-color-scheme)

  // 순수 함수: 퀵 메뉴 닫기 판정(T39)
  // overDock 이나 overMenu 면 닫지 않고, 둘 다 벗어난 지 350ms 이상일 때만 닫는다.
  function menuShouldClose({ overDock, overMenu, msSinceLeave }) {
    if (overDock || overMenu) return false;
    return typeof msSinceLeave === 'number' && msSinceLeave >= 350;
  }

  // 순수 함수: 주석 양 자동 조절 offset 문구(T41b)
  function offsetLabel(offset) {
    const n = typeof offset === 'number' ? offset : Number(offset);
    if (!Number.isFinite(n) || Math.abs(n) < 0.0001) {
      return '자동 조절: 0 (그대로)';
    }
    if (n > 0) {
      const v = n.toFixed(2);
      return `자동 조절: +${v} (주석 줄임)`;
    }
    const v = Math.abs(n).toFixed(2);
    return `자동 조절: −${v} (주석 늘림)`;
  }

  globalThis.readglossPanelCore = {
    getPath, patchFor, sortTabs, mountPane, levelIndex, levelAt, RANGES, CHOICES, TOGGLES, sliderPatch, sliderValue,
    cleanSite, addSite, removeSite, resetPatch, clampTop, dragTop, mergePatch, themeAttr, isCardPath, isToastPath,
    isConceptPath, isMemoPath,
    pageTranslateMenu, pageTranslateAction, studyModeText, studyModeToggle, menuShouldClose, offsetLabel, MAX_SITES,
  };

  if (typeof document === 'undefined' || globalThis.readglossPanelLoaded) return; // node 시험·중복 주입: 여기까지
  globalThis.readglossPanelLoaded = true;
  // ======================= 여기부터 DOM (페이지 안에서만) =======================
  const S = globalThis.readglossSettings;
  const C = globalThis.readglossPanelCore;
  const SAVE_DELAY = 100; // 슬라이더를 끄는 동안 저장을 모아서 한 번에(화면 반영은 바로)
  const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif';
  // --rg-accent-ink: 옅은 강조 바탕(--rg-accent-soft) 위 글자색(대비 4.5:1 이상). 탭의 눌린 칩·단추 글자에 쓴다
  const LIGHT = `--rg-bg: #ffffff; --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb; --rg-accent-ink: #245ac4;
    --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); color-scheme: light;`;
  const DARK = `--rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff; --rg-accent-ink: #8db4ff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45); color-scheme: dark;`;
  const BRIDGE_HELP = '터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요';

  const STYLE_TEXT = `
    :host { ${LIGHT} --rg-radius: 10px; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) { ${DARK} } }
    :host([data-theme="dark"]) { ${DARK} }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .root { font: 14px/1.5 ${FONT}; color: var(--rg-fg); }

    .dock { position: fixed; right: 10px; top: 60px; z-index: 2; transition: right .2s ease; }
    .open .dock { right: 350px; }
    .fab { width: 36px; height: 36px; padding: 0; border-radius: 50%; border: 1px solid var(--rg-border); background: var(--rg-bg);
      color: var(--rg-accent); box-shadow: var(--rg-shadow); display: grid; place-items: center; touch-action: none; cursor: grab; }
    .fab:active { cursor: grabbing; }
    .fab:hover { background: var(--rg-accent-soft); }
    .fab svg { width: 20px; height: 20px; pointer-events: none; }
    .menu { position: absolute; right: 100%; top: -8px; padding: 12px 16px 20px 8px; display: none; }
    .up .menu { top: auto; bottom: -8px; }
    .menu.open, .dock:has(:focus-visible) .menu { display: block; }
    .menu-card { display: flex; flex-direction: column; min-width: 150px; padding: 4px; border-radius: var(--rg-radius);
      background: var(--rg-bg); border: 1px solid var(--rg-border); box-shadow: var(--rg-shadow); }
    .mitem { all: unset; box-sizing: border-box; cursor: pointer; padding: 6px 10px; border-radius: 7px; white-space: nowrap; font-size: 13px; }
    .mitem:hover { background: var(--rg-accent-soft); color: var(--rg-accent-ink); }
    .mitem:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }

    .panel { position: fixed; top: 0; right: 0; z-index: 1; width: 340px; max-width: 100vw; height: 100vh; height: 100dvh; display: flex; flex-direction: column;
      background: var(--rg-bg); color: var(--rg-fg); border-left: 1px solid var(--rg-border); box-shadow: var(--rg-shadow);
      transform: translateX(105%); visibility: hidden; transition: transform .2s ease, visibility 0s .2s; }
    .open .panel { transform: none; visibility: visible; transition: transform .2s ease; }
    @media (prefers-reduced-motion: reduce) { .panel, .dock { transition: none !important; } }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--rg-border); }
    .title { font-weight: 700; font-size: 15px; }
    .status { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--rg-muted); font-size: 12px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--rg-muted); }
    .dot.on { background: #2da44e; }
    .dot.off { background: #d1242f; }
    .close { all: unset; box-sizing: border-box; cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; color: var(--rg-muted); font-size: 16px; }
    .close:hover { background: var(--rg-accent-soft); color: var(--rg-fg); }
    .close:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    /* 탭 이름은 한 줄로. 유튜브처럼 탭이 늘면 줄이 접히지 않고 옆으로 넘긴다(T51e) */
    .tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--rg-border); overflow-x: auto; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    .tab { all: unset; box-sizing: border-box; flex: none; white-space: nowrap; cursor: pointer; padding: 8px 8px; color: var(--rg-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab:hover { color: var(--rg-fg); }
    .tab[aria-selected="true"] { color: var(--rg-accent); border-bottom-color: var(--rg-accent); font-weight: 600; }
    .tab:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    .body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 28px; }

    .preview { padding: 14px; margin-bottom: 14px; border: 1px solid var(--rg-border); border-radius: var(--rg-radius); background: var(--rg-bg); font-size: 16px; line-height: 2.1; }
    .sec { margin: 18px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .02em; color: var(--rg-muted); }
    .sec:first-of-type { margin-top: 0; }
    .row { margin-bottom: 12px; }
    .rowhead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .rowhead output { color: var(--rg-accent); font-variant-numeric: tabular-nums; font-size: 13px; }
    .hint { margin: 2px 0 0; color: var(--rg-muted); font-size: 12px; }
    input[type="range"] { width: 100%; margin: 4px 0 0; accent-color: var(--rg-accent); }
    .seg { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .seg button { padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border); background: transparent; font-size: 13px; }
    .seg button:hover { border-color: var(--rg-accent); }
    .seg button[aria-pressed="true"] { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent-ink); font-weight: 600; }
    input[type="color"] { width: 32px; height: 26px; padding: 0; border: 1px solid var(--rg-border); border-radius: 6px; background: none; cursor: pointer; vertical-align: middle; }
    .check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
    .check input { margin: 4px 0 0; accent-color: var(--rg-accent); }
    .sites { list-style: none; margin: 0 0 8px; padding: 0; }
    .sites li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--rg-border); }
    .sites li.empty { color: var(--rg-muted); font-size: 12px; border: 0; }
    .sites.scroll { max-height: 190px; overflow-y: auto; }
    .glossites.dim > :not(.rowhead):not(.hint) { opacity: .5; }
    .sites .name { overflow-wrap: anywhere; font-size: 13px; }
    .btn { padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border); background: transparent; font-size: 12.5px; white-space: nowrap; }
    .btn:hover:not(:disabled) { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent-ink); }
    .btn:disabled { opacity: .55; cursor: default; }
    .addrow { display: flex; gap: 6px; margin-top: 8px; }
    .addrow input { flex: 1; min-width: 0; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--rg-border); background: var(--rg-bg); color: var(--rg-fg); font: inherit; font-size: 13px; }
    .msg { margin: 4px 0 0; color: var(--rg-muted); font-size: 12px; min-height: 1.5em; }
    .reset { margin-top: 22px; }
  `;

  // ---- 설정 상태: 화면은 바로 바꾸고, 저장은 모아서 한 번에(저장 순서는 줄 세운다) ----
  let state = S.normalize({});
  let pageOff = globalThis.readglossPageOff === true;
  let pend = null; // 아직 저장 안 한 patch
  let inflight = 0; // 저장 중인 횟수
  let timer = 0;
  let chain = Promise.resolve();
  let waiters = [];
  const listeners = new Set(); // 설정이 바뀔 때 부르는 곳(탭)
  const pageOffCbs = new Set();

  function setSettings(patch) {
    state = S.merge(state, patch);
    notify();
    pend = C.mergePatch(pend, patch);
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
    return new Promise((r) => waiters.push(r));
  }
  function flush() {
    const patch = pend;
    const ws = waiters;
    pend = null;
    waiters = [];
    inflight++;
    chain = chain
      .then(() => S.save(patch))
      .then(
        (next) => {
          inflight--;
          if (!pend && !inflight) { state = next; notify(); } // 마지막 저장이 끝난 뒤에만 저장된 값으로 맞춘다
        },
        () => { inflight--; }, // ponytail: 확장이 다시 로드돼 저장이 막히면 화면 값만 남는다(새로고침하면 저장된 값으로 돌아감)
      )
      .then(() => ws.forEach((r) => r(state)));
  }

  // ---- DOM 도우미 ----
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    n.append(...kids.filter((k) => k != null && k !== false));
    return n;
  }
  const svgIcon = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M3 5.5h6.5a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H3zM21 5.5h-6.5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h7z');
    svg.append(p);
    return svg;
  };
  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return { error: 'ext-reloaded' };
    }
  }

  // ---- 호스트(버튼·퀵 메뉴·패널 한 덩어리, 페이지 CSS 와 격리) ----
  const host = document.createElement('readgloss-ui');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' }); // ponytail: 시험에서 안을 들여다보려고 open. 페이지 스크립트가 읽을 수는 있다
  const root = h('div', { class: 'root' });

  // 떠 있는 버튼 + 퀵 메뉴
  const fab = h('button', { class: 'fab', type: 'button', 'aria-expanded': 'false' }, svgIcon());
  const pageOffItem = h('button', { class: 'mitem', type: 'button', onclick: () => setPageOff(!pageOff) });

  let ptState = { running: false, done: 0, total: 0, failed: 0, started: false, blocked: false, reason: '' };
  const pageTranslateItem = h('button', { class: 'mitem', type: 'button', onclick: onPageTranslateClick });
  const ptApi = () => globalThis.readglossPageTranslate; // paragraph.js 가 나중에 로드되므로 호출 때 읽는다

  function applyPtState(d) {
    ptState = {
      running: d?.running === true,
      done: Number(d?.done) || 0,
      total: Number(d?.total) || 0,
      failed: Number(d?.failed) || 0,
      started: d?.started === true,
      blocked: d?.blocked === true,
      reason: typeof d?.reason === 'string' ? d.reason : '',
    };
    updatePageTranslateUI();
  }

  function updatePageTranslateUI() {
    const m = C.pageTranslateMenu(ptState);
    pageTranslateItem.textContent = m.text;
    if (m.busy) pageTranslateItem.setAttribute('aria-busy', 'true');
    else pageTranslateItem.removeAttribute('aria-busy');
    if (m.title) pageTranslateItem.title = m.title;
    else pageTranslateItem.removeAttribute('title');
  }

  function onPageTranslateClick(e) {
    if (e && e.isTrusted === false) return; // 페이지 스크립트가 .click() 으로 열린 shadow 의 버튼을 눌러 AI 한도를 쓰지 못하게
    const api = ptApi();
    if (!api) return;
    const action = C.pageTranslateAction(ptState);
    if (action === 'stop') api.stop();
    else if (action === 'clear') api.clear();
    else api.start();
  }

  // 메뉴를 열 때(마우스 올림·포커스)에도 문구를 다시 계산한다.
  function syncPageTranslate() {
    const api = ptApi();
    if (!api) return;
    applyPtState(api.state?.() ?? {});
  }

  function bindPageTranslate() {
    const api = ptApi();
    if (!api) return;
    applyPtState(api.state?.() ?? {});
    api.onStatus?.(applyPtState);
  }
  bindPageTranslate();

  const scrapViewItem = h('button', {
    class: 'mitem',
    type: 'button',
    text: '스크랩 보기',
    onclick: () => globalThis.readglossScrapPage?.openFirstBar?.(),
  });
  scrapViewItem.hidden = true;

  function syncScrapView() {
    const pageScraps = globalThis.readglossScrapPage?.scraps || [];
    const core = globalThis.readglossScrap;
    const curUrl = core?.normalizeUrl && typeof location !== 'undefined' ? core.normalizeUrl(location.href) : (typeof location !== 'undefined' ? location.href : '');
    const hasScraps = pageScraps.some((s) => (core?.normalizeUrl ? core.normalizeUrl(s.url) : s.url) === curUrl);
    scrapViewItem.hidden = !hasScraps;
  }

  // ---- 공부 모드(퀵 메뉴 [공부 모드], 모듈 메모리 변수에 보관) ----
  let studyModeOn = false;
  function getStudyMode() {
    return studyModeOn;
  }
  function setStudyMode(on) {
    studyModeOn = Boolean(on);
  }

  const studyModeItem = h('button', {
    class: 'mitem',
    type: 'button',
    text: C.studyModeText(getStudyMode()),
    onclick: onStudyModeClick,
  });

  function updateStudyModeUI() {
    studyModeItem.textContent = C.studyModeText(getStudyMode());
  }

  function onStudyModeClick(e) {
    if (e && e.isTrusted === false) return;
    const nextOn = !getStudyMode();
    setStudyMode(nextOn);
    updateStudyModeUI();
    try {
      chrome.runtime.sendMessage({ type: 'study-mode', on: nextOn }).catch(() => {});
    } catch {}
    globalThis.readglossMemoPad?.setStudyMode?.(nextOn);
  }

  const menu = h('div', { class: 'menu' },
    h('div', { class: 'menu-card', role: 'group', 'aria-label': '빠른 메뉴' },
      pageOffItem,
      pageTranslateItem,
      scrapViewItem,
      studyModeItem,
      h('button', { class: 'mitem', type: 'button', text: '설정', onclick: () => openPanel('settings') }),
      h('button', { class: 'mitem', type: 'button', text: '내 단어', onclick: () => openPanel('words') }),
      h('button', { class: 'mitem', type: 'button', text: '버튼 숨기기', onclick: () => setSettings({ floatingButton: { show: false } }) })));
  const dock = h('div', { class: 'dock' }, menu, fab);
  let overDock = false;
  let overMenu = false;
  let menuCloseTimer = 0;
  let menuLeaveAt = 0;

  function openQuickMenu() {
    clearTimeout(menuCloseTimer);
    menuLeaveAt = 0;
    menu.classList.add('open');
    syncPageTranslate();
    syncScrapView();
  }

  function scheduleQuickMenuClose() {
    clearTimeout(menuCloseTimer);
    menuLeaveAt = Date.now();
    menuCloseTimer = setTimeout(() => {
      const elapsed = Date.now() - menuLeaveAt;
      if (C.menuShouldClose({ overDock, overMenu, msSinceLeave: elapsed })) {
        menu.classList.remove('open');
      }
    }, 350);
  }

  dock.addEventListener('mouseenter', () => {
    overDock = true;
    openQuickMenu();
  });
  dock.addEventListener('mouseleave', () => {
    overDock = false;
    scheduleQuickMenuClose();
  });
  menu.addEventListener('mouseenter', () => {
    overMenu = true;
    openQuickMenu();
  });
  menu.addEventListener('mouseleave', () => {
    overMenu = false;
    scheduleQuickMenuClose();
  });
  dock.addEventListener('focusin', () => {
    syncPageTranslate();
    syncScrapView();
  });
  dock.hidden = true; // 저장된 위치를 읽기 전에는 숨겨 둔다(깜빡임 방지)

  // 패널
  const statusDot = h('span', { class: 'dot' });
  const statusText = h('span', { text: '확인 중…' });
  const status = h('div', { class: 'status', role: 'status' }, statusDot, statusText);
  const closeBtn = h('button', { class: 'close', type: 'button', 'aria-label': '닫기', text: '✕', onclick: () => closePanel() });
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'readgloss 탭' });
  const body = h('div', { class: 'body' });
  const panel = h('aside', { class: 'panel', role: 'dialog', 'aria-label': 'readgloss 패널' },
    h('div', { class: 'head' }, h('span', { class: 'title', text: 'readgloss' }), status, closeBtn), tablist, body);

  root.append(dock, panel);
  const style = h('style');
  style.textContent = STYLE_TEXT;
  shadow.append(style, root);
  document.documentElement.append(host); // body 가 아니라 documentElement: 자동 주석이 body 글을 훑어도 섞이지 않게

  // ---- 이 페이지만 끄기(저장 안 함) ----
  function setPageOff(off) {
    globalThis.readglossPageOff = off;
    window.dispatchEvent(new CustomEvent('readgloss:pageoff', { detail: { off } }));
  }
  window.addEventListener('readgloss:pageoff', (e) => {
    pageOff = e.detail?.off === true;
    pageOffItem.textContent = pageOff ? '이 페이지 주석 켜기' : '이 페이지 주석 끄기';
    pageOffCbs.forEach((cb) => cb(pageOff));
  });
  pageOffItem.textContent = pageOff ? '이 페이지 주석 켜기' : '이 페이지 주석 끄기';

  // ---- 설정이 바뀔 때 버튼·테마·탭에 알린다 ----
  function positionDock(top) {
    dock.style.top = `${top}px`;
    dock.classList.toggle('up', top > innerHeight / 2); // 아래쪽이면 메뉴를 위로 펼친다
  }
  function notify() {
    const t = C.themeAttr(state.theme);
    if (t) host.setAttribute('data-theme', t);
    else host.removeAttribute('data-theme');
    dock.hidden = !state.floatingButton.show;
    if (!drag) positionDock(C.clampTop(state.floatingButton.top, innerHeight));
    for (const cb of [...listeners]) {
      try { cb(state); } catch { /* 탭 하나가 망가져도 나머지는 이어서 */ }
    }
  }
  window.addEventListener('resize', () => !drag && positionDock(C.clampTop(state.floatingButton.top, innerHeight)));

  // ---- 버튼 끌기·클릭 ----
  let drag = null;
  let suppressClick = false;
  fab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { startY: e.clientY, startTop: C.clampTop(state.floatingButton.top, innerHeight), moved: false, top: null };
    try { fab.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
  });
  fab.addEventListener('pointermove', (e) => {
    if (!drag || (!drag.moved && Math.abs(e.clientY - drag.startY) < 4)) return; // 4px 미만은 클릭
    drag.moved = true;
    drag.top = C.dragTop({ startTop: drag.startTop, startY: drag.startY, y: e.clientY, vh: innerHeight });
    positionDock(drag.top);
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    suppressClick = true; // 끌기 끝의 click 은 패널 토글이 아니다
    setTimeout(() => { suppressClick = false; }, 0);
    setSettings({ floatingButton: { top: d.top } });
  };
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);
  fab.addEventListener('click', () => !suppressClick && (isOpen ? closePanel() : openPanel()));

  // ---- 패널 열기·닫기·탭 ----
  let isOpen = false;
  let tabs = [];
  let selected = null;
  let prevFocus = null;
  let cleanups = [];

  const ctx = {
    send,
    get settings() { return state; },
    setSettings,
    onSettings(cb) {
      listeners.add(cb);
      const off = () => listeners.delete(cb);
      cleanups.push(off);
      return off;
    },
  };

  function renderTabs() {
    cleanups.forEach((f) => f());
    cleanups = [];
    tabs = C.sortTabs(globalThis.readglossPanelTabs); // 열 때마다 읽는다(나중에 등록된 탭도 보인다)
    tablist.replaceChildren();
    body.replaceChildren();
    for (const t of tabs) {
      const btn = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `pane-${t.id}`, text: t.title, onclick: () => selectTab(t.id) });
      const pane = h('div', { role: 'tabpanel', id: `pane-${t.id}`, 'aria-labelledby': `tab-${t.id}`, hidden: true });
      tablist.append(btn);
      C.mountPane(body, pane, (p) => t.render(p, ctx), () => h('p', { class: 'msg', text: '이 탭을 그리지 못했어요.' }));
    }
  }
  function selectTab(id) {
    const t = tabs.find((x) => x.id === id) ?? tabs[0];
    selected = t?.id ?? null;
    for (const x of tabs) {
      const on = x.id === selected;
      const btn = shadow.getElementById(`tab-${x.id}`);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      shadow.getElementById(`pane-${x.id}`).hidden = !on;
    }
    body.scrollTop = 0;
  }
  tablist.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.id === selected);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to == null || !tabs.length) return;
    e.preventDefault();
    selectTab(tabs[(to + tabs.length) % tabs.length].id);
    shadow.getElementById(`tab-${selected}`).focus();
  });

  function setStatus(kind) {
    statusDot.className = `dot ${kind === 'on' ? 'on' : kind === 'off' ? 'off' : ''}`;
    statusText.textContent = kind === 'on' ? '다리 연결됨' : kind === 'off' ? '다리 꺼짐' : '확인 중…';
    status.title = kind === 'off' ? BRIDGE_HELP : '';
  }
  async function refreshStatus() {
    setStatus('checking');
    const r = await send({ type: 'ping' });
    if (isOpen) setStatus(r?.ok ? 'on' : 'off');
  }

  function openPanel(id) {
    if (!isOpen) {
      prevFocus = document.activeElement && document.activeElement !== host ? document.activeElement : null;
      renderTabs();
      isOpen = true;
      root.classList.add('open');
      fab.setAttribute('aria-expanded', 'true');
      fab.setAttribute('aria-label', 'readgloss 패널 닫기');
      refreshStatus();
    }
    selectTab(id ?? selected);
    shadow.getElementById(`tab-${selected}`)?.focus({ preventScroll: true });
  }
  function closePanel({ restoreFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', 'readgloss 패널 열기');
    if (restoreFocus && document.activeElement === host) {
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
      else shadow.activeElement?.blur();
    }
  }
  fab.setAttribute('aria-label', 'readgloss 패널 열기');

  // 바깥 클릭: 패널 안, 사전 카드, 확인 메시지, 개념 칸·카드, 메모장을 눌러도 닫지 않는다.
  // 개념 표시 위를 누른 것(e.readglossConceptHit)이면 닫지 않는다: 패널은 열린 채 상세만 바뀐다. 같은 개념이면 concept.js 가 닫는다.
  document.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    if (isOpen && !e.readglossConceptHit && !path.includes(host) && !C.isCardPath(path) && !C.isConceptPath(path) && !C.isToastPath(path) && !C.isMemoPath(path)) closePanel({ restoreFocus: false });
  }, true);
  // 사전 카드가 이 Escape 로 닫혔으면(content.js 가 표시를 남긴다) 패널은 그대로 둔다. 확인 메시지(메모)나 개념 칸·카드, 메모장 안에서 누른 Escape 도 무시한다.
  document.addEventListener('keydown', (e) => e.key === 'Escape' && isOpen && !e.readglossCardClosed && !C.isMemoPath(e.composedPath()) && !C.isConceptPath(e.composedPath()) && !C.isToastPath(e.composedPath()) && closePanel(), true);
  window.addEventListener('readgloss:open-panel', (e) => openPanel(e.detail?.tab));
  try {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (sender.id !== chrome.runtime.id || msg?.type !== 'open-panel') return; // 툴바 아이콘(background.js 가 보낸다)
      isOpen ? closePanel() : openPanel();
    });
  } catch { /* 확장 밖(시험 페이지) */ }

  // ---- 설정 탭 ----
  let uid = 0;
  const FMT = {
    level: (i) => S.LEVELS[i],
    maxPerParagraph: (n) => (n === 0 ? '제한 없음' : `${n}개`),
    'annotation.sizePct': (n) => `${n}%`,
    'annotation.opacityPct': (n) => `${n}%`,
    'annotation.liftEm': (n) => `${(n * 5) / 100}em`,
    opacityInput: (n) => `${n}%`,
    opacityUi: (n) => `${n}%`,
    'video.fontPct': (n) => `${n}%`,
  };
  const LABEL = {
    level: '수준', maxPerParagraph: '문단당 최대', repeat: '반복', 'annotation.position': '위치', 'annotation.sizePct': '크기',
    'annotation.color': '색', 'annotation.opacityPct': '불투명도', 'annotation.weight': '굵기', 'annotation.liftEm': '뜻 높이',
    mark: '단어 표시', theme: '테마', glossary: '분야 용어집', enabled: '주석 켜기', allowCopy: '주석 글자 복사 허용', selectionTranslate: '드래그 번역', 'floatingButton.show': '떠 있는 버튼 보이기',
    opacityInput: '입력 칸 투명도', opacityUi: '나머지 투명도', dimWhileReading: '읽는 동안 흐리게',
    structureHints: '문장 구조 표시',
    savedMarks: '단어장 단어 칠하기',
    'video.subs': '유튜브 자막 층 켜기', 'video.ko': '한국어 줄 보이기', 'video.hard': '어려운 단어 칠하기', 'video.hoverPause': '자막에 마우스를 올리면 잠깐 멈춤',
    'video.autoCC': '자막이 꺼져 있으면 켜기', 'video.pauseEach': '줄마다 멈춤', 'video.hide': '가리기(듣기 연습)', 'video.fontPct': '자막 크기', 'video.slowRate': '느리게 속도',
  };
  const LEVEL_HINT = {
    A2: 'A2 이상: 거의 모든 단어에 뜻이 붙어요',
    B1: 'B1 이상: 중급 단어부터',
    B2: 'B2 이상: 중상급 단어부터',
    C1: 'C1 이상: 상급 단어부터(기본)',
    C2: 'C2: 가장 어려운 단어에만',
  };
  const find = (list, path) => list.find((x) => x.path === path);

  function renderSettings(box, ctx) {
    const refreshers = [];
    const focused = (el) => shadow.activeElement === el; // 만지고 있는 컨트롤은 값을 덮어쓰지 않는다

    const slider = (path) => {
      const spec = find(C.RANGES, path);
      const id = `r${++uid}`;
      const input = h('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step });
      const out = h('output', { for: id });
      const hint = path === 'level' ? h('p', { class: 'hint' }) : null;
      input.addEventListener('input', () => {
        const patch = C.sliderPatch(spec, input.value);
        if (patch) ctx.setSettings(patch);
      });
      refreshers.push((s) => {
        const v = C.sliderValue(spec, s);
        if (!focused(input)) input.value = v;
        out.textContent = FMT[path](v);
        if (hint) hint.textContent = `${LEVEL_HINT[S.LEVELS[v]]} · 목록에 없는 기술 단어 포함`;
      });
      return h('div', { class: 'row' }, h('div', { class: 'rowhead' }, h('label', { for: id, text: LABEL[path] }), out), input, hint);
    };

    const choice = (path, extra, hint) => {
      const spec = find(C.CHOICES, path);
      const btns = spec.options.map(([value, text]) => h('button', { type: 'button', text, 'aria-pressed': 'false', onclick: () => ctx.setSettings(C.patchFor(path, value)) }));
      refreshers.push((s) => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(C.getPath(s, path) === spec.options[i][0]))));
      return h('div', { class: 'row' }, h('div', { class: 'rowhead', text: LABEL[path] }), h('div', { class: 'seg', role: 'group', 'aria-label': LABEL[path] }, ...btns, extra), hint ? h('p', { class: 'hint', text: hint }) : null);
    };

    const color = h('input', { type: 'color', 'aria-label': '직접 고른 색' });
    color.addEventListener('input', () => ctx.setSettings({ annotation: { color: 'custom', customColor: color.value } }));
    refreshers.push((s) => { if (!focused(color)) color.value = s.annotation.customColor; });

    const toggle = (path, hint) => {
      const input = h('input', { type: 'checkbox' });
      input.addEventListener('change', () => ctx.setSettings(C.patchFor(path, input.checked)));
      refreshers.push((s) => { input.checked = C.getPath(s, path) === true; });
      return h('div', { class: 'row' }, h('label', { class: 'check' }, input, h('span', {}, LABEL[path], hint ? h('p', { class: 'hint', text: hint }) : null)));
    };

    const offInput = h('input', { type: 'checkbox' });
    offInput.addEventListener('change', () => setPageOff(offInput.checked));
    const onOff = (off) => { offInput.checked = off; };
    onOff(pageOff);
    pageOffCbs.add(onOff);
    cleanups.push(() => pageOffCbs.delete(onOff));
    const offRow = h('div', { class: 'row' }, h('label', { class: 'check' }, offInput, h('span', {}, '이 페이지만 끄기', h('p', { class: 'hint', text: '저장하지 않아요. 새로고침하면 다시 켜져요.' }))));

    // 미리보기(16): 주석 그리기(T6a)가 내놓은 공유 스타일시트와 그리기 함수를 쓴다. 없으면 안내 문구.
    const previewBox = h('div', { class: 'preview', 'aria-label': '주석 미리보기', role: 'group' });
    const updatePreview = (s) => {
      const A = globalThis.readglossAnnotStyle;
      try {
        if (!A) throw new Error('none');
        if (!shadow.adoptedStyleSheets.includes(A.sheet)) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, A.sheet];
        A.apply(s, previewBox);
        A.renderPreview(previewBox, s);
      } catch {
        previewBox.replaceChildren(h('p', { class: 'hint', text: '미리보기는 주석 기능이 켜진 뒤 보여요' }));
      }
    };

    // 사이트 목록 UI(끌 사이트 49 · 용어집을 켤 사이트 T11 가 같은 모양): 줄마다 삭제, 지금 사이트 추가, 직접 입력. key 는 설정 키.
    const here = location.hostname;
    function siteList(key, { label, inputLabel, max }) {
      const list = h('ul', { class: max ? 'sites scroll' : 'sites', 'aria-label': label });
      const msg = h('p', { class: 'msg', role: 'status' });
      const hereBtn = h('button', { class: 'btn', type: 'button', onclick: () => add(here) });
      const input = h('input', { type: 'text', placeholder: 'example.com 또는 *.example.com', 'aria-label': inputLabel, spellcheck: 'false', autocomplete: 'off' });
      const addBtn = h('button', { class: 'btn', type: 'button', text: '추가', onclick: () => add(input.value) });
      function add(raw) {
        const cur = ctx.settings[key];
        const next = C.addSite(cur, raw);
        if (next.length === cur.length) {
          msg.textContent = C.cleanSite(raw) ? (next.length >= C.MAX_SITES && !next.includes(C.cleanSite(raw)) ? '목록이 가득 찼어요(200개).' : '이미 목록에 있어요.') : '도메인 형태로 적어 주세요(예: example.com, *.example.com).';
          return;
        }
        msg.textContent = '';
        input.value = '';
        ctx.setSettings({ [key]: next });
      }
      input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add(input.value)));
      const nodes = [list, hereBtn, h('div', { class: 'addrow' }, input, addBtn), msg];
      const off = (s) => key === 'glossarySites' && s.glossary === 'off'; // 용어집 자체가 꺼져 있으면 목록은 흐리게(고칠 수는 없다)
      refreshers.push((s) => {
        list.replaceChildren(...(s[key].length
          ? s[key].map((site) => h('li', {}, h('span', { class: 'name', text: site }),
            h('button', { class: 'btn', type: 'button', text: '삭제', 'aria-label': `${site} 삭제`, disabled: off(s), onclick: () => ctx.setSettings({ [key]: C.removeSite(ctx.settings[key], site) }) })))
          : [h('li', { class: 'empty', text: '아직 없어요' })]));
        hereBtn.textContent = s[key].includes(here) ? `${here}: 목록에 있어요` : `지금 사이트 추가(${here})`;
        hereBtn.disabled = !here || s[key].includes(here) || off(s);
        input.disabled = addBtn.disabled = off(s);
      });
      return nodes;
    }
    const blockNodes = siteList('sites', { label: '끌 사이트 목록', inputLabel: '끌 사이트 직접 입력' });
    const glossNodes = siteList('glossarySites', { label: '분야 용어집을 켤 사이트 목록', inputLabel: '분야 용어집을 켤 사이트 직접 입력', max: true });
    const glossBox = h('div', { class: 'row glossites', role: 'group', 'aria-label': '분야 용어집을 켤 사이트' },
      h('div', { class: 'rowhead', text: '분야 용어집을 켤 사이트' }),
      h('p', { class: 'hint', text: '이 사이트에서는 보안·머신러닝·수학 용어가 분야 용어로 보여요. 목록 밖에서도 수식·머신러닝 글이면 그 분야만 켜져요.' }), ...glossNodes);
    refreshers.push((s) => glossBox.classList.toggle('dim', s.glossary === 'off'));

    // 기본값 복원: 한 번 더 눌러야 한다. 끌 사이트 목록은 남기고, 용어집을 켤 사이트는 기본 목록으로.
    let armed = 0;
    const resetBtn = h('button', { class: 'btn', type: 'button', text: '기본값 복원' });
    resetBtn.addEventListener('click', () => {
      if (!armed) {
        resetBtn.textContent = '한 번 더 누르면 복원돼요';
        armed = setTimeout(() => { armed = 0; resetBtn.textContent = '기본값 복원'; }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      resetBtn.textContent = '기본값 복원';
      ctx.setSettings(C.resetPatch(S.DEFAULTS));
    });

    // 내게 맞추기(T41b): 주석 양 자동 조절 스위치, offset 표시 및 되돌리기, 7일 통계
    const autoInput = h('input', { type: 'checkbox' });
    const autoRow = h('div', { class: 'row' },
      h('label', { class: 'check' }, autoInput, h('span', {}, '주석 양 자동 맞추기'))
    );
    const offsetSpan = h('span', { text: C.offsetLabel(0) });
    const offsetResetBtn = h('button', { class: 'btn', type: 'button', text: '되돌리기' });
    const offsetRow = h('div', { class: 'row' },
      h('div', { class: 'rowhead' }, offsetSpan, offsetResetBtn)
    );
    const statsHint = h('p', { class: 'hint', text: '지난 7일: 뜬 주석 0 · 본 것 0 · 주석 없이 찾아본 단어 0' });
    const adaptiveMsg = h('p', { class: 'msg', role: 'status' });
    adaptiveMsg.hidden = true;

    async function loadAdaptiveStats() {
      const r = await ctx.send({ type: 'annotate-stats', op: 'get' });
      if (!r || r.error) {
        adaptiveMsg.textContent = '다리에 연결하지 못했어요';
        adaptiveMsg.hidden = false;
        return;
      }
      adaptiveMsg.hidden = true;
      adaptiveMsg.textContent = '';
      autoInput.checked = r.auto !== false;
      offsetSpan.textContent = C.offsetLabel(r.offset ?? 0);
      const l7 = r.last7 || {};
      const shown = Number(l7.shown) || 0;
      const seen = Number(l7.seen) || 0;
      const missed = Number(l7.missedLookups) || 0;
      statsHint.textContent = `지난 7일: 뜬 주석 ${shown} · 본 것 ${seen} · 주석 없이 찾아본 단어 ${missed}`;
    }

    autoInput.addEventListener('change', async () => {
      const nextOn = autoInput.checked;
      const r = await ctx.send({ type: 'annotate-stats', op: 'auto', on: nextOn });
      if (r?.error) {
        adaptiveMsg.textContent = '다리에 연결하지 못했어요';
        adaptiveMsg.hidden = false;
        autoInput.checked = !nextOn;
      } else {
        await loadAdaptiveStats();
      }
    });

    offsetResetBtn.addEventListener('click', async () => {
      offsetResetBtn.disabled = true;
      try {
        const r = await ctx.send({ type: 'annotate-stats', op: 'reset' });
        if (r?.error) {
          adaptiveMsg.textContent = '다리에 연결하지 못했어요';
          adaptiveMsg.hidden = false;
        } else {
          await loadAdaptiveStats();
        }
      } finally {
        offsetResetBtn.disabled = false;
      }
    });

    loadAdaptiveStats();

    box.append(
      previewBox,
      h('h3', { class: 'sec', text: '켜기' }), toggle('enabled'), offRow,
      h('h3', { class: 'sec', text: '어떤 단어에' }), slider('level'), slider('maxPerParagraph'), choice('repeat'), choice('glossary', null, '전치행렬처럼 분야 용어로 보여 줘요. 끄면 사전 뜻만 나와요.'), glossBox,
      h('h3', { class: 'sec', text: '주석 모양' }), choice('annotation.position'), slider('annotation.sizePct'), choice('annotation.color', color),
      slider('annotation.opacityPct'), choice('annotation.weight'), slider('annotation.liftEm'), toggle('structureHints'), toggle('savedMarks'),
      h('h3', { class: 'sec', text: '내게 맞추기' }), autoRow, offsetRow, statsHint, adaptiveMsg,
      h('h3', { class: 'sec', text: '단어 표시' }), choice('mark'),
      h('h3', { class: 'sec', text: '영상 자막' }), toggle('video.subs', '유튜브 영상에서 영어·한국어 두 줄 자막. 유튜브 자막(CC) 단추로 켜고 꺼요. 낱말을 누르면 사전 카드.'),
      toggle('video.ko', '맥 번역(무료)이에요. 자막 위 [풀이]는 AI 문맥 번역.'), toggle('video.hard'), toggle('video.hoverPause'), toggle('video.autoCC', '영상마다 한 번 CC 단추를 눌러요.'),
      toggle('video.pauseEach', 'P 키로도 바꿔요. A 앞 줄 · S 이 줄 다시 · D 다음 줄.'), choice('video.hide', null, 'H 키로도 바꿔요. 가린 낱말을 누르거나 R 로 그 줄을 보여요.'), slider('video.fontPct'), choice('video.slowRate', null, 'Z 키나 자막 막대 [느리게]로 1배와 이 속도를 오가요.'),
      h('h3', { class: 'sec', text: '화면' }), slider('opacityInput'), slider('opacityUi'), toggle('dimWhileReading', '메모할 때만 진해지고, 읽을 때는 설정한 투명도로 보여요.'),
      h('h3', { class: 'sec', text: '기타' }), toggle('allowCopy', '체크하지 않으면 복사할 때 주석 글자가 섞이지 않아요.'), toggle('selectionTranslate', '글을 드래그하면 맥 번역 카드가 떠요. 한 단어는 사전 카드로 열려요.'), choice('theme'), toggle('floatingButton.show', '숨겨도 브라우저 툴바의 readgloss 아이콘으로 패널을 열 수 있어요.'),
      h('h3', { class: 'sec', text: '끌 사이트' }), ...blockNodes,
      h('div', { class: 'reset' }, resetBtn, h('p', { class: 'hint', text: '끌 사이트 목록은 그대로 두고, 분야 용어집을 켤 사이트는 기본 목록으로 돌아가요.' })),
    );
    const refresh = (s) => { refreshers.forEach((f) => f(s)); updatePreview(s); };
    refresh(ctx.settings);
    ctx.onSettings(refresh);
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'settings', title: '설정', order: 10, render: renderSettings });

  // ---- 시작: 저장된 설정을 읽고 따라간다 ----
  S.load().then((s) => { state = s; notify(); }, notify); // 읽기 전에는 버튼을 숨겨 둔다(깜빡임 방지)
  try {
    S.onChange((s) => {
      if (pend || inflight) return; // 우리가 저장하는 중이면 끝난 뒤 한 번에 맞춘다
      state = s;
      notify();
    });
  } catch { /* 확장 밖 */ }
})();
