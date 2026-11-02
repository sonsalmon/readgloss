// "다시 볼 것" 패널 탭(29-6). 표시(mark)가 있는 메모를 최신순으로 모아 보여 준다.
// 위쪽은 DOM 을 만지지 않는 순수 함수(globalThis.readglossPanelMarks, node --test 가 같은 파일을 import 한다).
// 태그 칩을 고르면 표시 없는 메모도 그 태그가 있으면 함께 보인다(블로그 글감용).
(() => {
  const MARKS = ['question', 'insight'];
  const MARK_LABELS = { question: '❓ 다시 볼 것', insight: '💡 깨달음' };
  const MARK_ICONS = { question: '❓', insight: '💡', none: '✎' };
  const PERIODS = ['today', '7d', 'all'];
  const EMPTY = '? 스페이스나 드래그 후 ?로 남긴 메모가 여기 모여요';

  const markOf = (memo) => (MARKS.includes(memo?.mark) ? memo.mark : null);
  const tagsOf = (memo) => {
    const list = Array.isArray(memo?.tags) ? memo.tags : [];
    return [...new Set(list.filter((t) => typeof t === 'string' && t))];
  };
  const tsOf = (memo) => (Number.isFinite(memo?.ts) ? memo.ts : 0);
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  // 기간 거르기: 오늘 = 오늘 0시부터, 7일 = 오늘 포함 7일(달력 날짜 기준), 전부 = 모두.
  function inPeriod(ts, period, now = new Date()) {
    if (period === 'today') return ts >= startOfDay(now);
    if (period === '7d') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
      return ts >= start;
    }
    return true;
  }

  // 태그 칩에 쓸 개수: 지금 기간의 메모 전체에서 그 태그가 붙은 수(표시 없는 메모도 센다).
  function tagCounts(memos, { period = 'all' } = {}, now = new Date()) {
    const counts = new Map();
    for (const memo of Array.isArray(memos) ? memos : []) {
      if (!memo || !inPeriod(tsOf(memo), period, now)) continue;
      for (const tag of tagsOf(memo)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, n]) => ({ tag, n }))
      .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  }

  // 표시·기간·태그 거르기.
  // 태그가 없으면 표시가 있는 메모만(표시 칩 '전체' = 표시가 있는 모두).
  // 태그가 있으면 그 태그가 붙은 메모 전부에서 표시 칩으로 다시 거른다(표시 칩 '전체'면 표시 없는 것도 포함).
  function filterMemos(memos, state = {}, now = new Date()) {
    const mark = MARKS.includes(state.mark) ? state.mark : 'all';
    const period = PERIODS.includes(state.period) ? state.period : 'all';
    const tag = typeof state.tag === 'string' && state.tag ? state.tag : null;
    const inRange = (Array.isArray(memos) ? memos : []).filter(
      (memo) => memo && Number.isFinite(memo.ts) && inPeriod(memo.ts, period, now),
    );
    const candidates = tag ? inRange.filter((memo) => tagsOf(memo).includes(tag)) : inRange;
    return candidates
      .filter((memo) => {
        const mine = markOf(memo);
        if (mark === 'all') return tag ? true : mine !== null;
        return mine === mark;
      })
      .sort((a, b) => b.ts - a.ts);
  }

  // 인용 첫 줄(빈 줄은 건너뛴다). 없으면 ''.
  function firstQuoteLine(memo) {
    const exact = memo?.quote?.exact;
    if (typeof exact !== 'string') return '';
    return exact.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  }

  const pad = (n) => String(n).padStart(2, '0');
  // M/D HH:mm (로컬). 잘못된 값이면 ''.
  function formatDate(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function safeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
      return null;
    }
  }

  globalThis.readglossPanelMarks = {
    MARKS,
    MARK_LABELS,
    MARK_ICONS,
    PERIODS,
    EMPTY,
    markOf,
    tagsOf,
    inPeriod,
    tagCounts,
    filterMemos,
    firstQuoteLine,
    formatDate,
    safeUrl,
  };

  const STYLE_TEXT = `
    .marks-container {
      font-size: 13px;
      line-height: 1.5;
      color: var(--rg-fg, #222);
      padding: 8px 12px;
    }
    .marks-empty {
      color: var(--rg-muted, #777);
      text-align: center;
      padding: 32px 16px;
    }
    .marks-filters {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .marks-sep {
      color: var(--rg-muted, #999);
      font-size: 11px;
      margin: 0 1px;
    }
    .marks-chip {
      background: none;
      border: 1px solid var(--rg-border, #d0d7de);
      border-radius: 14px;
      padding: 3px 10px;
      font-size: 12px;
      font-family: inherit;
      color: var(--rg-muted, #656d76);
      cursor: pointer;
    }
    .marks-chip:hover {
      background: var(--rg-accent-soft, rgba(47, 111, 235, .10));
    }
    .marks-chip[aria-pressed="true"] {
      background: var(--rg-accent-soft, rgba(47, 111, 235, .10));
      color: var(--rg-accent-ink, var(--rg-accent, #2f6feb));
      border-color: var(--rg-accent, #2f6feb);
      font-weight: 600;
    }
    .mark-item {
      background: var(--rg-bg, #fff);
      border: 1px solid var(--rg-border, #e5e5e5);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .mark-main {
      display: flex;
      gap: 7px;
      align-items: flex-start;
    }
    .mark-icon {
      flex: none;
      line-height: 1.5;
    }
    .mark-body {
      min-width: 0;
      flex: 1;
    }
    .mark-text {
      color: var(--rg-fg, #222);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .mark-quote {
      color: var(--rg-muted, #888);
      font-size: 12px;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mark-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }
    .mark-tag {
      font-size: 11px;
      color: var(--rg-accent-ink, var(--rg-accent, #2f6feb));
      background: var(--rg-accent-soft, rgba(47, 111, 235, .10));
      border-radius: 10px;
      padding: 1px 7px;
    }
    .mark-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      font-size: 11.5px;
      color: var(--rg-muted, #888);
    }
    .mark-page {
      color: var(--rg-accent-ink, var(--rg-accent, #2f6feb));
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 70%;
    }
    .mark-page:hover {
      text-decoration: underline;
    }
  `;

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) el.setAttribute(k, String(v));
    }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === 'string') el.append(document.createTextNode(c));
      else el.append(c);
    }
    return el;
  }

  function render(container, ctx) {
    if (typeof document === 'undefined') return;

    const root = h('div', { class: 'marks-container' });
    const style = h('style', { text: STYLE_TEXT });
    container.replaceChildren(style, root);

    let memos = [];
    let state = { mark: 'all', period: 'all', tag: null };

    function chips() {
      const now = new Date();
      const counts = globalThis.readglossPanelMarks.tagCounts(memos, { period: state.period }, now);
      // 기간이 바뀌어 사라진 태그를 골라 두었으면 푼다
      if (state.tag && !counts.some((c) => c.tag === state.tag)) state.tag = null;

      const chip = (text, active, onclick) =>
        h('button', {
          class: 'marks-chip',
          type: 'button',
          text,
          'aria-pressed': active ? 'true' : 'false',
          onclick,
        });

      const row = h('div', { class: 'marks-filters' });
      row.append(
        chip('전체', state.mark === 'all', () => {
          state.mark = 'all';
          draw();
        }),
        chip(MARK_LABELS.question, state.mark === 'question', () => {
          state.mark = 'question';
          draw();
        }),
        chip(MARK_LABELS.insight, state.mark === 'insight', () => {
          state.mark = 'insight';
          draw();
        }),
        h('span', { class: 'marks-sep', text: '·' }),
        chip('오늘', state.period === 'today', () => {
          state.period = 'today';
          draw();
        }),
        chip('7일', state.period === '7d', () => {
          state.period = '7d';
          draw();
        }),
        chip('전부', state.period === 'all', () => {
          state.period = 'all';
          draw();
        }),
      );
      if (counts.length > 0) {
        row.append(h('span', { class: 'marks-sep', text: '·' }));
        for (const c of counts) {
          row.append(
            chip(`#${c.tag} (${c.n})`, state.tag === c.tag, () => {
              state.tag = state.tag === c.tag ? null : c.tag;
              draw();
            }),
          );
        }
      }
      return row;
    }

    function item(memo) {
      const mark = markOf(memo);
      const el = h('div', { class: 'mark-item' });
      const body = h('div', { class: 'mark-body' });
      // #태그는 아래 칩 줄로 보이니 글에서는 뺀다
      body.append(h('div', { class: 'mark-text', text: String(memo.text || '').replace(/(^|\s)#[^\s#]{1,20}(?=\s|$)/g, '$1').replace(/[ \t]+$/gm, '').trim() }));

      const quoteLine = firstQuoteLine(memo);
      if (quoteLine) body.append(h('div', { class: 'mark-quote', text: quoteLine }));

      const tags = tagsOf(memo);
      if (tags.length > 0) {
        body.append(h('div', { class: 'mark-tags' }, ...tags.map((t) => h('span', { class: 'mark-tag', text: `#${t}` }))));
      }

      const meta = h('div', { class: 'mark-meta' });
      const url = safeUrl(memo.url);
      const title = memo.title || memo.url || '';
      if (url) {
        meta.append(h('a', { class: 'mark-page', href: url, target: '_blank', rel: 'noopener noreferrer', text: title }));
      } else if (title) {
        meta.append(h('span', { class: 'mark-page', text: title }));
      }
      const date = formatDate(memo.ts);
      if (date) meta.append(h('span', { text: date }));
      body.append(meta);

      el.append(h('div', { class: 'mark-main' }, h('span', { class: 'mark-icon', text: MARK_ICONS[mark || 'none'] }), body));
      return el;
    }

    function draw() {
      const filters = chips();
      const list = filterMemos(memos, state, new Date());
      if (list.length === 0) {
        root.replaceChildren(filters, h('div', { class: 'marks-empty', text: EMPTY }));
        return;
      }
      root.replaceChildren(filters, ...list.map(item));
    }

    async function loadData() {
      root.replaceChildren(h('div', { class: 'marks-empty', text: '불러오는 중…' }));
      const res = await ctx.send({ type: 'memos', op: 'get' });
      if (!res || res.error) {
        root.replaceChildren(h('div', { class: 'marks-empty', text: '메모를 불러오지 못했어요.' }));
        return;
      }
      memos = Array.isArray(res.memos) ? res.memos : [];
      draw();
    }

    // 패널에서 이 탭을 고를 때마다(숨김 -> 보임) 새로 읽는다.
    let visible = false;
    const onVisibility = () => {
      const now = !container.hidden && container.isConnected;
      if (now && !visible) loadData();
      visible = now;
    };
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(onVisibility).observe(container, { attributes: true, attributeFilter: ['hidden'] });
    }
    onVisibility();
    if (typeof MutationObserver === 'undefined') loadData();
  }

  (globalThis.readglossPanelTabs ||= []).push({
    id: 'marks',
    title: '다시 볼 것',
    order: 24,
    render,
  });
})();
