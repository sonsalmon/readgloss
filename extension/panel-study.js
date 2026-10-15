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

  globalThis.readglossStudy = { KINDS, RANGES, DEFAULT_RANGE, EMPTY, dateKey, fillDays, bars, chips, periodTotal, dayTitle, timeOf, kindLabel, listDays, itemRow };

  // ---- 그리기(document 는 render 가 불릴 때만 만진다) ----
  const MESSAGES = { 'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요', unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요', 'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요', 'http-404': '다리가 이 기능을 아직 몰라요. 다리를 다시 시작해 주세요' };

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
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function render(container, ctx) {
    const S = globalThis.readglossStudy;
    let range = S.DEFAULT_RANGE;
    let data = null; // fillDays 결과
    let message = '불러오는 중…';
    let seq = 0; // 늦게 도착한 옛 응답을 버리기 위한 번호

    const root = el('div', 'rgs');
    const style = el('style');
    style.textContent = CSS;
    const head = el('div', 'head');
    head.append(el('h3', '', '오늘'));
    const ranges = el('div', 'ranges');
    ranges.setAttribute('role', 'group');
    ranges.setAttribute('aria-label', '기간 선택');
    const rngBtns = S.RANGES.map((n) => {
      const b = el('button', 'rng', `${n}일`);
      b.type = 'button';
      b.setAttribute('aria-label', `최근 ${n}일 보기`);
      b.addEventListener('click', () => load(n)); // 같은 기간을 눌러도 다시 불러온다
      ranges.append(b);
      return b;
    });
    head.append(ranges);
    const status = el('div', 'status');
    status.setAttribute('role', 'status');
    const todayBox = el('div', 'sec');
    const barsBox = el('div', 'sec');
    const listBox = el('div', 'sec');
    root.append(style, head, status, todayBox, barsBox, listBox);
    container.replaceChildren(root);

    function draw() {
      rngBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(S.RANGES[i] === range)));
      status.textContent = message;
      for (const box of [todayBox, barsBox, listBox]) box.hidden = !data;
      if (!data) return;
      const sum = S.periodTotal(data);
      status.textContent = sum === 0 ? S.EMPTY : '';

      const today = data[data.length - 1];
      const cl = el('ul', 'chips');
      cl.setAttribute('aria-label', '오늘 한 일');
      for (const c of S.chips(today)) {
        const li = el('li', `chip${c.n ? '' : ' zero'}`);
        li.append(c.label, el('b', '', String(c.n)));
        cl.append(li);
      }
      todayBox.replaceChildren(cl, el('p', 'sum', `오늘 ${today.total}건`));

      const bs = S.bars(data);
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
      axis.append(el('span', '', S.dayTitle(data[0].date).replace(/ \(.\)$/, '')), el('span', '', `최근 ${range}일 모두 ${sum}건`), el('span', '', '오늘'));
      barsBox.replaceChildren(el('h3', '', `최근 ${range}일`), wrap, axis);

      listBox.replaceChildren(...S.listDays(data).map(dayNode));
    }

    // 날짜 하나: 펼칠 때(또는 처음부터 펼쳐져 있으면 바로) 항목 줄을 만든다
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

    async function load(n) {
      range = n;
      const mine = ++seq;
      if (!data) message = '불러오는 중…';
      draw();
      const r = await ctx.send({ type: 'study', days: n });
      if (mine !== seq) return;
      if (Array.isArray(r?.days)) {
        data = S.fillDays(r.days, n);
        message = '';
      } else {
        data = null;
        message = MESSAGES[r?.error] ?? `불러오지 못했어요(${r?.error ?? '응답 없음'})`;
      }
      draw();
    }

    // 패널을 연 채 한 동작(내 사전 고치기·알아요·구 빼기·카드 저장 등)은 이 탭이 안 보이는 사이에 일어난다. 다시 불러 두면 탭으로 올 때 숫자가 맞다.
    // 패널이 새로 그려져 이 노드가 떨어지면 스스로 거둔다(panel-words.js 의 onMine 과 같은 방식).
    const EVENTS = ['readgloss:mydict', 'readgloss:words'];
    const onChange = () => {
      if (!root.isConnected) return EVENTS.forEach((e) => window.removeEventListener(e, onChange));
      load(range);
    };
    EVENTS.forEach((e) => window.addEventListener(e, onChange));

    draw();
    load(range);
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'study', title: '공부 기록', order: 25, render });
})();
