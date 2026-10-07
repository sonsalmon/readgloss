// 문단 클릭 -> 왼쪽 번역 버튼 -> 원문 바로 아래에 번역문 삽입. DOM 접착만 한다. 판단 로직은 paragraph-core.js(globalThis.readglossParagraph).
(() => {
  const core = globalThis.readglossParagraph;
  if (!core) return;
  // 켜짐 범위 판정(계약 D)은 자동 주석과 같은 함수를 쓴다. 없으면(로드 순서가 어긋난 경우) 막지 않는다.
  const enabledHere = globalThis.readglossAnnotate?.enabledHere ?? (() => true);
  const { MAX_TEXT, BUTTON_SIZE, TRANSLATION_TAG, TRANSLATION_STYLE, isTargetText, findBlock, insertPlacement, textOf, textExceeds, buttonPosition, collectBlocks } = core;

  const MAX_SENTENCE = 1000; // 표현을 담을 때 함께 저장하는 문단 원문의 상한(다리의 sentence 상한)

  const MESSAGES = {
    'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요',
    timeout: '번역이 오래 걸려요. 다시 눌러 주세요',
    'ai-failed': '번역하지 못했어요. 다시 눌러 주세요',
    'too-large': '문단이 너무 길어요(4000자 이하만 돼요)',
    'pair-failed': '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요',
  };

  const DARK = '--rg-bg:#1e2127; --rg-fg:#e6e8eb; --rg-muted:#9aa3ad; --rg-border:#343a44; --rg-accent:#6b9bff; --rg-accent-soft:rgba(107,155,255,.14); --rg-shadow:0 8px 28px rgba(0,0,0,.45);';
  // 카드·버튼 공통 디자인 토큰(밝은 기본 + 어두운 모드). 바꾸지 말 것.
  const CSS = `
    .wrap { --rg-bg:#ffffff; --rg-fg:#1f2328; --rg-muted:#656d76; --rg-border:#e3e6ea; --rg-accent:#2f6feb; --rg-accent-soft:rgba(47,111,235,.10);
      --rg-shadow:0 8px 28px rgba(15,23,42,.14), 0 1px 3px rgba(15,23,42,.08); --rg-radius:10px;
      position: relative; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) .wrap { ${DARK} } }
    :host([data-theme="dark"]) .wrap { ${DARK} }
    .btn { all: unset; box-sizing: border-box; position: relative; display: grid; place-items: center; width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px;
      border-radius: 50%; border: 1px solid var(--rg-border); background: var(--rg-bg); color: var(--rg-accent); box-shadow: var(--rg-shadow); cursor: pointer; }
    .btn::before { content: ''; position: absolute; inset: -6px; border-radius: 50%; } /* 눈에 보이는 크기는 22px, 누를 수 있는 영역만 넓힘 */
    .btn:hover { background: var(--rg-accent-soft); }
    .btn:focus-visible { outline: 2px solid var(--rg-accent); outline-offset: 2px; }
    .btn[aria-pressed="true"] { background: var(--rg-accent-soft); border-color: var(--rg-accent); }
    .btn svg { width: 14px; height: 14px; }
    .btn[data-state="loading"] { cursor: progress; }
    .btn[data-state="loading"] svg { display: none; }
    .btn[data-state="loading"]::after { content: ''; width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%;
      border: 2px solid var(--rg-accent-soft); border-top-color: var(--rg-accent); animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .btn[data-state="loading"]::after { animation: none; } }
    .bubble { position: absolute; left: ${BUTTON_SIZE + 8}px; top: 0; width: max-content; max-width: 240px; padding: 6px 10px; border-radius: var(--rg-radius);
      border: 1px solid var(--rg-border); background: var(--rg-bg); color: var(--rg-fg); box-shadow: var(--rg-shadow); font-size: 13px; line-height: 1.45; }
    .bubble[hidden] { display: none; }
  `;

  let settings = globalThis.readglossSettings?.normalize({}) ?? { enabled: true, sites: [] }; // 저장된 값을 읽기 전에는 기본값
  let pageOff = globalThis.readglossPageOff === true; // 이 페이지만 끄기(T6b 가 이벤트로 알리고 전역에도 둔다)
  // 테마(설정 'theme'): auto 면 속성 없이 prefers-color-scheme, light·dark 면 호스트에 data-theme 로 강제(content.js 카드와 같다)
  const applyTheme = () => host && (settings.theme === 'light' || settings.theme === 'dark' ? host.setAttribute('data-theme', settings.theme) : host.removeAttribute('data-theme'));
  const allowed = () => enabledHere(settings, location.hostname, pageOff);
  let host = null;
  let ui = null; // { btn, bubble }
  let current = null; // 버튼이 붙어 있는 문단 블록
  let raf = 0;
  const requests = new WeakMap(); // 블록 -> { status: 'loading' | 'error', error? } (진행·실패만. 끝나면 지운다)
  const nodes = new WeakMap(); // 블록 -> 우리가 넣은 번역 노드

  const isHidden = (el) => getComputedStyle(el).display === 'none';
  const nodeOf = (block) => {
    const n = nodes.get(block);
    return n?.isConnected ? n : null; // 페이지가 다시 그려 지워졌으면 없는 것으로 본다
  };

  function buildButton() {
    host = document.createElement('readgloss-paragraph');
    host.setAttribute('data-readgloss', 'button'); // 클릭 판정에서 우리 요소를 건너뛰는 표지
    host.style.cssText = 'all: initial; position: fixed; left: 0; top: 0; z-index: 2147483647; visibility: hidden;';
    const shadow = host.attachShadow({ mode: 'closed' }); // 페이지 CSS 와 격리
    const style = document.createElement('style');
    style.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.setAttribute('aria-label', '이 문단 번역');
    btn.title = '이 문단 번역';
    btn.setAttribute('aria-pressed', 'false');
    // 번역 아이콘(Lucide languages, ISC)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ['m5 8 6 6', 'm4 14 6-6 2-3', 'M2 5h12', 'M7 2h1', 'm22 22-5-10-5 10', 'M14 18h6']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    btn.append(svg);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.setAttribute('role', 'alert');
    bubble.hidden = true;
    btn.addEventListener('click', () => onButton().catch(() => {}));
    wrap.append(btn, bubble);
    shadow.append(style, wrap);
    document.documentElement.append(host);
    ui = { btn, bubble };
    applyTheme();
  }

  // 블록의 첫 글자 줄 사각형(버튼을 첫 줄 높이에 맞추려고). 못 구하면 undefined -> 블록 맨 위.
  function firstLineRect(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.nodeValue.trim() && !t.parentElement.closest('[data-readgloss]:not([data-readgloss="ann"])') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT), // 자동 주석 단어는 글자, 뜻 글자(gloss)·번역·버튼은 아님
    });
    const t = walker.nextNode();
    if (!t) return undefined;
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 1);
    const rect = r.getClientRects()[0];
    return rect && { top: rect.top, height: rect.height };
  }

  function place() {
    if (!current || !host) return;
    if (!current.isConnected) return hide();
    const rect = current.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight || (rect.width === 0 && rect.height === 0)) {
      host.style.visibility = 'hidden'; // 문단이 화면 밖
      return;
    }
    const cs = getComputedStyle(current);
    const list = current.tagName === 'LI' && cs.display === 'list-item' && cs.listStyleType !== 'none' && cs.listStylePosition !== 'inside'; // 글머리표가 li 바깥에 있을 때만 비켜 둔다
    const pos = buttonPosition({ blockRect: rect, firstLine: firstLineRect(current), list });
    // 긴 문단은 첫 줄이 화면 위로 넘어가도 버튼이 문단 안에 머문다
    const top = Math.min(Math.max(pos.top, 4), Math.max(rect.bottom - BUTTON_SIZE, 4));
    host.style.left = `${Math.max(pos.left, 2)}px`;
    host.style.top = `${top}px`;
    host.style.visibility = 'visible';
  }

  function refresh() {
    if (!ui || !current) return;
    const req = requests.get(current);
    const shown = nodeOf(current) !== null;
    const loading = req?.status === 'loading';
    ui.btn.dataset.state = loading ? 'loading' : shown ? 'done' : 'idle';
    ui.btn.setAttribute('aria-pressed', String(shown));
    ui.btn.setAttribute('aria-busy', String(loading));
    ui.btn.title = shown ? '번역 걷기' : '이 문단 번역';
    const err = !loading && !shown && req?.status === 'error' ? (MESSAGES[req.error] ?? `문제가 생겼어요(${req.error})`) : '';
    ui.bubble.textContent = err;
    ui.bubble.hidden = !err;
  }

  function hide() {
    current = null;
    if (host) host.style.visibility = 'hidden';
  }

  function show(block) {
    if (!host) buildButton();
    current = block;
    refresh();
    place();
  }

  // 번역문 아래 "기억할 표현" 줄들(T17). 목록 그리기는 드래그 카드와 같은 selection.js 의 것(readglossExpressions, 나중에 로드되므로 호출 때 읽는다).
  // 번역 노드 안에 Shadow DOM 호스트로 넣어 페이지 CSS 와 격리하고, data-readgloss="translation" 이라 주석·문단 글 뽑기에서 빠진다.
  function appendExpressions(n, expressions, sentence) {
    const E = globalThis.readglossExpressions;
    const list = E?.create(expressions, { sentence, inline: true });
    if (!list?.el) return;
    const eh = document.createElement('readgloss-expressions');
    eh.setAttribute('data-readgloss', 'translation');
    eh.style.cssText = 'all: initial; display: block; margin-top: .4em; color: inherit; font: inherit; font-size: .92em; line-height: 1.5; white-space: normal;';
    if (settings.theme === 'light' || settings.theme === 'dark') eh.setAttribute('data-theme', settings.theme);
    const style = document.createElement('style');
    style.textContent = E.CSS;
    eh.attachShadow({ mode: 'closed' }).append(style, list.el);
    n.append(eh);
  }

  function insert(block, translation, expressions, sentence) {
    const n = document.createElement(TRANSLATION_TAG);
    n.setAttribute('data-readgloss', 'translation');
    n.lang = 'ko';
    n.style.cssText = TRANSLATION_STYLE;
    n.textContent = translation; // innerHTML 은 쓰지 않는다
    appendExpressions(n, expressions, sentence);
    block.insertAdjacentElement(insertPlacement(block.tagName), n);
    nodes.set(block, n);
  }

  async function translateBlock(block, { bulk = false, stale } = {}) {
    if (!block || !block.isConnected) return { ok: false, error: 'disconnected' };
    if (nodeOf(block)) return { ok: true };
    if (requests.get(block)?.status === 'loading') return { ok: false, error: 'loading' };

    const text = textOf(block, { isHidden });
    if (text.length > MAX_TEXT) {
      requests.set(block, { status: 'error', error: 'too-large' });
      if (current === block) refresh();
      return { ok: false, error: 'too-large' };
    }

    requests.set(block, { status: 'loading' });
    if (current === block) refresh();

    const payload = {
      type: 'translate',
      text,
      ...(bulk ? { bulk: true } : {}),
      ...(globalThis.readglossGlossary?.hint(settings, document, location.hostname) ?? {}),
    };

    let r;
    try {
      r = await chrome.runtime.sendMessage(payload);
    } catch {
      r = { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
    }

    if (stale?.()) {
      requests.delete(block); // 걷혔거나 새 실행이 시작됐으면 늦게 온 답을 버린다(번역문이 되살아나지 않게)
      return { ok: false, error: 'aborted' };
    }
    if (r?.translation && block.isConnected) {
      requests.delete(block);
      insert(block, r.translation, r.expressions, text.slice(0, MAX_SENTENCE));
      if (current === block) {
        refresh();
        place();
      }
      return { ok: true, translation: r.translation };
    } else {
      const error = r?.error ?? 'no-response';
      requests.set(block, { status: 'error', error });
      if (current === block) refresh();
      return { ok: false, error };
    }
  }

  async function onButton() {
    const block = current;
    if (!block) return;
    const shown = nodeOf(block);
    if (shown) {
      shown.remove(); // 다시 누르면 걷는다
      nodes.delete(block);
    } else if (requests.get(block)?.status !== 'loading') {
      await translateBlock(block, { bulk: false });
    }
    if (current === block) {
      refresh();
      place();
    }
  }

  // ---- 전체 번역 (T21) ----
  const BLOCKED_MS = 2000; // 이 페이지가 꺼져 있을 때 안내 문구를 보여 주는 시간
  // 상태 객체는 하나를 두고 그 자리에서 고친다(새 객체로 바꾸면 돌고 있는 루프가 옛 객체를 못 보고 안 멈춘다).
  const bulkState = {
    running: false,
    abort: false,
    done: 0,
    total: 0,
    failed: 0,
    consecutive: 0,
    started: false, // 전체 번역을 한 번이라도 시작했고 아직 걷지 않음(메뉴 문구 판단)
    blocked: false,
    reason: '',
  };
  let bulkGen = 0; // start·clear 마다 올려서 늦게 온 옛 결과를 버린다
  let blockedTimer = 0;
  const statusListeners = new Set();

  function resetBulk() {
    bulkState.running = false;
    bulkState.abort = false;
    bulkState.done = 0;
    bulkState.total = 0;
    bulkState.failed = 0;
    bulkState.consecutive = 0;
    bulkState.started = false;
    bulkState.blocked = false;
    bulkState.reason = '';
  }

  function emitStatus() {
    const detail = {
      running: bulkState.running,
      done: bulkState.done,
      total: bulkState.total,
      failed: bulkState.failed,
      started: bulkState.started,
      blocked: bulkState.blocked,
      reason: bulkState.reason,
    };
    for (const cb of statusListeners) {
      try {
        cb(detail);
      } catch {
        // 구독 하나가 망가져도 나머지는 이어서
      }
    }
  }

  function isVisibleBlock(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && (r.width > 0 || r.height > 0);
  }

  function orderFromVisible(blocks) {
    const firstIdx = blocks.findIndex(isVisibleBlock);
    if (firstIdx <= 0) return blocks;
    return [...blocks.slice(firstIdx), ...blocks.slice(0, firstIdx)];
  }

  // 이 페이지·사이트가 꺼져 있어서 시작할 수 없을 때: 상태에 blocked 를 내고 잠깐 뒤 원래 문구로 돌린다.
  function showBlocked() {
    bulkState.blocked = true;
    emitStatus();
    clearTimeout(blockedTimer);
    blockedTimer = setTimeout(() => {
      bulkState.blocked = false;
      emitStatus();
    }, BLOCKED_MS);
  }

  async function startPageTranslate() {
    if (bulkState.running) return;
    if (!allowed() || pageOff) return showBlocked();
    const root = document.body;
    if (!root) return;

    const raw = (collectBlocks ?? core.collectBlocks)?.(root, { isHidden }) ?? [];
    const blocks = raw.filter((b) => !nodeOf(b)); // 이미 번역된 문단은 건너뛴다(손으로 번역한 것 포함)
    const gen = ++bulkGen;
    bulkState.running = true;
    bulkState.abort = false;
    bulkState.done = 0;
    bulkState.total = blocks.length;
    bulkState.failed = 0;
    bulkState.consecutive = 0;
    bulkState.started = true;
    bulkState.blocked = false;
    bulkState.reason = '';
    emitStatus();

    const queue = orderFromVisible(blocks);
    for (const b of queue) {
      if (bulkState.abort || gen !== bulkGen) break;
      if (!b.isConnected) {
        bulkState.failed++;
        emitStatus();
        continue;
      }
      if (nodeOf(b)) {
        bulkState.done++;
        emitStatus();
        continue;
      }
      if (requests.get(b)?.status === 'loading') continue; // 사용자가 손으로 번역 중이면 실패로 세지 않고 건너뛴다

      const res = await translateBlock(b, { bulk: true, stale: () => gen !== bulkGen });
      if (bulkState.abort || gen !== bulkGen) break;
      const step = core.bulkStep(bulkState, res);
      emitStatus();
      if (step === 'stop') break; // 치명 오류 또는 연달아 BULK_MAX_CONSECUTIVE 번 실패
    }

    bulkState.running = false;
    emitStatus();
  }

  function stopPageTranslate() {
    if (bulkState.running) {
      bulkState.abort = true;
    }
  }

  function clearPageTranslate() {
    bulkGen++; // 진행 중이던 번역 결과가 걷은 뒤 되살아나지 않게
    bulkState.abort = true;
    const all = document.querySelectorAll(TRANSLATION_TAG);
    for (const el of all) el.remove();
    if (current) {
      refresh();
      place();
    }
    resetBulk();
    emitStatus();
  }

  // 페이지 스크립트가 부르지 못하게 window 이벤트 대신 전역 객체로만 내보낸다(panel.js 가 나중에 로드돼 호출 때 읽는다).
  globalThis.readglossPageTranslate = {
    start: () => startPageTranslate().catch(() => {}),
    stop: stopPageTranslate,
    clear: clearPageTranslate,
    state: () => ({ ...bulkState }),
    onStatus(cb) {
      if (typeof cb !== 'function') return () => {};
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
  };

  function onClick(e) {
    if (host && e.composedPath().includes(host)) return; // 번역 버튼 안
    if (e.composedPath().some((n) => n.localName === 'readgloss-expressions')) return; // 번역문 아래 표현 [☆] 을 누른 것: 문단 클릭이 아니다
    if (getSelection()?.isCollapsed === false) return; // 드래그로 글을 골랐으면(드래그 번역이 맡는다) 번역 버튼은 새로 띄우지 않는다
    if (!allowed()) return hide(); // 끄기 범위: 이 사이트·이 페이지·전체 끄기면 번역 버튼을 안 띄운다(더블클릭 사전 카드는 따로 계속 된다)
    const t = e.target;
    const block = findBlock(t?.nodeType === 1 ? t : t?.parentElement);
    // ponytail: 아주 큰 블록(레이아웃용 td 등)은 글자를 걷기 전에 거른다(주석 rt 글자는 세지 않는다). 4000자를 조금 넘는 문단은 버튼이 뜨고 "너무 길어요"를 보여 준다.
    if (!block || textExceeds(block, MAX_TEXT * 4) || !isTargetText(textOf(block, { isHidden }))) return hide();
    show(block);
  }

  document.addEventListener(
    'click',
    (e) => {
      try {
        onClick(e); // preventDefault 는 하지 않는다: 링크·버튼의 원래 동작을 막지 않는다
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
    },
    true,
  );
  // 설정·이 페이지 끄기가 바뀌어 꺼지면 떠 있던 버튼을 거둔다(이미 끼워 넣은 번역문은 그대로 둔다)
  addEventListener('readgloss:pageoff', (e) => {
    pageOff = typeof e.detail?.off === 'boolean' ? e.detail.off : globalThis.readglossPageOff === true;
    if (!allowed()) {
      hide();
      stopPageTranslate();
    }
  });
  try {
    globalThis.readglossSettings?.load().then((s) => ((settings = s), applyTheme(), allowed() || (hide(), stopPageTranslate())), () => {});
    globalThis.readglossSettings?.onChange((s) => ((settings = s), applyTheme(), allowed() || (hide(), stopPageTranslate())));
  } catch {
    // 확장이 다시 로드된 뒤의 낡은 페이지: 기본값으로 둔다
  }
  const follow = () => {
    if (!current || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      place();
    });
  };
  addEventListener('scroll', follow, { capture: true, passive: true });
  addEventListener('resize', follow, { passive: true });
})();
