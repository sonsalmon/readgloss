// 설정값 뼈대. chrome.storage.local 의 'settings' 키 하나만 읽고 쓴다(다른 키, 특히 'token' 은 건드리지 않는다).
// classic script: globalThis.readglossSettings 로 등록. normalize·merge·siteBlocked 는 순수 함수라 node 에서도 쓴다.
(() => {
  const KEY = 'settings';
  const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];
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
    video: { subs: true, ko: true, hard: true, hoverPause: true, autoCC: true, fontPct: 100, hide: 'off', pauseEach: false, repeatLine: false, skipGaps: false },
    reviewMode: 'flip', // 복습 방식(27-4): 뒤집기 · 고르기 · 듣기
  });
  const ENUMS = {
    level: LEVELS, repeat: ['page', 'paragraph', 'always'], mark: ['none', 'color', 'underline', 'background'], theme: ['auto', 'light', 'dark'], glossary: ['auto', 'off'],
    position: ['top', 'none'], color: ['text', 'accent', 'custom'], weight: ['light', 'normal', 'bold'],
    hide: ['off', 'hard', 'all'], reviewMode: ['flip', 'choice', 'listen'],
  };
  const MAX_SITES = 200;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const pickEnum = (v, list, def) => (list.includes(v) ? v : def);
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  // 범위 밖은 가장 가까운 허용값, 숫자가 아니면 기본값
  const num = (v, min, max, def, int = true) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return def;
    const c = Math.min(max, Math.max(min, v));
    return int ? Math.round(c) : Math.round(c * 1000) / 1000;
  };

  // 사이트 목록 정리: 문자열만, trim·소문자·중복 제거, 최대 200개
  const cleanList = (list) => [...new Set(list.filter((s) => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SITES);

  function normalize(raw) {
    const r = isObj(raw) ? raw : {};
    const a = isObj(r.annotation) ? r.annotation : {};
    const f = isObj(r.floatingButton) ? r.floatingButton : {};
    const v = isObj(r.video) ? r.video : {};
    const D = DEFAULTS, DA = D.annotation, DF = D.floatingButton, DV = D.video;
    const repeatLine = bool(v.repeatLine, DV.repeatLine);
    const pauseEach = repeatLine ? false : bool(v.pauseEach, DV.pauseEach); // 함께 켤 수 없다(28-1): 문장 반복이 이긴다
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
        ko: bool(v.ko, DV.ko),
        hard: bool(v.hard, DV.hard),
        hoverPause: bool(v.hoverPause, DV.hoverPause),
        autoCC: bool(v.autoCC, DV.autoCC),
        fontPct: num(v.fontPct, 60, 160, DV.fontPct),
        hide: pickEnum(v.hide, ENUMS.hide, DV.hide),
        pauseEach,
        repeatLine,
        skipGaps: bool(v.skipGaps, DV.skipGaps),
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

  globalThis.readglossSettings = { KEY, DEFAULTS, LEVELS, normalize, merge, siteMatches, siteBlocked, load, save, onChange };
})();
