// 설정값 뼈대. chrome.storage.local 의 'settings' 키 하나만 읽고 쓴다(다른 키, 특히 'token' 은 건드리지 않는다).
// classic script: globalThis.readglossSettings 로 등록. normalize·merge·siteBlocked 는 순수 함수라 node 에서도 쓴다.
(() => {
  const KEY = 'settings';
  const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];
  // 세로 컨트롤 막대(28-10): 기본 순서와 저장값이 받는 이름. video-core.barModel 이 이 순서를 바탕으로 그린다.
  const BAR_NAMES = Object.freeze(['prev', 'repeat', 'next', 'repeatLine', 'loop', 'drill', 'pauseEach', 'skipGaps', 'slow', 'focusMode', 'hide', 'ko', 'save', 'explain']);
  // 자막 줄 구성(28-11): 둘 다 · 영어만 · 한국어만 · 안 보이기
  const SUB_TYPES = ['dual', 'en', 'ko', 'none'];
  // 영상 학습 모드(28-16): 보기 · 이해 · 듣기 · 조립
  const VIDEO_MODES = ['watch', 'understand', 'listen', 'build'];
  const DEFAULTS = Object.freeze({
    enabled: true, level: 'C1', maxPerParagraph: 3, repeat: 'page',
    annotation: { position: 'top', sizePct: 55, color: 'text', customColor: '#2f6feb', opacityPct: 70, weight: 'normal', gapEm: 0, liftEm: -0.15 },
    mark: 'none', allowCopy: false, selectionTranslate: true, theme: 'auto', glossary: 'auto', sites: [],
    opacityInput: 100, opacityUi: 100, dimWhileReading: true,
    structureHints: true,
    savedMarks: true,
    // 분야 용어집(보안·ML·수학)을 켤 사이트. 규칙은 sites 와 같다.
    glossarySites: Object.freeze(['academy.hackthebox.com', 'app.hackthebox.com', 'portswigger.net', 'owasp.org', '*.owasp.org', 'book.hacktricks.xyz', 'book.hacktricks.wiki', 'cloud.hacktricks.xyz', 'hacktricks.wiki', '*.hacktricks.wiki', 'tryhackme.com', 'attack.mitre.org', 'atlas.mitre.org', 'cwe.mitre.org', 'nvd.nist.gov', 'www.exploit-db.com', 'gtfobins.github.io', 'lolbas-project.github.io', 'arxiv.org']),
    floatingButton: { show: true, top: 60 },
    // 유튜브 자막 층(변경 기록 27-2·27-6): 켜기, 한국어 줄, 어려운 단어 칠하기, 마우스를 올리면 멈춤, 자막 켜기 도움, 글자 크기 %, 가리기, 줄마다 멈춤
    // 변경 기록 28-1: 문장 반복·틈 건너뛰기(문장 반복과 줄마다 멈춤은 함께 켤 수 없다)
    // 변경 기록 28-2: 키 배정 안내를 처음 한 번 보여 주고 [알겠어요] 로 keysNoticeSeen 을 남긴다
    // 변경 기록 28-3: 느리게 재생 속도(slowRate, 0.5~0.9)
    // 변경 기록 28-6: 마우스를 올려도 영상은 멈추지 않는다(hoverPause 기본 false). 켜면 지금처럼 멈춘다.
    // 변경 기록 28-7: W 키보드 저장 모드(focusMode 기본 false)
    // 변경 기록 28-8: 리스닝 연습 가리기(hide: off·word·line, hideTypes: 어려운·복습 끝·나머지)
    // 변경 기록 28-9: 칠하기 구간(wordBands: 쉬움·보통·어려움, 기본 보통 이상)과 숙어 덩어리(idioms)
    // 변경 기록 28-10: 세로 막대 단추 순서(barOrder)와 숨긴 단추(barHidden)
    // 변경 기록 28-11: 자막 유형(subType)·한국어 위로(koAbove)·영어/한국어 크기(enFontPct·koFontPct)·배경 진하기(bgOpacity)·위치(posY)
    // 변경 기록 28-16: 학습 모드(mode: 보기·이해·듣기·조립)
    video: { subs: true, subType: 'dual', koAbove: false, enFontPct: 100, koFontPct: 100, bgOpacity: 75, posY: 0, hard: true, hoverPause: false, autoCC: true, hide: 'off', hideTypes: { hard: true, done: false, other: false }, pauseEach: false, repeatLine: false, skipGaps: false, keysNoticeSeen: false, slowRate: 0.75, focusMode: false, wordBands: { easy: false, medium: true, hard: true }, idioms: true, mode: 'watch', barOrder: BAR_NAMES, barHidden: [] },
    reviewMode: 'flip', // 복습 방식(27-4): 뒤집기 · 고르기 · 듣기
  });
  const ENUMS = {
    level: LEVELS, repeat: ['page', 'paragraph', 'always'], mark: ['none', 'color', 'underline', 'background'], theme: ['auto', 'light', 'dark'], glossary: ['auto', 'off'],
    position: ['top', 'none'], color: ['text', 'accent', 'custom'], weight: ['light', 'normal', 'bold'],
    hide: ['off', 'word', 'line'], reviewMode: ['flip', 'choice', 'listen'],
  };
  const MAX_SITES = 200;

  // 느리게 재생(28-3): video-core.clampSlowRate 와 같은 규칙. settings-core 는 video-core 를 부르지 않으므로 여기에 둔다.
  const SLOW_MIN = 0.5;
  const SLOW_MAX = 0.9;
  const SLOW_STEP = 0.05;
  const SLOW_DEFAULT = 0.75;
  function clampSlowRate(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return SLOW_DEFAULT;
    const snapped = Math.round(Math.round(v / SLOW_STEP) * SLOW_STEP * 100) / 100;
    return Math.min(SLOW_MAX, Math.max(SLOW_MIN, snapped));
  }

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const pickEnum = (v, list, def) => (list.includes(v) ? v : def);
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  // 범위 밖은 가장 가까운 허용값, 숫자가 아니면 기본값
  const num = (v, min, max, def, int = true) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return def;
    const c = Math.min(max, Math.max(min, v));
    return int ? Math.round(c) : Math.round(c * 1000) / 1000;
  };
  // 10 단위처럼 정해진 칸으로 맞춘다(범위 밖은 가장 가까운 허용값).
  const stepNum = (v, min, max, step, def) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return def;
    const c = Math.min(max, Math.max(min, v));
    return Math.min(max, Math.max(min, Math.round(c / step) * step));
  };

  // 사이트 목록 정리: 문자열만, trim·소문자·중복 제거, 최대 200개
  const cleanList = (list) => [...new Set(list.filter((s) => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SITES);

  // 막대 이름 목록: 아는 이름만, 순서 유지·중복 제거. 배열이 아니면 기본 순서.
  const cleanBar = (list, def) => {
    if (!Array.isArray(list)) return [...def];
    const out = [];
    for (const k of list) if (BAR_NAMES.includes(k) && !out.includes(k)) out.push(k);
    return out;
  };

  function normalize(raw) {
    const r = isObj(raw) ? raw : {};
    const a = isObj(r.annotation) ? r.annotation : {};
    const f = isObj(r.floatingButton) ? r.floatingButton : {};
    const v = isObj(r.video) ? r.video : {};
    const D = DEFAULTS, DA = D.annotation, DF = D.floatingButton, DV = D.video;
    const repeatLine = bool(v.repeatLine, DV.repeatLine);
    const pauseEach = repeatLine ? false : bool(v.pauseEach, DV.pauseEach); // 함께 켤 수 없다(28-1): 문장 반복이 이긴다
    // 옛 가리기(28-8 이전): 'hard' → 낱말+어려운, 'all' → 줄+모든 유형. 새 값은 그대로 쓴다.
    const oldHide = v.hide;
    const hide = oldHide === 'hard' ? 'word' : oldHide === 'all' ? 'line' : pickEnum(oldHide, ENUMS.hide, DV.hide);
    const rawTypes = oldHide === 'hard' ? { hard: true, done: false, other: false }
      : oldHide === 'all' ? { hard: true, done: true, other: true }
        : isObj(v.hideTypes) ? v.hideTypes : DV.hideTypes;
    const hideTypes = { hard: bool(rawTypes.hard, DV.hideTypes.hard), done: bool(rawTypes.done, DV.hideTypes.done), other: bool(rawTypes.other, DV.hideTypes.other) };
    const rawBands = isObj(v.wordBands) ? v.wordBands : DV.wordBands;
    const wordBands = { easy: bool(rawBands.easy, DV.wordBands.easy), medium: bool(rawBands.medium, DV.wordBands.medium), hard: bool(rawBands.hard, DV.wordBands.hard) };
    // 28-11 옛 값 옮기기: fontPct 는 두 크기로, ko=false 는 subType 'en' 으로. 새 값이 있으면 그쪽이 이긴다.
    const legacyFont = typeof v.fontPct === 'number' && Number.isFinite(v.fontPct) ? v.fontPct : undefined;
    const legacySub = v.ko === false ? 'en' : DV.subType;
    return {
      enabled: bool(r.enabled, D.enabled),
      level: pickEnum(r.level, LEVELS, D.level),
      maxPerParagraph: num(r.maxPerParagraph, 0, 10, D.maxPerParagraph),
      repeat: pickEnum(r.repeat, ENUMS.repeat, D.repeat),
      annotation: {
        position: pickEnum(a.position === 'right' ? 'top' : a.position, ENUMS.position, DA.position),
        sizePct: num(a.sizePct, 40, 100, DA.sizePct),
        color: pickEnum(a.color, ENUMS.color, DA.color),
        customColor: typeof a.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(a.customColor) ? a.customColor.toLowerCase() : DA.customColor,
        opacityPct: num(a.opacityPct, 30, 100, DA.opacityPct),
        weight: pickEnum(a.weight, ENUMS.weight, DA.weight),
        gapEm: num(a.gapEm, 0, 0.3, DA.gapEm, false),
        liftEm: num(a.liftEm, -0.5, 0.3, DA.liftEm, false),
      },
      mark: pickEnum(r.mark, ENUMS.mark, D.mark),
      allowCopy: bool(r.allowCopy, D.allowCopy),
      selectionTranslate: bool(r.selectionTranslate, D.selectionTranslate), // 드래그 번역. 사용자가 직접 하는 동작이라 사이트·페이지 끄기와 별개
      theme: pickEnum(r.theme, ENUMS.theme, D.theme),
      glossary: pickEnum(r.glossary, ENUMS.glossary, D.glossary),
      sites: Array.isArray(r.sites) ? cleanList(r.sites) : [],
      opacityInput: num(r.opacityInput, 40, 100, D.opacityInput),
      opacityUi: num(r.opacityUi, 40, 100, D.opacityUi),
      dimWhileReading: bool(r.dimWhileReading, D.dimWhileReading),
      // 배열이면 빈 배열도 그대로("다 지웠다"), 배열이 아닐 때(옛 저장값)만 기본 목록
      glossarySites: cleanList(Array.isArray(r.glossarySites) ? r.glossarySites : D.glossarySites),
      // 위쪽 한계(창 높이-40)는 창 크기를 아는 쪽(버튼)이 맞춘다. 여기서는 40 이상만 보장.
      floatingButton: { show: bool(f.show, DF.show), top: num(f.top, 40, Infinity, DF.top) },
      structureHints: bool(r.structureHints, D.structureHints),
      savedMarks: bool(r.savedMarks, D.savedMarks),
      video: {
        subs: bool(v.subs, DV.subs),
        subType: pickEnum(v.subType, SUB_TYPES, legacySub),
        koAbove: bool(v.koAbove, DV.koAbove),
        enFontPct: stepNum(v.enFontPct ?? legacyFont, 60, 160, 10, DV.enFontPct),
        koFontPct: stepNum(v.koFontPct ?? legacyFont, 60, 160, 10, DV.koFontPct),
        bgOpacity: typeof v.bgOpacity === 'number' && Number.isFinite(v.bgOpacity) ? Math.min(100, Math.max(0, Math.round(v.bgOpacity / 25) * 25)) : DV.bgOpacity,
        posY: num(v.posY, -40, 0, DV.posY),
        hard: bool(v.hard, DV.hard),
        hoverPause: bool(v.hoverPause, DV.hoverPause),
        autoCC: bool(v.autoCC, DV.autoCC),
        hide,
        hideTypes,
        pauseEach,
        repeatLine,
        skipGaps: bool(v.skipGaps, DV.skipGaps),
        keysNoticeSeen: bool(v.keysNoticeSeen, DV.keysNoticeSeen),
        slowRate: clampSlowRate(v.slowRate),
        focusMode: bool(v.focusMode, DV.focusMode),
        wordBands,
        idioms: bool(v.idioms, DV.idioms),
        mode: pickEnum(v.mode, VIDEO_MODES, DV.mode),
        barOrder: cleanBar(v.barOrder, DV.barOrder),
        barHidden: cleanBar(v.barHidden, []),
      },
      reviewMode: pickEnum(r.reviewMode, ENUMS.reviewMode, D.reviewMode),
    };
  }

  // 깊은 병합: 객체는 키별로 합치고 배열·값은 patch 가 통째로 덮는다. 결과는 항상 normalize.
  function mergeDeep(base, patch) {
    if (!isObj(patch)) return base;
    const out = { ...base };
    for (const k of Object.keys(patch)) out[k] = isObj(patch[k]) && isObj(base[k]) ? mergeDeep(base[k], patch[k]) : patch[k];
    return out;
  }
  const merge = (cur, patch) => normalize(mergeDeep(normalize(cur), patch));

  // 규칙: 'example.com' 은 그 도메인만, '*' 는 아무 글자열(하위 도메인 포함은 '*.example.com').
  function siteMatches(list, hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host || !Array.isArray(list)) return false;
    return list.some((p) => {
      if (typeof p !== 'string' || !p.trim()) return false;
      const re = new RegExp('^' + p.trim().toLowerCase().split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      return re.test(host);
    });
  }
  const siteBlocked = (settings, hostname) => siteMatches(isObj(settings) ? settings.sites : undefined, hostname);

  const storage = () => globalThis.chrome?.storage?.local;
  async function load() {
    const got = await storage().get(KEY);
    return normalize(got?.[KEY]);
  }
  async function save(patch) {
    const next = merge(await load(), patch);
    await storage().set({ [KEY]: next }); // 'settings' 키만
    return next;
  }
  function onChange(cb) {
    globalThis.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) cb(normalize(changes[KEY].newValue));
    });
  }

  globalThis.readglossSettings = { KEY, DEFAULTS, LEVELS, clampSlowRate, normalize, merge, siteMatches, siteBlocked, load, save, onChange };
})();
