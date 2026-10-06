// "내 단어" 탭(단어장 / 아는 단어 / 최근 찾은 단어) + 카드 버튼 상태 판단.
// 위쪽은 DOM 을 만지지 않는 순수 함수(globalThis.readglossWords, node --test 가 같은 파일을 import 한다).
// content.js 의 사전 카드도 클릭 시점에 이 순수 함수를 쓴다. 아래쪽 render 는 패널 Shadow DOM 안 container 에 그린다.
(() => {
  // ---- 순수 로직 ----
  const LISTS = [
    { id: 'saved', title: '단어장', empty: '아직 단어장에 담은 단어가 없어요. 단어 카드에서 ☆ 단어장에 추가를 눌러 보세요.' },
    { id: 'known', title: '아는 단어', empty: '아는 단어로 표시한 단어가 없어요. 카드에서 ✓ 알아요를 누르면 이 단어에는 주석이 붙지 않아요.' },
    { id: 'history', title: '최근 찾은 단어', empty: '아직 찾아본 단어가 없어요. 영어 단어를 더블클릭해 보세요.' },
  ];

  const pad = (n) => String(n).padStart(2, '0');
  function formatDate(ts) {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : '';
  }

  const counts = (s) => ({ saved: Object.keys(s.saved).length, known: Object.keys(s.known).length, history: s.history.length });

  // 줄마다 동작 버튼. 단어장: 빼기·알아요 / 아는 단어: 알아요 취소 / 최근: 단어장에 추가·알아요(이미 했으면 되돌리기)
  function actionsFor(list, isSaved, isKnown) {
    const known = isKnown ? { op: 'unknown', label: '알아요 취소' } : { op: 'known', label: '알아요' };
    if (list === 'saved') return [{ op: 'unsave', label: '빼기' }, known];
    if (list === 'known') return [{ op: 'unknown', label: '알아요 취소' }];
    return [isSaved ? { op: 'unsave', label: '단어장에서 빼기' } : { op: 'save', label: '단어장에 추가' }, known];
  }

  // 상태 + 하위 목록 + 검색어(원형 앞부분 일치) -> 줄 목록. 아는 단어 줄은 단어장·최근 기록에서 뜻과 문장을 빌려 온다.
  function rowsFor(state, list, query = '') {
    const q = String(query).trim().toLowerCase();
    const idx = (o) => Object.entries(o).map(([lemma, v]) => ({ lemma, ...v }));
    const byNew = (a, b) => b.ts - a.ts;
    let rows;
    if (list === 'saved') rows = idx(state.saved).sort(byNew);
    else if (list === 'known') {
      rows = idx(state.known)
        .sort(byNew)
        .map((k) => {
          const o = state.saved[k.lemma] ?? state.history.find((h) => h.lemma === k.lemma) ?? {};
          return { lemma: k.lemma, word: o.word ?? k.lemma, gloss: o.gloss ?? '', sentence: o.sentence ?? '', url: o.url ?? '', ts: k.ts };
        });
    } else rows = state.history.map((h) => ({ ...h }));
    return rows
      .filter((r) => r.lemma.startsWith(q))
      .map((r) => ({ ...r, actions: actionsFor(list, Object.hasOwn(state.saved, r.lemma), Object.hasOwn(state.known, r.lemma)) }));
  }

  // 사전 카드의 두 버튼. aria-label 은 보이는 글자를 포함한다.
  function buttonModel({ saved = false, known = false } = {}) {
    const save = saved ? { op: 'unsave', text: '★ 단어장에 있음', label: '★ 단어장에 있음, 누르면 빼기' } : { op: 'save', text: '☆ 단어장에 추가', label: '☆ 단어장에 추가' };
    const mark = known ? { op: 'unknown', text: '알아요 취소', label: '알아요 취소, 이 단어에 주석을 다시 붙이기' } : { op: 'known', text: '✓ 알아요', label: '✓ 알아요, 이 단어에 주석 붙이지 않기' };
    return { save, known: mark };
  }

  // 알아요/취소는 페이지의 주석을 걷거나 되살려야 해서 이벤트를 보낸다(계약 C). 그 밖의 동작은 null.
  function eventDetail(op, lemma) {
    if (op === 'known') return { known: [lemma], unknown: [] };
    if (op === 'unknown') return { known: [], unknown: [lemma] };
    return null;
  }

  // 동작 -> 다리에 보낼 메시지. save 는 줄이 가진 단어·뜻·문장·주소를 그대로 싣는다.
  const messageFor = (op, row) => (op === 'save' ? { type: 'words', op, lemma: row.lemma, word: row.word, gloss: row.gloss, sentence: row.sentence, url: row.url } : { type: 'words', op, lemma: row.lemma });

  globalThis.readglossWords = { LISTS, formatDate, counts, actionsFor, rowsFor, buttonModel, eventDetail, messageFor };

  // ---- 그리기 ----
  const MESSAGES = { 'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요', unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요', 'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요' };

  // 패널 껍데기가 정한 토큰(--rg-*)을 쓰고, 껍데기 없이 시험할 때를 위해 밝은/어두운 기본값을 둔다.
  const CSS = `
    .rgw { --w-fg: var(--rg-fg, #1f2328); --w-muted: var(--rg-muted, #656d76); --w-border: var(--rg-border, #e3e6ea); --w-accent: var(--rg-accent, #2f6feb);
      --w-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); color: var(--w-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgw { --w-fg: var(--rg-fg, #e6e8eb); --w-muted: var(--rg-muted, #9aa3ad); --w-border: var(--rg-border, #343a44); --w-accent: var(--rg-accent, #6b9bff);
        --w-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); }
    }
    .subs { display: flex; gap: 4px; flex-wrap: wrap; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
    .sub { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--w-border); background: none; font-size: 13px; }
    .sub[aria-pressed="true"] { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-accent); font-weight: 600; }
    .n { margin-left: 4px; font-variant-numeric: tabular-nums; opacity: .8; }
    .q { box-sizing: border-box; width: 100%; margin: 10px 0 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--w-border); background: none; color: inherit; font: inherit; }
    .status { color: var(--w-muted); font-size: 13px; padding: 6px 0; word-break: keep-all; overflow-wrap: anywhere; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { padding: 9px 0; border-top: 1px solid var(--w-border); }
    .top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .lemma { font-weight: 700; font-size: 15px; }
    .gloss { color: var(--w-fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sent { color: var(--w-muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .date { color: var(--w-muted); font-size: 12px; margin-right: auto; font-variant-numeric: tabular-nums; }
    .act { padding: 1px 9px; border-radius: 7px; border: 1px solid var(--w-border); background: none; font-size: 12.5px; }
    .act:hover { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-accent); }
    .act[disabled] { opacity: .55; cursor: default; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function render(container, ctx) {
    const W = globalThis.readglossWords;
    let state = null;
    let list = 'saved';
    let query = '';
    let busy = false;
    let message = '불러오는 중…';

    const root = el('div', 'rgw');
    const style = el('style');
    style.textContent = CSS;
    const subs = el('div', 'subs');
    subs.setAttribute('role', 'group');
    subs.setAttribute('aria-label', '내 단어 목록');
    const search = el('input', 'q');
    search.type = 'search';
    search.placeholder = '원형 앞부분으로 찾기';
    search.setAttribute('aria-label', '원형 앞부분으로 찾기');
    const status = el('div', 'status');
    status.setAttribute('role', 'status');
    const ul = el('ul');
    root.append(style, subs, search, status, ul);
    container.replaceChildren(root);

    const subBtns = W.LISTS.map((l) => {
      const b = el('button', 'sub');
      b.type = 'button';
      b.addEventListener('click', () => {
        list = l.id;
        draw();
      });
      subs.append(b);
      return b;
    });
    search.addEventListener('input', () => {
      query = search.value;
      draw();
    });

    async function act(op, row) {
      if (busy) return;
      busy = true;
      const r = await ctx.send(W.messageFor(op, row));
      busy = false;
      if (r?.known && r.saved && r.history) {
        state = r;
        message = '';
        const detail = W.eventDetail(op, row.lemma);
        if (detail) window.dispatchEvent(new CustomEvent('readgloss:words', { detail }));
      } else message = MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;
      draw();
    }

    function draw() {
      const c = state ? W.counts(state) : null;
      W.LISTS.forEach((l, i) => {
        subBtns[i].replaceChildren(l.title, ...(c ? [el('span', 'n', String(c[l.id]))] : []));
        subBtns[i].setAttribute('aria-pressed', String(l.id === list));
      });
      const rows = state ? W.rowsFor(state, list, query) : [];
      status.textContent = message || (state && !rows.length ? (query.trim() ? '찾는 단어가 없어요' : W.LISTS.find((l) => l.id === list).empty) : '');
      ul.replaceChildren(
        ...rows.map((r) => {
          const li = el('li');
          const top = el('div', 'top');
          top.append(el('span', 'lemma', r.lemma));
          if (r.gloss) top.append(el('span', 'gloss', r.gloss));
          li.append(top);
          if (r.sentence) {
            const s = el('div', 'sent', r.sentence);
            s.title = r.sentence;
            li.append(s);
          }
          const meta = el('div', 'meta');
          meta.append(el('span', 'date', W.formatDate(r.ts)));
          for (const a of r.actions) {
            const b = el('button', 'act', a.label);
            b.type = 'button';
            b.setAttribute('aria-label', `${r.lemma} ${a.label}`);
            b.addEventListener('click', () => act(a.op, r));
            meta.append(b);
          }
          li.append(meta);
          return li;
        }),
      );
    }

    draw();
    ctx.send({ type: 'words', op: 'get' }).then((r) => {
      if (r?.known && r.saved && r.history) {
        state = r;
        message = '';
      } else message = MESSAGES[r?.error] ?? `불러오지 못했어요(${r?.error ?? '응답 없음'})`;
      draw();
    });
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'words', title: '내 단어', order: 20, render });
})();
