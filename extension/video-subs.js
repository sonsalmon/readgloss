// 유튜브 영상 페이지의 readgloss 자막 층(변경 기록 27-2). DOM 접착만 하고 판단은 video-core.js(globalThis.readglossVideo)가 한다.
// 자막 글은 yt-hook.js(MAIN world)가 플레이어 응답을 엿들어 postMessage 로 넘겨 준다.
// 패널 [영상] 탭(panel-video.js)·복습(panel-words.js)은 globalThis.readglossVideoUi 로 부른다.
(() => {
  if (typeof document === 'undefined' || !/(^|\.)youtube\.com$/.test(location.hostname) || globalThis.readglossVideoUi) return;
  const V = globalThis.readglossVideo;
  const Sel = globalThis.readglossSelection;
  const SET = globalThis.readglossSettings;
  if (!V || !Sel || !SET) return;

  const SOURCE = 'readgloss-yt';
  const WAIT_MS = 5000; // 이만큼 지나도 영어 줄이 없으면 안내
  const MSG_MS = 8000; // 안내가 떠 있는 시간
  const ERR_PAUSE_MS = 15000; // 번역·주석이 다리 문제로 실패하면 이만큼 쉬었다 다시
  const MAX_ASKED = 20000; // 물어본 낱말 기억 상한(넘으면 비운다)
  const ERR = {
    'bridge-off': '다리가 꺼져 있어요', 'mt-unavailable': '맥 번역 도우미가 없어요(npm run build:mt)', 'mt-failed': '맥 번역이 실패했어요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요', 'pair-failed': '다리와 연결하지 못했어요(인증)', unauthorized: '다리와 연결하지 못했어요(인증)',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 눌러 주세요', 'ai-failed': '풀이를 가져오지 못했어요',
  };
  const STOP_KO = new Set(['bridge-off', 'mt-unavailable', 'ext-reloaded', 'pair-failed', 'unauthorized']); // 줄 하나가 아니라 번역 전체가 막힌 오류
  const errText = (r, head) => ERR[r?.error] ?? `${head}(${r?.error ?? '응답 없음'})`;

  let settings = SET.normalize({});
  const vs = () => settings.video;
  const S = {
    tracks: [], id: null, mainKey: '', koKey: '', main: null, others: false,
    cues: [], ko: [], koFail: new Set(), cur: -1, past: false, revealed: -1, pausedFor: -1, clip: null,
    hard: new Map(), asked: new Set(), annotBusy: false, annotErrAt: 0, hardVer: 0,
    koBusy: false, koAll: false, koErr: '', koErrAt: 0,
    savedForms: new Map(), phrases: {}, savedVer: 0, saving: false,
    note: null, waitSince: Date.now(), ccTried: new Set(), msg: '', msgAt: 0,
  };
  // 잠깐 멈춤(마우스를 올림·사전 카드·풀이): 이유가 하나라도 있으면 멈춰 두고, 우리가 멈춘 것만 다시 재생한다. 사용자가 직접 재생하면 이유를 다 지운다.
  const hold = { reasons: new Set(), paused: false, ours: false };
  const listeners = new Set();
  let player = null;
  let video = null;
  let host = null;
  let ui = null;
  let raf = 0;
  let sizeObs = null;

  function apply(s) {
    if (s.level !== settings.level) {
      S.hard = new Map();
      S.asked = new Set();
      S.hardVer++;
    }
    settings = s;
    layout();
    render();
    pumpKo();
    pumpAnnot();
  }
  SET.load().then(apply, () => {});
  try {
    SET.onChange(apply);
  } catch { /* 확장 밖 */ }
  function setVideo(patch) {
    settings = SET.merge(settings, { video: patch });
    render();
    pumpAnnot();
    SET.save({ video: patch }).catch(() => {});
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage({ ...message, page: { url: location.href.slice(0, 2000), title: document.title.slice(0, 200) } });
    } catch {
      return { error: 'ext-reloaded' };
    }
  }
  const notify = (what, i) => listeners.forEach((cb) => { try { cb(what, i); } catch { /* 탭 그리기 오류는 무시 */ } });
  const titleNow = () => V.titleOf(document.title);
  const wordsChanged = () => window.dispatchEvent(new CustomEvent('readgloss:words', { detail: { known: [], unknown: [] } })); // 패널이 다시 읽게(주석은 반응하지 않게 빈 목록)
  const toast = (text, anchorEl) => globalThis.readglossToast?.show({ text, anchor: anchorEl?.getBoundingClientRect?.() ?? null, ms: 1800 });

  // ---- 자막 받기(yt-hook.js) ----
  // 같은 트랙을 다시 받아도(replay) 번역·칠하기를 버리지 않게 내용 열쇠로 비교한다
  const keyOf = (t) => [t.videoId, t.lang, t.tlang, t.kind, t.cues.length, t.cues[0]?.start, t.cues[t.cues.length - 1]?.end].join('|');
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SOURCE || d.type !== 'timedtext' || typeof d.url !== 'string' || typeof d.body !== 'string') return;
    let tr = null;
    try {
      tr = V.parseTrack(d.body, d.url);
    } catch { /* 못 읽는 자막 */ }
    if (!tr?.videoId) return;
    tr.ts = Date.now();
    S.tracks = [...S.tracks.filter((x) => !(x.videoId === tr.videoId && x.lang === tr.lang && x.tlang === tr.tlang && x.kind === tr.kind)), tr].slice(-20);
    if (tr.videoId === S.id) chooseTracks();
  });

  function chooseTracks() {
    const mine = S.tracks.filter((t) => t.videoId === S.id);
    const { main, ko } = V.pickTracks(mine);
    const key = main ? keyOf(main) : '';
    if (key !== S.mainKey) {
      S.mainKey = key;
      S.koKey = '';
      S.main = main;
      S.cues = main ? main.cues : [];
      S.ko = new Array(S.cues.length).fill('');
      S.koFail = new Set();
      S.cur = -1;
      S.revealed = -1;
      S.pausedFor = -1;
      S.note = null;
      S.koErr = '';
    }
    const kk = main && ko ? keyOf(ko) : '';
    if (kk && kk !== S.koKey) {
      S.koKey = kk;
      V.alignKo(S.cues, ko.cues).forEach((t, i) => { if (t) S.ko[i] = t; }); // 유튜브 한국어 자막을 골라 두었으면 그것을 한국어 줄로
    }
    S.others = mine.length > 0 && !main;
    tick(true);
    pumpKo();
    pumpAnnot();
    notify('track');
  }

  // ---- 페이지·플레이어 ----
  function checkPage() {
    attach();
    const id = location.pathname === '/watch' ? V.videoIdOf(location.href) : null;
    if (id !== S.id) {
      S.id = id;
      S.mainKey = '';
      S.main = null;
      S.cues = [];
      S.ko = [];
      S.clip = null;
      S.koAll = false;
      S.waitSince = Date.now();
      S.msg = '';
      hold.reasons.clear();
      hold.paused = false;
      chooseTracks();
      if (id) {
        window.postMessage({ source: SOURCE, type: 'replay' }, location.origin); // 늦게 뜬 이 스크립트를 위해 들고 있던 자막을 다시
        askPending(id);
        loadSaved();
      }
      notify('page');
    }
    ensureCaptions();
    render();
  }

  function attach() {
    const p = document.getElementById('movie_player');
    if (p !== player) {
      player = p;
      sizeObs?.disconnect();
      if (p && typeof ResizeObserver === 'function') {
        sizeObs = new ResizeObserver(() => layout());
        sizeObs.observe(p);
      }
    }
    if (player && (!host || host.parentNode !== player)) {
      if (!host) build();
      player.append(host);
      layout();
    }
    const v = player?.querySelector('video.html5-main-video') ?? player?.querySelector('video') ?? null;
    if (v !== video) {
      if (video) unbind(video);
      video = v;
      if (v) bind(v);
    }
  }

  const adShowing = () => Boolean(player?.classList.contains('ad-showing'));
  const ccButton = () => player?.querySelector('.ytp-subtitles-button') ?? null;
  // 단추가 없거나 aria-pressed 모양이 바뀌었으면 켜진 것으로 본다(27-7)
  const ccOn = () => ccButton()?.getAttribute('aria-pressed') !== 'false';
  function ccAvailable(b = ccButton()) {
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const st = getComputedStyle(b);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }
  // 자막 켜기 도움: 영상마다 한 번, 자막이 꺼져 있으면 CC 단추를 누른다(플레이어가 자막을 받아야 우리도 받는다)
  function ensureCaptions() {
    if (!S.id || !player || !vs().subs || !vs().autoCC || S.ccTried.has(S.id) || S.cues.length || adShowing()) return;
    if (Date.now() - S.waitSince < 1500) return; // 플레이어가 자리 잡을 때까지
    const b = ccButton();
    if (!b || !ccAvailable(b)) {
      if (Date.now() - S.waitSince > 10_000) S.ccTried.add(S.id);
      return;
    }
    S.ccTried.add(S.id);
    if (b.getAttribute('aria-pressed') === 'false') b.click();
  }
  function waitMessage() {
    if (!vs().subs || !S.id || !player || S.cues.length || adShowing() || Date.now() - S.waitSince < WAIT_MS) return '';
    if (S.others) return '영어 자막을 골라 주세요(⚙ → 자막)';
    const b = ccButton();
    if (!b) return '';
    if (!ccAvailable(b)) return vs().autoCC ? '이 영상은 자막이 없어요' : '';
    if (ccOn()) return '자막을 받지 못했어요 — 자막(CC)을 껐다 켜거나 새로고침해 보세요';
    return '';
  }

  // 유튜브 자막은 우리 층이 보이는 동안만 숨긴다
  const PAGE_CSS = 'html[data-readgloss-subs] .html5-video-player .ytp-caption-window-container { display: none !important; }';
  let pageSheet = null;
  function ensurePageStyle() {
    if (pageSheet) return;
    if (typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets) {
      try {
        pageSheet = new CSSStyleSheet();
        pageSheet.replaceSync(PAGE_CSS);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
        return;
      } catch {
        pageSheet = null;
      }
    }
    pageSheet = document.createElement('style'); // adoptedStyleSheets 가 안 되면 style 엘리먼트(saved-marks.js 와 같은 대체)
    pageSheet.textContent = PAGE_CSS;
    (document.head || document.documentElement).append(pageSheet);
  }

  // ---- 영상 시각 따라가기 ----
  function onPlay() {
    if (hold.ours) hold.ours = false;
    else {
      hold.reasons.clear(); // 사용자가 직접 재생했다
      hold.paused = false;
    }
    startLoop();
  }
  function onPause() {
    if (hold.ours) hold.ours = false;
    tick(true);
  }
  function onSeeked() {
    const c = S.cues[S.pausedFor];
    if (c && video.currentTime < c.end - 0.1) S.pausedFor = -1; // 그 줄로 되돌아가면 끝에서 다시 멈춘다
    tick(true);
  }
  const onTime = () => tick();
  function bind(v) {
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onTime);
    if (!v.paused) startLoop();
  }
  function unbind(v) {
    v.removeEventListener('play', onPlay);
    v.removeEventListener('pause', onPause);
    v.removeEventListener('seeked', onSeeked);
    v.removeEventListener('timeupdate', onTime);
    v.removeEventListener('loadedmetadata', onTime);
  }
  function startLoop() {
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function loop() {
    raf = 0;
    tick();
    if (video && !video.paused && !document.hidden) raf = requestAnimationFrame(loop); // 숨은 탭은 timeupdate 가 이어 받는다
  }

  function tick(force = false) {
    if (!video || adShowing()) {
      if (force) render();
      return;
    }
    const t = video.currentTime;
    // 장면 구간은 자막이 없어도(자막 꺼짐·자막 없는 영상) 끝에서 멈춘다
    if (S.clip) {
      if (t >= S.clip.end) {
        S.clip = null;
        video.pause();
      } else if (t < S.clip.start - 1) S.clip = null; // 사용자가 구간 밖으로 옮겼다
    }
    if (!S.cues.length) {
      if (force) render();
      return;
    }
    const i = V.activeIndex(S.cues, t);
    if (!S.clip && V.shouldPauseEach({ on: vs().pauseEach, cur: i, pausedFor: S.pausedFor, t, cues: S.cues })) {
      S.pausedFor = i;
      video.pause();
    }
    const past = i >= 0 && !V.isLive(S.cues, i, t);
    if (force || i !== S.cur || past !== S.past) {
      if (i !== S.cur) {
        S.cur = i;
        S.revealed = -1;
        notify('cur', i);
        pumpKo();
        pumpAnnot();
      }
      S.past = past;
      render();
    }
  }

  function holdOn(reason) {
    hold.reasons.add(reason);
    if (video && !video.paused) {
      hold.paused = true;
      hold.ours = true;
      video.pause();
    }
  }
  function holdOff(reason) {
    if (!hold.reasons.delete(reason) || hold.reasons.size || !hold.paused) return;
    hold.paused = false;
    if (video?.paused) {
      hold.ours = true;
      video.play()?.catch?.(() => { hold.ours = false; });
    }
  }
  // 다른 낱말을 누르면 카드가 닫혔다 곧 다시 열린다: 잠깐 기다렸다가 정말 닫혔을 때만 멈춤을 푼다
  window.addEventListener('readgloss:card-closed', () => setTimeout(() => { if (!globalThis.readglossDictCardUi?.isOpen?.()) holdOff('card'); }, 150));

  // ---- 그리기 ----
  const CSS = `
    .box { pointer-events: auto; box-sizing: border-box; max-width: min(92%, 1100px); display: flex; flex-direction: column; align-items: center; gap: 4px;
      font-family: "YouTube Noto", Roboto, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .lines { order: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; border-radius: 6px; transition: opacity .15s; }
    .lines:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
    .note { order: -2; } .bar { order: -1; } .msg { order: 1; } /* 화면 차례(풀이 → 막대 → 두 줄 → 안내)와 Tab 차례(두 줄 → 막대 → 풀이)를 따로 */
    .lines.past { opacity: .62; }
    .en, .ko { box-sizing: border-box; max-width: 100%; padding: .08em .45em; border-radius: 4px; background: rgba(8, 8, 8, .74); color: #fff; text-align: center; line-height: 1.38; overflow-wrap: anywhere; }
    .en { font-size: var(--fs, 22px); user-select: none; }
    .ko { font-size: calc(var(--fs, 22px) * .82); color: #f1f1f1; }
    .ko.err { color: #c9c9c9; font-size: calc(var(--fs, 22px) * .62); }
    .en:empty, .ko:empty { display: none; }
    .w { position: relative; cursor: pointer; border-radius: 3px; }
    .w:hover { background: rgba(255, 255, 255, .2); }
    .w.hard { text-decoration: underline dotted rgba(255, 214, 102, .95); text-decoration-thickness: .08em; text-underline-offset: .2em; }
    .w.saved { background: rgba(56, 189, 248, .34); }
    .w.hid { color: transparent; background: rgba(255, 255, 255, .24); text-decoration: none; }
    .w .g { display: none; position: absolute; left: 50%; bottom: 100%; transform: translate(-50%, -2px); white-space: nowrap; pointer-events: none;
      padding: 1px 6px; border-radius: 4px; background: rgba(20, 20, 20, .94); color: #ffe08a; font-size: max(12px, .52em); line-height: 1.5; }
    .w.hard:hover .g { display: block; }
    .w.hid .g { display: none !important; }
    .bar { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; visibility: hidden; opacity: 0; transition: opacity .15s, visibility .15s; }
    .box:hover .bar, .box:focus-within .bar { visibility: visible; opacity: 1; } /* 숨은 막대 자리에 마우스가 지나가도 멈추지 않게 visibility 로 */
    button { all: unset; box-sizing: border-box; cursor: pointer; padding: 0 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, .2);
      background: rgba(28, 28, 28, .92); color: #fff; font: 12px/1.7 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; white-space: nowrap; }
    button:hover:not(:disabled) { border-color: #fff; }
    button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 1px; }
    button[aria-pressed="true"], button[aria-expanded="true"] { background: rgba(62, 166, 255, .32); border-color: #3ea6ff; }
    button:disabled { opacity: .45; cursor: default; }
    .note { position: relative; box-sizing: border-box; max-width: min(100%, 720px); max-height: 38vh; overflow-y: auto; padding: 8px 30px 8px 12px; border-radius: 8px;
      background: rgba(20, 20, 20, .94); color: #eee; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; text-align: left; }
    .note .x { position: absolute; top: 6px; right: 6px; padding: 0 6px; }
    .note .tr { font-weight: 600; color: #fff; }
    .note .nt { color: #c8c8c8; margin-top: 3px; }
    .note .ex { display: flex; align-items: baseline; gap: 6px; margin-top: 4px; }
    .note .ex .en2 { font-weight: 600; } .note .ex .ko2 { color: #c8c8c8; }
    .msg { padding: 4px 12px; border-radius: 6px; background: rgba(20, 20, 20, .88); color: #eee; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    [hidden] { display: none !important; }
    @media (prefers-reduced-motion: reduce) { .bar, .lines { transition: none; } }
  `;
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; // 자막·번역·풀이 글은 textContent 로만 넣는다
    return n;
  }
  function button(text, label, onclick) {
    const b = el('button', '', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onclick(e);
      b.blur(); // 키보드는 유튜브(k·Space 등)로 돌려준다
    });
    return b;
  }

  function build() {
    host = document.createElement('readgloss-subs');
    host.style.cssText = 'all: initial; position: absolute; left: 0; right: 0; bottom: 62px; z-index: 59; display: none; justify-content: center; pointer-events: none; transition: bottom .15s;';
    // 플레이어가 클릭으로 재생·멈춤, 더블클릭으로 전체 화면을 하지 않게 우리 층에서 멈춘다(키는 막지 않는다)
    for (const t of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu']) host.addEventListener(t, (e) => e.stopPropagation());
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = CSS;
    const box = el('div', 'box');
    const bar = el('div', 'bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'readgloss 자막');
    const prevBtn = button('‹', '앞 줄 (A)', () => run('prev'));
    const repeatBtn = button('↻', '이 줄 다시 (S)', () => run('repeat'));
    const nextBtn = button('›', '다음 줄 (D)', () => run('next'));
    const hideBtn = button('가리기: 끔', '가리기 바꾸기 (H)', () => run('hide'));
    const pauseBtn = button('줄마다 멈춤', '줄마다 멈춤 (P)', () => run('pauseEach'));
    const koBtn = button('한', '한국어 줄 보이기', () => setVideo({ ko: !vs().ko }));
    const saveBtn = button('☆ 저장', '이 줄 구·문장에 저장', () => saveLine(S.cur, saveBtn));
    const explainBtn = button('풀이', '이 줄 AI 풀이(문맥 번역)', () => explain(S.cur));
    bar.append(prevBtn, repeatBtn, nextBtn, hideBtn, pauseBtn, koBtn, saveBtn, explainBtn);
    const note = el('div', 'note');
    note.hidden = true;
    note.setAttribute('role', 'status');
    const lines = el('div', 'lines');
    // 키보드만 쓸 때: Tab 으로 두 줄에 오면 막대가 보이고 다음 Tab 이 막대 단추로 간다(27-2)
    lines.tabIndex = 0;
    lines.setAttribute('role', 'group');
    lines.setAttribute('aria-label', 'readgloss 자막 — A 앞 줄 · S 이 줄 다시 · D 다음 줄 · H 가리기 · R 가린 줄 보기 · P 줄마다 멈춤');
    const en = el('div', 'en');
    en.lang = 'en';
    const ko = el('div', 'ko');
    ko.lang = 'ko';
    lines.append(en, ko);
    const msg = el('div', 'msg');
    msg.hidden = true;
    msg.setAttribute('role', 'status');
    box.append(lines, bar, note, msg);
    shadow.append(style, box);
    ui = { box, bar, note, lines, en, ko, msg, prevBtn, repeatBtn, nextBtn, hideBtn, pauseBtn, koBtn, saveBtn, explainBtn, lineKey: '', noteKey: '', tokens: [] };

    en.addEventListener('click', (e) => {
      const sp = e.target?.closest?.('.w');
      const cue = S.cues[S.cur];
      if (!sp || !cue) return;
      if (sp.classList.contains('hid')) {
        S.revealed = S.cur; // 가린 낱말을 누르면 그 줄을 보인다
        return renderLine();
      }
      const tk = ui.tokens[Number(sp.dataset.k)];
      if (tk?.w) lookupWord(tk.t, S.cur, sp.getBoundingClientRect());
    });
    box.addEventListener('mouseenter', () => vs().hoverPause && holdOn('hover'));
    box.addEventListener('mouseleave', () => holdOff('hover'));
  }

  // 글자 크기는 플레이어 높이를 따라가고, 줄은 유튜브 조작 막대 위에 둔다(막대가 숨어도 같은 자리 — 마우스를 올렸을 때 자막이 움직이지 않게)
  function layout() {
    if (!host || !player) return;
    host.style.setProperty('--fs', `${V.fontPx(player.clientHeight || 360, vs().fontPct)}px`);
    const bar = player.querySelector('.ytp-chrome-bottom');
    host.style.bottom = `${(bar?.offsetHeight || 48) + 14}px`;
  }

  const visible = () => Boolean(vs().subs && S.id && player && video && S.cues.length && ccOn() && !adShowing());
  function render() {
    if (!host || !ui) return;
    const show = visible();
    document.documentElement.toggleAttribute('data-readgloss-subs', show);
    if (show) ensurePageStyle();
    const msg = waitMessage();
    if (msg !== S.msg) {
      S.msg = msg;
      S.msgAt = Date.now();
      notify('message');
    }
    const showMsg = Boolean(msg) && Date.now() - S.msgAt < MSG_MS;
    ui.msg.hidden = !showMsg;
    if (ui.msg.textContent !== msg) ui.msg.textContent = msg;
    host.style.display = show || showMsg ? 'flex' : 'none';
    ui.lines.hidden = ui.bar.hidden = !show;
    if (!show) {
      ui.note.hidden = true;
      return;
    }
    renderLine();
    renderBar();
    renderNote();
  }

  // 영어 줄은 바뀐 것이 있을 때만 다시 만든다(누르는 사이에 낱말이 갈리면 클릭이 사라진다)
  function renderLine() {
    if (!ui) return;
    const i = S.cur;
    const cue = S.cues[i];
    const v = vs();
    ui.lines.classList.toggle('past', S.past);
    const key = cue ? [S.mainKey, i, S.revealed === i, v.hide, v.hard, v.ko, S.ko[i] ?? '', S.koErr, S.hardVer, S.savedVer].join('|') : '';
    if (key === ui.lineKey) return;
    ui.lineKey = key;
    ui.en.replaceChildren();
    ui.tokens = [];
    if (!cue) {
      ui.ko.textContent = '';
      return;
    }
    const toks = V.tokenize(cue.text);
    const hid = V.maskFlags(toks, S.revealed === i ? 'off' : v.hide, (w) => S.hard.has(w));
    toks.forEach((tk, k) => {
      if (!tk.w) return void ui.en.append(tk.t);
      const sp = el('span', 'w', tk.t);
      sp.dataset.k = String(k);
      const h = S.hard.get(tk.lower);
      if (v.hard && h) {
        sp.classList.add('hard');
        if (h.gloss) sp.append(el('span', 'g', h.gloss));
      }
      if (S.savedForms.has(tk.lower)) sp.classList.add('saved');
      if (hid[k]) {
        sp.classList.add('hid');
        sp.title = '가린 낱말 — 누르거나 R 로 보기';
      }
      ui.en.append(sp);
    });
    ui.tokens = toks;
    const koText = S.ko[i] || (S.koErr && !S.koFail.has(i) ? S.koErr : '');
    ui.ko.textContent = v.ko ? koText : '';
    ui.ko.classList.toggle('err', !S.ko[i] && Boolean(koText));
  }

  function setBtn(b, text, label) {
    if (b.textContent !== text) b.textContent = text;
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  function renderBar() {
    const v = vs();
    const cue = S.cues[S.cur];
    const hide = V.HIDE_LABEL[v.hide] ?? '끔';
    setBtn(ui.hideBtn, `가리기: ${hide}`, `가리기 바꾸기 (H) — 지금 ${hide}`);
    ui.pauseBtn.setAttribute('aria-pressed', String(v.pauseEach));
    ui.koBtn.setAttribute('aria-pressed', String(v.ko));
    const saved = cue ? Boolean(Sel.findPhrase(S.phrases, cue.text)) : false;
    setBtn(ui.saveBtn, saved ? '★ 저장됨' : '☆ 저장', saved ? '이 줄 저장 빼기' : '이 줄 구·문장에 저장');
    ui.saveBtn.setAttribute('aria-pressed', String(saved));
    ui.explainBtn.setAttribute('aria-expanded', String(Boolean(S.note) && S.note.i === S.cur));
    for (const b of [ui.prevBtn, ui.repeatBtn, ui.nextBtn, ui.saveBtn, ui.explainBtn]) b.disabled = !cue;
  }

  function renderNote() {
    const n = S.note;
    const show = Boolean(n) && n.i === S.cur;
    ui.note.hidden = !show;
    if (!show) return;
    const key = [S.mainKey, n.i, n.state, S.savedVer].join('|');
    if (key === ui.noteKey) return;
    ui.noteKey = key;
    const x = button('✕', '풀이 닫기', () => {
      S.note = null;
      holdOff('note');
      render();
    });
    x.classList.add('x');
    if (n.state !== 'done') return ui.note.replaceChildren(x, el('div', 'nt', n.state === 'loading' ? '풀이를 가져오는 중…' : n.text));
    const cue = S.cues[n.i];
    const kids = [x, el('div', 'tr', n.data.translation)];
    if (n.data.note) kids.push(el('div', 'nt', n.data.note));
    for (const row of Sel.expressionRows(n.data.expressions, S.phrases)) {
      const m = Sel.expressionButton(row.en, Boolean(row.id));
      const line = el('div', 'ex');
      const b = button(m.text, m.label, () => toggleExpression(row, cue, b));
      line.append(b, el('span', 'en2', row.en), el('span', 'ko2', row.ko));
      kids.push(line);
    }
    ui.note.replaceChildren(...kids);
  }

  // ---- 동작 ----
  function goLine(i) {
    const c = S.cues[i];
    if (!c || !video) return;
    S.clip = null;
    S.pausedFor = -1;
    video.currentTime = c.start + 0.01; // 줄 시작보다 앞이면 앞 줄이 잠깐 지금 줄이 된다
    if (video.paused) video.play()?.catch?.(() => {});
    tick(true);
  }
  function run(act) {
    const i = S.cur;
    if (act === 'prev') return goLine(Math.max(0, i - 1));
    if (act === 'repeat') return goLine(Math.max(0, i));
    if (act === 'next') return goLine(Math.min(S.cues.length - 1, i + 1));
    if (act === 'hide') return setVideo({ hide: V.nextHide(vs().hide) });
    if (act === 'pauseEach') return setVideo({ pauseEach: !vs().pauseEach });
    if (act === 'reveal') {
      S.revealed = i;
      renderLine();
    }
  }

  function lookupWord(word, i, rect) {
    const cue = S.cues[i];
    if (!cue) return;
    holdOn('card');
    const title = titleNow();
    const ctx = V.contextOf(S.cues, i, title);
    // 사전 카드(content.js): 문장 = 이 줄, 문맥 = 앞뒤 3줄, 출처 = 이 줄 장면(단어장에 담으면 장면이 같이 남는다)
    window.dispatchEvent(new CustomEvent('readgloss:lookup', {
      detail: { word, sentence: cue.text, rect: { left: rect.left, top: rect.top, bottom: rect.bottom }, context: { ...ctx, headings: [] }, source: { url: V.sceneUrl(S.id, cue.start), title } },
    }));
    if (!globalThis.readglossDictCardUi?.isOpen?.()) holdOff('card'); // 카드가 안 열렸으면(영어 낱말 아님 등) 멈춤을 바로 푼다
  }

  async function saveLine(i, anchorEl) {
    const cue = S.cues[i];
    if (!cue || S.saving) return;
    S.saving = true;
    const pid = Sel.findPhrase(S.phrases, cue.text);
    let ko = S.ko[i] || '';
    if (!pid && !ko) ko = (await send({ type: 'mt', text: cue.text }))?.translation || ''; // 한국어 줄을 꺼 두었어도 복습 뒷면에 번역이 있게
    const r = await send(pid ? { type: 'words', op: 'unsave-phrase', id: pid } : V.lineMessage({ cue, ko, id: S.id, title: titleNow() }));
    S.saving = false;
    if (r?.phrases) {
      S.phrases = r.phrases;
      S.savedVer++;
      toast(pid ? '구·문장에서 뺐어요' : '구·문장에 저장했어요', anchorEl);
      wordsChanged();
    } else toast(errText(r, '저장하지 못했어요'), anchorEl);
    render();
    notify('saved', i);
  }

  async function toggleExpression(row, cue, b) {
    if (!cue) return;
    const msg = Sel.expressionToggle(row, { sentence: cue.text, url: V.sceneUrl(S.id, cue.start), title: titleNow() });
    if (msg.op === 'save-phrase') msg.clip = V.clipOfCue(cue); // 표현도 그 줄 소리로 복습할 수 있게
    b.disabled = true;
    const r = await send(msg);
    b.disabled = false;
    if (r?.phrases) {
      S.phrases = r.phrases;
      S.savedVer++;
      toast(row.id ? '구·문장에서 뺐어요' : '표현을 저장했어요', b);
      wordsChanged();
    } else toast(errText(r, '저장하지 못했어요'), b);
    render();
  }

  // [풀이]: 문맥 번역(AI). 누를 때만 부른다(구독 한도). 다시 누르면 닫는다.
  async function explain(i) {
    const cue = S.cues[i];
    if (!cue) return;
    if (S.note?.i === i) {
      if (S.note.state === 'loading') return;
      S.note = null;
      holdOff('note');
      return render();
    }
    S.note = { i, state: 'loading' };
    holdOn('note');
    render();
    const ctx = V.contextOf(S.cues, i, titleNow());
    const r = await send({ type: 'translate-context', text: cue.text, context: { before: ctx.before, after: ctx.after, title: ctx.title, headings: [] } });
    if (S.note?.i !== i || S.cues[i] !== cue) return;
    S.note = typeof r?.translation === 'string' && r.translation ? { i, state: 'done', data: r } : { i, state: 'error', text: errText(r, '풀이를 가져오지 못했어요') };
    render();
  }

  // ---- 한국어 줄(맥 번역): 한 번에 하나씩, 지금 줄 근처부터 ----
  async function pumpKo() {
    if (S.koBusy || !vs().ko || !S.cues.length || !S.id) return;
    if (S.koErr) {
      if (Date.now() - S.koErrAt < ERR_PAUSE_MS) return;
      S.koErr = '';
    }
    const i = V.koPlan(S.cues.length, S.cur, (k) => Boolean(S.ko[k]) || S.koFail.has(k), S.koAll);
    if (i < 0) return;
    S.koBusy = true;
    const key = S.mainKey;
    const text = S.cues[i].text;
    const r = await send({ type: 'mt', text });
    S.koBusy = false;
    if (key !== S.mainKey) return pumpKo(); // 그 사이 영상·자막이 바뀌었다
    if (typeof r?.translation === 'string' && r.translation) {
      S.ko[i] = r.translation;
      if (i === S.cur) renderLine();
      notify('ko', i);
      return pumpKo();
    }
    if (STOP_KO.has(r?.error)) {
      S.koErr = errText(r, '한국어 줄을 가져오지 못했어요');
      S.koErrAt = Date.now();
      setTimeout(pumpKo, ERR_PAUSE_MS + 50);
    } else S.koFail.add(i); // 이 줄만 안 된다: 건너뛴다
    if (i === S.cur) renderLine();
    notify('ko', i);
    if (!S.koErr) pumpKo();
  }

  // ---- 어려운 단어(/annotate): 지금 줄부터 30줄 안의 아직 안 물은 낱말 ----
  async function askAnnot(words) {
    S.annotBusy = true;
    const r = await send({ type: 'annotate', words, level: settings.level });
    S.annotBusy = false;
    if (!r?.items || typeof r.items !== 'object') {
      S.annotErrAt = Date.now();
      return false;
    }
    if (S.asked.size + words.length > MAX_ASKED) {
      S.asked = new Set();
      S.hard = new Map();
    }
    for (const w of words) S.asked.add(w);
    for (const [w, it] of Object.entries(r.items)) {
      if (it && typeof it === 'object' && typeof it.gloss === 'string') S.hard.set(w.toLowerCase(), { lemma: typeof it.lemma === 'string' ? it.lemma : w.toLowerCase(), gloss: it.gloss });
    }
    S.hardVer++;
    renderLine();
    notify('hard');
    return true;
  }
  function pumpAnnot() {
    const v = vs();
    if (!(v.hard || v.hide === 'hard') || !S.cues.length || S.annotBusy || Date.now() - S.annotErrAt < ERR_PAUSE_MS) return;
    const { words } = V.annotateBatch(S.cues, Math.max(0, S.cur), S.asked);
    if (words.length) askAnnot(words).then((ok) => ok && pumpAnnot());
  }
  // 패널 [어려운 단어 보기]: 대본 전체를 300개씩
  async function annotateAll() {
    for (let n = 0; n < 200; n++) {
      while (S.annotBusy) await new Promise((r) => setTimeout(r, 100));
      const { words } = V.annotateBatch(S.cues, 0, S.asked, { maxCues: Infinity });
      if (!words.length) return true;
      if (!(await askAnnot(words))) return false;
    }
    return true;
  }

  // ---- 단어장(칠하기·★) ----
  async function loadSaved() {
    const r = await send({ type: 'words', op: 'get' });
    if (!r?.saved) return;
    S.savedForms = globalThis.readglossSavedMarksCore?.buildFormSet?.(Object.keys(r.saved)) ?? new Map();
    S.phrases = r.phrases ?? {};
    S.savedVer++;
    render();
    notify('saved');
  }
  let savedTimer = 0;
  window.addEventListener('readgloss:words', () => {
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => S.id && loadSaved(), 300);
  });

  // ---- 장면 재생(복습 27-4) ----
  function playClip(start, end) {
    if (!video) return false;
    S.clip = { start, end };
    S.pausedFor = -1;
    video.currentTime = start + 0.01;
    video.play()?.catch?.(() => {});
    tick(true);
    return true;
  }
  function playScene(scene) {
    if (!scene || scene.id !== S.id || !video) return false;
    const c = scene.clip ?? V.clipAt(S.cues, scene.t);
    return playClip(c.start, c.end);
  }
  // 다른 탭의 복습에서 연 장면: 광고가 끝나고 영상이 준비되면(최대 30초) 그 구간만
  async function askPending(id) {
    const r = await send({ type: 'video-pending', id });
    const p = r?.pending;
    if (!p || p.id !== id || !V.validClip(p)) return;
    const until = Date.now() + 30_000;
    (function tryPlay() {
      if (S.id !== id || Date.now() > until) return;
      if (!video || adShowing() || video.readyState < 1) return void setTimeout(tryPlay, 500);
      playClip(p.start, p.end);
    })();
  }

  // ---- 키(27-2): 입력칸 밖·고른 글 없음·우리 다른 화면(패널·카드·메모장) 밖 ----
  window.addEventListener('keydown', (e) => {
    const act = V.keyAction(e);
    if (!act || !visible()) return;
    const path = e.composedPath();
    if (Sel.isTypingPath(path, e.isComposing)) return;
    if (path.some((n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-') && n !== host)) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return; // 고른 글이 있으면 readgloss 의 다른 키(D 개념 등) 몫
    e.preventDefault();
    e.stopPropagation();
    run(act);
  }, true);

  document.addEventListener('yt-navigate-finish', checkPage);
  setInterval(checkPage, 1000); // 주소 바뀜·플레이어 교체·안내 시간을 함께 본다
  checkPage();

  globalThis.readglossVideoUi = {
    state: () => ({ id: S.id, title: titleNow(), cues: S.cues, kind: S.main?.kind ?? null, ko: S.ko, cur: S.cur, hard: S.hard, koAll: S.koAll, message: S.msg }),
    isSaved: (i) => Boolean(S.cues[i] && Sel.findPhrase(S.phrases, S.cues[i].text)),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    seek: (i) => goLine(i),
    saveLine: (i, anchorEl) => saveLine(i, anchorEl),
    setKoAll(on) {
      S.koAll = Boolean(on);
      notify('koAll');
      pumpKo();
    },
    annotateAll,
    playScene,
  };
})();
