// 설정값 뼈대. chrome.storage.local 의 'settings' 키 하나만 읽고 쓴다(다른 키, 특히 'token' 은 건드리지 않는다).
// classic script: globalThis.readglossSettings 로 등록. normalize·merge·siteBlocked 는 순수 함수라 node 에서도 쓴다.
(() => {
  const KEY = 'settings';
  const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];
  const DEFAULTS = Object.freeze({
    enabled: true, level: 'C1', maxPerParagraph: 3, repeat: 'page',
    annotation: { position: 'top', sizePct: 55, color: 'text', customColor: '#2f6feb', opacityPct: 70, weight: 'normal', gapEm: 0 },
    mark: 'none', allowCopy: false, theme: 'auto', glossary: 'auto', sites: [],
    floatingButton: { show: true, top: 60 },
  });
  const ENUMS = {
    level: LEVELS, repeat: ['page', 'paragraph', 'always'], mark: ['none', 'color', 'underline', 'background'], theme: ['auto', 'light', 'dark'], glossary: ['auto', 'off'],
    position: ['top', 'right', 'none'], color: ['text', 'accent', 'custom'], weight: ['light', 'normal', 'bold'],
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

  function normalize(raw) {
    const r = isObj(raw) ? raw : {};
    const a = isObj(r.annotation) ? r.annotation : {};
    const f = isObj(r.floatingButton) ? r.floatingButton : {};
    const D = DEFAULTS, DA = D.annotation, DF = D.floatingButton;
    const sites = Array.isArray(r.sites)
      ? [...new Set(r.sites.filter((s) => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SITES)
      : [];
    return {
      enabled: bool(r.enabled, D.enabled),
      level: pickEnum(r.level, LEVELS, D.level),
      maxPerParagraph: num(r.maxPerParagraph, 0, 10, D.maxPerParagraph),
      repeat: pickEnum(r.repeat, ENUMS.repeat, D.repeat),
      annotation: {
        position: pickEnum(a.position, ENUMS.position, DA.position),
        sizePct: num(a.sizePct, 40, 100, DA.sizePct),
        color: pickEnum(a.color, ENUMS.color, DA.color),
        customColor: typeof a.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(a.customColor) ? a.customColor.toLowerCase() : DA.customColor,
        opacityPct: num(a.opacityPct, 30, 100, DA.opacityPct),
        weight: pickEnum(a.weight, ENUMS.weight, DA.weight),
        gapEm: num(a.gapEm, 0, 0.3, DA.gapEm, false),
      },
      mark: pickEnum(r.mark, ENUMS.mark, D.mark),
      allowCopy: bool(r.allowCopy, D.allowCopy),
      theme: pickEnum(r.theme, ENUMS.theme, D.theme),
      glossary: pickEnum(r.glossary, ENUMS.glossary, D.glossary),
      sites,
      // 위쪽 한계(창 높이-40)는 창 크기를 아는 쪽(버튼)이 맞춘다. 여기서는 40 이상만 보장.
      floatingButton: { show: bool(f.show, DF.show), top: num(f.top, 40, Infinity, DF.top) },
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
  function siteBlocked(settings, hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    const sites = isObj(settings) && Array.isArray(settings.sites) ? settings.sites : [];
    return sites.some((p) => {
      if (typeof p !== 'string' || !p.trim()) return false;
      const re = new RegExp('^' + p.trim().toLowerCase().split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      return re.test(host);
    });
  }

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

  globalThis.readglossSettings = { KEY, DEFAULTS, LEVELS, normalize, merge, siteBlocked, load, save, onChange };
})();
