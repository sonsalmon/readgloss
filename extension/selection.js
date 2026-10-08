// 드래그 -> 번역 카드. DOM 접착만 한다. 판단 로직은 selection-core.js(globalThis.readglossSelection), 글 뽑기는 text.js·paragraph-core.js.
// 한 단어를 드래그하면 더블클릭과 같은 사전 카드(content.js)를 열고, 두 단어 이상이면 맥 번역 카드를 띄운다. [문맥 번역] 은 앞뒤 문맥을 보고 AI 가 번역한다.
(() => {
  const core = globalThis.readglossSelection;
  const T = globalThis.readgloss;
  const P = globalThis.readglossParagraph;
  const blockOf = globalThis.readglossBlockOf; // content.js 가 올려 둔다(더블클릭 사전 카드와 같은 블록 판정)
  if (!core || !T || !P || !blockOf) return;
  const { classify, around, buildContext, MAX_SIDE, WIDE_SIDE } = core;
  const { extractSentence, plainTextAt, positionBubble } = T;
  const { textOf, textExceeds } = P;

  const MAX_RAW = 20_000; // 이보다 큰 선택은 대상으로 보지 않는다(복제·분류 비용)

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    'mt-unavailable': '맥 번역 도우미가 아직 없어요. 터미널에서 cd ~/dev/readgloss && npm run build:mt 를 실행하고, 시스템 설정의 번역 언어에서 영어·한국어를 받아 주세요',
    'mt-failed': '맥 번역에 실패했어요. [문맥 번역]을 눌러 보세요',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요',
    'ai-failed': '번역하지 못했어요. 다시 시도해 주세요',
    'too-large': '글이 너무 길어요(문단 번역 버튼을 써 주세요)',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };
  const errText = (r) => MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;

  // [내 사전에 추가] 입력칸·"내 사전: …" 줄·약어 줄의 모양. 사전 카드(content.js)도 globalThis.readglossMydict.CSS 로 같이 쓴다.
  const MD_CSS = `
    .btn.on { color: var(--rg-accent); border-color: var(--rg-accent); }
    .mine, .acr { margin-bottom: 8px; padding: 4px 10px; border-radius: 8px; background: var(--rg-accent-soft); color: var(--rg-accent);
      font-size: 13px; font-weight: 600; word-break: keep-all; overflow-wrap: anywhere; }
    .mine[hidden], .acr[hidden] { display: none; }
    .mdform { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 6px; }
    .mdform[hidden] { display: none; }
    .mdin { flex: 1 1 140px; min-width: 0; box-sizing: border-box; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--rg-border);
      background: var(--rg-bg); color: var(--rg-fg); font: inherit; font-size: 13px; }
    .mdin:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 1px; }
    .mderr { flex: 1 0 100%; color: var(--rg-muted); font-size: 12px; }
    .mderr[hidden] { display: none; }
  `;

  // "기억할 표현" 목록의 모양(드래그 카드와 문단 번역 블록이 같이 쓴다). 토큰은 바깥(.card 또는 .blk)이 정한다.
  const EXPR_CSS = `
    .exps { margin-top: 10px; }
    .exps-title { color: var(--rg-accent); font-size: 12px; font-weight: 700; }
    .exps ul { list-style: none; margin: 2px 0 0; padding: 0; }
    .exps li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
    .exp-text { flex: 1 1 auto; min-width: 0; font-size: 13px; word-break: keep-all; overflow-wrap: anywhere; }
    .exp-en { font-weight: 700; }
    .star { all: unset; flex: none; box-sizing: border-box; cursor: pointer; min-width: 28px; text-align: center; padding: 0 6px; border-radius: 7px;
      border: 1px solid var(--rg-border, rgba(128,128,128,.45)); color: inherit; font-size: 13px; line-height: 1.6; }
    .star:hover { background: var(--rg-accent-soft, rgba(47,111,235,.10)); border-color: var(--rg-accent); color: var(--rg-accent); }
    .star:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .star.on { color: var(--rg-accent); border-color: var(--rg-accent); }
    .star[aria-disabled="true"] { opacity: .55; cursor: default; }
    .exps-err { margin-top: 2px; font-size: 12px; opacity: .8; }
    .exps-err[hidden] { display: none; }
    .blk { --rg-accent: #2f6feb; --rg-accent-soft: rgba(47,111,235,.10); }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .blk { --rg-accent: #6b9bff; --rg-accent-soft: rgba(107,155,255,.14); } }
    :host([data-theme="dark"]) .blk { --rg-accent: #6b9bff; --rg-accent-soft: rgba(107,155,255,.14); }
  `;

  // 카드 디자인 토큰·모양은 content.js 의 사전 카드와 같다(바꿀 땐 같이 바꾼다).
  const DARK = `--rg-bg: #1e2127; --rg-fg: #e6e8eb; --rg-muted: #9aa3ad; --rg-border: #343a44; --rg-accent: #6b9bff;
    --rg-accent-soft: rgba(107,155,255,.14); --rg-shadow: 0 8px 28px rgba(0,0,0,.45);`;
  const CSS = `
    .card { --rg-bg: #ffffff; --rg-fg: #1f2328; --rg-muted: #656d76; --rg-border: #e3e6ea; --rg-accent: #2f6feb;
      --rg-accent-soft: rgba(47,111,235,.10); --rg-shadow: 0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); --rg-radius: 10px;
      box-sizing: border-box; width: 340px; max-width: calc(100vw - 16px); overflow: hidden; border-radius: var(--rg-radius);
      background: var(--rg-bg); color: var(--rg-fg); border: 1px solid var(--rg-border); box-shadow: var(--rg-shadow);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .card { ${DARK} } }
    :host([data-theme="dark"]) .card { ${DARK} }
    .scroll { max-height: 400px; overflow-y: auto; overscroll-behavior: contain; padding: 12px 16px 6px; }
    .scroll:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    .src { color: var(--rg-muted); font-size: 12.5px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    .term { display: none; margin-top: 8px; color: var(--rg-accent); font-size: 12px; font-weight: 600; word-break: keep-all; overflow-wrap: anywhere; }
    .term.on { display: block; }
    .out { margin-top: 8px; word-break: keep-all; overflow-wrap: anywhere; white-space: pre-wrap; }
    .out.err, .msg { color: var(--rg-muted); }
    .ctx { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--rg-border); }
    .ctx[hidden] { display: none; }
    .ctx-title { color: var(--rg-accent); font-size: 12px; font-weight: 700; }
    .note { margin-top: 4px; color: var(--rg-muted); font-size: 12px; word-break: keep-all; overflow-wrap: anywhere; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px 12px; }
    .btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border);
      color: var(--rg-fg); font-size: 12.5px; line-height: 1.6; }
    .btn:hover { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .btn[aria-disabled="true"] { opacity: .55; cursor: default; }
    .btn[hidden] { display: none; }
    .notice { margin-top: 8px; }
    .notice[hidden] { display: none; }
    .task-row { display: flex; align-items: baseline; gap: 4px; padding: 6px 12px 10px; border-top: 1px solid var(--rg-border); font-size: 11.5px; color: var(--rg-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .task-btn { all: unset; cursor: pointer; color: var(--rg-accent); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; flex-shrink: 0; }
    .task-btn:hover { opacity: .8; }
    .task-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
    .task-picker { display: flex; flex-direction: column; gap: 2px; padding: 6px 12px 8px; border-top: 1px solid var(--rg-border); background: var(--rg-bg); max-height: 120px; overflow-y: auto; }
    .task-picker[hidden] { display: none; }
    .task-item { all: unset; cursor: pointer; padding: 3px 6px; border-radius: 5px; font-size: 12px; color: var(--rg-fg); }
    .task-item:hover { background: var(--rg-accent-soft); color: var(--rg-accent); }
    .task-item.on { font-weight: 700; color: var(--rg-accent); }
    .ask-box { padding: 8px 12px; border-top: 1px solid var(--rg-border); background: var(--rg-accent-soft); font-size: 12px; }
    .ask-box[hidden] { display: none; }
    .ask-text { font-weight: 600; color: var(--rg-fg); margin-bottom: 6px; word-break: keep-all; }
    .ask-btns { display: flex; gap: 6px; }
    ${MD_CSS}
    ${EXPR_CSS}
  `;

  let settings = globalThis.readglossSettings?.normalize({}) ?? { selectionTranslate: true, theme: 'auto' }; // 저장된 값을 읽기 전에는 기본값
  let host = null;
  let ui = null; // { card, src, term, out, ctx, ctxBody, note, ctxBtn, copyBtn }
  let current = null; // { text, range, anchor, mt, termKo, ctx, ctxNote, wide, wideNote, mine, phraseId }  ctx·wide 는 문맥·넓은 문맥 번역(성공했을 때만 생김)
  let seq = 0; // 닫거나 새로 열 때마다 올려서 늦게 온 응답을 버린다
  const applyTheme = () => host && (settings.theme === 'light' || settings.theme === 'dark' ? host.setAttribute('data-theme', settings.theme) : host.removeAttribute('data-theme'));
  try {
    globalThis.readglossSettings?.load().then((s) => ((settings = s), applyTheme()), () => {});
    globalThis.readglossSettings?.onChange((s) => ((settings = s), applyTheme()));
  } catch {
    // 확장이 다시 로드된 뒤의 낡은 페이지: 기본값으로 둔다
  }

  const hint = () => globalThis.readglossGlossary?.hint(settings, document, location.hostname) ?? {};
  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  // 문맥에 안 싣는 요소: 화면에 안 보이는 것, 그리고 사용자가 입력한 글(입력창·textarea·select)
  const isHidden = (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || getComputedStyle(el).display === 'none';

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage({ ...message, page: { url: location.href.slice(0, 2000), title: document.title.slice(0, 200) } }); // page: 공부 기록용(T14)
    } catch {
      return { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }
  }

  // 사용자가 고른 글: 주석 뜻 글자(gloss)·번역 노드는 뺀다(range.toString() 은 rt 글자까지 섞는다).
  function selectedText(range) {
    const box = document.createElement('div');
    box.append(range.cloneContents());
    // 복제본은 문서 밖이라 getComputedStyle 이 안 먹는다: 폼 컨트롤만 태그로 뺀다(입력창을 가로질러 드래그해도 그 글이 섞이지 않게).
    return textOf(box, { isHidden: (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) });
  }

  // block 의 앞(dir -1)·뒤(dir 1) 블록 글. 형제를 따라가다 없으면 한 단계 위로. 문서 순서로 돌려준다. limit(기본 1500, 넓게는 6000)자가 모이면 멈춘다.
  // ponytail: 형제 하나가 한도의 4배(기본 6000자, 넓게는 24000자)를 넘으면(큰 래퍼) 거기서 멈춘다. 안으로 내려가 찾지는 않는다 -- 문맥이 짧아질 뿐이다.
  function neighbors(block, dir, limit = MAX_SIDE) {
    const out = [];
    let size = 0;
    let node = block;
    for (let guard = 0; guard < 60 && size < limit && node && node !== document.body && node !== document.documentElement; guard++) {
      const sib = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
      if (!sib) {
        node = node.parentElement;
        continue;
      }
      node = sib;
      if (textExceeds(sib, limit * 4)) break;
      const t = textOf(sib, { isHidden });
      if (!t) continue;
      out.push(t);
      size += t.length;
    }
    return dir < 0 ? out.reverse() : out;
  }

  // 선택 시작 위쪽의 h1~h3 (문서 순서, 가까운 것이 끝). 셋만 쓰니 요소를 먼저 고른 뒤 글을 뽑는다.
  function headingsAbove(node) {
    const found = [];
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (!(h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) break; // 문서 순서라 선택을 지나면 끝
      found.push(h);
    }
    return found.slice(-core.MAX_HEADINGS).map((h) => textOf(h, { isHidden }));
  }

  // [더 넓게 보기]용 페이지 목차: 문서 전체 h1~h3 중 20개(많으면 선택 근처). 선택 위쪽 제목 수를 세서 pickHeadings 에 맡긴다.
  function pageHeadings(node) {
    const all = [...document.querySelectorAll('h1, h2, h3')];
    const before = all.filter((h) => h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).length;
    return core.pickHeadings(all, before, core.WIDE_HEADINGS).map((h) => textOf(h, { isHidden }));
  }

  // 선택을 담은 글 블록 앞뒤와 제목·소제목 -> 다리에 싣는 context. 못 만들면 undefined(문맥 없이 번역). wide: [더 넓게 보기](앞뒤 6000자 + 페이지 목차 20개).
  function contextFor(range, wide = false) {
    try {
      const sc = range.startContainer;
      const ec = range.endContainer;
      const sb = blockOf(sc);
      const eb = blockOf(ec);
      const { head, tail } = around(sb, sc, range.startOffset, eb, ec, range.endOffset);
      const limit = wide ? WIDE_SIDE : MAX_SIDE;
      return buildContext({ prev: neighbors(sb, -1, limit), head, tail, next: neighbors(eb, 1, limit), title: document.title, headings: wide ? pageHeadings(sc) : headingsAbove(sc), wide });
    } catch {
      return undefined;
    }
  }
  globalThis.readglossContextFor = contextFor; // content.js 의 [AI 문맥 뜻] 도 같은 함수를 쓴다(DOM 을 만지므로 순수 모듈 readglossSelection 에는 붙이지 않는다)

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(label, aria, onclick) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onclick);
    return b;
  }

  // [내 사전에 추가] 한 벌(버튼 + 입력칸·저장·취소). 드래그 카드와 사전 카드(content.js)가 같이 쓴다.
  // key: 내 사전 키(mydictKey 를 통과한 것). spec(): 지금 기본값 { ko, exp?, note? }. resize(): 입력칸이 열리고 닫혀 카드 키가 달라질 때. onSaved(ko): 저장 뒤.
  // 반환: { btn, form, setHas(ko|null) }. btn 은 카드 안 버튼 줄에, form 도 그 줄 끝(한 줄 전체)에 넣는다.
  function createMydict({ key, spec, source = () => ({ url: location.href, title: document.title }), resize = () => {}, onSaved = () => {} }) {
    let has = null; // 내 사전에 있는 뜻
    const input = el('input', 'mdin');
    input.type = 'text';
    input.maxLength = 80;
    input.setAttribute('aria-label', '내 사전에 저장할 뜻');
    const err = el('div', 'mderr');
    err.hidden = true;
    err.setAttribute('role', 'status');
    const ok = button('저장', '내 사전에 저장', () => save());
    const no = button('취소', '내 사전 저장 취소', () => ((form.hidden = true), resize()));
    const form = el('div', 'mdform');
    form.hidden = true;
    form.append(input, ok, no, err);
    const btn = button('', '', () => open());
    const paint = () => {
      btn.textContent = has === null ? '내 사전에 추가' : '내 사전에 있음 ✓';
      btn.setAttribute('aria-label', has === null ? '내 사전에 추가' : '내 사전에 있음 ✓, 누르면 뜻 고치기');
      btn.classList.toggle('on', has !== null);
    };
    paint();
    const fail = (text) => ((err.hidden = false), (err.textContent = text), resize());
    function open() {
      if (!form.hidden) return void ((form.hidden = true), resize());
      input.value = has ?? spec().ko ?? '';
      err.hidden = true;
      form.hidden = false;
      resize();
      input.focus();
      input.select();
    }
    async function save() {
      if (ok.getAttribute('aria-disabled') === 'true') return;
      const ko = input.value.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!ko) return fail('뜻을 적어 주세요');
      ok.setAttribute('aria-disabled', 'true');
      const s = spec();
      const k = typeof key === 'function' ? key() : key; // 사전 카드는 다리가 준 원형(lemma)을 저장 때 읽는다
      const src = source(); // 사전 카드는 패널 저장 문장의 출처를, 드래그 카드는 지금 페이지를 (기본값)
      const r = await send(core.mydictMessage({ key: k, ko, exp: s.exp, note: s.note, url: src.url, title: src.title }));
      ok.removeAttribute('aria-disabled');
      if (!r?.entries) return fail(errText(r));
      has = ko;
      window.dispatchEvent(new CustomEvent('readgloss:mydict', { detail: { set: [k], delete: [] } })); // 이 페이지의 주석을 바로 바꾼다(annotate.js)
      form.hidden = true;
      err.hidden = true;
      paint();
      onSaved(ko);
      resize();
    }
    input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && save());
    // 닫힌 shadow 안 입력은 페이지에서 보면 호스트가 받은 키라, GitHub·YouTube 단축키가 같이 눌린다. 입력칸의 키는 밖으로 보내지 않는다(Escape 는 카드 닫기용으로 통과).
    for (const t of ['keydown', 'keypress', 'keyup']) input.addEventListener(t, (e) => e.key !== 'Escape' && e.stopPropagation());
    return { btn, form, setHas: (ko) => ((has = ko), paint()) };
  }
  globalThis.readglossMydict = { CSS: MD_CSS, create: createMydict }; // content.js 의 사전 카드도 클릭·그리기 때 참조한다(그쪽이 먼저 로드되므로 호출 때 읽는다)

  // ---- 기억할 표현 목록: "en — ko [☆]" 줄들. 드래그 카드(문맥 번역)와 문단 번역 블록(paragraph.js)이 같이 쓴다. ----
  let knownPhrases = {}; // 마지막으로 받은 단어장의 구·문장(★ 상태). 목록을 만들 때마다 다시 받는다
  const liveLists = new Set(); // 지금 떠 있는 목록들의 새로고침(같은 표현이 짧은·넓은 문맥 목록에 같이 있을 때 ★ 이 같이 바뀌게)
  const refreshLists = () => {
    for (const f of liveLists) f() || liveLists.delete(f);
  };
  // list: 응답의 expressions. sentence: 표현이 나온 원문(1000자까지 저장). inline: 페이지 글 사이에 끼우는 모양. onChange(): 높이가 달라질 때.
  // 반환: { el(없으면 null), rows }. 모든 글은 textContent 로만 넣는다.
  function createExpressions(list, { sentence = '', inline = false, onChange = () => {} } = {}) {
    const rows = core.expressionRows(list, knownPhrases);
    if (!rows.length) return { el: null, rows };
    const box = el('div', inline ? 'exps blk' : 'exps');
    const ul = el('ul');
    const err = el('div', 'exps-err');
    err.hidden = true;
    err.setAttribute('role', 'status');
    const items = rows.map((row) => {
      const text = el('span', 'exp-text');
      text.append(el('span', 'exp-en', row.en), ` — ${row.ko}`);
      const btn = el('button', 'star');
      btn.type = 'button';
      const li = el('li');
      li.append(text, btn);
      ul.append(li);
      const it = { row, btn };
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // 이 블록이 든 문단·링크의 페이지 동작에 닿지 않게
        e.preventDefault(); // 우리 버튼(type=button)이라 링크 안 카드의 <p> 안에 놓여도 따라가지 않는다. 페이지의 다른 클릭은 막지 않는다
        toggle(it);
      });
      return it;
    });
    const paint = () => {
      for (const { row, btn } of items) {
        const m = core.expressionButton(row.en, row.id != null);
        btn.textContent = m.text;
        btn.setAttribute('aria-label', m.label);
        btn.classList.toggle('on', row.id != null);
      }
    };
    const refresh = () => {
      for (const it of items) it.row.id = core.findPhrase(knownPhrases, it.row.en);
      paint();
      return box.isConnected; // 카드가 닫혔거나 문단 번역을 걷었으면 false -> 목록에서 뺀다
    };
    async function toggle(it) {
      if (it.btn.getAttribute('aria-disabled') === 'true') return;
      it.btn.setAttribute('aria-disabled', 'true');
      err.hidden = true;
      const saved = it.row.id != null;
      const r = await send(core.expressionToggle(it.row, { sentence, url: location.href, title: document.title }));
      it.btn.removeAttribute('aria-disabled');
      if (r && !r.error) {
        it.row.id = saved ? null : (r.id ?? core.findPhrase(r.phrases, it.row.en));
        if (r.phrases) knownPhrases = r.phrases;
        refreshLists();
        // 새로 저장했을 때만 확인 메시지(+메모). 카드·선택은 그대로 둔다(한 카드에서 여러 개를 고르니까).
        if (!saved && it.row.id != null) {
          const id = it.row.id;
          globalThis.readglossToast?.show({
            text: '단어장에 추가됐어요!',
            onMemo: (memo) => send({ type: 'words', op: 'memo', id, memo }),
          });
        }
      } else {
        err.hidden = false;
        err.textContent = errText(r);
      }
      paint();
      onChange();
    }
    box.append(el('div', 'exps-title', '기억할 표현'), ul, err);
    paint();
    liveLists.add(refresh);
    send({ type: 'words', op: 'get' }).then((s) => {
      if (!s?.known) return;
      knownPhrases = s.phrases ?? {};
      refreshLists();
    }, () => {});
    return { el: box, rows };
  }
  globalThis.readglossExpressions = { CSS: EXPR_CSS, create: createExpressions }; // paragraph.js 의 번역 블록도 클릭·그리기 때 참조한다(그쪽이 먼저 로드되므로 호출 때 읽는다)

  function close() {
    seq++;
    current = null;
    host?.remove();
    host = ui = null;
  }

  function place() {
    if (!host || !current) return;
    const a = current.anchor;
    const p = positionBubble({
      rect: { left: a.left - scrollX, top: a.top - scrollY, bottom: a.bottom - scrollY },
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollX, scrollY },
      size: ui.card.getBoundingClientRect(),
    });
    host.style.left = `${p.left}px`;
    host.style.top = `${p.top}px`;
  }

  // 문맥 번역 구역(제목 + 번역 + note). 처음엔 숨긴다.
  function section(title) {
    const box = el('div', 'ctx');
    box.hidden = true;
    const body = el('div', 'out', '');
    body.setAttribute('role', 'status');
    const note = el('div', 'note');
    const exps = el('div'); // 기억할 표현(있을 때만)
    box.append(el('div', 'ctx-title', title), body, note, exps);
    return { box, body, note, exps };
  }

  // text: 선택 원문(정리한 것). 너무 길면(long) 안내만 보인다. 모든 글은 textContent 로만 넣는다(innerHTML 금지).
  function build(text, long) {
    host = document.createElement('readgloss-selection');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; left: 0; top: 0;';
    applyTheme();
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = el('style');
    style.textContent = CSS;
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '번역');
    const scroll = el('div', 'scroll');
    scroll.tabIndex = 0;
    ui = { card };
    if (long) {
      scroll.append(el('div', 'msg', '너무 길어요(문단 번역 버튼을 써 주세요)'));
      card.append(scroll);
    } else {
      ui.mine = el('div', 'mine'); // "내 사전: 뜻" (내 사전에 있을 때만)
      ui.mine.hidden = true;
      ui.term = el('div', 'term');
      ui.out = el('div', 'out', '번역 중…');
      ui.out.setAttribute('role', 'status');
      ui.short = section('문맥 번역');
      ui.wide = section('넓은 문맥 번역');
      ui.notice = el('div', 'msg notice');
      ui.notice.hidden = true;
      ui.notice.setAttribute('role', 'status');
      scroll.append(ui.mine, el('div', 'src', text), ui.term, ui.out, ui.short.box, ui.wide.box, ui.notice);
      ui.ctxBtn = button('', '', () => askContext(core.stageButton('ctx', stage()).wide));
      ui.saveBtn = button('', '', () => togglePhrase());
      ui.saveBtn.setAttribute('aria-disabled', 'true'); // 단어장 상태를 받으면 켠다
      ui.scrapBtn = button('', '', () => toggleScrap());
      ui.copyBtn = button('복사', '번역문 복사', () => copy());
      const foot = el('div', 'foot');
      foot.append(ui.ctxBtn, ui.saveBtn, ui.scrapBtn);
      const key = core.mydictKey(text); // 키 규칙에 안 맞는 선택(너무 길거나 허용 밖 글자)은 [내 사전에 추가] 를 숨긴다
      if (key) {
        ui.md = createMydict({
          key,
          spec: () => ({ ko: core.bestMeaning({ wide: current?.wide, ctx: current?.ctx, mt: current?.mt, term: current?.termKo }), exp: current?.mine?.exp, note: current?.wide !== undefined ? current.wideNote : current?.ctxNote ?? current?.mine?.note }),
          resize: () => ui && place(),
          onSaved: (ko) => current && paintMine({ ...current.mine, ko }),
        });
        foot.append(ui.md.btn);
      }
      foot.append(ui.copyBtn);
      if (ui.md) foot.append(ui.md.form);

      // 밖 페이지 질문 상자: "지금 하는 '<제목>'에 넣을까요?" [넣기] [인박스]
      ui.askBox = el('div', 'ask-box');
      ui.askBox.hidden = true;
      ui.askText = el('div', 'ask-text');
      ui.askPutBtn = button('넣기', '지금 할 일에 넣기', () => answerAsk(true));
      ui.askInboxBtn = button('인박스', '인박스에 넣기', () => answerAsk(false));
      const askBtns = el('div', 'ask-btns');
      askBtns.append(ui.askPutBtn, ui.askInboxBtn);
      ui.askBox.append(ui.askText, askBtns);

      // 할 일 줄: → <할 일 제목> › <페이지 제목> › <가장 가까운 소제목>
      ui.taskRow = el('div', 'task-row');
      const arrow = el('span', 'task-arrow', '→ ');
      ui.taskBtn = el('button', 'task-btn', '짐작 중…');
      ui.taskBtn.type = 'button';
      ui.taskBtn.setAttribute('aria-label', '할 일 바꾸기');
      ui.taskBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTaskPicker();
      });
      ui.taskPath = el('span', 'task-path');
      ui.taskRow.append(arrow, ui.taskBtn, ui.taskPath);

      ui.taskPicker = el('div', 'task-picker');
      ui.taskPicker.hidden = true;

      card.append(scroll, foot, ui.askBox, ui.taskRow, ui.taskPicker);
      paintCtxBtn();
      paintSaveBtn();
      paintScrapBtn();
      paintTaskRow();
    }
    shadow.append(style, card);
    document.documentElement.append(host);
  }

  const stage = () => ({ done: current.ctx !== undefined, wide: current.wide !== undefined });

  function paintCtxBtn() {
    const m = core.stageButton('ctx', stage());
    ui.ctxBtn.hidden = m.hidden;
    ui.ctxBtn.textContent = m.text;
    ui.ctxBtn.setAttribute('aria-label', m.label);
  }

  function paintSaveBtn() {
    const m = globalThis.readglossWords.buttonModel({ saved: current.phraseId != null }).save;
    ui.saveBtn.textContent = m.text;
    ui.saveBtn.setAttribute('aria-label', m.label);
    ui.saveBtn.classList.toggle('on', current.phraseId != null);
  }

  // 내 사전에 있는 선택: 카드 맨 위 "내 사전: 뜻" 줄 + 버튼은 [내 사전에 있음 ✓]
  function paintMine(mine) {
    current.mine = mine;
    ui.mine.hidden = false;
    ui.mine.textContent = `내 사전: ${mine.ko}`;
    ui.md?.setHas(mine.ko);
    place();
  }

  function notify(text) {
    ui.notice.hidden = !text;
    ui.notice.textContent = text;
    place();
  }

  async function askMt() {
    const my = seq;
    const r = await send({ type: 'mt', text: current.text, ...hint() });
    if (my !== seq) return;
    if (r?.translation) {
      current.mt = r.translation;
      current.termKo = r.term?.ko;
      ui.out.textContent = r.translation;
      const line = globalThis.readglossGlossary?.termLine(r.term) ?? '';
      ui.term.textContent = line;
      ui.term.classList.toggle('on', line !== '');
    } else {
      ui.out.className = 'out err';
      ui.out.textContent = errText(r);
    }
    if (typeof r?.mine?.ko === 'string' && r.mine.ko) paintMine(r.mine);
    place();
  }

  // 단어장 상태(저장된 구)를 받아 버튼을 켠다. 못 받으면 꺼진 채로 둔다.
  async function loadPhraseState() {
    const my = seq;
    const s = await send({ type: 'words', op: 'get' });
    if (my !== seq || !s?.known) return;
    knownPhrases = s.phrases ?? {};
    current.phraseId = core.findPhrase(s.phrases, current.text);
    ui.saveBtn.removeAttribute('aria-disabled');
    paintSaveBtn();
  }

  async function togglePhrase() {
    if (ui.saveBtn.getAttribute('aria-disabled') === 'true') return;
    const my = seq;
    const saved = current.phraseId != null;
    ui.saveBtn.setAttribute('aria-disabled', 'true');
    notify('');
    const message = saved
      ? { type: 'words', op: 'unsave-phrase', id: current.phraseId }
      : core.phraseMessage({ text: current.text, mt: current.mt, ctx: current.wide ?? current.ctx, ctxNote: current.wide !== undefined ? current.wideNote : current.ctxNote, wide: current.wide !== undefined, url: location.href, title: document.title });
    const r = await send(message);
    if (my !== seq) return;
    ui.saveBtn.removeAttribute('aria-disabled');
    if (r && !r.error) {
      const id = saved ? null : (r.id ?? core.findPhrase(r.phrases, current.text));
      current.phraseId = id;
      if (r.phrases) knownPhrases = r.phrases;
      // 새로 저장했을 때만: 확인 메시지(+메모) -> 선택 해제 -> 카드 닫기. 빼기는 그대로.
      if (!saved) {
        globalThis.readglossToast?.show({
          text: '단어장에 추가됐어요!',
          onMemo: (memo) => send({ type: 'words', op: 'memo', id, memo }),
        });
        getSelection().removeAllRanges();
        close();
        return;
      }
    }
    else notify(errText(r));
    paintSaveBtn();
    place();
  }

  function paintScrapBtn() {
    if (!ui?.scrapBtn) return;
    const saved = current?.scrapId != null;
    ui.scrapBtn.textContent = saved ? '스크랩됨' : '스크랩';
    ui.scrapBtn.setAttribute('aria-label', saved ? '스크랩됨, 누르면 빼기' : '스크랩');
    ui.scrapBtn.classList.toggle('on', saved);
  }

  function paintTaskRow() {
    if (!ui?.taskBtn || !ui?.taskPath) return;
    ui.taskBtn.textContent = current?.taskTitle || (current?.task ? current.task : '인박스');
    const nearHeading = current?.range ? (headingsAbove(current.range.startContainer).at(-1) || '') : '';
    const pageTitle = document.title || '페이지';
    ui.taskPath.textContent = ` › ${pageTitle}${nearHeading ? ` › ${nearHeading}` : ''}`;
  }

  function toggleTaskPicker() {
    if (!ui?.taskPicker) return;
    ui.taskPicker.hidden = !ui.taskPicker.hidden;
    place();
  }

  function renderTaskPicker(candidates) {
    if (!ui?.taskPicker) return;
    ui.taskPicker.replaceChildren();
    const list = [...(candidates || [])];
    if (!list.some((c) => c.id === null)) {
      list.push({ id: null, title: '인박스' });
    }
    for (const item of list) {
      const b = el('button', 'task-item', item.title || item.id || '인박스');
      b.type = 'button';
      if (item.id === current?.task) b.classList.add('on');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        chooseTask(item.id, item.title || item.id || '인박스');
      });
      ui.taskPicker.append(b);
    }
  }

  function chooseTask(id, title) {
    if (!current) return;
    current.task = id;
    current.taskTitle = title;
    current.taskChosen = true;
    if (ui?.taskPicker) ui.taskPicker.hidden = true;
    paintTaskRow();
    place();
  }

  async function guessTask() {
    const my = seq;
    const r = await send({ type: 'scraps', op: 'guess', url: location.href });
    if (my !== seq || !r || !current) return;
    current.guess = r;
    if (!current.taskChosen) {
      current.task = r.task ?? null;
      const matched = r.candidates?.find((c) => c.id === r.task);
      current.taskTitle = matched ? matched.title : (r.task ?? '인박스');
    }
    paintTaskRow();
    renderTaskPicker(r.candidates);
  }

  const getStorage = () => globalThis.chrome?.['storage']?.local;

  async function toggleScrap() {
    if (!ui?.scrapBtn || ui.scrapBtn.getAttribute('aria-disabled') === 'true' || !current) return;
    const my = seq;
    const saved = current.scrapId != null;

    if (saved) {
      ui.scrapBtn.setAttribute('aria-disabled', 'true');
      notify('');
      const r = await send({ type: 'scraps', op: 'remove', id: current.scrapId });
      if (my !== seq) return;
      ui.scrapBtn.removeAttribute('aria-disabled');
      if (r && !r.error) {
        globalThis.readglossScrapPage?.unpaint(current.scrapId);
        current.scrapId = null;
        paintScrapBtn();
      } else {
        notify(errText(r));
      }
      return;
    }

    // 밖 페이지 질문: ask:true 이고 아직 직접 고르지 않았으며 후보 할 일이 있을 때
    if (!current.taskChosen && current.guess?.ask === true && current.task) {
      const dateStr = core.localDateStr();
      const askKey = core.scrapAskKey(dateStr, location.href);
      const storage = getStorage();
      if (storage) {
        try {
          const stored = await storage.get(askKey);
          const answer = stored?.[askKey];
          if (answer === 'inbox') {
            current.task = null;
            return saveScrap();
          } else if (answer) {
            return saveScrap();
          }
        } catch {
          // 조회 실패는 묻기로 진행
        }
      }
      ui.askText.textContent = `지금 하는 '${current.taskTitle || current.task}'에 넣을까요?`;
      ui.askBox.hidden = false;
      place();
      return;
    }

    saveScrap();
  }

  async function answerAsk(put) {
    if (!current) return;
    ui.askBox.hidden = true;
    place();
    const dateStr = core.localDateStr();
    const askKey = core.scrapAskKey(dateStr, location.href);
    const storage = getStorage();
    if (storage) {
      storage.set({ [askKey]: put ? 'task' : 'inbox' }).catch(() => {});
    }
    if (!put) current.task = null;
    saveScrap();
  }

  async function saveScrap() {
    if (!ui?.scrapBtn || ui.scrapBtn.getAttribute('aria-disabled') === 'true' || !current) return;
    const my = seq;
    ui.scrapBtn.setAttribute('aria-disabled', 'true');
    notify('');
    const headings = headingsAbove(current.range.startContainer);
    const translation = current.wide ?? current.ctx ?? current.mt ?? '';
    const message = core.scrapMessage({
      url: location.href,
      title: document.title,
      headings,
      quote: current.quote,
      pos: current.pos,
      translation,
      task: current.task,
    });
    const r = await send(message);
    if (my !== seq) return;
    ui.scrapBtn.removeAttribute('aria-disabled');
    if (r && !r.error) {
      const list = Array.isArray(r.scraps) ? r.scraps : [];
      const normUrl = core.normalizeUrl(location.href);
      const saved = list.find((s) => s.url === normUrl && s.quote?.exact === current.quote?.exact) || list.at(-1);
      const id = saved?.id;
      current.scrapId = id;
      globalThis.readglossScrapPage?.paint(list);
      globalThis.readglossToast?.show({
        text: '스크랩했어요',
        onMemo: (memo) => send({ type: 'scraps', op: 'memo', id, memo }),
      });
      getSelection().removeAllRanges();
      close();
      return;
    }
    notify(errText(r));
    paintScrapBtn();
    place();
  }

  // wide: [더 넓게 보기] 단계. 앞 결과(문맥 번역)는 남기고 "넓은 문맥 번역" 구역에 보탠다.
  async function askContext(wide) {
    if (ui.ctxBtn.getAttribute('aria-disabled') === 'true') return;
    const my = seq;
    const sec = wide ? ui.wide : ui.short;
    ui.ctxBtn.setAttribute('aria-disabled', 'true');
    sec.box.hidden = false;
    sec.body.className = 'out';
    sec.body.textContent = wide ? '글 앞뒤와 목차를 넓게 보고 번역 중…' : '번역 중…';
    sec.note.textContent = '';
    sec.exps.replaceChildren();
    place();
    const r = await send({ type: 'translate-context', text: current.text, context: contextFor(current.range, wide), wide, ...hint() });
    if (my !== seq) return;
    ui.ctxBtn.removeAttribute('aria-disabled');
    if (r?.translation) {
      sec.body.textContent = r.translation;
      const list = createExpressions(r.expressions, { sentence: current.text, onChange: place });
      if (list.el) sec.exps.append(list.el);
      sec.note.textContent = core.noteText(r.note, list.rows); // note 는 표현이 없을 때만(겹침 방지)
      if (wide) [current.wide, current.wideNote] = [r.translation, r.note ?? ''];
      else [current.ctx, current.ctxNote] = [r.translation, r.note ?? ''];
    } else {
      sec.body.className = 'out err';
      sec.body.textContent = errText(r);
    }
    paintCtxBtn();
    place();
  }

  // 가장 마지막에 얻은 번역(넓은 문맥 > 문맥 > 맥 번역)을 클립보드로. 실패하면 조용히 둔다.
  async function copy() {
    const text = current.wide ?? current.ctx ?? current.mt;
    if (!text) return;
    const my = seq;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    if (my !== seq) return;
    ui.copyBtn.textContent = '복사됨';
    setTimeout(() => my === seq && ui && (ui.copyBtn.textContent = '복사'), 1200);
  }

  const isUi = (n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-'); // 카드·패널·버튼·번역문

  function onSelect(path) {
    const sel = getSelection();
    if (!settings.selectionTranslate || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const root = elementOf(range.commonAncestorContainer);
    const active = document.activeElement;
    if (!root || root.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') || root.isContentEditable) return;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName)) && active.contains(root)) return;
    if (path.some(isUi) || isUi(root.closest('[data-readgloss]:not([data-readgloss="ann"]):not([data-readgloss="gloss"])'))) return;
    if (sel.toString().length > MAX_RAW) return;
    const text = selectedText(range);
    const cls = classify(text);
    if (cls.kind === 'none') return;
    const r = range.getBoundingClientRect();
    if (cls.kind === 'word') {
      const block = blockOf(range.startContainer);
      const { text: plain, offset } = plainTextAt(block, range.startContainer, range.startOffset);
      const at = plain.indexOf(cls.word, offset);
      const sentence = extractSentence(plain, at < 0 ? offset : at, cls.word.length);
      // drag:true -> content.js 가 이 카드의 사전 조회에 nolog 를 실어 공부 기록에 남기지 않는다(더블클릭은 남긴다).
      window.dispatchEvent(new CustomEvent('readgloss:lookup', { detail: { word: cls.word, sentence, rect: { left: r.left, top: r.top, bottom: r.bottom }, range: range.cloneRange(), drag: true } }));
      return;
    }
    if (host) close();
    const scrapPage = globalThis.readglossScrapPage;
    const qInfo = scrapPage?.quoteForRange ? scrapPage.quoteForRange(range) : null;
    const quote = qInfo?.quote ?? { exact: cls.text, prefix: '', suffix: '' };
    const pos = qInfo?.pos ?? 0;
    const existingScrap = scrapPage?.findExisting ? scrapPage.findExisting(cls.text) : null;
    current = {
      text: cls.text,
      range: range.cloneRange(),
      anchor: { left: r.left + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY },
      quote,
      pos,
      scrapId: existingScrap ? existingScrap.id : null,
      task: null,
      taskTitle: '',
      taskChosen: false,
      guess: null,
    };
    build(cls.text, cls.kind === 'long');
    place();
    if (cls.kind === 'phrase') {
      askMt().catch(close);
      loadPhraseState().catch(() => {});
      guessTask().catch(() => {});
    }
  }

  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0 || e.detail !== 1) return; // 더블클릭(detail 2)은 content.js 의 사전 카드가 처리한다
      const path = e.composedPath();
      setTimeout(() => {
        try {
          onSelect(path);
        } catch {
          // 페이지를 깨뜨리지 않는다
        }
      }, 0); // 선택이 확정된 뒤(이미 고른 글을 다시 눌러 지워지는 경우 포함)에 읽는다
    },
    true,
  );
  document.addEventListener('mousedown', (e) => host && !e.composedPath().includes(host) && !e.composedPath().some((n) => n.localName === 'readgloss-toast') && close(), true); // 확인 메시지(메모)를 누를 땐 카드를 닫지 않는다
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && host && !e.composedPath().some((n) => n.localName === 'readgloss-toast')) close();
      if (host && e.code === 'KeyS' && e.altKey) {
        e['preventDefault']?.();
        toggleScrap();
      }
    },
    true,
  );
})();
