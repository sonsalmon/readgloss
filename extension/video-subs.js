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
  const TIP_HOVER_MS = 250; // 마우스를 올린 뒤 말풍선이 뜨기까지(28-6)
  const TIP_CLOSE_MS = 200; // 낱말·말풍선을 떠난 뒤 닫히기까지(28-6)
  const MAX_DICT_MEMO = 500; // 한 영상에서 뜻을 기억해 둘 낱말 수
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
    prevT: 0, range: null, mem: { repeatedFor: -1, gapTo: -1 },
    hard: new Map(), asked: new Set(), annotBusy: false, annotErrAt: 0, hardVer: 0,
    dictMemo: new Map(), // 낱말별 사전 응답(28-6): 영상이 바뀌면 지운다
    koBusy: false, koAll: false, koErr: '', koErrAt: 0,
    savedForms: new Map(), phrases: {}, savedVer: 0, saving: false,
    note: null, waitSince: Date.now(), ccTried: new Set(), msg: '', msgAt: 0, ad: false, shown: false,
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
  // 말풍선 상태(28-6): 어느 낱말(tip.k)에 붙어 있는지, 그 줄 번호, 마우스를 떠난 뒤 닫는 타이머
  const tip = { open: false, k: -1, i: -1, el: null, lower: '', word: '' };
  let tipOpenTimer = 0;
  let tipCloseTimer = 0;

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
  // 확인 메시지: 자막 층 안 단추에서 낸 것은 층 전체 위에 띄운다(아래로 띄우면 방금 저장한 줄을 가린다 — 바닥을 화면 끝으로 주면 위에 놓인다)
  function toast(text, anchorEl) {
    const inLayer = Boolean(ui && anchorEl && ui.box.contains(anchorEl));
    const r = (inLayer ? ui.box : anchorEl)?.getBoundingClientRect?.() ?? null;
    const anchor = r && inLayer ? { left: r.left, right: r.right, top: r.top, bottom: innerHeight } : r;
    globalThis.readglossToast?.show({ text, anchor, ms: 1800 });
  }

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
      S.prevT = 0;
      S.mem = { repeatedFor: -1, gapTo: -1 };
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
    const ad = adShowing();
    if (S.ad && !ad) S.waitSince = Date.now(); // 광고가 끝났다: 자막 켜기·안내까지 기다리는 시간은 이제부터 잰다
    S.ad = ad;
    const id = location.pathname === '/watch' ? V.videoIdOf(location.href) : null;
    if (id !== S.id) {
      S.id = id;
      S.mainKey = '';
      S.main = null;
      S.cues = [];
      S.ko = [];
      S.clip = null;
      S.range = null;
      if (video) video.playbackRate = 1; // 새 영상은 1배로(28-3)
      S.prevT = 0;
      S.mem = { repeatedFor: -1, gapTo: -1 };
      S.koAll = false;
      S.waitSince = Date.now();
      S.msg = '';
      S.dictMemo = new Map(); // 영상이 바뀌면 낱말별 사전 기억을 지운다(28-6)
      closeTip();
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
      if (v) {
        v.playbackRate = 1; // 플레이어가 바뀌면 1배로(28-3)
        bind(v);
      }
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
  // 유튜브 메뉴로 속도를 바꾸면 단추 눌림 표시만 따라 그린다(우리가 playbackRate 를 되돌리지 않는다 — 28-3)
  const onRate = () => { if (ui) renderBar(); };
  function bind(v) {
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onTime);
    v.addEventListener('ratechange', onRate);
    if (!v.paused) startLoop();
  }
  function unbind(v) {
    v.removeEventListener('play', onPlay);
    v.removeEventListener('pause', onPause);
    v.removeEventListener('seeked', onSeeked);
    v.removeEventListener('timeupdate', onTime);
    v.removeEventListener('loadedmetadata', onTime);
    v.removeEventListener('ratechange', onRate);
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
        const reached = t < S.clip.end + 1; // 재생하다 끝에 닿았다(사용자가 끝 너머로 옮겼으면 멈추지 않고 구간만 끝낸다)
        S.clip = null;
        if (reached) video.pause();
      } else if (t < S.clip.start - 1) S.clip = null; // 사용자가 구간 밖으로 옮겼다
    }
    if (!S.cues.length) {
      if (force) render();
      return;
    }
    const i = V.activeIndex(S.cues, t);
    if (!S.clip && !video.paused) {
      // 재생 엔진(28-1): 구간 반복·문장 반복·줄마다 멈춤·틈 건너뛰기. 장면 구간(S.clip)·멈춤 중에는 부르지 않는다.
      const step = V.playbackStep({
        t, prevT: S.prevT, cues: S.cues, cur: i,
        settings: { repeatLine: vs().repeatLine, pauseEach: vs().pauseEach, skipGaps: vs().skipGaps },
        range: S.range, mem: S.mem, pausedFor: S.pausedFor,
      });
      S.prevT = t;
      S.mem = step.mem;
      if (step.action === 'seek' && Number.isFinite(step.to)) {
        video.currentTime = step.to;
        S.pausedFor = -1;
      } else if (step.action === 'pause') {
        S.pausedFor = i;
        video.pause();
      }
    } else S.prevT = t;
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
  // 카드가 닫히면 멈춤을 푼다. 다른 낱말을 누르면 카드가 닫혔다 곧 다시 열리니 잠깐 기다리고, 누르는 중(영상 위를 눌러 닫음)이면
  // 손을 뗀 뒤에 정한다: 유튜브는 영상 클릭으로 재생·멈춤을 바꾸니, 먼저 재생하면 그 클릭이 다시 멈춰 버린다(누른 시간에 따라 결과가 갈렸다).
  let pressing = false;
  window.addEventListener('pointerdown', (e) => { if (e.isTrusted) pressing = true; }, true);
  const release = () => setTimeout(() => { pressing = false; }, 0); // 같은 누름의 click 이 다 돈 다음
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  function afterCardClosed(until) {
    if (pressing && Date.now() < until) return void setTimeout(() => afterCardClosed(until), 50);
    if (!globalThis.readglossDictCardUi?.isOpen?.()) holdOff('card'); // 그 사이 사용자가 재생했으면 이유가 이미 지워져 아무것도 안 한다
  }
  window.addEventListener('readgloss:card-closed', () => setTimeout(() => afterCardClosed(Date.now() + 2000), 150));

  // ---- 그리기 ----
  const CSS = `
    .box { pointer-events: none; box-sizing: border-box; max-width: min(92%, 1100px); display: flex; flex-direction: column; align-items: center;
      font-family: "YouTube Noto", Roboto, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    /* 마우스는 두 줄·막대(보일 때)·풀이만 받는다: 빈 자리·숨은 막대 자리·안내 위에서는 멈추지 않는다.
       그 사이에 틈을 두지 않는다(틈을 지나면 마우스가 층을 나갔다 들어와 재생됐다가 다시 멈춘다). */
    .lines, .bar, .note { pointer-events: auto; }
    .lines { order: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; border-radius: 6px; }
    .lines:focus { outline: none; }
    /* 포커스 표시는 검정·흰·검정 세 겹(안 2px 검정 + 흰 테두리 + 밖 2px 검정): 영상이 밝든 어둡든, 어두운 자막 바탕 옆이든 흰 줄이 보인다
       (파랑 한 겹은 흰 화면에서 2.6:1, 흰+검정 두 겹은 흰 화면에서 안쪽 검정만 남아 바탕이 굵어진 것처럼 보였다) */
    .lines:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 2px rgba(8, 8, 8, .92), 0 0 0 6px rgba(8, 8, 8, .92); }
    .note { order: -2; } .bar { order: -1; } .msg { order: 1; } /* 화면 차례(풀이 → 막대 → 두 줄 → 안내)와 Tab 차례(두 줄 → 막대 → 풀이)를 따로 */
    .en, .ko { box-sizing: border-box; max-width: 100%; padding: .08em .45em; border-radius: 4px; background: rgba(8, 8, 8, .74); color: #fff; text-align: center; line-height: 1.38; overflow-wrap: anywhere; }
    .en { font-size: var(--fs, 22px); user-select: none; }
    .ko { font-size: calc(var(--fs, 22px) * .82); color: #f1f1f1; }
    .ko.err { color: #c9c9c9; font-size: calc(var(--fs, 22px) * .62); }
    /* 지난 줄(다음 줄 전 빈 사이): 바탕은 그대로 두고 글자만 흐리게 — 밝은 화면 위에서도 읽힌다 */
    .lines.past .en, .lines.past .ko { color: rgba(255, 255, 255, .72); }
    .en:empty, .ko:empty { display: none; }
    .w { position: relative; cursor: pointer; border-radius: 3px; }
    .w:hover { background: rgba(255, 255, 255, .2); }
    .w.hard { text-decoration: underline dotted rgba(255, 214, 102, .95); text-decoration-thickness: .08em; text-underline-offset: .2em; }
    .w.saved { background: rgba(56, 189, 248, .34); }
    .w.hid { color: transparent; background: rgba(255, 255, 255, .38); box-shadow: inset 0 -2px 0 rgba(255, 255, 255, .85); text-decoration: none; }
    .lines:focus .w.cur { outline: 2px solid #3ea6ff; outline-offset: 1px; } /* 키보드 낱말 자리(←·→) */
    .w .g { display: none; position: absolute; left: 50%; bottom: 100%; z-index: 1; transform: translate(-50%, -2px); white-space: nowrap; pointer-events: none;
      padding: 1px 6px; border-radius: 4px; background: rgba(20, 20, 20, .94); color: #ffe08a; font-size: max(12px, .52em); line-height: 1.5; }
    .w.hard:hover .g, .lines:focus .w.hard.cur .g { display: block; }
    .w.hid .g { display: none !important; }
    /* 말풍선(28-6): 낱말 위에 원형·뜻·저장·자세히. 어두운 바탕 + 흰 글자로 밝은 영상에서도 4.5:1 이상, 단추는 키보드로도 닿는다 */
    .tip { position: fixed; z-index: 2; pointer-events: auto; box-sizing: border-box; max-width: min(320px, 84vw); padding: 8px 10px; border-radius: 8px; text-align: left;
      background: rgba(8, 8, 8, .97); border: 1px solid rgba(255, 255, 255, .55); color: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .55);
      font: max(12px, calc(var(--fs, 22px) * .54))/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .tip .tp-lemma { font-size: max(14px, calc(var(--fs, 22px) * .64)); font-weight: 700; color: #fff; overflow-wrap: anywhere; }
    .tip .tp-gloss { margin-top: 2px; color: #f1f1f1; overflow-wrap: anywhere; }
    .tip .tp-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .tip .tp-actions button { min-height: 28px; }
    .box.tip-open .w .g { display: none !important; } /* 말풍선이 뜨면 옛 짧은 뜻 풍선은 겹치지 않게 숨긴다 */
    /* 막대: 숨어 있을 때는 visibility 라 마우스를 받지 않는다. 아래 여백은 뜻 풍선 자리(풍선이 단추를 가리지 않게)이고 막대의 일부라 두 줄과 틈이 없다 */
    .bar { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; padding: 4px 0 max(22px, calc(var(--fs, 22px) * .85)); visibility: hidden; opacity: 0; transition: opacity .15s, visibility .15s; }
    .box:hover .bar, .box:focus-within .bar { visibility: visible; opacity: 1; }
    /* 단추: 누를 자리 24px 이상, 글자는 자막 크기를 따라 커진다 */
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; padding: 0 9px; cursor: pointer;
      border-radius: 6px; border: 1px solid rgba(255, 255, 255, .2); background: rgba(28, 28, 28, .92); color: #fff;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.7 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; white-space: nowrap; }
    button:hover:not(:disabled) { border-color: #fff; }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 2px rgba(8, 8, 8, .92), 0 0 0 6px rgba(8, 8, 8, .92); }
    /* 글이 바뀌는 단추(가리기·저장): 글을 모두 한 칸에 겹쳐 두고 하나만 보인다 — 폭이 가장 긴 글로 고정돼 눌러도 막대가 흔들리지 않는다 */
    button.stack { display: inline-grid; place-items: center; }
    button.stack > span { grid-area: 1 / 1; }
    button.stack > span:not(.on) { visibility: hidden; }
    /* 눌린 단추: 옅은 파랑을 어두운 단추 바탕 위에 얹는다(파랑만 반투명이면 밝은 영상 위에서 흰 글자가 1.35:1) */
    button[aria-pressed="true"], button[aria-expanded="true"] { background: linear-gradient(rgba(62, 166, 255, .32), rgba(62, 166, 255, .32)), rgba(28, 28, 28, .92); border-color: #3ea6ff; }
    button:disabled { opacity: .45; cursor: default; }
    .note { position: relative; box-sizing: border-box; max-width: min(100%, 720px); max-height: 38vh; overflow-y: auto; padding: 8px 36px 8px 12px; border-radius: 8px;
      background: rgba(20, 20, 20, .94); color: #eee; font: max(13px, calc(var(--fs, 22px) * .6))/1.55 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; text-align: left; }
    .note .x { position: absolute; top: 6px; right: 6px; padding: 0; }
    .note .tr { font-weight: 600; color: #fff; }
    .note .nt { color: #c8c8c8; margin-top: 3px; }
    .note .ex { display: flex; align-items: baseline; gap: 6px; margin-top: 4px; }
    .note .ex .en2 { font-weight: 600; } .note .ex .ko2 { color: #c8c8c8; }
    /* 처음 한 번 키 안내(28-2): 자막 층 위 작은 카드. 밝은 영상 위에서도 읽히게 어두운 바탕 + 흰 글자, 단추는 기존 포커스 세 겹을 쓴다 */
    .notice { order: -3; pointer-events: auto; box-sizing: border-box; max-width: min(92%, 440px); padding: 10px 12px; border-radius: 10px;
      background: rgba(8, 8, 8, .94); border: 1px solid rgba(255, 255, 255, .55); color: #fff; text-align: left;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .notice .nt-title { font-size: max(14px, calc(var(--fs, 22px) * .68)); font-weight: 700; margin-bottom: 6px; }
    .notice .nt-keys { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; }
    .notice .nt-k { display: inline-grid; place-items: center; min-width: 2.2em; padding: 0 5px; border-radius: 4px; background: #2b2b2b; color: #fff; font-weight: 600; }
    .notice .nt-d { align-self: center; color: #f1f1f1; }
    .notice .nt-ok { margin-top: 8px; }
    .msg { margin-top: 4px; padding: 4px 12px; border-radius: 6px; background: rgba(20, 20, 20, .88); color: #eee;
      font: max(13px, calc(var(--fs, 22px) * .6))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    /* 안내만 뜰 때(우리 두 줄이 없을 때)는 유튜브 자막이 보일 수 있으니 그 자리 위로 올린다 */
    .box:has(.lines[hidden]) .msg { margin-bottom: max(3.4em, calc(var(--fs, 22px) * 3)); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
      if (e.detail > 0) b.blur(); // 마우스로 눌렀으면 키보드는 유튜브(k·Space 등)로 돌려준다. 키보드로 눌렀으면 그 자리에 둔다(Esc 로 나간다)
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
    const prevBtn = button('‹', '이전 줄 (A)', () => run('prev'));
    const repeatBtn = button('↻', '이 줄 처음 (S)', () => run('repeat'));
    const nextBtn = button('›', '다음 줄 (D)', () => run('next'));
    const hideBtn = button('', '가리기 바꾸기', () => run('hide'));
    stackLabels(hideBtn, Object.fromEntries(V.HIDE_MODES.map((m) => [m, `가리기: ${V.HIDE_LABEL[m]}`])));
    const pauseBtn = button('줄마다 멈춤', '줄마다 멈춤', () => run('pauseEach'));
    const lineBtn = button('문장 반복', '문장 반복 (R)', () => run('repeatLine'));
    const loopBtn = button('구간', '구간 반복 (Q)', () => run('loop', loopBtn));
    const gapBtn = button('틈 건너뛰기', '틈 건너뛰기', () => run('skipGaps'));
    const slowBtn = button('느리게', '느리게 (Z)', () => run('slow'));
    const koBtn = button('한', '한국어 줄 보이기', () => setVideo({ ko: !vs().ko }));
    const saveBtn = button('', '이 줄 구·문장에 저장 (Shift)', () => saveLine(S.cur, saveBtn));
    stackLabels(saveBtn, { off: '☆ 저장', on: '★ 저장됨' });
    const explainBtn = button('풀이', '이 줄 AI 풀이(문맥 번역)', () => explain(S.cur));
    bar.append(prevBtn, repeatBtn, nextBtn, hideBtn, pauseBtn, lineBtn, loopBtn, gapBtn, slowBtn, koBtn, saveBtn, explainBtn);
    const note = el('div', 'note');
    note.hidden = true;
    note.setAttribute('role', 'status');
    // 처음 한 번 키 안내(28-2): [알겠어요] 를 누르면 video.keysNoticeSeen 을 남겨 다시 보이지 않는다
    const notice = el('div', 'notice');
    notice.hidden = true;
    notice.setAttribute('role', 'note');
    notice.setAttribute('aria-label', '키가 바뀌었어요');
    const noticeKeys = el('div', 'nt-keys');
    for (const [key, desc] of [['A', '이전 줄'], ['S', '이 줄 처음'], ['D', '다음 줄'], ['R', '문장 반복'], ['Q', '구간 반복'], ['Z', '느리게'], ['Shift', '줄 저장']]) {
      const row = el('div', 'nt-k', key);
      noticeKeys.append(row, el('div', 'nt-d', desc));
    }
    const noticeOk = button('알겠어요', '키 안내 닫기', () => setVideo({ keysNoticeSeen: true }));
    noticeOk.classList.add('nt-ok');
    notice.append(el('div', 'nt-title', '키가 바뀌었어요'), noticeKeys, noticeOk);
    const lines = el('div', 'lines');
    // 키보드만 쓸 때: Tab 으로 두 줄에 오면 막대가 보이고 다음 Tab 이 막대 단추로 간다(27-2)
    lines.tabIndex = 0;
    lines.setAttribute('role', 'group');
    lines.setAttribute('aria-label', 'readgloss 자막 — A 이전 줄 · S 이 줄 처음 · D 다음 줄 · R 문장 반복 · Q 구간 반복 · Z 느리게 · Shift 줄 저장 · ←→ 낱말 · Enter 사전 · Esc 나가기');
    // 마우스로 눌러도 포커스는 층으로 옮기지 않는다(화살표·Space 는 유튜브 몫으로 남는다). Tab 으로만 들어온다.
    // 한국어 줄은 끌어서 고르기(복사)가 되게 기본 동작을 두고, 손을 떼면 포커스만 놓는다(고른 글은 남는다).
    let koPress = false;
    lines.addEventListener('mousedown', (e) => {
      if (e.target.closest?.('.ko')) koPress = true;
      else e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      if (!koPress) return;
      koPress = false;
      lines.blur();
    }, true);
    const en = el('div', 'en');
    en.lang = 'en';
    const ko = el('div', 'ko');
    ko.lang = 'ko';
    lines.append(en, ko);
    const msg = el('div', 'msg');
    msg.hidden = true;
    msg.setAttribute('role', 'status');
    const sr = el('div', 'sr'); // 키보드 낱말 자리를 읽어 주는 곳(화면에는 안 보인다)
    sr.setAttribute('aria-live', 'polite');
    // 낱말 말풍선(28-6): 자막 층 shadow 안에 그린다. 낱말 위(자리가 모자라면 아래)에 붙고 단추는 키보드로도 닿는다.
    const tipEl = el('div', 'tip');
    tipEl.hidden = true;
    tipEl.setAttribute('role', 'group');
    tipEl.setAttribute('aria-label', '낱말 뜻과 저장');
    box.prepend(notice);
    box.append(lines, bar, note, msg);
    box.append(tipEl); // 말풍선은 position: fixed 라 흐름에 끼지 않는다
    shadow.append(style, box, sr);
    ui = { box, bar, note, notice, lines, en, ko, msg, sr, tip: tipEl, prevBtn, repeatBtn, nextBtn, hideBtn, pauseBtn, lineBtn, loopBtn, gapBtn, slowBtn, koBtn, saveBtn, explainBtn, lineKey: '', noteKey: '', tokens: [], wcur: -1, wcurFor: '' };

    en.addEventListener('click', (e) => {
      const sp = e.target?.closest?.('.w');
      if (sp) pickWord(sp);
    });
    // 마우스를 낱말에 0.25초 올리면 말풍선(28-6). 낱말과 말풍선 사이를 오가는 동안에는 닫지 않는다.
    en.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const sp = e.target?.closest?.('.w');
      if (sp) armTip(sp);
    });
    en.addEventListener('pointerout', (e) => {
      const sp = e.target?.closest?.('.w');
      if (!sp) return;
      if (e.relatedTarget && sp.contains(e.relatedTarget)) return; // 낱말 안(옛 뜻 풍선)으로 옮겼다
      clearTimeout(tipOpenTimer);
      if (tip.open) scheduleTipClose();
    });
    tipEl.addEventListener('pointerenter', cancelTipClose);
    tipEl.addEventListener('pointerleave', () => { if (tip.open) scheduleTipClose(); });
    tipEl.addEventListener('focusin', cancelTipClose);
    tipEl.addEventListener('focusout', (e) => { if (tip.open && !tipEl.contains(e.relatedTarget)) scheduleTipClose(); });
    // 두 줄에 포커스가 있을 때: ←·→ 낱말 자리, Enter 그 낱말 사전(가린 낱말이면 그 줄 보이기), Esc 나가기.
    // 화살표는 유튜브의 5초 이동으로 새지 않게 여기서 멈춘다(포커스가 우리 층 밖이면 건드리지 않는다).
    lines.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const words = ui.tokens.flatMap((tk, k) => (tk.w ? [k] : []));
        if (!words.length) return;
        e.preventDefault();
        e.stopPropagation();
        const at = words.indexOf(ui.wcur);
        const step = e.key === 'ArrowRight' ? 1 : -1;
        moveCursor(words[at < 0 ? (step > 0 ? 0 : words.length - 1) : Math.min(words.length - 1, Math.max(0, at + step))]);
      } else if (e.key === 'Enter' && ui.wcur >= 0) {
        const sp = ui.en.querySelector(`.w[data-k="${ui.wcur}"]`);
        if (!sp) return;
        e.preventDefault();
        e.stopPropagation();
        pickWord(sp);
      }
    });
    // 포커스가 층(두 줄·막대·풀이)을 떠나면 키보드 멈춤을 풀고 낱말 자리를 지운다(다시 들어오면 첫 낱말부터).
    // 층 안에서 옮길 때(두 줄 → 막대 Tab)와 창을 잠깐 떠날 때(돌아오면 그대로 — 그 사이 영상이 저절로 재생되지 않게)는 그대로 둔다.
    box.addEventListener('focusout', (e) => {
      if (box.contains(e.relatedTarget) || !document.hasFocus()) return;
      holdOff('keys');
      ui.wcur = -1;
      ui.en.querySelector('.w.cur')?.classList.remove('cur');
      closeTip();
    });
    // Esc: 층 안 포커스를 놓아 키보드를 유튜브로 돌려준다(같은 Esc 로 사전 카드를 닫았으면 그대로 둔다)
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.readglossCardClosed) e.target?.blur?.();
    });
    box.addEventListener('mouseenter', () => vs().hoverPause && holdOn('hover'));
    box.addEventListener('mouseleave', () => holdOff('hover'));
  }

  // ---- 말풍선(28-6) ----
  const dictPending = new Set(); // 사전에 묻는 중인 낱말(같은 낱말을 두 번 묻지 않는다)
  function cancelTipClose() {
    clearTimeout(tipCloseTimer);
    tipCloseTimer = 0;
  }
  function scheduleTipClose() {
    clearTimeout(tipCloseTimer);
    tipCloseTimer = setTimeout(() => {
      tipCloseTimer = 0;
      if (ui?.tip?.matches?.(':focus-within')) return; // 말풍선 단추에 키보드 포커스가 있으면 둔다
      closeTip();
    }, TIP_CLOSE_MS);
  }
  function closeTip() {
    clearTimeout(tipOpenTimer);
    tipOpenTimer = 0;
    cancelTipClose();
    tip.open = false;
    tip.k = -1;
    tip.i = -1;
    tip.el = null;
    tip.lower = '';
    tip.word = '';
    if (!ui?.tip) return;
    ui.tip.hidden = true;
    ui.tip.replaceChildren();
    ui.box.classList.remove('tip-open');
  }
  function armTip(sp) {
    if (!ui || !sp?.isConnected || sp.classList.contains('hid')) return;
    const k = Number(sp.dataset.k);
    if (!Number.isInteger(k) || !ui.tokens[k]?.w) return;
    cancelTipClose();
    if (tip.open && tip.k === k && tip.i === S.cur) return;
    clearTimeout(tipOpenTimer);
    tipOpenTimer = setTimeout(() => {
      tipOpenTimer = 0;
      showTip(sp);
    }, TIP_HOVER_MS);
  }
  function showTip(sp) {
    if (!ui?.tip || !sp?.isConnected || sp.classList.contains('hid')) return;
    const k = Number(sp.dataset.k);
    const tk = ui.tokens[k];
    if (!tk?.w) return;
    tip.open = true;
    tip.k = k;
    tip.i = S.cur;
    tip.el = sp;
    tip.lower = tk.lower;
    tip.word = tk.t;
    ui.box.classList.add('tip-open');
    paintTip();
  }
  function paintTip() {
    if (!tip.open || !ui?.tip) return;
    const hard = S.hard.get(tip.lower);
    const dict = S.dictMemo.get(tip.lower);
    const m = V.tooltipModel({ word: tip.word, hard, dict, saved: S.savedForms.has(tip.lower) });
    const kids = [];
    if (m.state === 'found') {
      kids.push(el('div', 'tp-lemma', m.lemma), el('div', 'tp-gloss', m.gloss));
    } else if (typeof dict?.error === 'string') {
      kids.push(el('div', 'tp-gloss', errText(dict, '뜻을 가져오지 못했어요')));
    } else if (!dict && !hard) {
      kids.push(el('div', 'tp-gloss', '찾는 중…'));
    } else {
      kids.push(el('div', 'tp-gloss', '사전에 없어요'));
    }
    const acts = el('div', 'tp-actions');
    if (m.state === 'found') {
      const saveButton = button(m.saved ? '★ 저장됨' : '☆ 저장', m.saved ? '★ 저장됨, 누르면 단어장에서 빼기' : '☆ 저장, 단어장에 추가', () => toggleTipSave(m, saveButton));
      acts.append(saveButton);
    }
    acts.append(button('자세히', '자세히 — 사전 카드 열기', openTipDetail));
    kids.push(acts);
    ui.tip.hidden = false;
    ui.tip.replaceChildren(...kids);
    placeTip();
    if (!hard && !dict) askTipDict(tip.lower, tip.word);
  }
  // 낱말 위에 붙인다. 위가 모자라면(플레이어 위 끝) 낱말 아래에 둔다.
  function placeTip() {
    if (!tip.open || !ui?.tip || !tip.el?.isConnected) return;
    const r = tip.el.getBoundingClientRect();
    const t = ui.tip.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(pad, Math.min(innerWidth - t.width - pad, r.left + r.width / 2 - t.width / 2));
    let top = r.top - t.height - 6;
    if (top < pad) top = Math.min(innerHeight - t.height - pad, r.bottom + 6);
    ui.tip.style.left = `${Math.round(left)}px`;
    ui.tip.style.top = `${Math.round(top)}px`;
  }
  async function askTipDict(lower, word) {
    if (dictPending.has(lower)) return;
    dictPending.add(lower);
    const id = S.id;
    const r = await send({ type: 'dict', word });
    dictPending.delete(lower);
    if (id !== S.id) return; // 그 사이 영상이 바뀌었다
    S.dictMemo.set(lower, r && typeof r === 'object' ? (r.error ? { found: false, error: r.error } : r) : { found: false, error: '응답 없음' });
    if (S.dictMemo.size > MAX_DICT_MEMO) S.dictMemo.delete(S.dictMemo.keys().next().value);
    if (tip.open && tip.lower === lower) paintTip();
  }
  // 저장 칠하기를 바로 갱신한다(loadSaved 를 다시 부르지 않고 그 낱말의 활용형만).
  function setTipSaved(lower, lemma, on) {
    if (on) {
      const forms = globalThis.readglossSavedMarksCore?.buildFormSet?.([lemma]) ?? new Map();
      for (const [form, l] of forms) S.savedForms.set(form, l);
      S.savedForms.set(lower, S.savedForms.get(lower) ?? lower);
    } else {
      const target = String(S.savedForms.get(lower) || lemma || lower).toLowerCase();
      for (const [form, l] of [...S.savedForms]) if (l === target || form === lower) S.savedForms.delete(form);
    }
    S.savedVer++;
  }
  async function toggleTipSave(m, btn) {
    const cue = S.cues[tip.i];
    if (!cue) return;
    const lower = tip.lower;
    const word = tip.word;
    const saved = S.savedForms.has(lower);
    const lemma = saved ? S.savedForms.get(lower) || m.lemma : m.lemma || lower;
    // 지금 카드 저장과 같은 메시지(27-2·28-6): 문장 = 이 줄, 주소 = 이 줄 장면
    const msg = saved
      ? { type: 'words', op: 'unsave', lemma }
      : { type: 'words', op: 'save', lemma, word, gloss: m.gloss, sentence: cue.text, url: V.sceneUrl(S.id, cue.start) };
    btn.disabled = true;
    const r = await send(msg);
    if (!tip.open || tip.lower !== lower) return;
    btn.disabled = false;
    if (r?.saved) {
      setTipSaved(lower, lemma, !saved);
      toast(saved ? '단어장에서 뺐어요' : '단어장에 저장했어요', ui.tip);
      wordsChanged();
      renderLine(); // .w.saved 칠하기를 바로 다시 그린다
      paintTip();
    } else toast(errText(r, '저장하지 못했어요'), btn);
  }
  function openTipDetail() {
    if (!tip.open) return;
    const { i, word, el: sp } = tip;
    const rect = sp?.isConnected ? sp.getBoundingClientRect() : null;
    closeTip();
    if (rect) lookupWord(word, i, rect); // 낱말 누르기와 같은 사전 카드(카드는 지금처럼 영상을 멈춘다)
  }

  // 낱말 하나 고르기(마우스·Enter): 가린 낱말이면 그 줄을 보이고, 아니면 사전 카드
  function pickWord(sp) {
    closeTip();
    if (!S.cues[S.cur]) return;
    if (sp.classList.contains('hid')) {
      S.revealed = S.cur;
      return renderLine();
    }
    const tk = ui.tokens[Number(sp.dataset.k)];
    if (tk?.w) lookupWord(tk.t, S.cur, sp.getBoundingClientRect());
  }
  // 키보드 낱말 자리 옮기기. 움직이는 동안 줄이 넘어가지 않게 마우스를 올린 것처럼 잠깐 멈춘다(마우스 멈춤 설정을 따른다)
  function moveCursor(k) {
    if (vs().hoverPause) holdOn('keys');
    ui.en.querySelector('.w.cur')?.classList.remove('cur');
    ui.wcur = k;
    const sp = ui.en.querySelector(`.w[data-k="${k}"]`);
    if (!sp) return;
    sp.classList.add('cur');
    const tk = ui.tokens[k];
    const h = vs().hard ? S.hard.get(tk.lower) : null;
    ui.sr.textContent = sp.classList.contains('hid') ? '가린 낱말, Enter 로 그 줄 보기' : `${tk.t}${h?.gloss ? `, ${h.gloss}` : ''}`;
    if (sp.classList.contains('hid')) closeTip();
    else showTip(sp); // 키보드 낱말 자리에도 같은 말풍선(28-6)
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
    if (show !== S.shown) {
      S.shown = show;
      if (show) setTimeout(() => { pumpKo(); pumpAnnot(); }, 0); // 층이 다시 보이면(CC 켬·광고 끝) 지금 줄 근처를 채운다
    }
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
    ui.notice.hidden = !(show && !vs().keysNoticeSeen); // 처음 한 번만(알겠어요를 누르면 설정에 남는다)
    if (!show) {
      ui.note.hidden = true;
      closeTip();
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
    const cursorFor = `${S.mainKey}|${i}`;
    if (ui.wcurFor !== cursorFor) {
      ui.wcurFor = cursorFor; // 다른 줄이 되면 키보드 낱말 자리는 처음부터
      ui.wcur = -1;
    }
    ui.en.replaceChildren();
    ui.tokens = [];
    if (!cue) {
      ui.ko.textContent = '';
      closeTip();
      return;
    }
    const toks = V.tokenize(cue.text);
    const mode = S.revealed === i ? 'off' : v.hide;
    const hid = V.maskFlags(toks, mode, (w) => S.hard.has(w));
    toks.forEach((tk, k) => {
      if (!tk.w) return void appendRest(tk.t, mode === 'all');
      const sp = el('span', 'w', tk.t);
      sp.dataset.k = String(k);
      if (k === ui.wcur) sp.classList.add('cur');
      const h = S.hard.get(tk.lower);
      if (v.hard && h) {
        sp.classList.add('hard');
        if (h.gloss) sp.append(el('span', 'g', h.gloss));
      }
      if (S.savedForms.has(tk.lower)) sp.classList.add('saved');
      if (hid[k]) {
        sp.classList.add('hid');
        sp.title = HID_TITLE;
      }
      ui.en.append(sp);
    });
    ui.tokens = toks;
    const koText = S.ko[i] || (S.koErr && !S.koFail.has(i) ? S.koErr : '');
    ui.ko.textContent = v.ko ? koText : '';
    ui.ko.classList.toggle('err', !S.ko[i] && Boolean(koText));
    // 말풍선이 열려 있으면 다시 만든 낱말에 붙여 다시 그린다(저장 칠하기·어려운 단어가 바뀌어도 따라간다).
    if (tip.open) {
      const sp = tip.i === i ? ui.en.querySelector(`.w[data-k="${tip.k}"]`) : null;
      if (sp) {
        tip.el = sp;
        paintTip();
      } else closeTip();
    }
  }

  // 낱말이 아닌 조각. 문장 전체 가리기면 그 안의 글자·숫자(한 글자 a·I, x86, café 등)도 가린다 — 사전 낱말이 아니라 누르면 그 줄을 보이기만 한다
  const HID_TITLE = '가린 낱말 — 눌러서 보기';
  function appendRest(text, hideAll) {
    if (!hideAll) return void ui.en.append(text);
    let last = 0;
    for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
      if (m.index > last) ui.en.append(text.slice(last, m.index));
      const sp = el('span', 'w hid', m[0]);
      sp.title = HID_TITLE;
      ui.en.append(sp);
      last = m.index + m[0].length;
    }
    if (last < text.length) ui.en.append(text.slice(last));
  }

  function stackLabels(b, labels) {
    b.classList.add('stack');
    b.replaceChildren(...Object.entries(labels).map(([k, t]) => {
      const sp = el('span', '', t);
      sp.dataset.k = k;
      return sp;
    }));
  }
  function showLabel(b, k, label) {
    for (const sp of b.children) sp.classList.toggle('on', sp.dataset.k === k);
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  function renderBar() {
    const v = vs();
    const cue = S.cues[S.cur];
    const hide = V.HIDE_LABEL[v.hide] ?? '끔';
    showLabel(ui.hideBtn, v.hide, `가리기 바꾸기 — 지금 ${hide}`);
    ui.pauseBtn.setAttribute('aria-pressed', String(v.pauseEach));
    ui.lineBtn.setAttribute('aria-pressed', String(v.repeatLine));
    ui.gapBtn.setAttribute('aria-pressed', String(v.skipGaps));
    ui.loopBtn.setAttribute('aria-pressed', String(Boolean(S.range)));
    ui.slowBtn.setAttribute('aria-pressed', String(Boolean(video && video.playbackRate !== 1))); // 지금 속도가 1 이 아님(28-3)
    ui.koBtn.setAttribute('aria-pressed', String(v.ko));
    const saved = cue ? Boolean(Sel.findPhrase(S.phrases, cue.text)) : false;
    showLabel(ui.saveBtn, saved ? 'on' : 'off', saved ? '이 줄 저장 빼기 (Shift)' : '이 줄 구·문장에 저장 (Shift)');
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
  function run(act, anchorEl) {
    const i = S.cur;
    if (act === 'prev') return goLine(Math.max(0, i - 1));
    if (act === 'repeat') return goLine(Math.max(0, i));
    if (act === 'next') return goLine(Math.min(S.cues.length - 1, i + 1));
    if (act === 'hide') return setVideo({ hide: V.nextHide(vs().hide) });
    if (act === 'pauseEach') return setVideo(vs().pauseEach ? { pauseEach: false } : { pauseEach: true, repeatLine: false });
    if (act === 'repeatLine') return setVideo(vs().repeatLine ? { repeatLine: false } : { repeatLine: true, pauseEach: false });
    if (act === 'skipGaps') return setVideo({ skipGaps: !vs().skipGaps });
    if (act === 'loop') return loopRange(anchorEl);
    // 느리게 재생(28-3): 1 ↔ 설정한 느린 속도. 유튜브 메뉴로 바꾼 다른 속도도 1 이 아니면 1 로 돌린다.
    if (act === 'slow') {
      if (!video) return;
      video.playbackRate = V.nextRate(video.playbackRate, vs().slowRate);
      renderBar();
      return;
    }
    // 자리만 잡은 키(28-2): 동작은 해당 티켓에서 붙인다. 지금은 아무것도 하지 않되 키는 이미 여기서 막혀 유튜브로 넘어가지 않는다.
    if (act === 'focusMode' || act === 'drill' || act === 'panel') return; // T53d 키보드 저장 · T53e 리스닝 드릴 · T53j 패널
    if (act === 'reveal') {
      S.revealed = i;
      renderLine();
    }
  }

  // 구간 반복(28-1): 첫 누름 = 시작, 둘째 = 끝(시작보다 뒤일 때만), 셋째 = 해제. 저장하지 않는다(영상이 바뀌면 checkPage 가 지운다).
  function loopRange(anchorEl) {
    if (!video) return;
    const t = video.currentTime;
    if (!S.range) {
      S.range = { start: t, end: null };
      toast(`구간 시작 ${V.fmtTime(t)} · Q 로 끝`, anchorEl);
    } else if (!Number.isFinite(S.range.end)) {
      if (!(t > S.range.start)) return toast('끝은 시작보다 뒤여야 해요', anchorEl);
      S.range = { start: S.range.start, end: t };
      toast(`구간 ${V.fmtTime(S.range.start)}–${V.fmtTime(t)} · Q 해제`, anchorEl);
    } else {
      S.range = null;
      toast('구간 반복 해제됨', anchorEl);
    }
    render();
    return undefined;
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
    const key = S.mainKey; // 번역을 기다리는 사이 다른 영상으로 가면 새 영상 주소·제목으로 잘못 저장하지 않게, 누를 때 값을 잡아 둔다
    const id = S.id;
    const title = titleNow();
    const pid = Sel.findPhrase(S.phrases, cue.text);
    let ko = S.ko[i] || '';
    if (!pid && !ko) ko = (await send({ type: 'mt', text: cue.text }))?.translation || ''; // 한국어 줄을 꺼 두었어도 복습 뒷면에 번역이 있게
    if (key !== S.mainKey) {
      S.saving = false;
      return;
    }
    const r = await send(pid ? { type: 'words', op: 'unsave-phrase', id: pid } : V.lineMessage({ cue, ko, id, title }));
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
    const clip = V.clipOfCue(cue);
    if (msg.op === 'save-phrase' && V.validClip(clip)) msg.clip = clip; // 표현도 그 줄 소리로 복습할 수 있게
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
  // 지금 줄 근처는 한국어 줄이 보일 때만(층이 꺼졌거나 CC 를 껐으면 맥 번역을 부르지 않는다). [한국어 모두 보기]는 한국어 줄 설정과 상관없이 대본 전체를.
  async function pumpKo() {
    if (S.koBusy || !S.cues.length || !S.id || !(S.koAll || (vs().ko && visible()))) return;
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
    const level = settings.level;
    const r = await send({ type: 'annotate', words, level });
    S.annotBusy = false;
    if (level !== settings.level) return true; // 그 사이 수준이 바뀌었다(apply 가 칠하기를 비웠다): 옛 수준 답은 버리고 새 수준으로 다시 묻게
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
    if (!(v.hard || v.hide === 'hard') || !visible() || S.annotBusy || Date.now() - S.annotErrAt < ERR_PAUSE_MS) return; // 층이 보일 때만(대본 전체는 annotateAll)
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

  // ---- 키(27-2·28-2): 입력칸 밖·고른 글 없음·우리 다른 화면(패널·카드·메모장) 밖 ----
  // 360° 영상은 W·A·S·D 로 둘러본다: 그 플레이어에서는 줄 이동·키보드 저장 모드 키(A·S·D·W)를 유튜브에 양보한다
  const spherical = () => Boolean(player?.classList.contains('ytp-webgl-spherical') || player?.querySelector('.ytp-webgl-spherical-control'));
  const inOtherScreen = (path) => path.some((n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-') && n !== host);
  function keyBlocked(e) {
    const path = e.composedPath();
    if (Sel.isTypingPath(path, e.isComposing)) return true;
    if (inOtherScreen(path)) return true;
    const sel = getSelection();
    return Boolean(sel && !sel.isCollapsed && String(sel).trim()); // 고른 글이 있으면 readgloss 의 다른 키(D 개념 등) 몫
  }
  // Shift 단독(28-2): 누른 뒤 다른 키·마우스 누름이 없고 0.6초 안에 떼면 그 줄 저장
  let shiftDown = null;
  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return; // 페이지 스크립트가 만든 키로 설정(가리기·줄마다 멈춤)을 바꾸지 못하게
    if (e.key === 'Shift') {
      if (!e.repeat) shiftDown = { at: Date.now(), interrupted: false }; // 뗀 keyup 을 놓쳤어도 다음 누름에서 새로 잰다
      return;
    }
    if (shiftDown) shiftDown.interrupted = true; // 다른 키가 눌리면 Shift 단독이 아니다
    const act = V.keyAction(e);
    if (!act || !visible()) return;
    if ((act === 'prev' || act === 'repeat' || act === 'next' || act === 'focusMode') && spherical()) return;
    if (keyBlocked(e)) return;
    e.preventDefault();
    e.stopPropagation();
    run(act);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!e.isTrusted || e.key !== 'Shift' || !shiftDown) return;
    const tap = V.shiftTapAction({ downAt: shiftDown.at, upAt: Date.now(), interrupted: shiftDown.interrupted });
    shiftDown = null;
    if (tap !== 'saveLine' || !visible() || S.cur < 0) return;
    if (keyBlocked(e)) return;
    saveLine(S.cur);
  }, true);
  window.addEventListener('pointerdown', () => { if (shiftDown) shiftDown.interrupted = true; }, true);
  window.addEventListener('blur', () => { if (shiftDown) shiftDown.interrupted = true; }); // 창을 떠나며 Shift 를 놓친 경우

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
