// 어려운 단어 위 자동 주석: 화면 근처 글 블록의 텍스트 노드를 <ruby data-readgloss="ann">단어<rt>뜻</rt></ruby> 로 쪼갠다.
// DOM 접착만 한다. 판단 로직은 annotate-core.js(globalThis.readglossAnnotate), 뜻은 다리의 /annotate(맥 영한사전)가 준다.
(() => {
  const core = globalThis.readglossAnnotate;
  if (!core || !globalThis.chrome?.runtime?.id) return;
  const { MAX_WORDS, blockCandidates, chooseSpans, splitText, chunk, annotationColor, isDarkColor } = core;

  const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption';
  // 건드리지 않는 곳: 코드·입력창·편집 영역·이미 있는 ruby·우리가 넣은 노드(번역 블록 등)
  const EXCLUDE = 'pre, code, kbd, samp, script, style, noscript, template, textarea, input, select, button, svg, ruby, [contenteditable]:not([contenteditable="false"]), [data-readgloss]';
  const LEVELS = ['A2', 'B1', 'B2', 'C1'];
  const FLUSH_MS = 50; // 한꺼번에 들어온 블록을 한 요청으로 묶는 시간
  const MUTATION_MS = 300;
  const RETRY_MS = 30_000; // 다리가 꺼져 있으면 이만큼 쉬고 다시 시도한다(최대 MAX_RETRIES 번 연속)
  const MAX_RETRIES = 3;

  let enabled = true;
  let level = 'B2';
  let dead = false; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
  let retries = 0;
  let offUntil = 0;
  let io = null;
  let mo = null;
  let flushTimer = 0;
  let mutationTimer = 0;
  const done = new WeakSet(); // 처리한 블록(블록 안 글이 바뀌면 다시 뺀다)
  const pending = new Set(); // 화면 근처에 들어와 처리를 기다리는 블록
  const dirty = new Set(); // 글이 바뀐 블록
  const known = Object.create(null); // 낱말 -> { lemma, gloss } | null(어렵지 않음). 기준 등급이 바뀌면 비운다.
  let knownLevel = level;

  const elementOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement);

  // block 에 속한 텍스트 노드(가장 가까운 글 블록이 block 이고, 제외 대상 밖). 후보가 될 글자가 없는 노드는 뺀다.
  function textNodesOf(block) {
    const out = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (p && /[A-Za-z]/.test(n.nodeValue) && !p.closest(EXCLUDE) && p.closest(BLOCK) === block) out.push(n);
    }
    return out;
  }

  async function request(words) {
    if (dead || Date.now() < offUntil) return null;
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: 'annotate', words, level });
    } catch {
      dead = true;
      stop();
      return null;
    }
    if (!r?.items) {
      offUntil = Date.now() + RETRY_MS; // 다리가 꺼졌거나 막힘: 조용히 쉰다(오류는 표시하지 않는다)
      return null;
    }
    return r.items;
  }

  // 아직 모르는 낱말을 300개씩 물어 known 에 채운다. 하나라도 실패하면 false.
  async function learn(words) {
    for (const part of chunk(words, MAX_WORDS)) {
      const items = await request(part);
      if (!items) return false;
      for (const w of part) known[w] = Object.hasOwn(items, w) ? items[w] : null; // items.constructor 같은 상속 속성을 낱말로 착각하지 않는다
    }
    return true;
  }

  function makeRuby(piece, color) {
    const ruby = document.createElement('ruby');
    ruby.setAttribute('data-readgloss', 'ann');
    ruby.setAttribute('data-rg-lemma', piece.lemma);
    ruby.append(document.createTextNode(piece.text));
    const rt = document.createElement('rt');
    rt.lang = 'ko';
    rt.textContent = piece.gloss; // innerHTML 은 쓰지 않는다
    // 글꼴은 상속, 선택·복사에서는 빠진다(user-select:none). 인라인 style 은 페이지의 CSP 에 막히지 않는다.
    rt.style.cssText = `font-size:.62em;color:${color};user-select:none;-webkit-user-select:none;font-family:inherit;font-style:normal;font-weight:normal;letter-spacing:normal;text-transform:none`;
    ruby.append(rt);
    return ruby;
  }

  function apply({ block, nodes, texts, occs }) {
    const seen = new Set([...block.querySelectorAll('ruby[data-readgloss="ann"]')].map((r) => r.getAttribute('data-rg-lemma')));
    // 그 사이 페이지가 글을 바꾼 노드는 건드리지 않는다
    const live = occs.filter((o) => nodes[o.node].isConnected && nodes[o.node].nodeValue === texts[o.node]);
    const spans = chooseSpans(live, known, seen);
    if (!spans.length) return;
    const color = annotationColor(isDarkColor(getComputedStyle(block).color, matchMedia('(prefers-color-scheme: dark)').matches));
    for (const [i, node] of nodes.entries()) {
      const mine = spans.filter((s) => s.node === i);
      if (!mine.length) continue;
      const frag = document.createDocumentFragment();
      for (const piece of splitText(texts[i], mine)) frag.append(piece.gloss ? makeRuby(piece, color) : document.createTextNode(piece.text));
      node.replaceWith(frag);
    }
  }

  async function flush() {
    flushTimer = 0;
    const blocks = [...pending].filter((b) => b.isConnected && !done.has(b));
    pending.clear();
    if (!enabled || dead || !blocks.length) return;
    if (knownLevel !== level) {
      for (const k of Object.keys(known)) delete known[k]; // 기준 등급이 바뀌면 지난 답은 못 쓴다
      knownLevel = level;
    }
    const jobs = [];
    const wanted = new Set();
    for (const block of blocks) {
      const nodes = textNodesOf(block);
      const texts = nodes.map((n) => n.nodeValue);
      const occs = blockCandidates(texts);
      done.add(block);
      jobs.push({ block, nodes, texts, occs });
      for (const o of occs) if (!(o.word in known)) wanted.add(o.word);
    }
    if (!(await learn([...wanted]))) {
      for (const j of jobs) done.delete(j.block);
      if (!dead && retries++ < MAX_RETRIES) setTimeout(() => jobs.forEach((j) => track(j.block)), RETRY_MS);
      return;
    }
    retries = 0;
    if (!enabled || dead) return;
    if (mo) collect(mo.takeRecords()); // 요청을 기다리는 사이 페이지가 바꾼 것은 챙기고
    for (const j of jobs) apply(j);
    mo?.takeRecords(); // 우리가 바꾼 DOM 은 변화로 치지 않는다
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target); // 들어올 때 한 번
      pending.add(e.target);
    }
    if (pending.size && !flushTimer) flushTimer = setTimeout(() => flush().catch(() => {}), FLUSH_MS);
  }

  function track(block) {
    if (io && enabled && !dead && block.isConnected && !done.has(block)) io.observe(block);
  }

  const isOurs = (n) => !!elementOf(n)?.closest?.('[data-readgloss]');

  function collect(records) {
    for (const r of records) {
      if (isOurs(r.target)) continue;
      const added = [...r.addedNodes];
      if (r.type === 'childList' && added.length && added.every(isOurs)) continue; // 번역 블록·버튼 같은 우리 노드만 들어옴
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
      }, MUTATION_MS);
    }
  }

  function start() {
    if (io || dead || !document.body) return;
    io = new IntersectionObserver(onIntersect, { rootMargin: '100% 0px' }); // 화면 + 위아래 한 화면
    mo = new MutationObserver(collect);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelectorAll(BLOCK).forEach(track);
  }

  function stop() {
    io?.disconnect();
    mo?.disconnect();
    io = mo = null;
    pending.clear();
    dirty.clear();
  }

  function applySettings(s) {
    if (typeof s.annotateEnabled === 'boolean') enabled = s.annotateEnabled;
    if (LEVELS.includes(s.level)) level = s.level;
    if (enabled) start();
    else stop();
  }

  try {
    chrome.storage.local.get({ annotateEnabled: true, level: 'B2' }).then(applySettings, () => applySettings({}));
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !('annotateEnabled' in ch || 'level' in ch)) return;
      applySettings({ annotateEnabled: ch.annotateEnabled ? ch.annotateEnabled.newValue !== false : enabled, level: ch.level?.newValue });
    });
  } catch {
    // 확장이 다시 로드된 뒤의 낡은 페이지: 조용히 아무것도 안 한다
  }
})();
