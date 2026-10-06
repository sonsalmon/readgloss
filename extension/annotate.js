// 어려운 단어 자동 주석: 화면 근처 글 블록의 텍스트 노드에 설정대로 뜻을 붙인다(위·오른쪽·없음).
// 페이지 접착(관찰·요청·설정·이벤트)만 한다. 판단·그리기·걷기는 annotate-core.js(globalThis.readglossAnnotate), 뜻은 다리의 /annotate(맥 영한사전)가 준다.
(() => {
  const core = globalThis.readglossAnnotate;
  const style = globalThis.readglossAnnotStyle;
  const S = globalThis.readglossSettings;
  const G = globalThis.readglossGlossary; // 분야 용어집 힌트(host·domains). 없어도 주석은 그대로 동작한다
  if (!core || !S || !globalThis.chrome?.runtime?.id) return;
  const { MAX_WORDS, blockCandidates, chunk, annotating, structuralKey, annotateBlock, unwrapAnnotations, applyWords } = core;

  const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, figcaption';
  // 건드리지 않는 곳: 코드·입력창·편집 영역·이미 있는 ruby·우리가 넣은 노드(번역 블록 등)
  const EXCLUDE = 'pre, code, kbd, samp, script, style, noscript, template, textarea, input, select, button, svg, ruby, [contenteditable]:not([contenteditable="false"]), [data-readgloss]';
  const FLUSH_MS = 50; // 한꺼번에 들어온 블록을 한 요청으로 묶는 시간
  const MUTATION_MS = 300;
  const RETRY_MS = 30_000; // 다리가 꺼져 있으면 이만큼 쉬고 다시 시도한다(최대 MAX_RETRIES 번 연속)
  const MAX_RETRIES = 3;

  let settings = S.normalize({}); // 저장소에서 읽기 전에는 기본값(읽기 전에는 sync 를 안 부른다)
  let pageOff = globalThis.readglossPageOff === true; // 이 페이지만 끄기(T6b 가 이벤트로 알리고 전역에도 둔다)
  let running = false; // 관찰 중(= 이 페이지에서 지금 자동 주석이 켜져 있다)
  let appliedKey = null; // 마지막으로 그린 구조 값(structuralKey)
  let epoch = 0; // 다시 그리거나 끌 때마다 올려서, 늦게 돌아온 요청 결과를 버린다
  let adopted = false;
  let loaded = false; // 저장된 설정을 읽었다
  let dead = false; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
  let retries = 0;
  let offUntil = 0;
  let io = null;
  let mo = null;
  let flushTimer = 0;
  let mutationTimer = 0;
  let done = new WeakSet(); // 처리한 블록(블록 안 글이 바뀌면 다시 뺀다. WeakSet 은 비울 수 없어 다시 그릴 때 새로 만든다)
  const pending = new Set(); // 화면 근처에 들어와 처리를 기다리는 블록
  const dirty = new Set(); // 글이 바뀐 블록
  const cache = Object.create(null); // 낱말 -> { lemma, gloss } | null(어렵지 않음). 기준 등급이 바뀌면 비운다.
  let cacheLevel = settings.level;
  let cacheHint = ''; // 캐시를 채울 때의 용어집 힌트 키(같은 단어도 분야가 다르면 뜻이 다르다)
  const state = { pageSeen: new Set(), skip: new Set() }; // pageSeen: 이 페이지에서 이미 주석 붙인 원형, skip: 아는 단어 원형(readgloss:words)

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

  async function request(words, hint) {
    if (dead || Date.now() < offUntil) return null;
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: 'annotate', words, level: settings.level, ...hint });
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

  // 아직 모르는 낱말을 300개씩 물어 cache 에 채운다. 하나라도 실패하거나 기다리는 사이 다시 그리기 시작했으면(mine !== epoch, 답이 낡았다) false.
  async function learn(words, mine, hint) {
    for (const part of chunk(words, MAX_WORDS)) {
      const items = await request(part, hint);
      if (!items || mine !== epoch) return false;
      for (const w of part) cache[w] = Object.hasOwn(items, w) ? items[w] : null; // items.constructor 같은 상속 속성을 낱말로 착각하지 않는다
    }
    return true;
  }

  async function flush() {
    flushTimer = 0;
    const blocks = [...pending].filter((b) => b.isConnected && !done.has(b));
    pending.clear();
    if (!running || dead || !blocks.length) return;
    const mine = epoch;
    const when = settings;
    // 수학 페이지 판단은 페이지가 바뀔 수 있어(SPA) 요청마다 다시 한다. 분야 조합이 달라지면 지난 답은 못 쓴다.
    // ponytail: 이미 그려 둔 블록은 그대로 둔다. 새로 처리하는 블록부터 새 분야 뜻이 붙는다.
    const hint = G ? G.hint(when, document, location.hostname) : {};
    const hintKey = G ? G.hintKey(hint) : '';
    if (cacheLevel !== when.level || cacheHint !== hintKey) {
      for (const k of Object.keys(cache)) delete cache[k]; // 기준 등급·용어집 분야가 바뀌면 지난 답은 못 쓴다
      cacheLevel = when.level;
      cacheHint = hintKey;
    }
    const jobs = [];
    const wanted = new Set();
    for (const block of blocks) {
      const nodes = textNodesOf(block);
      const texts = nodes.map((n) => n.nodeValue);
      const occs = blockCandidates(texts);
      done.add(block);
      jobs.push({ block, nodes, texts, occs });
      for (const o of occs) if (!(o.word in cache)) wanted.add(o.word);
    }
    const ok = await learn([...wanted], mine, hint);
    if (mine !== epoch) return; // 기다리는 사이 설정이 바뀌어 다시 그리는 중: 이 결과는 버린다
    if (!ok) {
      for (const j of jobs) done.delete(j.block);
      if (!dead && retries++ < MAX_RETRIES) setTimeout(() => jobs.forEach((j) => track(j.block)), RETRY_MS);
      return;
    }
    retries = 0;
    if (!running || dead) return;
    if (mo) collect(mo.takeRecords()); // 요청을 기다리는 사이 페이지가 바꾼 것은 챙기고
    for (const j of jobs) annotateBlock(j.block, j, cache, when, state);
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
    if (io && running && !dead && block.isConnected && !done.has(block)) io.observe(block);
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
    clearTimeout(flushTimer);
    clearTimeout(mutationTimer);
    flushTimer = mutationTimer = 0;
    pending.clear();
    dirty.clear();
  }

  // 구조가 바뀌었거나 새로 켜졌다: 붙은 주석을 다 걷고 처음부터 다시 처리한다.
  function rebuild() {
    epoch++;
    stop();
    unwrapAnnotations(document); // 관찰자를 끊은 뒤에 걷으므로 우리가 바꾼 DOM 이 변화로 잡히지 않는다
    state.pageSeen.clear();
    done = new WeakSet();
    offUntil = 0; // 설정을 바꾼 김에 다리 쉬던 것도 다시 시도
    retries = 0;
    running = true;
    start();
  }

  function turnOff() {
    epoch++;
    running = false;
    stop();
    unwrapAnnotations(document);
    state.pageSeen.clear();
    done = new WeakSet();
  }

  // 공유 스타일시트를 페이지에 한 번 붙인다(CSSOM 이라 페이지 CSP 에 안 막힌다). 안 되는 환경이면 <style> 로.
  function adopt() {
    if (adopted) return;
    adopted = true;
    try {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, style.sheet];
    } catch {
      const el = document.createElement('style');
      el.setAttribute('data-readgloss', 'style');
      el.textContent = style.css;
      (document.head ?? document.documentElement).append(el);
    }
  }

  // 설정·끄기 상태가 바뀔 때마다: 켜짐 범위 밖이면 걷고 멈추고, 구조 값이 바뀌었으면 다시 그리고, 아니면 CSS 변수만 갱신한다.
  function sync() {
    if (!loaded) return;
    const on = annotating(settings, location.hostname, pageOff);
    const key = structuralKey(settings);
    if (!on) {
      if (running) turnOff();
    } else {
      adopt();
      if (!running || key !== appliedKey) rebuild();
      style.apply(settings);
    }
    appliedKey = key;
  }

  // 이 페이지에서만 쓰는 상태 이벤트(window CustomEvent, 계약 C)
  addEventListener('readgloss:words', (e) => {
    const gone = applyWords(state.skip, e.detail, state.pageSeen);
    if (e.detail?.unknown?.length) for (const k of Object.keys(cache)) delete cache[k]; // 아는 단어였다고 캐시된 빈 답을 버린다
    if (gone.size && running) {
      unwrapAnnotations(document, gone); // 아는 단어의 주석을 지금 걷는다
      mo?.takeRecords();
    }
  });
  addEventListener('readgloss:pageoff', (e) => {
    pageOff = typeof e.detail?.off === 'boolean' ? e.detail.off : globalThis.readglossPageOff === true;
    sync();
  });

  try {
    S.load().then(
      (s) => ((settings = s), (loaded = true), sync()),
      () => ((loaded = true), sync()), // 저장소를 못 읽으면 기본값
    );
    S.onChange((s) => ((settings = s), (loaded = true), sync()));
  } catch {
    // 확장이 다시 로드된 뒤의 낡은 페이지: 조용히 아무것도 안 한다
  }
})();
