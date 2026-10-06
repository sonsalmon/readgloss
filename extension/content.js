// 더블클릭 -> 사전 카드. DOM 접착만 한다. 판단 로직은 text.js(globalThis.readgloss)에 있다.
(() => {
  const { cleanSelection, extractSentence, positionBubble, plainTextAt, BLOCKED_SELECTOR } = globalThis.readgloss;

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요',
    'ai-failed': '뜻을 가져오지 못했어요. 다시 시도해 주세요',
    'dict-unavailable': '맥 사전 도우미가 아직 없어요. 터미널에서 cd ~/dev/readgloss && npm run build:dict 를 실행해 주세요',
    'dict-failed': '사전을 읽지 못했어요. 다시 시도해 주세요',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };

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
    .term { display: none; padding: 10px 16px 0; color: var(--rg-accent); font-size: 12px; font-weight: 600; word-break: keep-all; overflow-wrap: anywhere; }
    .term.on { display: block; }
    .scroll { max-height: 360px; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 8px; }
    .scroll:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: -2px; }
    .msg { color: var(--rg-muted); padding-bottom: 6px; word-break: keep-all; overflow-wrap: anywhere; }
    .entry + .entry { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--rg-border); }
    .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
    .hnum { display: inline-grid; place-items: center; min-width: 18px; height: 18px; border-radius: 9px; background: var(--rg-accent-soft);
      color: var(--rg-accent); font-size: 11px; font-weight: 700; align-self: center; }
    .hw { font-size: 18px; font-weight: 700; }
    .pron { color: var(--rg-muted); font-size: 13px; }
    .etym { color: var(--rg-muted); font-size: 12px; margin-top: 2px; }
    .posrow { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
    .pos { padding: 0 8px; border-radius: 10px; background: var(--rg-accent-soft); color: var(--rg-accent); font-size: 12px; font-weight: 600; }
    .posnote { color: var(--rg-muted); font-size: 12px; }
    .sense { display: flex; gap: 6px; margin-top: 4px; }
    .num { flex: none; min-width: 1.4em; color: var(--rg-muted); font-variant-numeric: tabular-nums; }
    .stext { min-width: 0; word-break: keep-all; overflow-wrap: anywhere; }
    .ex { color: var(--rg-muted); font-size: 12.5px; margin-top: 2px; }
    .ai { margin: 2px 12px 0; padding: 6px 10px; border-radius: 8px; background: var(--rg-accent-soft); font-size: 13px; }
    .ai[hidden] { display: none; }
    .ai.err { background: none; color: var(--rg-muted); padding-left: 0; }
    .ai + .ai { margin-top: 6px; }
    .tops { display: flex; flex-direction: column; gap: 6px; padding: 10px 16px 0; }
    .tops[hidden] { display: none; }
    .tops .mine, .tops .acr { margin-bottom: 0; }
    .btn[hidden] { display: none; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px 12px; }
    .btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 10px; border-radius: 7px; border: 1px solid var(--rg-border);
      color: var(--rg-fg); font-size: 12.5px; line-height: 1.6; }
    .btn:hover { background: var(--rg-accent-soft); border-color: var(--rg-accent); color: var(--rg-accent); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .btn[aria-disabled="true"] { opacity: .55; cursor: default; }
  `;

  // 테마(설정 'theme'): auto 면 속성 없이 prefers-color-scheme, light·dark 면 호스트에 data-theme 로 강제
  let theme = 'auto';
  let glossary = 'auto'; // 설정 '분야 용어집'. 'off' 면 사전 요청에 host·domains 를 싣지 않는다
  let glossarySites = globalThis.readglossSettings?.DEFAULTS.glossarySites ?? []; // 용어집을 켤 사이트(설정을 읽기 전에는 기본 목록)
  try {
    globalThis.readglossSettings.load().then((s) => { theme = s.theme; glossary = s.glossary; glossarySites = s.glossarySites; }, () => {});
    globalThis.readglossSettings.onChange((s) => {
      theme = s.theme;
      glossary = s.glossary;
      glossarySites = s.glossarySites;
      if (host) applyTheme();
    });
  } catch { /* 설정을 못 읽으면 자동 */ }
  const applyTheme = () => (theme === 'auto' ? host.removeAttribute('data-theme') : host.setAttribute('data-theme', theme));

  let host = null;
  let ui = null; // { card, scroll, ai, aiBtn, saveBtn, knownBtn }
  let seq = 0; // 닫거나 새로 열 때마다 올려서 늦게 온 응답을 버린다
  let current = null; // { word, sentence, anchor, ai, aiWide, lemma, gloss, state, mine, acr, termKo, senseKo, firstSense }  lemma·gloss 는 /dict 응답, state 는 /words 응답, ai·aiWide 는 AI 문맥 뜻(짧은·넓은)

  // 사전·AI 가 준 글은 textContent 로만 넣는다(innerHTML 금지).
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildCard() {
    host = document.createElement('readgloss-card');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; left: 0; top: 0;';
    applyTheme();
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = el('style');
    style.textContent = CSS + (globalThis.readglossMydict?.CSS ?? ''); // 내 사전 입력칸 모양은 selection.js 가 올려 둔 것(그쪽이 나중에 로드돼도 카드는 사용자가 열 때 만든다)
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `${current.word} 사전`);
    const tops = el('div', 'tops'); // 카드 맨 위: "내 사전: 뜻"·약어 줄
    tops.hidden = true;
    const mine = el('div', 'mine');
    mine.hidden = true;
    const acr = el('div', 'acr');
    acr.hidden = true;
    tops.append(mine, acr);
    const scroll = el('div', 'scroll');
    scroll.tabIndex = 0;
    const term = el('div', 'term'); // 분야 용어집 뜻("용어: 전치(행렬) · 수학") 또는 사전의 분야 표시 뜻("분야 뜻: 곱셈 · 수학"). 사전 결과가 오면 채운다
    const ai = el('div', 'ai');
    ai.hidden = true;
    ai.setAttribute('role', 'status');
    const aiWide = el('div', 'ai'); // [더 넓게 보기] 결과(앞 결과는 남긴다)
    aiWide.hidden = true;
    aiWide.setAttribute('role', 'status');

    const foot = el('div', 'foot');
    const aiBtn = el('button', 'btn');
    aiBtn.type = 'button';
    aiBtn.addEventListener('click', () => current && askAi());
    const naver = el('a', 'btn', '네이버에서 열기');
    naver.href = `https://en.dict.naver.com/#/search?query=${encodeURIComponent(current.word)}`;
    naver.target = '_blank';
    naver.rel = 'noopener noreferrer';
    naver.setAttribute('aria-label', '네이버 사전에서 열기(새 탭)');
    const mkWordBtn = (key) => {
      const b = el('button', 'btn');
      b.type = 'button';
      b.setAttribute('aria-disabled', 'true'); // 사전 결과(원형)가 오면 켠다
      b.addEventListener('click', () => current && toggleWord(key));
      return b;
    };
    const saveBtn = mkWordBtn('save');
    const knownBtn = mkWordBtn('known');
    foot.append(saveBtn, knownBtn, aiBtn);
    ui = { card, tops, mine, acr, term, scroll, ai, aiWide, aiBtn, saveBtn, knownBtn };
    const md = globalThis.readglossMydict;
    const key = globalThis.readglossSelection.mydictKey(current.word); // 키 규칙에 안 맞으면 [내 사전에 추가] 를 숨긴다
    if (md && key) {
      ui.md = md.create({
        key,
        spec: () => ({
          ko: globalThis.readglossSelection.bestMeaning({ wide: current?.aiWide, ai: current?.ai, acr: current?.acr?.ko, term: current?.termKo, sense: current?.senseKo, first: globalThis.readglossSelection.firstMeaning(current?.firstSense) }),
          exp: current?.acr?.exp ?? current?.mine?.exp,
          note: current?.mine?.note,
        }),
        resize: () => current && place(),
        onSaved: (ko) => current && paintMine({ ...current.mine, ko }),
      });
      foot.append(ui.md.btn);
    }
    foot.append(naver);
    if (ui.md) foot.append(ui.md.form);

    card.append(tops, term, scroll, ai, aiWide, foot);
    shadow.append(style, card);
    document.documentElement.append(host);
    paintAiBtn();
    paintWordButtons();
  }

  function place() {
    const a = current.anchor;
    const rect = { left: a.left - scrollX, top: a.top - scrollY, bottom: a.bottom - scrollY };
    const size = ui.card.getBoundingClientRect();
    const p = positionBubble({
      rect,
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollX, scrollY },
      size,
    });
    host.style.left = `${p.left}px`;
    host.style.top = `${p.top}px`;
  }

  function showMessage(text) {
    ui.scroll.replaceChildren(el('div', 'msg', text));
    place();
  }

  // 표제어별 블록: 머리(번호·표제어·발음) / 품사 배지 + 번호 뜻 / 예문
  function renderEntries(entries) {
    const multi = entries.length > 1;
    const blocks = entries.map((e, i) => {
      const box = el('section', 'entry');
      const head = el('div', 'head');
      if (multi) head.append(el('span', 'hnum', String(e.homograph || i + 1)));
      head.append(el('span', 'hw', e.headword || current.word));
      if (e.pron) head.append(el('span', 'pron', e.pron));
      box.append(head);
      if (e.etym) box.append(el('div', 'etym', e.etym));
      let lastKey = null;
      for (const s of e.senses ?? []) {
        const key = `${s.pos}|${s.posNote}`;
        if (key !== lastKey) {
          lastKey = key;
          if (s.pos || s.posNote) {
            const row = el('div', 'posrow');
            if (s.pos) row.append(el('span', 'pos', s.pos));
            if (s.posNote) row.append(el('span', 'posnote', s.posNote));
            box.append(row);
          }
        }
        const line = el('div', 'sense');
        if (s.num != null) line.append(el('span', 'num', `${s.num}.`));
        const body = el('div', 'stext', s.text);
        for (const ex of s.examples ?? []) body.append(el('div', 'ex', ex));
        line.append(body);
        box.append(line);
      }
      return box;
    });
    ui.scroll.replaceChildren(...blocks);
    place();
  }

  // 카드의 단어장·알아요 버튼. 문구·동작 판단은 panel-words.js 의 순수 함수(readglossWords.buttonModel)가 한다.
  function paintWordButtons() {
    const m = globalThis.readglossWords.buttonModel({ saved: !!current.state?.saved[current.lemma], known: !!current.state?.known[current.lemma] });
    for (const [btn, b] of [[ui.saveBtn, m.save], [ui.knownBtn, m.known]]) {
      btn.textContent = b.text;
      btn.setAttribute('aria-label', b.label);
      if (current.state) btn.removeAttribute('aria-disabled');
    }
  }

  async function toggleWord(key) {
    if (!current.state || ui[`${key}Btn`].getAttribute('aria-disabled') === 'true') return;
    const W = globalThis.readglossWords;
    const my = seq;
    const op = W.buttonModel({ saved: !!current.state.saved[current.lemma], known: !!current.state.known[current.lemma] })[key].op;
    ui[`${key}Btn`].setAttribute('aria-disabled', 'true');
    const r = await send(W.messageFor(op, { lemma: current.lemma, word: current.word, gloss: current.gloss, sentence: current.sentence, url: location.href.slice(0, 2000) }));
    if (my !== seq) return;
    if (r?.known && r.saved) {
      current.state = r;
      const detail = W.eventDetail(op, current.lemma);
      if (detail) window.dispatchEvent(new CustomEvent('readgloss:words', { detail })); // 이 페이지의 주석을 바로 걷거나 되살린다
    } else {
      ui.ai.hidden = false;
      ui.ai.className = 'ai err';
      ui.ai.textContent = MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;
    }
    paintWordButtons();
    place();
  }

  // 사전 결과가 오면: 원형을 받아 두고, 최근 찾은 단어에 조용히 남기고(실패해도 카드는 그대로), 단어장·알아요 상태를 받아 버튼을 켠다.
  async function loadWordState(r, my) {
    current.lemma = r.lemma;
    current.gloss = r.gloss ?? '';
    if (r.found) send({ type: 'words', op: 'history', lemma: r.lemma, word: current.word, gloss: current.gloss, sentence: current.sentence, url: location.href.slice(0, 2000) }).catch(() => {});
    const s = await send({ type: 'words', op: 'get' });
    if (my !== seq || !s?.known) return; // 상태를 못 받으면 버튼은 꺼진 채로 둔다
    current.state = s;
    paintWordButtons();
  }

  function close() {
    seq++;
    current = null;
    host?.remove();
    host = ui = null;
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage({ ...message, page: { url: location.href.slice(0, 2000), title: document.title.slice(0, 200) } }); // page: 공부 기록용(T14)
    } catch {
      return { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }
  }

  async function askDict() {
    const my = ++seq;
    showMessage('찾는 중…');
    const r = await send({ type: 'dict', word: current.word, ...(globalThis.readglossGlossary?.hint({ glossary, glossarySites }, document, location.hostname) ?? {}) });
    if (my !== seq) return;
    const line = (globalThis.readglossGlossary?.termLine(r?.term) ?? '') || (r?.sense?.ko ? `분야 뜻: ${r.sense.ko} · ${r.sense.tag}` : ''); // 용어가 없을 때만 다리가 준 분야 표시 뜻(sense)
    ui.term.textContent = line;
    ui.term.classList.toggle('on', line !== '');
    current.termKo = r?.term?.ko;
    current.senseKo = r?.sense?.ko;
    current.firstSense = r?.entries?.[0]?.senses?.[0]?.text; // [내 사전에 추가] 의 마지막 기본 뜻 후보
    if (typeof r?.mine?.ko === 'string' && r.mine.ko) paintMine(r.mine);
    if (globalThis.readglossSelection.isAcronym(current.word)) showAcronym(r, my).catch(() => {});
    if (r?.found && r.entries?.length) renderEntries(r.entries);
    else if (r?.found === false) showMessage('사전에 없어요');
    else showMessage(MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`);
    if (typeof r?.lemma === 'string') loadWordState(r, my).catch(() => {});
  }

  // 사전 카드 맨 위 줄들(내 사전·약어)은 하나라도 있으면 보인다.
  const paintTops = () => (ui.tops.hidden = ui.mine.hidden && ui.acr.hidden);

  // 내 사전에 있는 단어: 카드 맨 위 "내 사전: 뜻" + 버튼은 [내 사전에 있음 ✓]
  function paintMine(mine) {
    current.mine = mine;
    ui.mine.hidden = false;
    ui.mine.textContent = `내 사전: ${mine.ko}`;
    ui.md?.setHas(mine.ko);
    paintTops();
    place();
  }

  function paintAcronym() {
    const a = current.acr;
    const line = a ? globalThis.readglossSelection.acronymLine({ word: current.word, ...a }) : '';
    ui.acr.hidden = line === '';
    ui.acr.textContent = line;
    paintTops();
    place();
  }

  // 페이지 글 전체(너무 크면 단어가 있는 블록)에서 "(PCA)" 앞의 풀이를 찾는다.
  // ponytail: 대문자 약어를 더블클릭할 때마다 본문을 한 번 훑는다(40만 자까지). 느려지면 첫 결과를 페이지별로 캐시한다.
  function pageExpansion(word) {
    const { textOf, textExceeds } = globalThis.readglossParagraph;
    const isHidden = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName);
    const root = textExceeds(document.body, 400_000) ? blockOf(current.range?.startContainer ?? document.body) : document.body;
    return globalThis.readglossSelection.expandAcronym(textOf(root, { isHidden }), word);
  }

  // 전부 대문자 2~6자(PCA)면 약어 줄: 내 사전·약어집의 풀이, 없으면 페이지 글에서 찾은 풀이와 그 맥 번역.
  async function showAcronym(r, my) {
    const exp = r?.mine?.exp ?? r?.acronym?.exp; // 내 사전이 먼저
    if (exp) {
      current.acr = { exp, ko: r.mine?.ko ?? r.acronym?.ko };
      return paintAcronym();
    }
    const found = pageExpansion(current.word);
    if (!found) return;
    current.acr = { exp: found, page: true };
    paintAcronym();
    const t = await send({ type: 'mt', text: found, ...(globalThis.readglossGlossary?.hint({ glossary, glossarySites }, document, location.hostname) ?? {}) });
    if (my !== seq || !t?.translation) return;
    current.acr.ko = t.translation;
    paintAcronym();
  }

  function paintAiBtn() {
    const m = globalThis.readglossSelection.stageButton('ai', { done: current.ai !== undefined, wide: current.aiWide !== undefined });
    ui.aiBtn.hidden = m.hidden;
    ui.aiBtn.textContent = m.text;
    ui.aiBtn.setAttribute('aria-label', m.label);
  }

  // [AI 문맥 뜻] -> 결과 뒤 [더 넓게 보기](글 앞뒤 6000자 + 목차) -> 숨김. 앞 결과는 남기고 아래에 넓은 결과를 보탠다.
  async function askAi() {
    if (ui.aiBtn.getAttribute('aria-disabled') === 'true') return;
    const my = seq;
    const wide = globalThis.readglossSelection.stageButton('ai', { done: current.ai !== undefined, wide: current.aiWide !== undefined }).wide;
    const box = wide ? ui.aiWide : ui.ai;
    ui.aiBtn.setAttribute('aria-disabled', 'true');
    box.hidden = false;
    box.className = 'ai';
    box.textContent = wide ? '글 앞뒤와 목차를 넓게 보고 찾는 중…' : '가져오는 중…';
    place();
    const context = current.range && globalThis.readglossContextFor?.(current.range, wide); // selection.js 가 나중에 로드되므로 호출 때 참조한다
    const r = await send({ type: 'lookup', word: current.word, sentence: current.sentence, wide, ...(context && { context }) });
    if (my !== seq) return;
    ui.aiBtn.removeAttribute('aria-disabled');
    if (r?.gloss) {
      box.textContent = `${wide ? '넓은 문맥 · ' : ''}${current.word}: ${r.gloss}`;
      current[wide ? 'aiWide' : 'ai'] = r.gloss;
    } else {
      box.className = 'ai err';
      box.textContent = MESSAGES[r?.error] ?? `문제가 생겼어요(${r?.error ?? '응답 없음'})`;
    }
    paintAiBtn();
    place();
  }

  function elementOf(node) {
    return node?.nodeType === 1 ? node : node?.parentElement;
  }

  // 글자가 놓인 가장 가까운 블록 상자(문장을 뽑을 범위)
  function blockOf(node) {
    for (let el = elementOf(node); el && el !== document.body; el = el.parentElement) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && !d.startsWith('ruby') && d !== 'contents') return el; // 자동 주석의 ruby(display: ruby)는 글 블록이 아니다
    }
    return document.body;
  }

  globalThis.readglossBlockOf = blockOf; // selection.js(드래그 번역)가 같은 블록 판정을 쓴다

  function onDblClick(e) {
    if (host && e.composedPath().includes(host)) return; // 카드 안
    if (e.composedPath().some((n) => n.localName === 'readgloss-ui')) return; // 떠 있는 버튼·패널 안
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = elementOf(range.commonAncestorContainer);
    const target = elementOf(e.target);
    if (!el || el.isContentEditable || el.closest(BLOCKED_SELECTOR) || target?.closest(BLOCKED_SELECTOR)) return;
    const picked = cleanSelection(sel.toString());
    if (!picked) return;

    const block = blockOf(range.startContainer);
    const { text, offset } = plainTextAt(block, range.startContainer, range.startOffset); // 자동 주석의 rt 글자는 문장에 섞지 않는다
    const sentence = extractSentence(text, offset + picked.start, picked.word.length);
    openCard(picked.word, sentence, range.getBoundingClientRect(), range);
  }

  // rect: 뷰포트 좌표의 단어 사각형. range: 단어를 담은 선택(AI 문맥 뜻이 앞뒤 문맥을 뽑을 때 쓴다).
  function openCard(word, sentence, r, range) {
    if (host) close();
    current = { word, sentence, range: range?.cloneRange(), anchor: { left: r.left + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY } };
    buildCard();
    askDict().catch(close); // 동기적으로 "찾는 중…" 부터 그린다
  }

  // 드래그 번역(selection.js)이 한 단어를 드래그하면 더블클릭과 같은 사전 카드를 그 자리에 연다.
  window.addEventListener('readgloss:lookup', (e) => {
    const d = e.detail;
    if (!globalThis.readgloss.isEnglishWord(d?.word) || typeof d.sentence !== 'string' || ![d.rect?.left, d.rect?.top, d.rect?.bottom].every(Number.isFinite)) return;
    try {
      openCard(d.word, d.sentence, d.rect, d.range);
    } catch {
      // 페이지를 깨뜨리지 않는다
    }
  });

  document.addEventListener(
    'dblclick',
    (e) => {
      try {
        onDblClick(e);
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
    },
    true,
  );
  document.addEventListener('mousedown', (e) => host && !e.composedPath().includes(host) && close(), true);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && host && close(), true);
})();
