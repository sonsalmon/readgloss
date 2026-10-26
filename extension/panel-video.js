// 패널 [영상] 탭(변경 기록 27-5): 유튜브에서만 등록한다. 대본(줄 누르면 그 장면) · 어려운 단어 미리 보기 · 한국어 모두 보기.
// 자막 층(video-subs.js)이 내놓은 globalThis.readglossVideoUi 를 읽고 부르기만 한다. 판단은 video-core.js.
(() => {
  if (typeof document === 'undefined' || !/(^|\.)youtube\.com$/.test(location.hostname)) return;
  const V = globalThis.readglossVideo;
  const FOLLOW_MS = 3000; // 사용자가 대본을 스크롤하면 이만큼은 지금 줄을 따라가지 않는다

  const CSS = `
    .rgv { --v-fg: var(--rg-fg, #1f2328); --v-muted: var(--rg-muted, #656d76); --v-border: var(--rg-border, #e3e6ea); --v-accent: var(--rg-accent, #2f6feb);
      --v-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); color: var(--v-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgv { --v-fg: var(--rg-fg, #e6e8eb); --v-muted: var(--rg-muted, #9aa3ad); --v-border: var(--rg-border, #343a44); --v-accent: var(--rg-accent, #6b9bff); --v-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); }
    }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--v-accent); outline-offset: 2px; }
    .title { font-weight: 700; overflow-wrap: anywhere; }
    .info, .status { color: var(--v-muted); font-size: 12.5px; }
    .tools { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    .act { padding: 2px 10px; border-radius: 7px; border: 1px solid var(--v-border); background: none; font-size: 12.5px; }
    .act:hover { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-accent); }
    .act[aria-pressed="true"] { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-accent); font-weight: 600; }
    .hard { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; }
    .chip { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--v-border); background: none; font-size: 12.5px; text-align: left; }
    .chip:hover { border-color: var(--v-accent); background: var(--v-soft); }
    .chip .g { color: var(--v-muted); }
    ol { list-style: none; margin: 0; padding: 0; }
    li { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: start; padding: 6px 4px; border-top: 1px solid var(--v-border); border-radius: 6px; }
    li.cur { background: var(--v-soft); }
    .t { padding: 0 4px; border: 0; background: none; color: var(--v-accent); font-size: 12px; font-variant-numeric: tabular-nums; }
    .txt { cursor: pointer; min-width: 0; overflow-wrap: anywhere; }
    .ko { color: var(--v-muted); font-size: 12.5px; }
    .star { padding: 0 6px; border: 0; background: none; color: var(--v-accent); font-size: 14px; }
    [hidden] { display: none !important; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(text, label, onclick, cls = 'act') {
    const b = el('button', cls, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onclick);
    return b;
  }
  // 대본을 담은 스크롤 상자(패널 본문): 가장 가까운 overflow-y auto·scroll 조상
  function scrollerOf(node) {
    for (let n = node?.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if (o === 'auto' || o === 'scroll') return n;
    }
    return null;
  }

  function render(container) {
    const root = el('div', 'rgv');
    const style = el('style');
    style.textContent = CSS;
    const titleEl = el('div', 'title');
    const infoEl = el('div', 'info');
    infoEl.setAttribute('role', 'status');
    const hardBtn = btn('어려운 단어 보기', '이 영상의 어려운 단어 미리 보기', () => showHard());
    const koBtn = btn('한국어 모두 보기', '대본 전체를 맥 번역으로', () => ui()?.setKoAll(!ui().state().koAll));
    const tools = el('div', 'tools');
    tools.append(hardBtn, koBtn);
    const hardBox = el('div', 'hard');
    hardBox.hidden = true;
    hardBox.setAttribute('role', 'group');
    hardBox.setAttribute('aria-label', '어려운 단어');
    const status = el('div', 'status');
    status.setAttribute('role', 'status');
    const list = el('ol');
    list.setAttribute('aria-label', '대본');
    root.append(style, titleEl, infoEl, tools, hardBox, status, list);
    container.replaceChildren(root);

    let rows = []; // 줄마다 { li, ko, star }
    let builtKey = '';
    let curRow = -1;
    let userScrollAt = 0;
    let auto = false;
    let hardOpen = false;
    let scroller = null; // 스크롤 듣기를 단 상자(패널 본문은 다시 그려도 그대로라 끊을 때 뗀다)
    const ui = () => globalThis.readglossVideoUi;

    function onScroll() {
      if (auto) auto = false;
      else userScrollAt = Date.now();
    }

    function build() {
      const st = ui()?.state();
      const key = st ? `${st.id}|${st.cues.length}|${st.cues[0]?.start}|${st.kind}` : '';
      if (key === builtKey) return;
      builtKey = key;
      curRow = -1;
      rows = (st?.cues ?? []).map((c, i) => {
        const li = el('li');
        const t = btn(V.fmtTime(c.start), `${V.fmtTime(c.start)} 그 장면으로`, () => ui()?.seek(i), 't');
        const txt = el('div', 'txt');
        txt.append(el('div', 'en', c.text));
        const ko = el('div', 'ko', st.ko[i] || '');
        txt.append(ko);
        txt.addEventListener('click', () => ui()?.seek(i));
        const star = btn('☆', '이 줄 구·문장에 저장', () => ui()?.saveLine(i, star), 'star');
        li.append(t, txt, star);
        return { li, ko, star };
      });
      list.replaceChildren(...rows.map((r) => r.li));
      rows.forEach((_, i) => paintStar(i));
      follow(true);
    }

    function paintStar(i) {
      const r = rows[i];
      if (!r) return;
      const saved = ui()?.isSaved(i) === true;
      r.star.textContent = saved ? '★' : '☆';
      r.star.setAttribute('aria-label', saved ? '이 줄 저장 빼기' : '이 줄 구·문장에 저장');
    }

    function paintHead() {
      const st = ui()?.state();
      if (!st?.id) {
        titleEl.textContent = '';
        infoEl.textContent = '유튜브 영상 페이지에서 보여요';
        tools.hidden = true;
        return;
      }
      titleEl.textContent = st.title;
      tools.hidden = !st.cues.length;
      if (!st.cues.length) {
        infoEl.textContent = st.message || '자막을 기다리는 중… (유튜브 자막(CC)을 켜 주세요)';
        return;
      }
      const done = st.ko.filter(Boolean).length;
      infoEl.textContent = `영어 자막 · ${st.cues.length}줄 · ${st.kind === 'asr' ? '자동 생성' : '사람이 씀'}${done ? ` · 한국어 ${done}/${st.cues.length}` : ''}`;
      koBtn.textContent = st.koAll ? '한국어 받는 중 · 멈추기' : '한국어 모두 보기';
      koBtn.setAttribute('aria-pressed', String(st.koAll));
    }

    // 지금 줄 강조·따라 스크롤(사용자가 막 스크롤했으면 안 따라감)
    function follow(force = false) {
      const st = ui()?.state();
      const i = st?.cur ?? -1;
      if (i === curRow && !force) return;
      rows[curRow]?.li.classList.remove('cur');
      rows[curRow]?.li.removeAttribute('aria-current');
      curRow = i;
      const r = rows[i];
      if (!r) return;
      r.li.classList.add('cur');
      r.li.setAttribute('aria-current', 'true');
      if (!scroller) {
        scroller = scrollerOf(root);
        scroller?.addEventListener('scroll', onScroll, { passive: true });
      }
      if (scroller && !root.closest?.('[hidden]') && Date.now() - userScrollAt > FOLLOW_MS) {
        // offsetTop 은 가장 가까운 위치 잡힌 조상(패널) 기준이라 스크롤 상자 안 자리를 화면 좌표 차이로 잰다
        const top = scroller.scrollTop + r.li.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2 + r.li.offsetHeight / 2;
        if (Math.abs(scroller.scrollTop - top) > 4) {
          auto = true; // 우리가 낸 스크롤은 사용자 스크롤로 치지 않는다
          scroller.scrollTop = Math.max(0, top);
          setTimeout(() => { auto = false; }, 120);
        }
      }
    }

    async function showHard() {
      hardOpen = !hardOpen;
      hardBtn.setAttribute('aria-pressed', String(hardOpen));
      hardBox.hidden = !hardOpen;
      if (!hardOpen) return;
      hardBox.replaceChildren(el('span', 'status', '대본 전체 낱말을 보는 중…'));
      const ok = await ui()?.annotateAll();
      if (!root.isConnected || !hardOpen) return;
      if (!ok) return hardBox.replaceChildren(el('span', 'status', '다리에 연결하지 못했어요'));
      paintHard();
    }
    function paintHard() {
      const st = ui()?.state();
      const words = st ? V.previewWords(st.cues, st.hard) : [];
      if (!words.length) return hardBox.replaceChildren(el('span', 'status', '지금 수준에서 어려운 단어가 없어요'));
      hardBox.replaceChildren(...words.map((w) => {
        const b = btn('', `${w.word} ${w.gloss}, ${w.count}번, 처음 나온 줄로`, () => ui()?.seek(w.first), 'chip');
        b.append(`${w.word} `, el('span', 'g', `${w.gloss}${w.count > 1 ? ` ×${w.count}` : ''}`));
        return b;
      }));
    }

    function refresh() {
      if (!ui()) {
        infoEl.textContent = '영상 자막 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요';
        tools.hidden = true;
        return;
      }
      build();
      paintHead();
      follow();
    }

    // 패널이 새로 그려져 이 노드가 떨어지면 스스로 구독을 끊는다(panel-words.js 와 같은 방식)
    const off = ui()?.onChange((what, i) => {
      if (!root.isConnected) {
        scroller?.removeEventListener('scroll', onScroll);
        return off?.();
      }
      if (what === 'ko' && rows[i]) {
        rows[i].ko.textContent = ui().state().ko[i] || '';
        return paintHead();
      }
      if (what === 'saved') return (Number.isInteger(i) ? [i] : rows.map((_, k) => k)).forEach(paintStar);
      if (what === 'hard') return hardOpen && paintHard();
      if (what === 'cur') return follow();
      refresh();
    });
    refresh();
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'video', title: '영상', order: 5, render });
})();
