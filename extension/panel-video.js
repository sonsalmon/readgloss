// 패널 [영상] 탭(변경 기록 27-5): 유튜브에서만 등록한다. 대본(줄 누르면 그 장면) · 어려운 단어 미리 보기 · 한국어 모두 보기.
// 자막 층(video-subs.js)이 내놓은 globalThis.readglossVideoUi 를 읽고 부르기만 한다. 판단은 video-core.js.
// 패널의 탭들은 shadow root 하나를 같이 쓴다: 이 탭 CSS 는 모두 .rgv 아래로 묶고 이름에 v- 를 붙여 다른 탭과 서로 새지 않게 한다.
(() => {
  if (typeof document === 'undefined' || !/(^|\.)youtube\.com$/.test(location.hostname)) return;
  const V = globalThis.readglossVideo;
  const FOLLOW_MS = 3000; // 사용자가 대본을 스크롤하면 이만큼은 지금 줄을 따라가지 않는다

  const CSS = `
    .rgv { --v-fg: var(--rg-fg, #1f2328); --v-muted: var(--rg-muted, #656d76); --v-border: var(--rg-border, #e3e6ea); --v-accent: var(--rg-accent, #2f6feb);
      --v-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); --v-ink: var(--rg-accent-ink, #245ac4);
      color: var(--v-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgv { --v-fg: var(--rg-fg, #e6e8eb); --v-muted: var(--rg-muted, #9aa3ad); --v-border: var(--rg-border, #343a44); --v-accent: var(--rg-accent, #6b9bff);
        --v-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); --v-ink: var(--rg-accent-ink, #8db4ff); }
    }
    .rgv button { box-sizing: border-box; margin: 0; font: inherit; color: inherit; background: none; cursor: pointer; }
    .rgv button:focus-visible { outline: 2px solid var(--v-accent); outline-offset: 2px; }
    .rgv .v-title { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
    .rgv .v-info, .rgv .v-status { color: var(--v-muted); font-size: 12.5px; font-weight: 400; }
    .rgv .v-tools { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .rgv .v-act { min-height: 28px; padding: 3px 12px; border-radius: 7px; border: 1px solid var(--v-border); font-size: 12.5px; font-weight: 400; }
    .rgv .v-act:hover { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-ink); }
    .rgv .v-act[aria-pressed="true"] { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-ink); font-weight: 600; }
    .rgv .v-hard { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }
    .rgv .v-chip { min-height: 26px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--v-border); font-size: 12.5px; text-align: left; }
    .rgv .v-chip:hover { border-color: var(--v-accent); background: var(--v-soft); }
    .rgv .v-chip .v-g { color: var(--v-muted); }
    .rgv .v-list { list-style: none; margin: 0; padding: 0; }
    .rgv .v-row { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: start; margin: 0; padding: 6px 4px; border-top: 1px solid var(--v-border); border-radius: 6px; }
    .rgv .v-row:hover:not(.v-cur) { background: color-mix(in srgb, var(--v-soft) 50%, transparent); }
    .rgv .v-row.v-cur { background: var(--v-soft); }
    .rgv .v-t { min-width: 40px; min-height: 24px; padding: 0 4px; border: 0; border-radius: 5px; color: var(--v-ink); font-size: 12px; font-variant-numeric: tabular-nums; }
    .rgv .v-txt { min-width: 0; cursor: pointer; overflow-wrap: anywhere; font-weight: 400; }
    .rgv .v-txt:hover .v-en { text-decoration: underline; text-underline-offset: 2px; }
    .rgv .v-ko { color: var(--v-muted); font-size: 12.5px; }
    .rgv .v-star { min-width: 28px; min-height: 28px; padding: 0; border: 0; border-radius: 6px; color: var(--v-ink); font-size: 15px; line-height: 1; }
    .rgv .v-star:hover { background: var(--v-soft); }
    .rgv [hidden] { display: none !important; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(text, label, onclick, cls = 'v-act') {
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
    const titleEl = el('div', 'v-title');
    const infoEl = el('div', 'v-info'); // 줄마다 바뀌는 번역 진행은 여기 말고 [한국어] 단추에(읽어 주기가 줄마다 울리지 않게)
    const hardBtn = btn('어려운 단어 보기', '이 영상의 어려운 단어 미리 보기', () => showHard());
    const koBtn = btn('한국어 모두 보기', '대본 전체를 맥 번역으로', () => ui()?.setKoAll(!ui().state().koAll));
    const tools = el('div', 'v-tools');
    tools.append(hardBtn, koBtn);
    const hardBox = el('div', 'v-hard');
    hardBox.hidden = true;
    hardBox.setAttribute('role', 'group');
    hardBox.setAttribute('aria-label', '어려운 단어');
    const list = el('ol', 'v-list');
    list.setAttribute('aria-label', '대본');
    root.append(style, titleEl, infoEl, tools, hardBox, list);
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
      if (key === builtKey) {
        // 같은 대본이어도 한국어 줄은 바뀔 수 있다(나중에 온 유튜브 한국어 자막은 'ko' 알림 없이 한꺼번에 채워진다)
        rows.forEach((r, i) => {
          const t = st?.ko[i] || '';
          if (r.ko.textContent !== t) r.ko.textContent = t;
        });
        return;
      }
      builtKey = key;
      curRow = -1;
      rows = (st?.cues ?? []).map((c, i) => {
        const li = el('li', 'v-row');
        const t = btn(V.fmtTime(c.start), `${V.fmtTime(c.start)} 그 장면으로`, () => ui()?.seek(i), 'v-t');
        const txt = el('div', 'v-txt');
        txt.append(el('div', 'v-en', c.text));
        const ko = el('div', 'v-ko', st.ko[i] || '');
        txt.append(ko);
        txt.addEventListener('click', () => ui()?.seek(i));
        const star = btn('☆', '이 줄 구·문장에 저장', () => ui()?.saveLine(i, star), 'v-star');
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
      infoEl.textContent = `영어 자막 · ${st.cues.length}줄 · ${st.kind === 'asr' ? '자동 생성' : '사람이 씀'}`;
      const done = st.ko.filter(Boolean).length;
      koBtn.textContent = st.koAll ? `한국어 받는 중 ${done}/${st.cues.length} · 멈추기` : done >= st.cues.length ? '한국어 모두 받음' : '한국어 모두 보기';
      koBtn.setAttribute('aria-pressed', String(st.koAll));
    }

    // 지금 줄 강조·따라 스크롤(사용자가 막 스크롤했으면 안 따라감)
    function follow(force = false) {
      const st = ui()?.state();
      const i = st?.cur ?? -1;
      if (i === curRow && !force) return;
      rows[curRow]?.li.classList.remove('v-cur');
      rows[curRow]?.li.removeAttribute('aria-current');
      curRow = i;
      const r = rows[i];
      if (!r) return;
      r.li.classList.add('v-cur');
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
      hardBox.replaceChildren(el('span', 'v-status', '대본 전체 낱말을 보는 중…'));
      const ok = await ui()?.annotateAll();
      if (!root.isConnected || !hardOpen) return;
      if (!ok) return hardBox.replaceChildren(el('span', 'v-status', '다리에 연결하지 못했어요'));
      paintHard();
    }
    function paintHard() {
      const st = ui()?.state();
      const words = st ? V.previewWords(st.cues, st.hard) : [];
      if (!words.length) return hardBox.replaceChildren(el('span', 'v-status', '지금 수준에서 어려운 단어가 없어요'));
      hardBox.replaceChildren(...words.map((w) => {
        const b = btn('', `${w.word} ${w.gloss}, ${w.count}번, 처음 나온 줄로`, () => ui()?.seek(w.first), 'v-chip');
        b.append(`${w.word} `, el('span', 'v-g', `${w.gloss}${w.count > 1 ? ` ×${w.count}` : ''}`));
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
