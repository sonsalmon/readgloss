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
    // 단어 간격은 0~0.3em 을 정수 0~6 단계(0.05em)로 — 소수 슬라이더의 부동소수 오차를 피한다
    { path: 'annotation.gapEm', min: 0, max: 6, step: 1, to: (v) => Math.round(v / 0.05), from: (n) => Math.round(n * 5) / 100 },
  ];
  const CHOICES = [
    { path: 'repeat', options: [['page', '페이지에서 한 번'], ['paragraph', '문단마다 첫 등장'], ['always', '매번']] },
    { path: 'annotation.position', options: [['top', '단어 위'], ['right', '단어 오른쪽'], ['none', '없음']] },
    { path: 'annotation.color', options: [['text', '본문색'], ['accent', '강조색'], ['custom', '직접']] },
    { path: 'annotation.weight', options: [['light', '얇게'], ['normal', '보통'], ['bold', '굵게']] },
    { path: 'mark', options: [['none', '없음'], ['color', '글자색'], ['underline', '점선 밑줄'], ['background', '옅은 배경']] },
    { path: 'theme', options: [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']] },
  ];
  const TOGGLES = [{ path: 'enabled' }, { path: 'allowCopy' }, { path: 'floatingButton.show' }];

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

  const themeAttr = (theme) => (theme === 'light' || theme === 'dark' ? theme : null); // auto 는 속성 없음(prefers-color-scheme)

  globalThis.readglossPanelCore = {
    getPath, patchFor, sortTabs, levelIndex, levelAt, RANGES, CHOICES, TOGGLES, sliderPatch, sliderValue,
    cleanSite, addSite, removeSite, clampTop, dragTop, mergePatch, themeAttr, MAX_SITES,
  };

  if (typeof document === 'undefined') return; // node 시험: 여기까지
})();
