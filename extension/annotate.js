// 어려운 단어 자동 주석: 화면 근처 글 블록에 겹침 층(overlay)과 Custom Highlight API 로 뜻과 표시를 그린다.
// 페이지 DOM(글자·요소)을 바꾸지 않는다.
(() => {
  const core = globalThis.readglossAnnotate;
  const S = globalThis.readglossSettings;
  const G = globalThis.readglossGlossary; // 분야 용어집 힌트(host·domains). 없어도 주석은 그대로 동작한다
  if (!core || !S || !globalThis.chrome?.runtime?.id) return;
  const { MAX_WORDS, MAX_ACRONYMS, blockCandidates, chunk, annotating, structuralKey, planBlock, applyWords, mydictKeys } = core;

  const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption';
  // 건드리지 않는 곳: 코드·입력창·편집 영역·우리가 넣은 노드(번역 블록 등)
  const EXCLUDE = 'pre, kbd, samp, script, style, noscript, template, textarea, input, select, button, svg, [contenteditable]:not([contenteditable="false"]), [data-readgloss]';
  const FLUSH_MS = 50; // 한꺼번에 들어온 블록을 한 요청으로 묶는 시간
  const MUTATION_MS = 300;
  const RETRY_MS = 30_000; // 다리가 꺼져 있으면 이만큼 쉬고 다시 시도한다(최대 MAX_RETRIES 번 연속)
  const MAX_RETRIES = 3;

  const ACCENT = '#2f6feb';
  const ACCENT_DARK = '#6b9bff';
  const WEIGHT_MAP = { light: 300, normal: 400, bold: 600 };

  let settings = S.normalize({}); // 저장소에서 읽기 전에는 기본값(읽기 전에는 sync 를 안 부른다)
  let pageOff = globalThis.readglossPageOff === true; // 이 페이지만 끄기
  let running = false; // 관찰 중(= 이 페이지에서 지금 자동 주석이 켜져 있다)
  let appliedKey = null; // 마지막으로 그린 구조 값(structuralKey)
  let epoch = 0; // 다시 그리거나 끌 때마다 올려서, 늦게 돌아온 요청 결과를 버린다
  let loaded = false; // 저장된 설정을 읽었다
  let dead = false; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
  let retries = 0;
  let offUntil = 0;
  let io = null;
  let mo = null;
  let ro = null;
  let rafId = 0;
  let flushTimer = 0;
  let mutationTimer = 0;
  let done = new WeakSet(); // 처리한 블록
  const pending = new Set(); // 화면 근처에 들어와 처리를 기다리는 블록
  const dirty = new Set(); // 글이 바뀐 블록
  const nearBlocks = new Set(); // 화면 근처 블록
  const entriesByBlock = new Map(); // block -> entry[{ node, text, start, end, lemma, gloss, range, label }]
  const cache = Object.create(null); // 낱말 -> { lemma, gloss } | null
  let cacheLevel = settings.level;
  let cacheHint = ''; // 캐시를 채울 때의 용어집 힌트 키
  const state = { pageSeen: new Set(), skip: new Set() }; // pageSeen: 이미 주석 붙인 원형, skip: 아는 단어 원형

  let layerHost = null;
  let layerShadow = null;
  let highlightSheet = null;
  let highlightStyleEl = null;

  const elementOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement);

  // 겹침 층 호스트 요소(readgloss-ann-layer)를 documentElement 에 준비한다
  function ensureLayer() {
    if (layerHost && layerHost.isConnected) return;
    layerHost = document.createElement('readgloss-ann-layer');
    layerHost.setAttribute('data-readgloss', 'layer');
    layerHost.style.cssText = 'all:initial; position:fixed; inset:0; pointer-events:none; z-index:2147483646;';
    layerShadow = layerHost.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = ':host { all: initial; } span { position: fixed; pointer-events: none; user-select: none; white-space: nowrap; line-height: 1; }';
    layerShadow.append(st);
    (document.documentElement || document.body)?.append(layerHost);
  }

  // mark 설정에 맞춰 ::highlight(readgloss-ann) 스타일시트를 붙인다
  function applyHighlightStyle(s) {
    const dark = core.isDarkColor
      ? core.isDarkColor(
          typeof getComputedStyle === 'function' && document.body ? getComputedStyle(document.body).color : '',
          typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
        )
      : false;
    const css = core.highlightCss ? core.highlightCss(s, dark) : '';
    try {
      if (typeof CSSStyleSheet === 'function') {
        if (!highlightSheet) {
          highlightSheet = new CSSStyleSheet();
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
        }
        highlightSheet.replaceSync(css);
        return;
      }
    } catch {
      // adoptedStyleSheets 미지원 환경은 style 엘리먼트로 대체
    }
    if (!highlightStyleEl) {
      highlightStyleEl = document.createElement('style');
      highlightStyleEl.setAttribute('data-readgloss', 'highlight');
      (document.head ?? document.documentElement).append(highlightStyleEl);
    }
    highlightStyleEl.textContent = css;
  }

  // CSS.highlights 에 현재 등록된 모든 단어 범위를 등록/삭제한다
  function updateHighlights() {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    if (!running || settings.mark === 'none') {
      CSS.highlights.delete('readgloss-ann');
      return;
    }
    const ranges = [];
    for (const list of entriesByBlock.values()) {
      for (const e of list) {
        if (e.range) ranges.push(e.range);
      }
    }
    if (ranges.length > 0) {
      CSS.highlights.set('readgloss-ann', new Highlight(...ranges));
    } else {
      CSS.highlights.delete('readgloss-ann');
    }
  }

  // 블록에 딸린 뜻 글자(label) 노드들을 지우고 맵에서 뺀다
  function clearBlockEntries(block) {
    const list = entriesByBlock.get(block);
    if (!list) return;
    for (const e of list) {
      if (e.label) e.label.remove();
    }
    entriesByBlock.delete(block);
  }

  // 모든 블록의 뜻 글자와 하이라이트를 지운다
  function clearAllEntries() {
    for (const list of entriesByBlock.values()) {
      for (const e of list) {
        if (e.label) e.label.remove();
      }
    }
    entriesByBlock.clear();
    updateHighlights();
  }

  // block 에 속한 텍스트 노드
  function textNodesOf(block) {
    const out = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (p && /[A-Za-z]/.test(n.nodeValue) && !p.closest(EXCLUDE) && p.closest(BLOCK) === block) out.push(n);
    }
    return out;
  }

  // 다리에 /annotate 요청
  async function request(words, hint, acronyms = []) {
    if (dead || Date.now() < offUntil) return null;
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: 'annotate', words, ...(acronyms.length && { acronyms }), level: settings.level, ...hint });
    } catch {
      dead = true;
      stop();
      return null;
    }
    if (!r?.items) {
      offUntil = Date.now() + RETRY_MS;
      return null;
    }
    return r.items;
  }

  // 단어 뜻 배우기
  async function learn(words, acronyms, mine, hint) {
    const parts = [...chunk(words, MAX_WORDS).map((w) => [w, []]), ...chunk(acronyms, MAX_ACRONYMS).map((a) => [[], a])];
    for (const [w, a] of parts) {
      const items = await request(w, hint, a);
      if (!items || mine !== epoch) return false;
      for (const k of [...w, ...a]) cache[k] = Object.hasOwn(items, k) ? items[k] : null;
    }
    return true;
  }

  // 화면 근처 블록 처리(다리 요청 후 planBlock 으로 Range 와 뜻 라벨 구성)
  async function flush() {
    flushTimer = 0;
    const blocks = [...pending].filter((b) => b.isConnected && !done.has(b));
    pending.clear();
    if (!running || dead || !blocks.length) return;
    const mine = epoch;
    const when = settings;
    const hint = G ? G.hint(when, document, location.hostname) : {};
    const hintKey = G ? G.hintKey(hint) : '';
    if (cacheLevel !== when.level || cacheHint !== hintKey) {
      for (const k of Object.keys(cache)) delete cache[k];
      cacheLevel = when.level;
      cacheHint = hintKey;
    }
    const jobs = [];
    const wanted = new Set();
    const wantedAcronyms = new Set();
    for (const block of blocks) {
      const nodes = textNodesOf(block);
      const texts = nodes.map((n) => n.nodeValue);
      const occs = blockCandidates(texts, { acronyms: true });
      done.add(block);
      jobs.push({ block, nodes, texts, occs });
      for (const o of occs) if (!(o.word in cache)) (o.acronym ? wantedAcronyms : wanted).add(o.word);
    }
    const ok = await learn([...wanted], [...wantedAcronyms], mine, hint);
    if (mine !== epoch) return;
    if (!ok) {
      for (const j of jobs) done.delete(j.block);
      if (!dead && retries++ < MAX_RETRIES) setTimeout(() => jobs.forEach((j) => track(j.block)), RETRY_MS);
      return;
    }
    retries = 0;
    if (!running || dead) return;
    if (mo) collect(mo.takeRecords());

    ensureLayer();
    for (const j of jobs) {
      clearBlockEntries(j.block);
      const plans = planBlock(j, cache, when, state, 0);
      if (!plans.length) continue;
      const entries = [];
      for (const p of plans) {
        let range = null;
        try {
          range = document.createRange();
          range.setStart(p.node, p.start);
          range.setEnd(p.node, p.end);
        } catch {
          continue;
        }
        let label = null;
        if (when.annotation.position !== 'none') {
          label = document.createElement('span');
          label.setAttribute('lang', 'ko');
          label.textContent = p.gloss;
          label.style.visibility = 'hidden';
          layerShadow.append(label);
        }
        entries.push({
          node: p.node,
          text: p.node.nodeValue,
          start: p.start,
          end: p.end,
          lemma: p.lemma,
          gloss: p.gloss,
          range,
          label,
        });
      }
      if (entries.length) entriesByBlock.set(j.block, entries);
    }
    updateHighlights();
    scheduleUpdate();
    mo?.takeRecords();
  }

  // rAF 로 다시 그리기(화면 근처 엔트리만 계산)
  function scheduleUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updatePositions();
    });
  }

  // 뜻 글자 위치 계산 및 숨김 판정
  function updatePositions() {
    if (!running || !layerShadow) return;
    const dark = core.isDarkColor
      ? core.isDarkColor(
          typeof getComputedStyle === 'function' && document.body ? getComputedStyle(document.body).color : '',
          typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
        )
      : false;
    const accent = dark ? ACCENT_DARK : ACCENT;
    const a = settings.annotation;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    for (const [block, list] of entriesByBlock.entries()) {
      if (!block.isConnected) {
        clearBlockEntries(block);
        done.delete(block);
        nearBlocks.delete(block);
        continue;
      }
      // 화면 근처가 아니면 숨긴다
      if (!nearBlocks.has(block)) {
        for (const e of list) {
          if (e.label) e.label.style.visibility = 'hidden';
        }
        continue;
      }
      // 페이지가 글을 바꿈: 노드가 끊겼거나 글이 달라지면 그 블록 엔트리를 버리고 다시 처리 대상으로
      let changed = false;
      for (const e of list) {
        if (!e.node.isConnected || e.node.nodeValue !== e.text) {
          changed = true;
          break;
        }
      }
      if (changed) {
        clearBlockEntries(block);
        done.delete(block);
        track(block);
        continue;
      }
      if (a.position === 'none') {
        for (const e of list) {
          if (e.label) e.label.style.visibility = 'hidden';
        }
        continue;
      }

      for (const e of list) {
        if (!e.label || !e.range) continue;
        const rects = e.range.getClientRects();
        if (!rects || !rects.length) {
          e.label.style.visibility = 'hidden';
          continue;
        }
        const rect = rects[0];
        if (rect.width === 0 && rect.height === 0) {
          e.label.style.visibility = 'hidden';
          continue;
        }
        // 화면 밖
        if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
          e.label.style.visibility = 'hidden';
          continue;
        }

        // 단어 가운데 점 elementFromPoint 검사
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cx > vw || cy < 0 || cy > vh) {
          e.label.style.visibility = 'hidden';
          continue;
        }
        const hit = document.elementFromPoint(cx, cy);
        const parent = e.node.parentElement;
        if (!hit) {
          e.label.style.visibility = 'hidden';
          continue;
        }
        const isOurHost = hit === layerHost || (hit.getAttribute && hit.getAttribute('data-readgloss') === 'layer');
        if (!isOurHost && parent && hit !== parent && !parent.contains(hit)) {
          e.label.style.visibility = 'hidden';
          continue;
        }

        // 글자 크기, 색, 투명도, 굵기 설정
        const cs = parent && typeof getComputedStyle === 'function' ? getComputedStyle(parent) : null;
        const parentFs = cs ? parseFloat(cs.fontSize) || 16 : 16;
        const labelFs = (parentFs * a.sizePct) / 100;
        const color = a.color === 'text' ? (cs?.color || 'currentColor') : a.color === 'accent' ? accent : a.customColor;

        e.label.style.fontSize = `${labelFs}px`;
        e.label.style.color = color;
        e.label.style.opacity = String(a.opacityPct / 100);
        e.label.style.fontWeight = String(WEIGHT_MAP[a.weight] ?? 400);

        // 위치: 사각형 위 가운데
        e.label.style.visibility = 'visible';
        const labelRect = e.label.getBoundingClientRect();
        const box = core.labelBox
          ? core.labelBox(rect, labelRect.width, labelRect.height)
          : { left: rect.left + rect.width / 2 - labelRect.width / 2, top: rect.top - labelRect.height - 1 };
        e.label.style.left = `${box.left}px`;
        e.label.style.top = `${box.top}px`;
      }
    }
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (e.isIntersecting) {
        nearBlocks.add(e.target);
        if (!done.has(e.target)) pending.add(e.target);
      } else {
        nearBlocks.delete(e.target);
      }
    }
    if (pending.size && !flushTimer) flushTimer = setTimeout(() => flush().catch(() => {}), FLUSH_MS);
    scheduleUpdate();
  }

  function track(block) {
    if (io && running && !dead && block.isConnected && !done.has(block)) {
      io.observe(block);
      ro?.observe(block);
    }
  }

  const isOurs = (n) => !!elementOf(n)?.closest?.('[data-readgloss]');

  function collect(records) {
    for (const r of records) {
      if (isOurs(r.target)) continue;
      const added = [...r.addedNodes];
      if (r.type === 'childList' && added.length && added.every(isOurs)) continue;
      const near = elementOf(r.target)?.closest(BLOCK);
      if (near) dirty.add(near);
      for (const n of added) {
        if (n.nodeType !== 1) continue;
        if (n.matches(BLOCK)) dirty.add(n);
        n.querySelectorAll?.(BLOCK).forEach((b) => dirty.add(b));
        const up = n.closest(BLOCK);
        if (up) dirty.add(up);
      }
    }
    if (dirty.size && !mutationTimer) {
      mutationTimer = setTimeout(() => {
        mutationTimer = 0;
        for (const b of dirty) {
          done.delete(b);
          track(b);
        }
        dirty.clear();
        scheduleUpdate();
      }, MUTATION_MS);
    } else {
      scheduleUpdate();
    }
  }

  function start() {
    if (io || dead || !document.body) return;
    ensureLayer();
    io = new IntersectionObserver(onIntersect, { rootMargin: '100% 0px' });
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => scheduleUpdate());
    }
    mo = new MutationObserver(collect);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelectorAll(BLOCK).forEach(track);

    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
  }

  function stop() {
    io?.disconnect();
    mo?.disconnect();
    ro?.disconnect();
    io = mo = ro = null;
    document.removeEventListener('scroll', scheduleUpdate, { capture: true });
    window.removeEventListener('resize', scheduleUpdate);
    clearTimeout(flushTimer);
    clearTimeout(mutationTimer);
    cancelAnimationFrame(rafId);
    rafId = 0;
    flushTimer = mutationTimer = 0;
    pending.clear();
    dirty.clear();
    nearBlocks.clear();
  }

  // 구조가 바뀌었거나 새로 켜졌다: 붙은 주석 엔트리와 하이라이트를 다 지우고 처음부터 다시 처리한다
  function rebuild() {
    epoch++;
    stop();
    clearAllEntries();
    state.pageSeen.clear();
    done = new WeakSet();
    offUntil = 0;
    retries = 0;
    running = true;
    start();
  }

  function turnOff() {
    epoch++;
    running = false;
    stop();
    clearAllEntries();
    state.pageSeen.clear();
    done = new WeakSet();
  }

  // 설정 동기화
  function sync() {
    if (!loaded) return;
    const on = annotating(settings, location.hostname, pageOff);
    const key = structuralKey(settings);
    if (!on) {
      if (running) turnOff();
    } else {
      applyHighlightStyle(settings);
      if (!running || key !== appliedKey) rebuild();
      else scheduleUpdate();
    }
    appliedKey = key;
  }

  // 아는 단어 걷기: 해당 원형의 라벨과 하이라이트 지움
  addEventListener('readgloss:words', (e) => {
    const gone = applyWords(state.skip, e.detail, state.pageSeen);
    if (e.detail?.unknown?.length) for (const k of Object.keys(cache)) delete cache[k];
    if (gone.size && running) {
      for (const [block, list] of entriesByBlock.entries()) {
        const remain = [];
        for (const entry of list) {
          if (gone.has(entry.lemma)) {
            if (entry.label) entry.label.remove();
          } else {
            remain.push(entry);
          }
        }
        if (remain.length !== list.length) {
          if (remain.length === 0) entriesByBlock.delete(block);
          else entriesByBlock.set(block, remain);
        }
      }
      updateHighlights();
      scheduleUpdate();
      mo?.takeRecords();
    }
  });

  // 내 사전 변경: 해당 키 주석 걷고 다시 처리
  addEventListener('readgloss:mydict', (e) => {
    const keys = mydictKeys(e.detail);
    if (!keys.size) return;
    for (const k of Object.keys(cache)) delete cache[k];
    if (!running) return;
    epoch++;
    offUntil = 0;
    for (const [block, list] of entriesByBlock.entries()) {
      const remain = [];
      for (const entry of list) {
        if (keys.has(entry.lemma)) {
          if (entry.label) entry.label.remove();
        } else {
          remain.push(entry);
        }
      }
      if (remain.length !== list.length) {
        if (remain.length === 0) entriesByBlock.delete(block);
        else entriesByBlock.set(block, remain);
      }
    }
    for (const k of keys) state.pageSeen.delete(k);
    done = new WeakSet();
    updateHighlights();
    document.querySelectorAll(BLOCK).forEach(track);
    scheduleUpdate();
    mo?.takeRecords();
  });

  addEventListener('readgloss:pageoff', (e) => {
    pageOff = typeof e.detail?.off === 'boolean' ? e.detail.off : globalThis.readglossPageOff === true;
    sync();
  });

  try {
    S.load().then(
      (s) => ((settings = s), (loaded = true), sync()),
      () => ((loaded = true), sync()),
    );
    S.onChange((s) => ((settings = s), (loaded = true), sync()));
  } catch {
    // 확장이 다시 로드된 뒤의 낡은 페이지
  }
})();
