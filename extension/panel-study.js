// "공부 기록" 탭: 다리가 남긴 하루 활동(GET /study)을 오늘 요약·막대·날짜별 목록으로 보여 준다.
// 위쪽은 DOM 을 만지지 않는 순수 함수(globalThis.readglossStudy, node --test 가 같은 파일을 import 한다). 아래쪽 render 는 패널 Shadow DOM 안에 그린다.
// 진행은 쌓인 숫자로만 보여 준다.
(() => {
  // ---- 순수 로직 ----
  const KINDS = [
    { id: 'dict', label: '찾은 단어' },
    { id: 'mt', label: '드래그 번역' },
    { id: 'context', label: '문맥 번역' },
    { id: 'aigloss', label: 'AI 문맥 뜻' },
    { id: 'paragraph', label: '문단 번역' },
    { id: 'save', label: '저장' },
    { id: 'known', label: '알아요' },
    { id: 'mydict', label: '내 용어집' },
    { id: 'scrap', label: '스크랩' },
    { id: 'memo', label: '메모' },
  ];
  const RANGES = [7, 14, 30];
  const DEFAULT_RANGE = 14;
  const EMPTY = '아직 공부 기록이 없어요. 영어 단어를 더블클릭하거나 문장을 드래그해 보세요. 쓴 만큼 여기에 쌓여요.';

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => {
    const [y, m, d] = String(k).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const total = (counts) => KINDS.reduce((n, k) => n + (Number(counts?.[k.id]) || 0), 0);

  // 응답 days -> 오늘로 끝나는 n 일(오래된 날 먼저). 응답에 없는 날은 0건으로 채우고, 항목은 최신순으로 다시 정렬한다.
  function fillDays(days, n, today = new Date()) {
    const byDate = new Map((Array.isArray(days) ? days : []).map((d) => [d.date, d]));
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const date = dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
      const d = byDate.get(date);
      const items = [...(d?.items ?? [])].sort((a, b) => b.ts - a.ts);
      out.push({ date, counts: d?.counts ?? {}, items, total: total(d?.counts) });
    }
    return out;
  }

  // 막대: 높이만(하루 합 / 기간 최댓값). 0건은 0, 1건 이상은 최소 8% 로 보이게. title 은 숫자 툴팁.
  function bars(filled) {
    const max = Math.max(0, ...filled.map((d) => d.total));
    return filled.map((d) => {
      const date = parseKey(d.date);
      return {
        date: d.date,
        total: d.total,
        pct: d.total === 0 ? 0 : Math.max(8, Math.round((d.total / max) * 100)),
        title: `${date.getMonth() + 1}월 ${date.getDate()}일 ${d.total}건`,
      };
    });
  }

  // 오늘 요약 칩: 종류 순서 고정, 0건도 그대로(자리가 흔들리지 않게). 단 'mt'(드래그 번역)는 T19부터 새로 늘지 않으므로 0이면 숨긴다.
  const chips = (day) => KINDS.map((k) => ({ id: k.id, label: k.label, n: Number(day?.counts?.[k.id]) || 0 })).filter((c) => !(c.id === 'mt' && c.n === 0));
  const periodTotal = (filled) => filled.reduce((n, d) => n + d.total, 0);

  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function dayTitle(key) {
    const d = parseKey(key);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  }
  function timeOf(ts) {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  }
  const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label ?? id;
  const safeHref = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x : null;
    } catch {
      return null;
    }
  };

  // 날짜별 목록: 기록이 있는 날만 최신 날부터. 첫 날만 펼친다.
  const listDays = (filled) => filled.filter((d) => d.items.length || d.total).reverse().map((d, i) => ({ ...d, title: dayTitle(d.date), open: i === 0 }));

  // 항목 한 줄에 필요한 것: 시각·종류 배지·원문·뜻·출처(http(s) 만 링크)
  function itemRow(it) {
    const u = it.url ? safeHref(it.url) : null;
    return { time: timeOf(it.ts), kind: it.kind, kindLabel: kindLabel(it.kind), text: it.text ?? '', ko: it.ko ?? '', href: u?.href ?? '', host: u?.hostname ?? '' };
  }

  // 섹션별 공부 시간(T40c) 포맷: 1분 미만은 <1분, 그 외 N시간 M분 또는 M분
  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s < 60) return '<1분';
    const totalM = Math.floor(s / 60);
    const h = Math.floor(totalM / 60);
    const m = totalM % 60;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  }

  // 이번 주 범위(월~오늘): 주 시작은 월요일
  function weekRange(todayStr) {
    const [y, m, d] = String(todayStr).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dayOfWeek = (dt.getDay() + 6) % 7; // 월요일:0, 화:1, ..., 일:6
    const monday = new Date(y, m - 1, d - dayOfWeek);
    return {
      from: dateKey(monday),
      to: todayStr,
    };
  }

  // 오래 머문 소제목 상위 n개(소제목 단위 상위 n개, 기본 3개)
  function topSections(items, n = 3) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const secMap = new Map();
    for (const it of items) {
      if (!it) continue;
      const url = typeof it.url === 'string' ? it.url : '';
      const pageTitle = (typeof it.title === 'string' && it.title.trim()) ? it.title.trim() : (url || '(제목 없음)');
      const headings = Array.isArray(it.headings) ? it.headings.filter(Boolean) : [];
      const sectionTitle = headings.length > 0 ? String(headings[headings.length - 1]).trim() : '(소제목 없음)';
      const key = `${url}|${sectionTitle}`;
      const sec = Math.max(0, Number(it.seconds) || 0);

      const prev = secMap.get(key);
      if (prev) {
        prev.seconds += sec;
      } else {
        secMap.set(key, {
          url,
          pageTitle,
          sectionTitle,
          seconds: sec,
        });
      }
    }

    const list = Array.from(secMap.values())
      .sort((a, b) => b.seconds - a.seconds || a.pageTitle.localeCompare(b.pageTitle) || a.sectionTitle.localeCompare(b.sectionTitle))
      .slice(0, n);

    return list.map((item) => ({
      ...item,
      formattedDuration: formatDuration(item.seconds),
      text: `${item.pageTitle} › ${item.sectionTitle} · ${formatDuration(item.seconds)}`,
    }));
  }

  // 묶음: 할 일(task, 없으면 '인박스') -> 페이지(title, 없으면 주소) -> 소제목(headings 마지막, 없으면 '(소제목 없음)')
  function groupTime(items, tasks = {}) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const taskMap = new Map();

    for (const it of items) {
      if (!it) continue;
      const task = (typeof it.task === 'string' && it.task.trim()) ? it.task.trim() : null;
      const taskKey = task ?? '__inbox__';
      const taskTitle = task ? (tasks?.[task] || task) : '인박스';
      const sec = Math.max(0, Number(it.seconds) || 0);

      let tObj = taskMap.get(taskKey);
      if (!tObj) {
        tObj = {
          task,
          title: taskTitle,
          seconds: 0,
          pageMap: new Map(),
        };
        taskMap.set(taskKey, tObj);
      }
      tObj.seconds += sec;

      const url = typeof it.url === 'string' ? it.url : '';
      const pageTitle = (typeof it.title === 'string' && it.title.trim()) ? it.title.trim() : (url || '(제목 없음)');
      const urlKey = url || pageTitle;

      let pObj = tObj.pageMap.get(urlKey);
      if (!pObj) {
        pObj = {
          url,
          title: pageTitle,
          seconds: 0,
          secMap: new Map(),
        };
        tObj.pageMap.set(urlKey, pObj);
      }
      pObj.seconds += sec;

      const headings = Array.isArray(it.headings) ? it.headings.filter(Boolean) : [];
      const secTitle = headings.length > 0 ? String(headings[headings.length - 1]).trim() : '(소제목 없음)';
      const secKey = secTitle;

      let sObj = pObj.secMap.get(secKey);
      if (!sObj) {
        sObj = {
          title: secTitle,
          headings,
          seconds: 0,
        };
        pObj.secMap.set(secKey, sObj);
      }
      sObj.seconds += sec;
    }

    const taskList = Array.from(taskMap.values()).sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
    const maxTaskSec = taskList.length > 0 ? Math.max(0, ...taskList.map((t) => t.seconds)) : 0;

    return taskList.map((t) => {
      const tPct = maxTaskSec > 0 ? Math.round((t.seconds / maxTaskSec) * 100) : 0;

      const pageList = Array.from(t.pageMap.values()).sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
      const maxPageSec = pageList.length > 0 ? Math.max(0, ...pageList.map((p) => p.seconds)) : 0;

      const pages = pageList.map((p) => {
        const pPct = maxPageSec > 0 ? Math.round((p.seconds / maxPageSec) * 100) : 0;

        const secList = Array.from(p.secMap.values()).sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
        const maxSec = secList.length > 0 ? Math.max(0, ...secList.map((s) => s.seconds)) : 0;

        const sections = secList.map((s) => ({
          title: s.title,
          headings: s.headings,
          seconds: s.seconds,
          formattedDuration: formatDuration(s.seconds),
          pct: maxSec > 0 ? Math.round((s.seconds / maxSec) * 100) : 0,
        }));

        return {
          url: p.url,
          title: p.title,
          seconds: p.seconds,
          formattedDuration: formatDuration(p.seconds),
          pct: pPct,
          sections,
        };
      });

      return {
        task: t.task,
        title: t.title,
        seconds: t.seconds,
        formattedDuration: formatDuration(t.seconds),
        pct: tPct,
        pages,
      };
    });
  }

  globalThis.readglossStudy = { KINDS, RANGES, DEFAULT_RANGE, EMPTY, dateKey, fillDays, bars, chips, periodTotal, dayTitle, timeOf, kindLabel, listDays, itemRow, formatDuration, weekRange, topSections, groupTime };

  // ---- 그리기(document 는 render 가 불릴 때만 만진다) ----
  const MESSAGES = { 'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요', unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요', 'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요', 'http-404': '다리가 이 기능을 아직 몰라요. 다리를 다시 시작해 주세요' };

  let savedSubView = 'records'; // 패널 열린 동안 고른 보기('records' | 'time') 기억
  let savedTimeRange = 'today'; // 패널 열린 동안 고른 시간 기간('today' | 'week') 기억

  const CSS = `
    .rgs { --s-fg: var(--rg-fg, #1f2328); --s-muted: var(--rg-muted, #656d76); --s-border: var(--rg-border, #e3e6ea); --s-accent: var(--rg-accent, #2f6feb);
      --s-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); color: var(--s-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgs { --s-fg: var(--rg-fg, #e6e8eb); --s-muted: var(--rg-muted, #9aa3ad); --s-border: var(--rg-border, #343a44); --s-accent: var(--rg-accent, #6b9bff);
        --s-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); }
    }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--s-accent); outline-offset: 2px; }
    [hidden] { display: none !important; }

    .view-switch { display: flex; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--s-border); margin-bottom: 12px; }
    .rg-view-tab { padding: 3px 14px; border-radius: 999px; border: 1px solid var(--s-border); background: none; font-size: 13px; font-weight: 500; cursor: pointer; color: var(--s-muted); }
    .rg-view-tab[aria-selected="true"] { background: var(--s-soft); border-color: var(--s-accent); color: var(--s-accent); font-weight: 600; }

    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h3 { margin: 0; font-size: 12px; letter-spacing: .02em; color: var(--s-muted); }
    .sec { margin-top: 16px; }
    .sec:first-child { margin-top: 0; }
    .ranges { display: flex; gap: 4px; }
    .rng { padding: 2px 9px; border-radius: 999px; border: 1px solid var(--s-border); background: none; font-size: 12.5px; }
    .rng[aria-pressed="true"] { background: var(--s-soft); border-color: var(--s-accent); color: var(--s-accent); font-weight: 600; }
    .status { color: var(--s-muted); font-size: 13px; padding: 6px 0; word-break: keep-all; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
    .chip { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--s-border); font-size: 12.5px; }
    .chip b { font-variant-numeric: tabular-nums; font-size: 14px; }
    .chip.zero { color: var(--s-muted); }
    .chip.zero b { font-weight: 400; }
    .chip:not(.zero) { background: var(--s-soft); border-color: var(--s-accent); }
    .sum { margin: 6px 0 0; color: var(--s-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .bars { display: flex; align-items: flex-end; gap: 2px; height: 64px; margin-top: 8px; border-bottom: 1px solid var(--s-border); }
    .bar { flex: 1; min-width: 0; background: var(--s-accent); opacity: .5; border-radius: 2px 2px 0 0; }
    .bar.today { opacity: 1; }
    .bar.none { height: 2px !important; background: var(--s-border); opacity: 1; border-radius: 0; }
    .axis { display: flex; justify-content: space-between; margin-top: 2px; color: var(--s-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
    details.day { border-top: 1px solid var(--s-border); padding: 6px 0; }
    details.day:first-of-type { margin-top: 8px; }
    summary { cursor: pointer; display: flex; align-items: baseline; gap: 8px; font-weight: 600; }
    summary .cnt { margin-left: auto; color: var(--s-muted); font-weight: 400; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    ul.items { list-style: none; margin: 4px 0 0; padding: 0; }
    .it { padding: 6px 0; border-top: 1px dashed var(--s-border); }
    .it:first-child { border-top: 0; }
    .r1 { display: flex; align-items: center; gap: 6px; color: var(--s-muted); font-size: 12px; }
    .time { font-variant-numeric: tabular-nums; }
    .badge { padding: 0 7px; border-radius: 999px; background: var(--s-soft); color: var(--s-accent); font-size: 11.5px; font-weight: 600; }
    .txt { font-weight: 600; overflow-wrap: anywhere; }
    .ko { overflow-wrap: anywhere; }
    .src { color: var(--s-accent); font-size: 12px; }

    /* 시간 보기 스타일 */
    .time-top-summary { margin-top: 10px; padding: 10px 12px; background: var(--s-soft); border-radius: 8px; border: 1px solid var(--s-border); }
    .time-sum-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13.5px; font-weight: 600; }
    .time-sum-val { font-size: 15px; font-variant-numeric: tabular-nums; color: var(--s-accent); }

    .top-sections { margin-top: 10px; border-top: 1px dashed var(--s-border); padding-top: 8px; }
    .top-sec-head { font-size: 12px; color: var(--s-muted); font-weight: 600; margin-bottom: 6px; }
    .top-sec-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; padding: 3px 0; }
    .top-sec-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .top-sec-val { display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; flex-shrink: 0; font-size: 12px; font-weight: 600; }

    .time-tree { margin-top: 14px; }
    .time-empty { color: var(--s-muted); text-align: center; padding: 24px 0; font-size: 13px; }
    .time-group { margin-bottom: 6px; }
    .time-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 6px; border-radius: 6px; }
    .time-row:hover { background: var(--s-soft); }
    .time-task-row { font-weight: 600; font-size: 13px; border-bottom: 1px solid var(--s-border); border-radius: 0; }
    .time-page-row { font-size: 12.5px; font-weight: 500; }
    .time-sec-row { font-size: 12px; color: var(--s-muted); }
    .tree-toggle { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; padding: 0; text-align: left; cursor: pointer; flex: 1; min-width: 0; font: inherit; color: inherit; }
    .toggle-arrow { display: inline-block; width: 12px; font-size: 10px; color: var(--s-muted); flex-shrink: 0; text-align: center; }
    .node-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .time-bar-wrap { display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-variant-numeric: tabular-nums; font-size: 12px; }
    .time-bar-bg { width: 50px; height: 6px; background: var(--s-border); border-radius: 3px; overflow: hidden; display: inline-block; }
    .time-bar-fill { height: 100%; background: var(--s-accent); opacity: 0.5; border-radius: 3px; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function render(container, ctx) {
    const S = globalThis.readglossStudy;

    // 상태
    let subView = savedSubView; // 'records' | 'time'
    let timeRange = savedTimeRange; // 'today' | 'week'
    let timeData = null; // { items, tasks }
    let timeMessage = '';
    let timeSeq = 0;

    let range = S.DEFAULT_RANGE;
    let recordsData = null; // fillDays 결과
    let recordsMessage = '불러오는 중…';
    let recordsSeq = 0;

    // 접기/펼치기 상태: 처음엔 할 일만 펼치고 페이지는 접음
    const openTasks = new Set();
    const openPages = new Set();
    let hasInitializedOpenTasks = false;

    const root = el('div', 'rgs');
    const style = el('style');
    style.textContent = CSS;

    // 보기 전환 탭: [기록] [시간]
    const viewSwitch = el('div', 'view-switch');
    viewSwitch.setAttribute('role', 'tablist');
    viewSwitch.setAttribute('aria-label', '보기 전환');

    const viewTabRecords = el('button', 'rg-view-tab', '기록');
    viewTabRecords.type = 'button';
    viewTabRecords.setAttribute('role', 'tab');
    viewTabRecords.setAttribute('aria-selected', String(subView === 'records'));
    viewTabRecords.addEventListener('click', () => switchView('records'));

    const viewTabTime = el('button', 'rg-view-tab', '시간');
    viewTabTime.type = 'button';
    viewTabTime.setAttribute('role', 'tab');
    viewTabTime.setAttribute('aria-selected', String(subView === 'time'));
    viewTabTime.addEventListener('click', () => switchView('time'));

    viewSwitch.append(viewTabRecords, viewTabTime);

    // ==========================================
    // 1. [기록] 보기 컨테이너
    // ==========================================
    const recordsContainer = el('div', 'records-view');
    const head = el('div', 'head');
    head.append(el('h3', '', '오늘'));
    const ranges = el('div', 'ranges');
    ranges.setAttribute('role', 'group');
    ranges.setAttribute('aria-label', '기간 선택');
    const rngBtns = S.RANGES.map((n) => {
      const b = el('button', 'rng', `${n}일`);
      b.type = 'button';
      b.setAttribute('aria-label', `최근 ${n}일 보기`);
      b.addEventListener('click', () => loadRecords(n));
      ranges.append(b);
      return b;
    });
    head.append(ranges);
    const recordsStatus = el('div', 'status');
    recordsStatus.setAttribute('role', 'status');
    const todayBox = el('div', 'sec');
    const barsBox = el('div', 'sec');
    const listBox = el('div', 'sec');
    recordsContainer.append(head, recordsStatus, todayBox, barsBox, listBox);

    // ==========================================
    // 2. [시간] 보기 컨테이너
    // ==========================================
    const timeContainer = el('div', 'time-view');
    const timeHead = el('div', 'head');
    timeHead.append(el('h3', '', '공부 시간'));

    const timeRanges = el('div', 'ranges');
    timeRanges.setAttribute('role', 'group');
    timeRanges.setAttribute('aria-label', '기간 선택');

    const todayTimeBtn = el('button', 'rng', '오늘');
    todayTimeBtn.type = 'button';
    todayTimeBtn.setAttribute('aria-label', '오늘 보기');
    todayTimeBtn.addEventListener('click', () => loadTime('today'));

    const weekTimeBtn = el('button', 'rng', '이번 주');
    weekTimeBtn.type = 'button';
    weekTimeBtn.setAttribute('aria-label', '이번 주(월~오늘) 보기');
    weekTimeBtn.addEventListener('click', () => loadTime('week'));

    timeRanges.append(todayTimeBtn, weekTimeBtn);
    timeHead.append(timeRanges);

    const timeStatus = el('div', 'status');
    timeStatus.setAttribute('role', 'status');

    const timeSummaryBox = el('div', 'time-top-summary');
    const timeTreeBox = el('div', 'time-tree');
    timeContainer.append(timeHead, timeStatus, timeSummaryBox, timeTreeBox);

    root.append(style, viewSwitch, recordsContainer, timeContainer);
    container.replaceChildren(root);

    // 서울 오늘 날짜 (YYYY-MM-DD)
    function getSeoulToday() {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      } catch {
        return S.dateKey(new Date());
      }
    }

    // 뷰 전환
    function switchView(view) {
      subView = view;
      savedSubView = view;
      viewTabRecords.setAttribute('aria-selected', String(view === 'records'));
      viewTabTime.setAttribute('aria-selected', String(view === 'time'));
      recordsContainer.hidden = (view !== 'records');
      timeContainer.hidden = (view !== 'time');

      if (view === 'records') {
        if (!recordsData) loadRecords(range);
        else drawRecords();
      } else {
        if (!timeData) loadTime(timeRange);
        else drawTime();
      }
    }

    // ------------------------------------------
    // [기록] 그리기 & 로드
    // ------------------------------------------
    function drawRecords() {
      rngBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(S.RANGES[i] === range)));
      recordsStatus.textContent = recordsMessage;
      for (const box of [todayBox, barsBox, listBox]) box.hidden = !recordsData;
      if (!recordsData) return;
      const sum = S.periodTotal(recordsData);
      recordsStatus.textContent = sum === 0 ? S.EMPTY : '';

      const today = recordsData[recordsData.length - 1];
      const cl = el('ul', 'chips');
      cl.setAttribute('aria-label', '오늘 한 일');
      for (const c of S.chips(today)) {
        const li = el('li', `chip${c.n ? '' : ' zero'}`);
        li.append(c.label, el('b', '', String(c.n)));
        cl.append(li);
      }
      todayBox.replaceChildren(cl, el('p', 'sum', `오늘 ${today.total}건`));

      const bs = S.bars(recordsData);
      const wrap = el('div', 'bars');
      wrap.setAttribute('role', 'img');
      wrap.setAttribute('aria-label', `최근 ${range}일 하루 활동 합계 막대, 모두 ${sum}건`);
      bs.forEach((b, i) => {
        const bar = el('div', `bar${b.total ? '' : ' none'}${i === bs.length - 1 ? ' today' : ''}`);
        bar.style.height = `${b.pct}%`;
        bar.title = b.title;
        wrap.append(bar);
      });
      const axis = el('div', 'axis');
      axis.append(el('span', '', S.dayTitle(recordsData[0].date).replace(/ \(.\)$/, '')), el('span', '', `최근 ${range}일 모두 ${sum}건`), el('span', '', '오늘'));
      barsBox.replaceChildren(el('h3', '', `최근 ${range}일`), wrap, axis);

      listBox.replaceChildren(...S.listDays(recordsData).map(dayNode));
    }

    function dayNode(day) {
      const d = el('details', 'day');
      d.open = day.open;
      const sm = el('summary', '', day.title);
      sm.append(el('span', 'cnt', `${day.total}건`));
      const ul = el('ul', 'items');
      let built = false;
      const build = () => {
        if (built || !d.open) return;
        built = true;
        ul.replaceChildren(...day.items.map(itemNode));
      };
      d.addEventListener('toggle', build);
      d.append(sm, ul);
      build();
      return d;
    }

    function itemNode(it) {
      const r = S.itemRow(it);
      const li = el('li', 'it');
      const r1 = el('div', 'r1');
      r1.append(el('span', 'time', r.time), el('span', 'badge', r.kindLabel));
      li.append(r1, el('div', 'txt', r.text));
      if (r.ko) li.append(el('div', 'ko', r.ko));
      if (r.href) {
        const a = el('a', 'src', r.host);
        a.href = r.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = r.href;
        li.append(a);
      }
      return li;
    }

    async function loadRecords(n) {
      range = n;
      const mine = ++recordsSeq;
      if (!recordsData) recordsMessage = '불러오는 중…';
      drawRecords();
      const r = await ctx.send({ type: 'study', days: n });
      if (mine !== recordsSeq) return;
      if (Array.isArray(r?.days)) {
        recordsData = S.fillDays(r.days, n);
        recordsMessage = '';
      } else {
        recordsData = null;
        recordsMessage = MESSAGES[r?.error] ?? `불러오지 못했어요(${r?.error ?? '응답 없음'})`;
      }
      drawRecords();
    }

    // ------------------------------------------
    // [시간] 그리기 & 로드
    // ------------------------------------------
    function makeBar(pct) {
      const wrap = el('span', 'time-bar-bg');
      const fill = el('span', 'time-bar-fill');
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      wrap.append(fill);
      return wrap;
    }

    function drawTime() {
      todayTimeBtn.setAttribute('aria-pressed', String(timeRange === 'today'));
      weekTimeBtn.setAttribute('aria-pressed', String(timeRange === 'week'));
      timeStatus.textContent = timeMessage;

      timeSummaryBox.hidden = !timeData;
      timeTreeBox.hidden = !timeData;
      if (!timeData) return;

      const items = timeData.items;
      const totalSec = items.reduce((acc, it) => acc + (Math.max(0, Number(it.seconds) || 0)), 0);

      // 상단 요약: 기간 합계 & 오래 머문 소제목 3개
      const sumRow = el('div', 'time-sum-row');
      sumRow.append(
        el('span', '', timeRange === 'today' ? '오늘 합계' : '이번 주 합계'),
        el('span', 'time-sum-val', S.formatDuration(totalSec))
      );

      const topSecs = S.topSections(items, 3);
      const topSecBox = el('div', 'top-sections');
      topSecBox.append(el('div', 'top-sec-head', '오래 머문 소제목 3개'));

      if (topSecs.length === 0) {
        topSecBox.append(el('div', 'time-empty', '아직 공부한 소제목이 없어요.'));
      } else {
        const maxTopSec = Math.max(0, ...topSecs.map((s) => s.seconds));
        for (const s of topSecs) {
          const row = el('div', 'top-sec-item');
          const title = el('div', 'top-sec-title', `${s.pageTitle} › ${s.sectionTitle}`);
          title.title = `${s.pageTitle} › ${s.sectionTitle}`;

          const val = el('div', 'top-sec-val');
          const pct = maxTopSec > 0 ? Math.round((s.seconds / maxTopSec) * 100) : 0;
          val.append(makeBar(pct), el('span', '', s.formattedDuration));

          row.append(title, val);
          topSecBox.append(row);
        }
      }

      timeSummaryBox.replaceChildren(sumRow, topSecBox);

      // 나무 렌더링
      renderTree();
    }

    function renderTree() {
      if (!timeData) return;
      const tree = S.groupTime(timeData.items, timeData.tasks);

      // 처음 로드 시에만 모든 할 일을 펼침 상태로 초기화
      if (!hasInitializedOpenTasks && tree.length > 0) {
        for (const t of tree) {
          openTasks.add(t.task ?? '__inbox__');
        }
        hasInitializedOpenTasks = true;
      }

      if (tree.length === 0) {
        timeTreeBox.replaceChildren(el('div', 'time-empty', '이 기간의 공부 시간 기록이 없어요.'));
        return;
      }

      const nodes = [];
      for (const t of tree) {
        const taskKey = t.task ?? '__inbox__';
        const isTaskOpen = openTasks.has(taskKey);

        const groupEl = el('div', 'time-group');

        // 할 일 줄
        const taskRow = el('div', 'time-row time-task-row');
        const taskToggle = el('button', 'tree-toggle');
        taskToggle.type = 'button';
        taskToggle.setAttribute('aria-expanded', String(isTaskOpen));
        taskToggle.addEventListener('click', () => {
          if (openTasks.has(taskKey)) openTasks.delete(taskKey);
          else openTasks.add(taskKey);
          renderTree();
        });

        const arrow = el('span', 'toggle-arrow', isTaskOpen ? '▾' : '▸');
        const titleSpan = el('span', 'node-text', t.title);
        taskToggle.append(arrow, titleSpan);

        const taskVal = el('div', 'time-bar-wrap');
        taskVal.append(makeBar(t.pct), el('span', '', t.formattedDuration));

        taskRow.append(taskToggle, taskVal);
        groupEl.append(taskRow);

        // 페이지 목록 (할 일이 펼쳐져 있을 때)
        if (isTaskOpen) {
          for (const p of t.pages) {
            const pageKey = `${taskKey}|${p.url || p.title}`;
            const isPageOpen = openPages.has(pageKey);

            const pageGroup = el('div', 'time-group');
            pageGroup.style.paddingLeft = '14px';

            const pageRow = el('div', 'time-row time-page-row');
            const pageToggle = el('button', 'tree-toggle');
            pageToggle.type = 'button';
            pageToggle.setAttribute('aria-expanded', String(isPageOpen));
            pageToggle.addEventListener('click', () => {
              if (openPages.has(pageKey)) openPages.delete(pageKey);
              else openPages.add(pageKey);
              renderTree();
            });

            const pageArrow = el('span', 'toggle-arrow', isPageOpen ? '▾' : '▸');
            const pageTitleSpan = el('span', 'node-text', p.title);
            pageTitleSpan.title = p.title;
            pageToggle.append(pageArrow, pageTitleSpan);

            const pageVal = el('div', 'time-bar-wrap');
            pageVal.append(makeBar(p.pct), el('span', '', p.formattedDuration));

            pageRow.append(pageToggle, pageVal);
            pageGroup.append(pageRow);

            // 소제목 목록 (페이지가 펼쳐져 있을 때)
            if (isPageOpen) {
              for (const s of p.sections) {
                const secRow = el('div', 'time-row time-sec-row');
                secRow.style.paddingLeft = '30px';

                const secTitle = el('span', 'node-text', s.title);
                secTitle.title = s.title;

                const secVal = el('div', 'time-bar-wrap');
                secVal.append(makeBar(s.pct), el('span', '', s.formattedDuration));

                secRow.append(secTitle, secVal);
                pageGroup.append(secRow);
              }
            }

            groupEl.append(pageGroup);
          }
        }

        nodes.push(groupEl);
      }

      timeTreeBox.replaceChildren(...nodes);
    }

    async function loadTime(r) {
      timeRange = r;
      savedTimeRange = r;
      const mine = ++timeSeq;
      if (!timeData) timeMessage = '불러오는 중…';
      drawTime();

      const todayStr = getSeoulToday();
      let from, to;
      if (r === 'today') {
        from = todayStr;
        to = todayStr;
      } else {
        const w = S.weekRange(todayStr);
        from = w.from;
        to = w.to;
      }

      const [res, scrapsRes] = await Promise.all([
        ctx.send({ type: 'study-time', op: 'get', from, to }),
        ctx.send({ type: 'scraps', op: 'get' }),
      ]);

      if (mine !== timeSeq) return;

      if (!res || res.error) {
        timeData = null;
        timeMessage = '다리에 연결하지 못했어요';
      } else {
        const items = Array.isArray(res.items) ? res.items : [];
        const tasks = scrapsRes?.tasks && typeof scrapsRes.tasks === 'object' ? scrapsRes.tasks : {};
        timeData = { items, tasks };
        timeMessage = '';
      }
      drawTime();
    }

    // 패널 열린 동안 이벤트 리스너
    const EVENTS = ['readgloss:mydict', 'readgloss:words'];
    const onChange = () => {
      if (!root.isConnected) return EVENTS.forEach((e) => window.removeEventListener(e, onChange));
      if (subView === 'records') loadRecords(range);
      else loadTime(timeRange);
    };
    EVENTS.forEach((e) => window.addEventListener(e, onChange));

    switchView(subView);
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'study', title: '공부 기록', order: 25, render });
})();
