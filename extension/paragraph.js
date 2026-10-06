// 문단 클릭 -> 왼쪽 번역 버튼 -> 원문 바로 아래에 번역문 삽입. DOM 접착만 한다. 판단 로직은 paragraph-core.js(globalThis.readglossParagraph).
(() => {
  const core = globalThis.readglossParagraph;
  if (!core) return;
  // 켜짐 범위 판정(계약 D)은 자동 주석과 같은 함수를 쓴다. 없으면(로드 순서가 어긋난 경우) 막지 않는다.
  const enabledHere = globalThis.readglossAnnotate?.enabledHere ?? (() => true);
  const { MAX_TEXT, BUTTON_SIZE, TRANSLATION_TAG, TRANSLATION_STYLE, isTargetText, findBlock, insertPlacement, textOf, textExceeds, buttonPosition } = core;

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

  function insert(block, translation) {
    const n = document.createElement(TRANSLATION_TAG);
    n.setAttribute('data-readgloss', 'translation');
    n.lang = 'ko';
    n.style.cssText = TRANSLATION_STYLE;
    n.textContent = translation; // innerHTML 은 쓰지 않는다
    block.insertAdjacentElement(insertPlacement(block.tagName), n);
    nodes.set(block, n);
  }

  async function onButton() {
    const block = current;
    if (!block) return;
    const shown = nodeOf(block);
    if (shown) {
      shown.remove(); // 다시 누르면 걷는다
      nodes.delete(block);
    } else if (requests.get(block)?.status !== 'loading') {
      const text = textOf(block, { isHidden });
      if (text.length > MAX_TEXT) {
        requests.set(block, { status: 'error', error: 'too-large' });
      } else {
        requests.set(block, { status: 'loading' });
        refresh();
        let r;
        try {
          r = await chrome.runtime.sendMessage({ type: 'translate', text, ...(globalThis.readglossGlossary?.hint(settings, document, location.hostname) ?? {}) });
        } catch {
          r = { error: 'ext-reloaded' }; // 확장이 다시 로드되면 이 페이지의 연결이 끊긴다
        }
        if (r?.translation && block.isConnected) {
          requests.delete(block);
          insert(block, r.translation);
        } else {
          requests.set(block, { status: 'error', error: r?.error ?? 'no-response' });
        }
      }
    }
    if (current === block) {
      refresh();
      place();
    }
  }

  function onClick(e) {
    if (host && e.composedPath().includes(host)) return; // 번역 버튼 안
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
    if (!allowed()) hide();
  });
  try {
    globalThis.readglossSettings?.load().then((s) => ((settings = s), applyTheme(), allowed() || hide()), () => {});
    globalThis.readglossSettings?.onChange((s) => ((settings = s), applyTheme(), allowed() || hide()));
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
