// 유튜브·넷플릭스 영상 페이지의 readgloss 자막 층(변경 기록 27·28-22). DOM 접착만 하고 판단은 video-core.js(globalThis.readglossVideo)가 한다.
// 자막 글은 yt-hook.js·nf-hook.js(MAIN world)가 플레이어 응답을 엿들어 postMessage 로 넘겨 준다.
// 패널 [영상] 탭(panel-video.js)·복습(panel-words.js)은 globalThis.readglossVideoUi 로 부른다.
(() => {
  // 로컬 연습 페이지(28-23): 다리가 내는 http://127.0.0.1:47831/practice 에서도 같은 자막 층·키·패널을 쓴다.
  const PRACTICE_ORIGIN = 'http://127.0.0.1:47831';
  const PRACTICE_PATH = '/practice';
  const isPractice = () => typeof location !== 'undefined' && location.origin === PRACTICE_ORIGIN && location.pathname === PRACTICE_PATH;
  if (typeof document === 'undefined' || (!/(^|\.)youtube\.com$/.test(location.hostname) && !/(^|\.)netflix\.com$/.test(location.hostname) && !isPractice()) || globalThis.readglossVideoUi) return;
  const V = globalThis.readglossVideo;
  const Sel = globalThis.readglossSelection;
  const SET = globalThis.readglossSettings;
  if (!V || !Sel || !SET) return;

  const SOURCE = 'readgloss-yt';
  const PRACTICE_SOURCE = 'readgloss-practice';
  const NF_SOURCE = 'readgloss-nf';
  const WAIT_MS = 5000; // 이만큼 지나도 영어 줄이 없으면 안내
  const MSG_MS = 8000; // 안내가 떠 있는 시간
  const ERR_PAUSE_MS = 15000; // 번역·주석이 다리 문제로 실패하면 이만큼 쉬었다 다시
  const MAX_ASKED = 20000; // 물어본 낱말 기억 상한(넘으면 비운다)
  const TIP_HOVER_MS = 250; // 마우스를 올린 뒤 말풍선이 뜨기까지(28-6)
  const TIP_CLOSE_MS = 200; // 낱말·말풍선을 떠난 뒤 닫히기까지(28-6)
  const FOCUS_DELAY_MS = 300; // 사용자가 멈춘 뒤 두 줄로 포커스하기까지(28-7)
  const MAX_DICT_MEMO = 500; // 한 영상에서 뜻을 기억해 둘 낱말 수
  const MAX_POLISH_WORDS = 6000; // 다리 /video/polish 요청 상한(28-17)
  const ERR = {
    'bridge-off': '다리가 꺼져 있어요', 'mt-unavailable': '맥 번역 도우미가 없어요(npm run build:mt)', 'mt-failed': '맥 번역이 실패했어요',
    'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요', 'pair-failed': '다리와 연결하지 못했어요(인증)', unauthorized: '다리와 연결하지 못했어요(인증)',
    timeout: '시간이 오래 걸려요. 잠시 뒤 다시 눌러 주세요', 'ai-failed': '풀이를 가져오지 못했어요',
  };
  const STOP_KO = new Set(['bridge-off', 'mt-unavailable', 'ext-reloaded', 'pair-failed', 'unauthorized']); // 줄 하나가 아니라 번역 전체가 막힌 오류
  const errText = (r, head) => ERR[r?.error] ?? `${head}(${r?.error ?? '응답 없음'})`;

  // 세로 막대 단추(28-10): 짧은 글자·이름·키. 툴팁(aria-label·title)에 이름과 키를 함께 보여 준다.
  const BAR = {
    prev: { text: '‹', name: '이전 줄', key: 'A' },
    repeat: { text: '↻', name: '이 줄 처음', key: 'S' },
    next: { text: '›', name: '다음 줄', key: 'D' },
    repeatLine: { text: '문장', name: '문장 반복', key: 'R' },
    loop: { text: '구간', name: '구간 반복', key: 'Q' },
    drill: { text: '드릴', name: '리스닝 드릴', key: 'L' },
    mode: { text: '모드', name: '학습 모드', key: '' },
    pauseEach: { text: '줄멈춤', name: '줄마다 멈춤', key: '' },
    skipGaps: { text: '틈', name: '틈 건너뛰기', key: '' },
    slow: { text: '느리게', name: '느리게', key: 'Z' },
    focusMode: { text: '키보드', name: '키보드 저장 모드', key: 'W' },
    hide: { text: '가리기', name: '가리기 바꾸기', key: '' },
    ko: { text: '한', name: '한국어 줄 보이기', key: '' },
    save: { text: '☆', name: '이 줄 구·문장에 저장', key: 'Shift' },
    explain: { text: '풀이', name: '이 줄 AI 풀이(문맥 번역)', key: '' },
  };
  const barLabel = (b) => (b.key ? `${b.name} (${b.key})` : b.name);

  let settings = SET.normalize({});
  const vs = () => settings.video;
  const S = {
    tracks: [], id: null, mainKey: '', koKey: '', main: null, others: false,
    cues: [], ko: [], koFail: new Set(), cur: -1, past: false, revealed: -1, pausedFor: -1, eachPause: false, clip: null, clipPause: false,
    round: null, roundEnd: null, // 1분 라운드(28-14): 재생 중인 라운드와 끝난 라운드
    prevT: 0, range: null, mem: { repeatedFor: -1, gapTo: -1 },
    hard: new Map(), asked: new Set(), annotBusy: false, annotErrAt: 0, hardVer: 0,
    done: new Set(), // 단어장 복습 끝난 낱말(28-8 가리기 'done' 유형)
    hovering: false, // 자막 위에 마우스가 있는지(가리기 'word'/'line' 을 잠깐 보인다)
    drill: false, drillReveal: false, drillLastUp: null, drillPress: null, drillNotice: false, drillNoticeSeen: false,
    // 학습 모드(28-16): 이해 = 한국어 줄을 눌러 그 줄만 보기(koPeek 줄 번호),
    // 듣기 = 멈춘 뒤 눌러 두 줄 보기(listenReveal), 조립 = 멈춘 뒤 칩 맞히기(build). modePause 는 듣기·조립이 켠 줄마다 멈춤을 돌려놓을 값.
    koPeek: -1, listenReveal: false, build: null, modePause: null,
    dictMemo: new Map(), // 낱말별 사전 응답(28-6): 영상이 바뀌면 지운다
    koBusy: false, koAll: false, koErr: '', koErrAt: 0, koTrack: null,
    polished: null, polishBusy: false, polishErr: '', polishErrAt: 0, polishDoneAt: 0, polishVer: 0, // 자동 자막 다듬기(28-17)
    savedForms: new Map(), saved: {}, phrases: {}, savedVer: 0, saving: false,
    note: null, waitSince: Date.now(), ccTried: new Set(), msg: '', msgAt: 0, ad: false, shown: false,
    panelOpen: false, // 패널이 열려 있는지(28-13): / 가 열기·닫기를 가르고, 열 때 멈춤 이유를 건다
  };
  // 로컬 연습 페이지가 postMessage 로 넘긴 자막(28-23). id 는 페이지가 고른 자막 파일을 가리키는 열쇠다.
  const practice = { id: '', cues: [] };

  // 사이트 어댑터(28-22): 플레이어 찾기·영상 요소·광고·원래 자막 숨김·진행 막대·영상 id·재생 조작만 사이트별로 모은다.
  // 유튜브 어댑터는 지금 동작 그대로다. 넷플릭스는 재생 조작을 MAIN 월드(nf-hook.js)에 부탁한다.
  const YT_ADAPTER = {
    name: 'youtube',
    playerEl: () => document.getElementById('movie_player'),
    videoEl: (player) => player?.querySelector('video.html5-main-video') ?? player?.querySelector('video') ?? null,
    adShowing: (player) => Boolean(player?.classList.contains('ad-showing')),
    captionHelp: true,
    ccButton: (player) => player?.querySelector('.ytp-subtitles-button') ?? null,
    ccOn: (player) => player?.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') !== 'false',
    pageCss: 'html[data-readgloss-subs] .html5-video-player .ytp-caption-window-container { display: none !important; }',
    chromeHeight: (player) => player.querySelector('.ytp-chrome-bottom')?.offsetHeight || 48,
    progressEl: (player) => player?.querySelector('.ytp-progress-bar') ?? null,
    yieldKeys: (player) => Boolean(player?.classList.contains('ytp-webgl-spherical') || player?.querySelector('.ytp-webgl-spherical-control')),
    navEvent: 'yt-navigate-finish',
    idOf: () => location.pathname === '/watch' ? V.videoIdOf(location.href) : null,
    playback: (video) => video,
  };
  const PRACTICE_ADAPTER = {
    name: 'practice',
    playerEl: () => document.getElementById('readgloss-practice-player'),
    videoEl: (player) => player?.querySelector('video') ?? null,
    adShowing: () => false,
    captionHelp: false,
    ccButton: () => null,
    ccOn: () => true,
    pageCss: '',
    chromeHeight: () => 48,
    progressEl: () => null,
    yieldKeys: () => false,
    navEvent: null,
    idOf: () => (practice.cues.length ? practice.id : null),
    playback: (video) => video,
  };
  // 넷플릭스 광고 표시 세 가지(28-22): 광고 정보 띠·광고 배지·광고 플레이어.
  const NF_AD_MARKS = ['[data-uia="ads-info-container"]', '[data-uia="ad-badge"]', '[data-uia="ad-player"]'];
  // 넷플릭스 재생 조작은 모두 nf-hook.js 로 부탁한다(video.currentTime 을 직접 쓰면 멈춘다).
  function netflixPlayback(media) {
    if (!media) return null;
    const ask = (type, extra = {}) => {
      try {
        window.postMessage({ source: NF_SOURCE, type, ...extra }, location.origin);
      } catch {
        // 못 보내면 그만
      }
    };
    let lastSeekMs = -1;
    let lastSeekAt = 0;
    return {
      get currentTime() { return media.currentTime; },
      set currentTime(sec) {
        const ms = Math.max(0, Math.round(Number(sec) * 1000));
        if (!Number.isFinite(ms)) return;
        const now = Date.now();
        if (ms === lastSeekMs && now - lastSeekAt < 300) return; // 같은 자리로 연달아 부탁하지 않는다
        lastSeekMs = ms;
        lastSeekAt = now;
        ask('seek', { ms });
      },
      get paused() { return media.paused; },
      get readyState() { return media.readyState; },
      get playbackRate() { return media.playbackRate; },
      set playbackRate(rate) { try { media.playbackRate = rate; } catch { /* 플레이어가 거절하면 그만 */ } },
      play() { ask('play'); return Promise.resolve(); },
      pause() { ask('pause'); },
    };
  }
  const NF_ADAPTER = {
    name: 'netflix',
    playerEl: () => document.querySelector('.watch-video') ?? document.querySelector('[data-uia="video-canvas"]') ?? document.querySelector('.NFPlayer') ?? document.querySelector('video')?.parentElement ?? null,
    videoEl: (player) => player?.querySelector('video') ?? document.querySelector('video') ?? null,
    adShowing: () => NF_AD_MARKS.some((mark) => document.querySelector(mark)),
    captionHelp: false, // 넷플릭스는 자막 단추를 대신 눌러 줄 필요가 없다
    ccButton: () => null,
    ccOn: () => true,
    pageCss: 'html[data-readgloss-subs] .player-timedtext { display: none !important; }', // 원래 자막을 우리 층이 보이는 동안 숨긴다
    chromeHeight: () => 64,
    progressEl: () => null, // 진행 막대 눈금은 유튜브만(28-10)
    yieldKeys: () => false,
    navEvent: null,
    idOf: () => V.netflixIdOf(location.href),
    playback: (video) => netflixPlayback(video),
  };
  const ADAPTERS = { youtube: YT_ADAPTER, netflix: NF_ADAPTER, practice: PRACTICE_ADAPTER };
  const SITE = V.adapterFor(location);
  if (!SITE) return;
  const site = ADAPTERS[SITE.name] ?? YT_ADAPTER;
  // 넷플릭스 자막 파일을 한 번만 받는다(같은 주소를 replay 마다 다시 받지 않게).
  const nfFetched = new Set();
  const nfFetching = new Set();
  // 잠깐 멈춤(마우스를 올림·사전 카드·풀이): 이유가 하나라도 있으면 멈춰 두고, 우리가 멈춘 것만 다시 재생한다. 사용자가 직접 재생하면 이유를 다 지운다.
  const hold = { reasons: new Set(), paused: false, ours: false };
  const listeners = new Set();
  let player = null;
  let video = null;
  let media = null; // 실제 <video> 요소. video 는 넷플릭스에서 재생 조작을 nf-hook.js 로 넘기는 파사드다.
  let host = null;
  let ui = null;
  let raf = 0;
  let sizeObs = null;
  // 말풍선 상태(28-6): 어느 낱말(tip.k)에 붙어 있는지, 그 줄 번호, 마우스를 떠난 뒤 닫는 타이머
  // 묻기(28-18)는 말풍선 안에서 열리고, 질문·답을 여기에 담아 다시 그려도 잃지 않는다.
  const tip = { open: false, k: -1, i: -1, el: null, lower: '', word: '', askOpen: false, askText: '', askAnswer: '', askError: '', askBusy: false, askSeq: 0 };
  let tipOpenTimer = 0;
  let tipCloseTimer = 0;
  let focusTimer = 0; // 키보드 저장 모드 자동 포커스 예약(28-7)
  const adjust = { on: false, posY: 0 }; // 자막 위치 조정(28-11): 켜진 동안 임시 posY

  const bandsKey = (v) => `${v?.wordBands?.easy ? 1 : 0}${v?.wordBands?.medium ? 1 : 0}${v?.wordBands?.hard ? 1 : 0}`;
  function apply(s) {
    const before = settings.video;
    if (s.level !== settings.level || bandsKey(s.video) !== bandsKey(before) || s.video.hard !== before.hard) {
      S.hard = new Map();
      S.asked = new Set();
      S.hardVer++;
    }
    if (s.video.mode !== before.mode) {
      S.koPeek = -1;
      S.listenReveal = false;
      S.build = null;
      if (s.video.mode !== 'listen' && s.video.mode !== 'build') S.modePause = null;
    }
    settings = s;
    // 저장된 모드가 듣기·조립인데(새로 고침 등) 자동 줄마다 멈춤이 아직 아니면 지금 값을 기억해 두고 켠다.
    if (MODE_AUTO_PAUSE(s.video.mode) && !S.modePause && (!s.video.pauseEach || s.video.repeatLine)) {
      S.modePause = { pauseEach: s.video.pauseEach, repeatLine: s.video.repeatLine };
      setVideo({ pauseEach: true, repeatLine: false });
    }
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
  // 로컬 연습 페이지(28-23): 페이지가 고른 SRT·VTT·IMSC 자막을 줄로 만들어 넘겨 준다.
  // 영상 id 자리에 자막 파일 열쇠를 넣어, 파일을 바꾸면 자막 층이 새 자막으로 다시 시작하게 한다.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !isPractice()) return;
    const d = e.data;
    if (!d || d.source !== PRACTICE_SOURCE || d.type !== 'cues' || !Array.isArray(d.cues)) return;
    const key = typeof d.id === 'string' && d.id.trim() ? d.id.trim().slice(0, 160) : 'practice';
    // 연습 페이지를 장면 주소로 쓸 수 있게 영상 id 자리에 페이지 주소+자막 열쇠를 넣는다.
    const id = `${PRACTICE_ORIGIN}${PRACTICE_PATH}?sub=${encodeURIComponent(key)}`;
    const cues = V.normalizeCues(d.cues);
    practice.id = id;
    practice.cues = cues;
    S.tracks = [...S.tracks.filter((track) => !(track.videoId === id && track.lang === 'en' && !track.tlang)), { videoId: id, lang: 'en', tlang: '', kind: 'manual', cues, ts: Date.now() }].slice(-20);
    checkPage();
  });
  // 넷플릭스(28-22): nf-hook.js 가 모은 IMSC 자막 주소를 같은 출처에서 받아 parseImsc 로 줄을 만든다.
  function nfAddTracks(tracks) {
    if (!Array.isArray(tracks)) return;
    for (const track of tracks.slice(0, 40)) {
      const url = typeof track?.url === 'string' ? track.url : '';
      const lang = String(track?.lang ?? '').toLowerCase().split('-')[0];
      // 영어·한국어 자막만 받는다(28-22). 다른 언어 XML 은 받지 않는다.
      if (!url || (lang !== 'en' && lang !== 'ko')) continue;
      let same = false;
      try {
        same = new URL(url, location.href).origin === location.origin;
      } catch {
        same = false;
      }
      if (!same) continue; // 확장 권한을 늘리지 않는다: 넷플릭스와 같은 출처만 받는다
      const key = `${lang}|${url}`;
      if (nfFetched.has(key) || nfFetching.has(key)) continue;
      nfFetching.add(key);
      fetch(url)
        .then((r) => (r.ok ? r.text() : ''))
        .then((body) => {
          nfFetching.delete(key);
          if (!body) return;
          const cues = V.parseImsc(body);
          if (!cues.length) return;
          nfFetched.add(key);
          const videoId = V.netflixIdOf(location.href);
          if (!videoId) return;
          const tr = { videoId, lang, tlang: '', kind: 'manual', cues, ts: Date.now() };
          S.tracks = [...S.tracks.filter((x) => !(x.videoId === tr.videoId && x.lang === tr.lang && x.tlang === '' && x.kind === 'manual')), tr].slice(-20);
          if (tr.videoId === S.id) chooseTracks();
        })
        .catch(() => { nfFetching.delete(key); });
    }
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || site.name !== 'netflix') return;
    const d = e.data;
    if (d?.source === NF_SOURCE && d.type === 'tracks') nfAddTracks(d.tracks);
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
      S.koTrack = null;
      S.cur = -1;
      S.revealed = -1;
      S.pausedFor = -1;
      S.prevT = 0;
      S.mem = { repeatedFor: -1, gapTo: -1 };
      S.note = null;
      S.koErr = '';
      S.polished = null; // 다른 자막이 되면 다듬은 줄도 버린다(28-17)
      S.polishBusy = false;
      S.polishErr = '';
      S.polishErrAt = 0;
      S.polishDoneAt = 0;
      S.polishVer++;
    }
    const kk = main && ko ? keyOf(ko) : '';
    if (kk && kk !== S.koKey) {
      S.koKey = kk;
      S.koTrack = ko;
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
    const id = site.idOf();
    if (id !== S.id) {
      S.id = id;
      S.mainKey = '';
      S.main = null;
      S.cues = [];
      S.ko = [];
      S.clip = null;
      S.clipPause = false;
      S.round = null;
      S.roundEnd = null;
      S.range = null;
      S.drill = false; // 드릴은 저장하지 않는다: 영상이 바뀌면 끈다(28-8)
      S.drillReveal = false;
      S.drillLastUp = null;
      S.drillPress = null;
      S.drillNotice = false;
      S.koPeek = -1; // 학습 모드(28-16)의 임시 상태는 영상이 바뀌면 지운다(mode 설정은 남는다)
      S.listenReveal = false;
      S.build = null;
      if (video) video.playbackRate = 1; // 새 영상은 1배로(28-3)
      clearFocusTimer();
      if (ui?.lines.matches(':focus')) ui.lines.blur();
      S.prevT = 0;
      S.mem = { repeatedFor: -1, gapTo: -1 };
      S.koAll = false;
      S.waitSince = Date.now();
      S.msg = '';
      S.dictMemo = new Map(); // 영상이 바뀌면 낱말별 사전 기억을 지운다(28-6)
      S.polished = null; // 다듬은 자막도 영상이 바뀌면 지운다(28-17)
      S.polishBusy = false;
      S.polishErr = '';
      S.polishErrAt = 0;
      S.polishDoneAt = 0;
      S.polishVer++;
      closeTip();
      hold.reasons.clear();
      hold.paused = false;
      chooseTracks();
      if (id) {
        window.postMessage({ source: SOURCE, type: 'replay' }, location.origin); // 늦게 뜬 이 스크립트를 위해 들고 있던 자막을 다시
        if (site.name === 'netflix') window.postMessage({ source: NF_SOURCE, type: 'replay' }, location.origin);
        askPending(id);
        loadSaved();
      }
      notify('page');
    }
    ensureCaptions();
    render();
  }

  function attach() {
    const p = site.playerEl();
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
    const v = site.videoEl(player);
    if (v !== media) {
      if (media) unbind(media);
      media = v;
      video = v ? site.playback(v) : null;
      if (v) {
        v.playbackRate = 1; // 플레이어가 바뀌면 1배로(28-3)
        bind(v);
      }
    }
  }

  const adShowing = () => site.adShowing(player);
  const ccButton = () => site.ccButton(player);
  // 단추가 없거나 aria-pressed 모양이 바뀌었으면 켜진 것으로 본다(27-7)
  const ccOn = () => site.ccOn(player);
  function ccAvailable(b = ccButton()) {
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const st = getComputedStyle(b);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }
  // 자막 켜기 도움: 영상마다 한 번, 자막이 꺼져 있으면 CC 단추를 누른다(플레이어가 자막을 받아야 우리도 받는다)
  function ensureCaptions() {
    if (!site.captionHelp || !S.id || !player || !vs().subs || !vs().autoCC || S.ccTried.has(S.id) || S.cues.length || adShowing()) return;
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

  // 원래 자막은 우리 층이 보이는 동안만 사이트별 규칙으로 숨긴다(유튜브 .ytp-caption-window-container · 넷플릭스 .player-timedtext).
  const PAGE_CSS = site.pageCss;
  let pageSheet = null;
  function ensurePageStyle() {
    if (!PAGE_CSS || pageSheet) return;
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
    clearFocusTimer();
    S.clipPause = false;
    S.eachPause = false;
    // 학습 모드(28-16): 다시 재생하면 이해·듣기·조립의 임시 보기·칩을 접는다(다음에 멈출 때 새로 그린다).
    S.koPeek = -1;
    S.listenReveal = false;
    S.build = null;
    // 라운드 끝 안내를 띄운 채 사용자가 다시 재생하면 안내·칩 줄을 지운다(라운드를 재생 중이면 그대로 둔다).
    if (!S.round && S.roundEnd) {
      S.roundEnd = null;
      notify('round');
    }
    if (hold.ours) hold.ours = false;
    else {
      hold.reasons.clear(); // 사용자가 직접 재생했다
      hold.paused = false;
    }
    render(); // 멈춤 때문에 보이던 가리기가 다시 가려진다(28-8)
    startLoop();
  }
  function onPause() {
    if (hold.ours) hold.ours = false;
    tick(true);
    scheduleFocus(pauseReasonNow());
  }
  function onSeeked() {
    S.clipPause = false;
    const c = S.cues[S.pausedFor];
    if (c && video.currentTime < c.end - 0.1) S.pausedFor = -1; // 그 줄로 되돌아가면 끝에서 다시 멈춘다
    tick(true);
  }
  const onTime = () => tick();
  // 유튜브 메뉴로 속도를 바꾸면 단추 눌림 표시만 따라 그린다(우리가 playbackRate 를 되돌리지 않는다 — 28-3)
  const onRate = () => { if (ui) renderBar(); if (S.build) renderBuild(); };
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
        S.clipPause = reached;
        S.clip = null;
        if (reached) video.pause();
        // 라운드를 끝까지 재생했으면 상태 줄·패널 칩 줄에 알린다(28-14).
        if (reached && S.round) {
          S.roundEnd = { ...S.round, ended: true };
          S.round = null;
          notify('round');
          render();
        } else if (S.round) {
          S.round = null;
          notify('round');
        }
      } else if (t < S.clip.start - 1) {
        S.clip = null; // 사용자가 구간 밖으로 옮겼다
        if (S.round) {
          S.round = null;
          notify('round');
        }
      }
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
        S.eachPause = true; // 우리가 줄 끝에서 멈춘 것(사용자 멈춤과 가르는 표시, onPlay 가 지운다)
        video.pause();
      }
    } else S.prevT = t;
    const past = i >= 0 && !V.isLive(S.cues, i, t);
    if (force || i !== S.cur || past !== S.past) {
      if (i !== S.cur) {
        S.cur = i;
        S.revealed = -1;
        S.koPeek = -1; // 이해 = 줄이 바뀌면 한국어 줄은 다시 숨긴다(28-16)
        S.listenReveal = false;
        S.build = null;
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
  // 패널 열림·닫힘(28-13): 열 때 재생 중이었으면 멈추고('panel' 이유), 닫으면 그 이유만 푼다.
  // 재생 중이 아니었으면 이유를 걸지 않으므로, 그 사이 사용자가 재생한 경우에도 닫을 때 건드리지 않는다.
  window.addEventListener('readgloss:panel', (e) => {
    S.panelOpen = e.detail?.open === true;
    if (S.panelOpen) {
      if (video && !video.paused) holdOn('panel');
    } else holdOff('panel');
  });
  // 멈춘 이유(28-7): 사용자 멈춤만 키보드 저장 모드가 두 줄로 포커스한다. 우리가 멈춘 것은 이유별로 가른다.
  function pauseReasonNow() {
    if (hold.paused || hold.reasons.size) return hold.reasons.has('card') ? 'card' : 'hold';
    if (S.clipPause) return 'clip';
    if (S.eachPause) return 'pauseEach';
    return 'user';
  }
  // Esc 로 재생해도 되는가: 사용자가 멈춘 것이고(카드·hold·줄마다 멈춤·장면 끝이 아님) 영상이 멈춰 있다.
  const userPaused = () => Boolean(video?.paused && !hold.paused && !hold.reasons.size && !S.clipPause && !S.eachPause);
  function clearFocusTimer() {
    clearTimeout(focusTimer);
    focusTimer = 0;
  }
  function scheduleFocus(reason) {
    clearFocusTimer();
    if (!V.shouldAutoFocus({ on: vs().focusMode, pauseReason: reason })) return;
    focusTimer = setTimeout(() => {
      focusTimer = 0;
      if (!video?.paused || !vs().focusMode || !visible() || !ui?.lines || document.hidden) return;
      const root = ui.lines.getRootNode();
      const inside = root.activeElement;
      if (inside && inside !== ui.lines) return; // 우리 층 안 다른 자리(막대·풀이)에 있으면 빼앗지 않는다
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== host && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return; // 입력칸 밖 요청
      if (inside !== ui.lines) ui.lines.focus({ preventScroll: true });
      const k = V.focusStart(ui.tokens, S.hard);
      if (k >= 0) moveCursor(k);
      renderFocusHint();
    }, FOCUS_DELAY_MS);
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
    .note { order: -2; } .msg { order: 1; } /* 화면 차례(풀이 → 두 줄 → 안내). 세로 막대는 position: fixed 라 흐름에 끼지 않는다 */
    .en, .ko { box-sizing: border-box; max-width: 100%; padding: .08em .45em; border-radius: 4px; background: rgba(8, 8, 8, var(--bg, .74)); color: #fff; text-align: center; line-height: 1.38; overflow-wrap: anywhere; }
    .en { font-size: var(--fs-en, var(--fs, 22px)); user-select: none; }
    .ko { font-size: var(--fs-ko, var(--fs, 22px)); color: #f1f1f1; }
    .ko.err { color: #c9c9c9; font-size: calc(var(--fs-ko, var(--fs, 22px)) * .76); }
    /* 지난 줄(다음 줄 전 빈 사이): 바탕은 그대로 두고 글자만 흐리게 — 밝은 화면 위에서도 읽힌다 */
    .lines.past .en, .lines.past .ko { color: rgba(255, 255, 255, .72); }
    .en:empty, .ko:empty { display: none; }
    .w { position: relative; cursor: pointer; border-radius: 3px; }
    .w:hover { background: rgba(255, 255, 255, .2); }
    .w.hard { text-decoration: underline dotted rgba(255, 214, 102, .95); text-decoration-thickness: .08em; text-underline-offset: .2em; }
    .w.saved { background: rgba(56, 189, 248, .34); }
    /* 칠하기(28-9): 주황 = 고른 구간, 초록 = 복습 끝. 흰 글자와 4.5:1 이상(#c2522b·#1a7f37) */
    .w.or, .phr.or { background: #c2522b; color: #fff; }
    .w.gr, .phr.gr { background: #1a7f37; color: #fff; }
    .w.or, .w.gr, .phr .w { text-decoration: none; }
    .w.chk::after { content: '✓'; margin-left: .1em; font-size: .78em; color: #ffe08a; }
    .phr { border-radius: 999px; padding: 0 .24em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .phr .w:hover { background: rgba(255, 255, 255, .18); }
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
    /* 묻기(28-18): 한 줄 입력칸과 답 칸. 답은 1~3문장이라 줄바꿈을 살린다. */
    .tip .tp-ask { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .tip .tp-q { flex: 1 1 140px; min-width: 0; box-sizing: border-box; min-height: 28px; padding: 2px 7px; border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, .45); background: rgba(28, 28, 28, .92); color: #fff;
      font: max(12px, calc(var(--fs, 22px) * .54))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .tip .tp-q:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .tip .tp-answer { flex: 1 1 100%; margin-top: 2px; color: #f1f1f1; white-space: pre-wrap; overflow-wrap: anywhere; }
    .tip .tp-answer.err { color: #ffb4a8; }
    .box.tip-open .w .g { display: none !important; } /* 말풍선이 뜨면 옛 짧은 뜻 풍선은 겹치지 않게 숨긴다 */
    /* 세로 막대(28-10): 플레이어 왼쪽 가장자리. 숨어 있을 때는 visibility 라 마우스를 받지 않고, 두 줄·막대에 올리면 보인다.
       자리(top·left·max-height)는 layout() 이 플레이어 rect 와 유튜브 조작 막대 높이로 잡는다. */
    .bar { position: fixed; z-index: 1; box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch; gap: 4px;
      width: max-content; max-width: 96px; padding: 4px; overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
      visibility: hidden; opacity: 0; transition: opacity .15s 1.6s, visibility 0s 1.75s; } /* 숨을 때만 1.75초 늦춰, 두 줄에서 막대까지 마우스를 옮길 시간을 준다 */
    .bar::-webkit-scrollbar { display: none; }
    .box:hover .bar, .box:focus-within .bar, .bar:hover, .bar:focus-within { visibility: visible; opacity: 1; transition: opacity .15s, visibility 0s; }
    /* 단추: 누를 자리 28px 이상, 글자는 자막 크기를 따라 커진다 */
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; min-height: 28px; padding: 0 7px; cursor: pointer;
      border-radius: 6px; border: 1px solid rgba(255, 255, 255, .2); background: rgba(28, 28, 28, .92); color: #fff;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.7 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; white-space: nowrap; }
    button:hover:not(:disabled) { border-color: #fff; }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 2px rgba(8, 8, 8, .92), 0 0 0 6px rgba(8, 8, 8, .92); }
    /* 글이 바뀌는 단추(가리기·저장): 글을 모두 한 칸에 겹쳐 두고 하나만 보인다 — 폭이 가장 긴 글로 고정돼 눌러도 막대가 흔들리지 않는다 */
    button.stack { display: inline-grid; place-items: center; }
    button.stack > span { grid-area: 1 / 1; }
    button.stack > span:not(.on) { visibility: hidden; }
    /* 눌린 단추: 주황 테두리 + 옅은 주황 바탕(28-10) */
    button[aria-pressed="true"], button[aria-expanded="true"] { background: linear-gradient(rgba(245, 158, 11, .30), rgba(245, 158, 11, .30)), rgba(28, 28, 28, .92); border-color: #f59e0b; }
    button:disabled { opacity: .45; cursor: default; }
    /* 구간 손잡이(28-10): 유튜브 진행 막대 위 A·B 주황 눈금. 자리는 renderRange() 가 rect 로 잡는다 */
    .range { position: fixed; z-index: 2; pointer-events: none; }
    .range .h { position: absolute; top: 0; width: 12px; height: 100%; transform: translateX(-50%); box-sizing: border-box;
      background: #f59e0b; border: 1px solid #111; border-radius: 2px; pointer-events: auto; cursor: ew-resize; touch-action: none; }
    .range .h::after { content: attr(data-k); position: absolute; left: 50%; top: -1.2em; transform: translateX(-50%);
      color: #f59e0b; font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; text-shadow: 0 0 2px #000, 0 0 3px #000; }
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
    /* 라운드 끝 안내(28-14): 상태 줄 안의 [다음] 단추. 부모(.box)가 pointer-events: none 이라 단추만 받는다 */
    .msg .nx { margin-left: 8px; pointer-events: auto; }
    .msg .px { margin-left: 8px; pointer-events: auto; min-height: 26px; padding: 1px 9px; }
    /* 키보드 저장 모드 안내 알약(28-7): 두 줄 바로 아래. 어두운 바탕 + 흰 글자 */
    .focushint { order: 1; margin-top: 4px; padding: 3px 12px; border-radius: 999px; background: rgba(8, 8, 8, .9); border: 1px solid rgba(255, 255, 255, .45); color: #fff;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    /* 리스닝 드릴(28-8): 두 줄을 통째로 숨기고 가운데 아래 알약만 남긴다. Space 로 보이는 동안은 두 줄을 다시 그린다 */
    .lines.drillhide { display: none; }
    .drillpill { order: 1; pointer-events: auto; display: flex; align-items: center; gap: 4px; margin-top: 4px; padding: 3px 8px; border-radius: 999px;
      background: rgba(8, 8, 8, .9); border: 1px solid rgba(255, 255, 255, .45); color: #fff;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .drillpill button { border-color: transparent; background: transparent; min-height: 28px; }
    .drillpill .dc { min-width: 4.6em; text-align: center; }
    .drillnote { order: -3; pointer-events: auto; box-sizing: border-box; max-width: min(92%, 440px); padding: 10px 12px; border-radius: 10px;
      background: rgba(8, 8, 8, .94); border: 1px solid rgba(255, 255, 255, .55); color: #fff; text-align: left;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .drillnote .dt { margin-bottom: 8px; }
    /* 학습 모드(28-16): 이해 = 한국어 줄 자리의 '한국어 줄 보기' 단추, 듣기 = 멈춘 뒤 보기 알약 */
    .ko .kpeek { background: rgba(255, 255, 255, .12); border: 1px dashed rgba(255, 255, 255, .7); color: #f1f1f1; }
    .modepill { order: 1; pointer-events: auto; display: flex; align-items: center; gap: 4px; margin-top: 4px; padding: 3px 8px; border-radius: 999px;
      background: rgba(8, 8, 8, .9); border: 1px solid rgba(255, 255, 255, .45); color: #fff;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .modepill button { border-color: transparent; background: transparent; }
    /* 조립(28-16): 자막 자리에 빈칸과 섞은 칩. 칩은 진짜 단추라 Tab·Enter 로도 고른다 */
    .build { order: 0; pointer-events: auto; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: min(92%, 900px); }
    .build .bslots, .build .btiles, .build .bacts { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 5px; }
    .build .bslots { padding: 5px 8px; border-radius: 8px; background: rgba(8, 8, 8, .82); border: 1px solid rgba(255, 255, 255, .3); }
    .build .slot { display: inline-flex; align-items: center; justify-content: center; min-width: 2.2em; min-height: 28px; padding: 0 6px; border-bottom: 2px solid rgba(255, 255, 255, .7);
      color: #d8d8d8; font: max(12px, calc(var(--fs, 22px) * .56))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .build .tile { background: rgba(8, 8, 8, .92); }
    .build .tile.placed { border-color: #f59e0b; color: #ffe08a; }
    .build .tile.shake { animation: rg-shake .42s ease-in-out; }
    @keyframes rg-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-5px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
    .build .bt { color: #fff; }
    /* 자막 위치 조정(28-11): 자막 층 위 띠. 띠를 위아래로 끌면 임시 posY, [적용]으로 저장, [초기화]는 0 */
    .adjust { order: -1; pointer-events: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 4px; padding: 4px 8px; border-radius: 999px;
      background: rgba(8, 8, 8, .92); border: 1px solid rgba(255, 255, 255, .55); color: #fff; cursor: ns-resize; touch-action: none;
      font: max(12px, calc(var(--fs, 22px) * .56))/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
    .adjust .ad-t { padding: 0 4px; }
    /* 안내만 뜰 때(우리 두 줄이 없을 때)는 유튜브 자막이 보일 수 있으니 그 자리 위로 올린다 */
    .box:has(.lines[hidden]) .msg { margin-bottom: max(3.4em, calc(var(--fs, 22px) * 3)); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    [hidden] { display: none !important; }
    @media (prefers-reduced-motion: reduce) { .bar, .lines { transition: none; } .build .tile.shake { animation: none; } }
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
    bar.setAttribute('aria-label', 'readgloss 자막 컨트롤');
    // 단추는 한 번만 만들고 설정 순서·숨김에 따라 bar 안에서 다시 늘어놓는다(renderBarOrder)
    const btns = {};
    for (const [k, info] of Object.entries(BAR)) {
      const b = button(info.text, barLabel(info), () => run(k, b));
      b.dataset.k = k;
      btns[k] = b;
    }
    stackLabels(btns.hide, { off: '가리기', word: '낱말', line: '줄' });
    stackLabels(btns.save, { off: '☆', on: '★' });
    stackLabels(btns.mode, { watch: '보기', understand: '이해', listen: '듣기', build: '조립' });
    const prevBtn = btns.prev;
    const repeatBtn = btns.repeat;
    const nextBtn = btns.next;
    const hideBtn = btns.hide;
    const pauseBtn = btns.pauseEach;
    const lineBtn = btns.repeatLine;
    const loopBtn = btns.loop;
    const gapBtn = btns.skipGaps;
    const slowBtn = btns.slow;
    const drillBtn = btns.drill;
    const focusBtn = btns.focusMode;
    const koBtn = btns.ko;
    const saveBtn = btns.save;
    const explainBtn = btns.explain;
    const modeBtn = btns.mode;
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
    lines.setAttribute('aria-label', 'readgloss 자막 — A 이전 줄 · S 이 줄 처음 · D 다음 줄 · R 문장 반복 · Q 구간 반복 · Z 느리게 · Shift 줄 저장 · W 키보드 저장 모드 · ←→ 낱말 · Enter 저장 · ↓ 자세히 · Esc 재생');
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
    // 키보드 저장 모드 안내 알약(28-7): 두 줄에 포커스가 있을 때만 보인다.
    const hint = el('div', 'focushint');
    hint.hidden = true;
    hint.setAttribute('role', 'status');
    // 리스닝 드릴(28-8): 처음 한 번 안내 카드(세션 동안만, [가리기]로 접는다)와 가운데 아래 이동 알약
    const drillNote = el('div', 'drillnote');
    drillNote.hidden = true;
    drillNote.setAttribute('role', 'note');
    drillNote.setAttribute('aria-label', '리스닝 드릴 안내');
    const drillClose = button('가리기', '드릴 안내 접기', () => {
      S.drillNotice = false;
      S.drillNoticeSeen = true;
      render();
    });
    drillNote.append(el('div', 'dt', 'Space 를 누르고 있으면 자막 보기 · 두 번 빠르게 누르면 재생/정지'), drillClose);
    const drillPill = el('div', 'drillpill');
    drillPill.hidden = true;
    drillPill.setAttribute('role', 'group');
    drillPill.setAttribute('aria-label', '리스닝 드릴 문장 이동');
    const drillCount = el('span', 'dc');
    drillPill.append(button('‹ 이전 문장 A ·', '이전 문장 (A)', () => run('prev')), drillCount, button('· 다음 문장 D ›', '다음 문장 (D)', () => run('next')));
    // 학습 모드(28-16): 듣기는 멈춘 뒤 눌러 두 줄을 보고, 조립은 멈춘 뒤 자막 자리에 섞은 칩을 놓는다.
    const modePill = el('div', 'modepill');
    modePill.hidden = true;
    modePill.setAttribute('role', 'group');
    modePill.setAttribute('aria-label', '학습 모드 자막 보기');
    modePill.append(button('자막 보기', '멈춘 자막 두 줄 보기', () => {
      S.listenReveal = true;
      render();
    }));
    const buildEl = el('div', 'build');
    buildEl.hidden = true;
    buildEl.setAttribute('role', 'group');
    buildEl.setAttribute('aria-label', '조립 — 들은 순서대로 칩 누르기');
    const buildSlots = el('div', 'bslots');
    const buildTiles = el('div', 'btiles');
    const buildActs = el('div', 'bacts');
    const buildState = el('span', 'bt', '들은 순서대로 눌러 보세요');
    const buildAgain = button('↺ 다시 듣기', '이 줄 다시 듣기 (S)', () => run('repeat'));
    const buildSlow = button('느리게', '느리게 재생 (Z)', () => run('slow'));
    const buildNext = button('다음 줄', '다음 줄 (D)', () => run('next'));
    buildNext.hidden = true;
    buildActs.append(buildState, buildAgain, buildSlow, buildNext);
    buildEl.append(buildSlots, buildTiles, buildActs);
    // 자막 위치 조정(28-11): 설정 탭 [자막 위치 조정] 이 연다. 띠를 끌면 임시로 올리고 [적용]으로 저장한다.
    const adjustEl = el('div', 'adjust');
    adjustEl.hidden = true;
    adjustEl.setAttribute('role', 'group');
    adjustEl.setAttribute('aria-label', '자막 위치 조정');
    const adjustText = el('span', 'ad-t', '위아래로 끌어 옮기세요');
    adjustEl.append(adjustText, button('적용', '자막 위치 저장', () => {
      setVideo({ posY: adjust.posY });
      adjust.on = false;
      render();
      layout();
    }), button('초기화', '자막 위치 0으로', () => {
      adjust.posY = 0;
      setVideo({ posY: 0 });
      adjust.on = false;
      render();
      layout();
    }));
    adjustEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('button')) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startPos = adjust.posY;
      const height = player?.clientHeight || 360;
      const move = (ev) => {
        if (ev.cancelable) ev.preventDefault();
        adjust.posY = Math.min(0, Math.max(-40, Math.round(startPos + ((ev.clientY - startY) / height) * 100)));
        layout();
      };
      const end = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    });
    const sr = el('div', 'sr'); // 키보드 낱말 자리를 읽어 주는 곳(화면에는 안 보인다)
    sr.setAttribute('aria-live', 'polite');
    // 낱말 말풍선(28-6): 자막 층 shadow 안에 그린다. 낱말 위(자리가 모자라면 아래)에 붙고 단추는 키보드로도 닿는다.
    const tipEl = el('div', 'tip');
    tipEl.hidden = true;
    tipEl.setAttribute('role', 'group');
    tipEl.setAttribute('aria-label', '낱말 뜻과 저장');
    // 구간 손잡이(28-10): 진행 막대 위에 A·B 눈금. 유튜브 진행 막대를 못 찾으면 hidden.
    const rangeEl = el('div', 'range');
    rangeEl.hidden = true;
    rangeEl.setAttribute('aria-hidden', 'true');
    const rangeA = el('div', 'h');
    rangeA.dataset.k = 'A';
    const rangeB = el('div', 'h');
    rangeB.dataset.k = 'B';
    rangeA.dataset.which = 'start';
    rangeB.dataset.which = 'end';
    for (const [h, which, label] of [[rangeA, 'start', '구간 시작'], [rangeB, 'end', '구간 끝']]) {
      h.title = `${label} — 끌어서 옮기기`;
      h.addEventListener('pointerdown', (e) => startRangeDrag(which, e));
    }
    rangeEl.append(rangeA, rangeB);
    box.prepend(notice);
    box.append(lines, bar, note, msg);
    box.append(hint); // 안내 알약(28-7)은 화면 차례(order)로 두 줄 아래에 놓는다
    box.append(drillPill, drillNote); // 드릴 알약·안내도 order 로 자리를 잡는다
    box.append(modePill, buildEl); // 학습 모드(28-16): 듣기 보기 알약과 조립 칩
    box.append(adjustEl); // 자막 위치 조정 띠(28-11)
    box.append(tipEl); // 말풍선은 position: fixed 라 흐름에 끼지 않는다
    box.append(rangeEl); // 구간 눈금도 fixed 라 흐름에 끼지 않는다
    shadow.append(style, box, sr);
    ui = {
      box, bar, note, notice, lines, en, ko, msg, hint, sr, tip: tipEl, drillPill, drillNote, drillCount,
      modePill, build: buildEl, buildSlots, buildTiles, buildState, buildAgain, buildSlow, buildNext, buildKey: '',
      adjust: adjustEl, adjustText,
      prevBtn, repeatBtn, nextBtn, hideBtn, pauseBtn, lineBtn, loopBtn, gapBtn, slowBtn, drillBtn, focusBtn, koBtn, saveBtn, explainBtn, modeBtn,
      btns, barKey: '', range: rangeEl, rangeA, rangeB,
      lineKey: '', noteKey: '', msgKey: '', tokens: [], wcur: -1, wcurFor: '',
    };
    renderBarOrder();

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
    // 두 줄에 포커스가 있을 때(28-7): ←·→ 낱말 자리(끝에서 처음으로), Enter 저장/해제, ↓ 자세히(사전 카드),
    // Shift 단독은 전역 keyup 이 줄 저장, Esc 는 포커스를 놓고 사용자가 멈춘 영상을 재생한다.
    // 화살표는 유튜브의 5초 이동으로 새지 않게 여기서 멈춘다(포커스가 우리 층 밖이면 건드리지 않는다).
    lines.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const words = wordIdxs();
        if (!words.length) return;
        e.preventDefault();
        e.stopPropagation();
        moveCursor(V.focusStep(words, ui.wcur, e.key === 'ArrowRight' ? 1 : -1));
      } else if ((e.key === 'Enter' || e.key === 'ArrowDown') && ui.wcur >= 0) {
        const sp = ui.en.querySelector(`.w[data-k="${ui.wcur}"]`);
        if (!sp) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowDown' || !vs().focusMode) pickWord(sp); // ↓ = 자세히(사전 카드). 모드가 꺼져 있으면 옛 Enter 동작
        else toggleWordAt(ui.wcur);
      } else if (e.key === 'Escape' && vs().focusMode) {
        if (hold.paused && hold.reasons.size === 1 && hold.reasons.has('keys')) {
          // Tab 으로 들어올 때 hoverPause 가 영상을 멈췄다: 이유만 지우지 말고 holdOff 로 재생까지 되살린다
          e.preventDefault();
          e.stopPropagation();
          ui.lines.blur();
          holdOff('keys');
          return;
        }
        hold.reasons.delete('keys'); // 두 줄을 떠나므로 포커스용 키 멈춤은 먼저 푼다
        if (!userPaused()) return;
        e.preventDefault();
        e.stopPropagation();
        ui.lines.blur();
        video.play()?.catch?.(() => {});
      }
    });
    // 두 줄에 포커스가 들어오고 나갈 때 안내 알약(28-7)을 그리고, 모드가 켜져 있으면 첫 낱말 자리로 간다.
    lines.addEventListener('focus', () => {
      if (vs().focusMode && ui.wcur < 0) {
        const k = V.focusStart(ui.tokens, S.hard);
        if (k >= 0) moveCursor(k);
      }
      renderFocusHint();
    });
    lines.addEventListener('blur', renderFocusHint);
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
    box.addEventListener('mouseenter', () => {
      S.hovering = true;
      if (vs().hoverPause) holdOn('hover');
      renderLine(); // 자막 위에 마우스가 있으면 가린 것을 보인다(28-8)
    });
    box.addEventListener('mouseleave', () => {
      S.hovering = false;
      holdOff('hover');
      renderLine();
    });
  }

  // ---- 말풍선(28-6) ----
  const dictPending = new Map(); // 사전에 묻는 중인 낱말 → 약속(같은 낱말을 두 번 묻지 않고, 기다리던 쪽도 같은 답을 받는다)
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
    tip.askOpen = false;
    tip.askText = '';
    tip.askAnswer = '';
    tip.askError = '';
    tip.askBusy = false;
    tip.askSeq++;
    holdOff('ask');
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
    if (!tip.open || tip.k !== k || tip.i !== S.cur) {
      // 다른 낱말·줄로 옮기면 묻기 칸과 답을 새로 시작한다.
      tip.askOpen = false;
      tip.askText = '';
      tip.askAnswer = '';
      tip.askError = '';
      tip.askBusy = false;
      tip.askSeq++;
      holdOff('ask');
    }
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
    acts.append(button('묻기', '이 줄에 묻기', () => toggleTipAsk()));
    acts.append(button('자세히', '자세히 — 사전 카드 열기', openTipDetail));
    kids.push(acts);
    if (tip.askOpen) kids.push(buildTipAsk());
    ui.tip.hidden = false;
    ui.tip.replaceChildren(...kids);
    placeTip();
    if (!hard && !dict) askTipDict(tip.lower, tip.word);
  }
  // 말풍선 묻기(28-18): 한 줄 입력칸(200자)과 답 칸. 다시 그려도 입력·답을 잃지 않게 tip 에 담아 둔다.
  function toggleTipAsk() {
    if (!tip.open) return;
    tip.askOpen = !tip.askOpen;
    if (!tip.askOpen) {
      tip.askSeq++; // 닫으면 늦게 온 답을 버린다
      holdOff('ask');
      tip.askError = '';
      tip.askAnswer = '';
    }
    // 묻는 동안 줄이 바뀌어 말풍선이 닫히고 답이 버려지지 않게 영상을 멈춘다(28-6 [자세히]와 같은 방식)
    if (tip.askOpen) holdOn('ask');
    paintTip();
    if (tip.askOpen) ui?.tip?.querySelector('.tp-q')?.focus();
  }
  function buildTipAsk() {
    const box = el('div', 'tp-ask');
    const input = el('input', 'tp-q');
    input.type = 'text';
    input.maxLength = 200;
    input.value = tip.askText;
    input.setAttribute('aria-label', '이 줄에 대해 질문');
    input.addEventListener('input', () => (tip.askText = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        sendTipAsk();
        return;
      }
      if (e.key !== 'Escape') e.stopPropagation(); // 유튜브 단축키로 새지 않게
    });
    const go = button('묻기', '질문 보내기', () => sendTipAsk());
    go.disabled = tip.askBusy;
    box.append(input, go);
    if (tip.askBusy) box.append(el('div', 'tp-answer', '답을 가져오는 중…'));
    else if (tip.askError) box.append(el('div', 'tp-answer err', tip.askError));
    else if (tip.askAnswer) box.append(el('div', 'tp-answer', tip.askAnswer));
    return box;
  }
  async function sendTipAsk() {
    const question = tip.askText.trim().slice(0, 200);
    if (!question || tip.askBusy) return;
    const i = tip.i;
    const cue = S.cues[i];
    if (!cue) return;
    tip.askText = question;
    tip.askBusy = true;
    tip.askError = '';
    tip.askAnswer = '';
    const my = ++tip.askSeq;
    paintTip();
    const ctx = V.contextOf(S.cues, i, titleNow());
    const r = await send({ type: 'ask', selection: cue.text, question, context: ctx });
    if (!tip.open || tip.askSeq !== my) return; // 그 사이 닫았거나 다른 낱말로 옮겼다
    tip.askBusy = false;
    if (typeof r?.answer === 'string' && r.answer) tip.askAnswer = r.answer;
    else tip.askError = errText(r, '답을 가져오지 못했어요');
    paintTip();
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
  async function fetchDict(lower, word) {
    const doing = dictPending.get(lower);
    if (doing) return doing;
    const p = (async () => {
      const id = S.id;
      const r = await send({ type: 'dict', word });
      if (id !== S.id) return undefined; // 그 사이 영상이 바뀌었다
      const data = r && typeof r === 'object' ? (r.error ? { found: false, error: r.error } : r) : { found: false, error: '응답 없음' };
      S.dictMemo.set(lower, data);
      if (S.dictMemo.size > MAX_DICT_MEMO) S.dictMemo.delete(S.dictMemo.keys().next().value);
      return data;
    })().finally(() => dictPending.delete(lower));
    dictPending.set(lower, p);
    return p;
  }
  async function askTipDict(lower, word) {
    const r = await fetchDict(lower, word);
    if (r && tip.open && tip.lower === lower) paintTip();
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
  async function toggleWordSave(i, lower, word, m, anchorEl) {
    const cue = S.cues[i];
    if (!cue) return false;
    const saved = S.savedForms.has(lower);
    const lemma = saved ? S.savedForms.get(lower) || m.lemma : m.lemma || lower;
    // 지금 카드 저장과 같은 메시지(27-2·28-6): 문장 = 이 줄, 주소 = 이 줄 장면
    const msg = saved
      ? { type: 'words', op: 'unsave', lemma }
      : { type: 'words', op: 'save', lemma, word, gloss: m.gloss, sentence: cue.text, url: V.sceneUrl(S.id, cue.start) };
    const r = await send(msg);
    if (r?.saved) {
      setTipSaved(lower, lemma, !saved);
      toast(saved ? '단어장에서 뺐어요' : '단어장에 저장했어요', anchorEl);
      wordsChanged();
      renderLine(); // .w.saved 칠하기를 바로 다시 그린다
      return true;
    }
    toast(errText(r, '저장하지 못했어요'), anchorEl);
    return false;
  }
  async function toggleTipSave(m, btn) {
    const i = tip.i;
    const lower = tip.lower;
    const word = tip.word;
    btn.disabled = true;
    const ok = await toggleWordSave(i, lower, word, m, ui.tip);
    if (!tip.open || tip.lower !== lower) return;
    btn.disabled = false;
    if (ok) paintTip();
  }
  // 두 줄 안 Enter(28-7): 그 낱말 저장/해제. 말풍선 저장과 같은 함수·같은 메시지를 쓴다.
  async function toggleWordAt(k) {
    const tk = ui?.tokens?.[k];
    const i = S.cur;
    const cue = S.cues[i];
    if (!tk?.w || !cue) return;
    const lower = tk.lower;
    let dict = S.dictMemo.get(lower);
    if (!S.savedForms.has(lower) && !S.hard.get(lower) && !dict) dict = await fetchDict(lower, tk.t);
    if (S.cues[S.cur] !== cue) return; // 기다리는 사이 줄이 바뀌었다
    const m = V.tooltipModel({ word: tk.t, hard: S.hard.get(lower), dict, saved: S.savedForms.has(lower) });
    const sp = ui.en.querySelector(`.w[data-k="${k}"]`);
    if (!S.savedForms.has(lower) && m.state !== 'found') return toast('사전에 없어요', sp || ui.box);
    await toggleWordSave(i, lower, tk.t, m, sp || ui.box);
    if (tip.open && tip.lower === lower) paintTip();
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
  // 두 줄 안 낱말 자리 목록(tokenize 조각 번호) — ←·→ 가 도는 순서
  function wordIdxs() {
    return (ui?.tokens ?? []).flatMap((tk, k) => (tk?.w ? [k] : []));
  }
  // 키보드 저장 모드 안내 알약(28-7): 두 줄에 포커스가 있고 모드가 켜져 있을 때만 보인다.
  function renderFocusHint() {
    if (!ui?.hint) return;
    const words = wordIdxs();
    const show = Boolean(vs().focusMode && ui.lines.matches(':focus') && S.cues[S.cur] && words.length);
    ui.hint.hidden = !show;
    if (!show) return;
    const at = words.indexOf(ui.wcur);
    ui.hint.textContent = `${at < 0 ? 1 : at + 1}/${words.length} · ←→ 표현 · Enter 저장 · Shift 줄 저장 · ↓ 자세히 · Esc 재생`;
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
    renderFocusHint();
  }

  // 글자 크기는 플레이어 높이를 따라가고, 줄은 유튜브 조작 막대 위에 둔다(막대가 숨어도 같은 자리 — 마우스를 올렸을 때 자막이 움직이지 않게)
  // 세로 막대(28-10)는 플레이어 왼쪽 가장자리 안, 위아래로 유튜브 조작 막대와 여백을 둔다. 전체 화면에서도 플레이어 rect 를 그대로 쓴다.
  function layout() {
    if (!host || !player) return;
    const v = vs();
    const height = player.clientHeight || 360;
    host.style.setProperty('--fs', `${V.fontPx(height, v.enFontPct)}px`);
    host.style.setProperty('--fs-en', `${V.fontPx(height, v.enFontPct)}px`);
    host.style.setProperty('--fs-ko', `${V.fontPx(height, v.koFontPct)}px`);
    const alpha = typeof v.bgOpacity === 'number' && Number.isFinite(v.bgOpacity) ? Math.min(100, Math.max(0, v.bgOpacity)) / 100 : 0.75;
    host.style.setProperty('--bg', String(alpha));
    const chromeH = site.chromeHeight(player);
    const posY = Math.min(0, Math.max(-40, Number(adjust.on ? adjust.posY : v.posY) || 0));
    host.style.bottom = `${chromeH + 14 + Math.round((Math.abs(posY) / 100) * height)}px`;
    if (ui?.bar) {
      const r = player.getBoundingClientRect();
      const topPad = Math.min(64, Math.max(20, Math.round((r.height || 360) * 0.16)));
      const bottomPad = chromeH + 14;
      ui.bar.style.left = `${Math.round(r.left + 8)}px`;
      ui.bar.style.top = `${Math.round(r.top + topPad)}px`;
      ui.bar.style.maxHeight = `${Math.max(84, Math.round((r.height || 360) - topPad - bottomPad))}px`;
    }
    renderRange();
  }

  const visible = () => Boolean(vs().subs && S.id && player && video && S.cues.length && ccOn() && !adShowing());
  function render() {
    if (!host || !ui) return;
    const show = visible();
    const lay = V.subLayout({ subType: vs().subType, koAbove: vs().koAbove });
    document.documentElement.toggleAttribute('data-readgloss-subs', show);
    if (show) ensurePageStyle();
    if (show !== S.shown) {
      S.shown = show;
      if (show) setTimeout(() => { pumpKo(); pumpAnnot(); }, 0); // 층이 다시 보이면(CC 켬·광고 끝) 지금 줄 근처를 채운다
    }
    const wait = waitMessage();
    const roundEnd = S.roundEnd;
    const roundMsg = roundEnd ? roundEndText(roundEnd) : '';
    // 자동 자막 다듬기(28-17): 자동 생성(kind=asr) 자막일 때만 상태 줄에 단추를 둔다. 자동으로 부르지 않는다.
    const canPolish = Boolean(show && S.id && S.main?.kind === 'asr' && S.main.words?.length);
    let msg = wait || roundMsg;
    let msgKind = roundEnd ? 'round' : wait ? 'wait' : '';
    if (!msg && show) {
      if (S.polishBusy) {
        msg = '자막을 다듬는 중…';
        msgKind = 'polish-busy';
      } else if (S.polishErr && Date.now() - S.polishErrAt < MSG_MS) {
        msg = '다듬기 실패 — 지금 자막을 써요';
        msgKind = 'polish-err';
      } else if (S.polishDoneAt && Date.now() - S.polishDoneAt < MSG_MS) {
        msg = '자막을 다듬었어요';
        msgKind = 'polish-done';
      } else if (canPolish && !S.polished) {
        msg = '자동 생성 자막';
        msgKind = 'polish-offer';
      }
    }
    if (msg !== S.msg) {
      S.msg = msg;
      S.msgAt = Date.now();
      notify('message');
    }
    // 라운드 끝 안내·다듬기 단추는 사용자가 누르거나 다음 라운드를 고를 때까지 남긴다(28-14·28-17).
    const showMsg = Boolean(msg) && (roundEnd || msgKind === 'polish-offer' || msgKind === 'polish-busy' || Date.now() - S.msgAt < MSG_MS);
    ui.msg.hidden = !showMsg;
    const msgKey = [msgKind, roundEnd ? `${roundEnd.index}|${roundEnd.total}` : '', S.polishVer, msg].join('|');
    if (ui.msgKey !== msgKey) {
      ui.msgKey = msgKey;
      if (roundEnd) {
        const nb = button('다음', '다음 라운드 재생', () => nextRound(roundEnd));
        nb.classList.add('nx');
        ui.msg.replaceChildren(el('span', 'mx', roundMsg), nb);
      } else if (msgKind === 'polish-offer') {
        const pb = button('자막 다듬기(AI)', '자동 생성 자막을 AI 로 문장 단위로 다듬기', () => requestPolish());
        pb.classList.add('px');
        ui.msg.replaceChildren(el('span', 'mx', msg), pb);
      } else {
        ui.msg.textContent = msg;
      }
    }
    host.style.display = show || showMsg ? 'flex' : 'none';
    const mode = vs().mode;
    const paused = Boolean(video?.paused);
    if (show && mode === 'build' && paused) ensureBuild();
    const buildOpen = Boolean(show && mode === 'build' && S.build);
    const buildDone = buildOpen && S.build.done === true;
    const modeHide = (mode === 'listen' && !S.listenReveal) || (mode === 'build' && !buildDone);
    ui.lines.hidden = !show || (!lay.showEn && !lay.showKo) || modeHide;
    ui.adjust.hidden = !(show && adjust.on);
    renderBarOrder();
    ui.bar.hidden = !show || !ui.bar.childElementCount;
    ui.notice.hidden = !(show && !vs().keysNoticeSeen); // 처음 한 번만(알겠어요를 누르면 설정에 남는다)
    ui.modePill.hidden = !(show && mode === 'listen' && !S.listenReveal && paused);
    ui.build.hidden = !buildOpen;
    if (buildOpen) renderBuild();
    else ui.buildKey = '';
    const drillOn = show && S.drill;
    ui.box.classList.toggle('drill', drillOn);
    ui.lines.classList.toggle('drillhide', drillOn && !S.drillReveal);
    ui.drillPill.hidden = !drillOn;
    ui.drillNote.hidden = !(drillOn && S.drillNotice);
    if (drillOn) {
      const total = S.cues.length;
      const at = S.cur >= 0 ? S.cur + 1 : 0;
      ui.drillCount.textContent = `${at} / ${total}`;
      ui.drillCount.setAttribute('aria-label', `${total}줄 중 ${at}번째`);
    }
    if (!show) {
      ui.note.hidden = true;
      ui.range.hidden = true;
      closeTip();
      renderFocusHint();
      return;
    }
    renderLine();
    renderBar();
    renderRange();
    renderNote();
    renderFocusHint();
  }

  // 영어 줄은 바뀐 것이 있을 때만 다시 만든다(누르는 사이에 낱말이 갈리면 클릭이 사라진다)
  function renderLine() {
    if (!ui) return;
    const i = S.cur;
    const cue = S.cues[i];
    const v = vs();
    ui.lines.classList.toggle('past', S.past);
    // 멈췄거나 자막 위에 마우스가 있거나 드릴 Space 로 보이는 동안에는 가리기를 잠깐 푼다(28-8).
    const hideOff = S.revealed === i || S.drillReveal || (v.hide !== 'off' && (Boolean(video?.paused) || S.hovering));
    const mode = hideOff ? 'off' : v.hide;
    const lay = V.subLayout({ subType: v.subType, koAbove: v.koAbove });
    ui.en.hidden = !lay.showEn;
    ui.ko.hidden = !lay.showKo;
    const orderOf = (k) => String(Math.max(0, lay.order.indexOf(k)));
    ui.en.style.order = orderOf('en');
    ui.ko.style.order = orderOf('ko');
    const key = cue ? [S.mainKey, i, mode, v.hard, v.subType, v.koAbove, S.ko[i] ?? '', S.koErr, S.hardVer, S.savedVer, v.hideTypes?.hard, v.hideTypes?.done, v.hideTypes?.other, v.idioms, v.mode, S.koPeek === i ? 1 : 0, S.polishVer].join('|') : '';
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
    const bands = v.hard ? v.wordBands : null;
    const typeOf = (w) => (S.hard.has(w) ? 'hard' : S.done.has(S.savedForms.get(w) ?? w) ? 'done' : 'other');
    const hid = V.maskFlags(toks, mode, typeOf, v.hideTypes);
    const lineHid = mode === 'line' && hid.some(Boolean); // 고른 유형이 하나라도 있으면 줄 통째로(사이 글자 포함)
    const appendToken = (tk, k, parent, inPhrase = false) => {
      if (!tk.w) return void appendRest(tk.t, lineHid, parent);
      const sp = el('span', 'w', tk.t);
      sp.dataset.k = String(k);
      if (k === ui.wcur) sp.classList.add('cur');
      const h = S.hard.get(tk.lower);
      if (v.hard && h) {
        sp.classList.add('hard');
        if (h.gloss) sp.append(el('span', 'g', h.gloss));
      }
      if (!inPhrase) {
        const saved = S.savedForms.has(tk.lower);
        const done = S.done.has(S.savedForms.get(tk.lower) ?? tk.lower);
        const color = V.tokenColor({ p: h?.p, bands, saved, done, known: false });
        if (color === 'green') sp.classList.add('gr');
        else if (color === 'orange') sp.classList.add('or');
        else if (color === 'check') sp.classList.add('chk');
      }
      if (hid[k]) {
        sp.classList.add('hid');
        sp.title = HID_TITLE;
      }
      parent.append(sp);
    };
    // 저장한 구(28-9): 낱말들을 한 알약으로 감싼다(복습 끝 = 초록, 아니면 주황).
    const spans = v.idioms ? V.phraseSpans(toks, S.phrases) : [];
    const spanAt = new Map(spans.map((s) => [s.start, s]));
    for (let k = 0; k < toks.length;) {
      const span = spanAt.get(k);
      if (span) {
        const wrap = el('span', `phr ${span.done ? 'gr' : 'or'}`);
        for (let j = k; j <= span.end && j < toks.length; j++) appendToken(toks[j], j, wrap, true);
        ui.en.append(wrap);
        k = span.end + 1;
      } else {
        appendToken(toks[k], k, ui.en);
        k++;
      }
    }
    ui.tokens = toks;
    const koText = S.ko[i] || (S.koErr && !S.koFail.has(i) ? S.koErr : '');
    if (v.mode === 'understand' && lay.showKo && S.koPeek !== i) {
      // 이해(28-16): 한국어 줄은 숨기고 그 자리에 보기 단추를 둔다. 누르면 이 줄만 보인다.
      const peek = button('한국어 줄 보기', '이 줄의 한국어 줄 보기', () => {
        S.koPeek = i;
        renderLine();
      });
      peek.classList.add('kpeek');
      ui.ko.classList.remove('err');
      ui.ko.replaceChildren(peek);
    } else {
      ui.ko.textContent = lay.showKo ? koText : '';
      ui.ko.classList.toggle('err', !S.ko[i] && Boolean(koText));
    }
    // 말풍선이 열려 있으면 다시 만든 낱말에 붙여 다시 그린다(저장 칠하기·어려운 단어가 바뀌어도 따라간다).
    if (tip.open) {
      const sp = tip.i === i ? ui.en.querySelector(`.w[data-k="${tip.k}"]`) : null;
      if (sp) {
        tip.el = sp;
        paintTip();
      } else closeTip();
    }
  }

  // 낱말이 아닌 조각. 줄 통째 가리기면 그 안의 글자·숫자(한 글자 a·I, x86, café 등)도 가린다 — 사전 낱말이 아니라 누르면 그 줄을 보이기만 한다
  const HID_TITLE = '가린 낱말 — 눌러서 보기';
  function appendRest(text, hideAll, parent = ui.en) {
    if (!hideAll) return void parent.append(text);
    let last = 0;
    for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const sp = el('span', 'w hid', m[0]);
      sp.title = HID_TITLE;
      parent.append(sp);
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(text.slice(last));
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
  // 설정 순서·숨김(28-10). 순서가 바뀌었을 때만 단추를 다시 늘어놓는다.
  function renderBarOrder() {
    if (!ui?.bar) return;
    const rows = V.barModel(vs().barOrder, vs().barHidden, SET.DEFAULTS.video.barOrder);
    const key = rows.map((r) => `${r.name}${r.hidden ? 0 : 1}`).join(',');
    if (key === ui.barKey) return;
    ui.barKey = key;
    ui.bar.replaceChildren(...rows.filter((r) => !r.hidden).map((r) => ui.btns[r.name]).filter(Boolean));
    // 학습 모드(28-16)는 컨트롤 편집 목록과 상관없이 막대 맨 위에 늘 둔다(모드를 잃으면 나머지 단추의 뜻도 흐려진다).
    if (ui.btns.mode) ui.bar.prepend(ui.btns.mode);
  }
  function renderBar() {
    const v = vs();
    const cue = S.cues[S.cur];
    const hide = V.HIDE_LABEL[v.hide] ?? '끔';
    showLabel(ui.hideBtn, v.hide, `가리기 바꾸기 — 지금 ${hide}`);
    const modeAt = Math.max(0, V.MODES.indexOf(v.mode));
    const nextMode = V.MODES[(modeAt + 1) % V.MODES.length];
    showLabel(ui.modeBtn, v.mode, `학습 모드 — 지금 ${V.MODE_LABEL[v.mode] ?? '보기'} (누르면 ${V.MODE_LABEL[nextMode]})`);
    ui.modeBtn.setAttribute('aria-pressed', String(v.mode !== 'watch'));
    ui.pauseBtn.setAttribute('aria-pressed', String(v.pauseEach));
    ui.lineBtn.setAttribute('aria-pressed', String(v.repeatLine));
    ui.gapBtn.setAttribute('aria-pressed', String(v.skipGaps));
    ui.loopBtn.setAttribute('aria-pressed', String(Boolean(S.range)));
    ui.slowBtn.setAttribute('aria-pressed', String(Boolean(video && video.playbackRate !== 1))); // 지금 속도가 1 이 아님(28-3)
    ui.drillBtn.setAttribute('aria-pressed', String(S.drill));
    ui.focusBtn.setAttribute('aria-pressed', String(v.focusMode));
    ui.koBtn.setAttribute('aria-pressed', String(V.subLayout({ subType: v.subType, koAbove: v.koAbove }).showKo));
    const saved = cue ? Boolean(Sel.findPhrase(S.phrases, cue.text)) : false;
    showLabel(ui.saveBtn, saved ? 'on' : 'off', saved ? '이 줄 저장 빼기 (Shift)' : '이 줄 구·문장에 저장 (Shift)');
    ui.saveBtn.setAttribute('aria-pressed', String(saved));
    ui.explainBtn.setAttribute('aria-expanded', String(Boolean(S.note) && S.note.i === S.cur));
    for (const b of [ui.prevBtn, ui.repeatBtn, ui.nextBtn, ui.saveBtn, ui.explainBtn]) b.disabled = !cue;
  }

  // ---- 조립(28-16) ----
  // 멈춘 줄의 영어 낱말만 칩으로 만든다. seed 는 영상·줄·글로 정해 같은 줄은 늘 같은 순서로 섞인다.
  function ensureBuild() {
    if (!video?.paused) return;
    const cue = S.cues[S.cur];
    if (!cue) {
      S.build = null;
      return;
    }
    const b = S.build;
    if (b && b.i === S.cur && b.key === S.mainKey && b.text === cue.text) return;
    const tokens = V.tokenize(cue.text);
    const answer = tokens.flatMap((tk, k) => (tk.w ? [k] : []));
    if (!answer.length) {
      S.build = null;
      return;
    }
    S.build = {
      i: S.cur,
      key: S.mainKey,
      text: cue.text,
      tokens,
      answer,
      // 같은 낱말이 두 번 나와도 어느 칩을 눌렀든 그 자리의 낱말이면 맞게 본다(글자로 견준다).
      keys: answer.map((k) => tokens[k]?.lower ?? ''),
      chips: V.shuffleTiles(answer, `${S.mainKey}|${S.cur}|${cue.text}`),
      placed: [],
      wrongK: -1,
      done: false,
    };
  }
  // 놓은 칸·남은 칩·안내를 그린다. 틀린 칩은 잠깐 흔들고 은행에 그대로 둔다(벌점 없음).
  function renderBuild() {
    const b = S.build;
    if (!ui?.build) return;
    if (!b) {
      ui.build.hidden = true;
      return;
    }
    const key = [b.key, b.i, b.text, b.placed.join(','), b.wrongK, b.done ? 1 : 0, video?.playbackRate ?? 1].join('|');
    if (ui.buildKey === key) return;
    ui.buildKey = key;
    const used = new Set(b.placed);
    ui.buildSlots.replaceChildren(...b.answer.map((k, pos) => {
      // 칸에는 정답 낱말을 보여 준다(같은 낱말을 다른 자리에서 눌러도 글이 흔들리지 않게).
      if (pos < b.placed.length) return el('span', 'tile placed', b.tokens[k]?.t ?? '');
      return el('span', 'slot', String(pos + 1));
    }));
    ui.buildTiles.replaceChildren(...b.chips.filter((k) => !used.has(k)).map((k) => {
      const word = b.tokens[k]?.t ?? '';
      const tile = button(word, `${word} — 들은 순서대로 누르기`, () => clickTile(k));
      tile.classList.add('tile');
      if (k === b.wrongK) tile.classList.add('shake');
      return tile;
    }));
    ui.buildState.textContent = b.done ? '다 맞혔어요' : '들은 순서대로 눌러 보세요';
    ui.buildNext.hidden = !b.done;
    ui.buildAgain.disabled = !S.cues[S.cur];
    ui.buildSlow.setAttribute('aria-pressed', String(Boolean(video && video.playbackRate !== 1)));
  }
  function clickTile(k) {
    const b = S.build;
    if (!b || b.done) return;
    const keyOf = (x) => b.tokens[x]?.lower ?? '';
    const next = [...b.placed, k];
    const nextKeys = next.map(keyOf);
    if (!V.tileCheck(nextKeys, b.keys.slice(0, nextKeys.length))) {
      // 틀린 칩: 흔들기만 하고 placed 는 그대로라 칩이 제자리로 돌아간다.
      b.wrongK = k;
      renderBuild();
      setTimeout(() => {
        if (S.build !== b) return;
        b.wrongK = -1;
        renderBuild();
      }, 450);
      return;
    }
    b.placed = next;
    b.wrongK = -1;
    if (V.tileCheck(b.placed.map(keyOf), b.keys)) b.done = true;
    render();
  }

  function progressRect() {
    const p = site.name === 'youtube' ? (player?.querySelector('.ytp-progress-bar') ?? null) : site.progressEl(player);
    const r = p?.getBoundingClientRect?.() ?? null;
    return r && r.width > 0 && r.height > 0 ? r : null;
  }
  function renderRange() {
    if (!ui?.range) return;
    const range = S.range;
    const rect = player && visible() ? progressRect() : null;
    const duration = Number(video?.duration);
    if (!range || !Number.isFinite(range.start) || !rect || !Number.isFinite(duration) || duration <= 0) {
      ui.range.hidden = true;
      return;
    }
    ui.range.hidden = false;
    ui.range.style.left = `${Math.round(rect.left)}px`;
    ui.range.style.top = `${Math.round(rect.top - 4)}px`;
    ui.range.style.width = `${Math.round(rect.width)}px`;
    ui.range.style.height = `${Math.round(rect.height + 8)}px`;
    const x = (t) => Math.min(rect.width, Math.max(0, (t / duration) * rect.width));
    ui.rangeA.hidden = false;
    ui.rangeA.style.left = `${Math.round(x(range.start))}px`;
    const hasEnd = Number.isFinite(range.end) && range.end > range.start;
    ui.rangeB.hidden = !hasEnd;
    if (hasEnd) ui.rangeB.style.left = `${Math.round(x(range.end))}px`;
  }
  // 눈금 끌기: 진행 막대 x -> 시각(xToTime). 끝 ≤ 시작이 되는 값은 받지 않는다.
  let rangeDrag = null;
  function startRangeDrag(which, e) {
    if (!S.range || !video) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    rangeDrag = which;
    const move = (ev) => {
      if (!rangeDrag) return;
      const rect = progressRect();
      const duration = Number(video?.duration);
      if (!rect || !Number.isFinite(duration) || duration <= 0) return;
      if (ev.cancelable) ev.preventDefault();
      const t = V.xToTime(ev.clientX - rect.left, rect.width, duration);
      const r = S.range;
      if (!r) return;
      if (rangeDrag === 'start') {
        if (Number.isFinite(r.end) && t >= r.end) return;
        S.range = { start: t, end: Number.isFinite(r.end) ? r.end : null };
      } else {
        if (t <= r.start) return;
        S.range = { start: r.start, end: t };
      }
      renderRange();
    };
    const end = () => {
      rangeDrag = null;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      renderBar();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
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
    const hadRound = Boolean(S.round || S.roundEnd);
    S.clip = null;
    S.round = null;
    S.roundEnd = null;
    S.pausedFor = -1;
    video.currentTime = c.start + 0.01; // 줄 시작보다 앞이면 앞 줄이 잠깐 지금 줄이 된다
    if (video.paused) video.play()?.catch?.(() => {});
    tick(true);
    if (hadRound) notify('round');
  }
  function run(act, anchorEl) {
    const i = S.cur;
    if (act === 'prev') return goLine(Math.max(0, i - 1));
    if (act === 'repeat') return goLine(Math.max(0, i));
    if (act === 'next') return goLine(Math.min(S.cues.length - 1, i + 1));
    if (act === 'hide') return setVideo({ hide: V.nextHide(vs().hide) });
    // [한]: 한국어 줄만 켜고 끈다. 영어 줄이 같이 보이면 subType dual/en, 한국어만 보이면 ko/none 으로 오간다.
    if (act === 'ko') {
      const v = vs();
      const lay = V.subLayout({ subType: v.subType, koAbove: v.koAbove });
      return setVideo({ subType: lay.showKo ? (lay.showEn ? 'en' : 'none') : (lay.showEn ? 'dual' : 'ko') });
    }
    if (act === 'save') return saveLine(S.cur, anchorEl);
    if (act === 'explain') return explain(S.cur);
    if (act === 'pauseEach') return setVideo(vs().pauseEach ? { pauseEach: false } : { pauseEach: true, repeatLine: false });
    if (act === 'repeatLine') return setVideo(vs().repeatLine ? { repeatLine: false } : { repeatLine: true, pauseEach: false });
    if (act === 'skipGaps') return setVideo({ skipGaps: !vs().skipGaps });
    if (act === 'loop') return loopRange(anchorEl);
    // 느리게 재생(28-3): 1 ↔ 설정한 느린 속도. 유튜브 메뉴로 바꾼 다른 속도도 1 이 아니면 1 로 돌린다.
    if (act === 'slow') {
      if (!video) return;
      video.playbackRate = V.nextRate(video.playbackRate, vs().slowRate);
      renderBar();
      if (S.build) renderBuild();
      return;
    }
    // 키보드 저장 모드(28-7): 켜고 끄기 + 상태 줄. 켤 때 이미 사용자가 멈춰 있으면 곧 두 줄로 포커스한다.
    if (act === 'focusMode') {
      const on = !vs().focusMode;
      setVideo({ focusMode: on });
      toast(on ? '키보드 저장 모드 켜짐' : '키보드 저장 모드 꺼짐');
      if (on) {
        if (video?.paused) scheduleFocus(pauseReasonNow());
      } else {
        clearFocusTimer();
        if (ui?.lines.matches(':focus')) ui.lines.blur();
        closeTip();
      }
      render();
      return;
    }
    // 리스닝 드릴(28-8): 저장하지 않는다. 켜면 두 줄을 숨기고, 처음 한 번 안내 카드를 띄운다(세션 동안만).
    if (act === 'drill') {
      S.drill = !S.drill;
      S.drillReveal = false;
      S.drillLastUp = null;
      S.drillPress = null;
      S.drillNotice = S.drill && !S.drillNoticeSeen;
      toast(S.drill ? '리스닝 드릴 켜짐' : '리스닝 드릴 꺼짐');
      render();
      return;
    }
    // 패널 열기·닫기(28-13): 열 때는 [영상] 탭으로. 이미 열려 있으면(열림 알림을 받아 S.panelOpen) 닫기 알림을 보낸다.
    if (act === 'panel') {
      if (S.panelOpen) window.dispatchEvent(new CustomEvent('readgloss:close-panel'));
      else window.dispatchEvent(new CustomEvent('readgloss:open-panel', { detail: { tab: 'video' } }));
      return;
    }
    if (act === 'reveal') {
      S.revealed = i;
      renderLine();
    }
    if (act === 'mode') return cycleMode();
  }

  // 학습 모드(28-16): 막대 [모드] 는 보기 → 이해 → 듣기 → 조립 → 보기 로 돈다.
  const MODE_AUTO_PAUSE = (m) => m === 'listen' || m === 'build';
  function cycleMode() {
    const cur = vs().mode;
    const at = Math.max(0, V.MODES.indexOf(cur));
    setMode(V.MODES[(at + 1) % V.MODES.length]);
  }
  // 듣기·조립은 줄마다 멈춤을 자동으로 켜고(문장 반복과 배타), 모드를 떠나면 원래 값으로 돌린다.
  function setMode(next) {
    if (!V.MODES.includes(next) || next === vs().mode) return;
    const cur = vs().mode;
    const patch = { mode: next };
    if (!MODE_AUTO_PAUSE(cur) && MODE_AUTO_PAUSE(next)) {
      S.modePause = { pauseEach: vs().pauseEach, repeatLine: vs().repeatLine };
      patch.pauseEach = true;
      patch.repeatLine = false;
    } else if (MODE_AUTO_PAUSE(cur) && !MODE_AUTO_PAUSE(next)) {
      const snap = S.modePause;
      S.modePause = null;
      patch.pauseEach = snap ? snap.pauseEach : vs().pauseEach;
      patch.repeatLine = snap ? snap.repeatLine : vs().repeatLine;
    }
    S.koPeek = -1;
    S.listenReveal = false;
    S.build = null;
    S.revealed = -1;
    setVideo(patch);
    toast(`학습 모드 ${V.MODE_LABEL[next]}`, ui?.bar);
    render();
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

  // 패널 [풀이] 탭(28-12): 지금 줄 앞뒤 두 줄만 문맥으로 같은 다리 길(translate-context)을 부른다.
  // 카드는 패널이 그리고, 캐시는 다리가 그대로 쓴다. force 면 캐시를 건너뛰고 다시 만든다.
  async function explainAt(i, force = false) {
    const cue = S.cues[i];
    if (!cue) return { error: 'no-cue' };
    const key = S.mainKey;
    const from = Math.max(0, i - 2);
    const near = S.cues.slice(from, Math.min(S.cues.length, i + 3));
    const ctx = V.contextOf(near, i - from, titleNow());
    const r = await send({
      type: 'translate-context',
      text: cue.text,
      context: { before: ctx.before, after: ctx.after, title: ctx.title, headings: [] },
      ...(force === true && { force: true }),
    });
    if (key !== S.mainKey || S.cues[i] !== cue) return { error: 'changed' };
    return r;
  }

  // 패널 [풀이] 탭 묻기(28-18): 지금 줄을 selection 으로, 앞뒤 3줄을 문맥으로 보낸다. 같은 (줄, 질문)은 다리 캐시.
  async function askAt(i, question) {
    const cue = S.cues[i];
    if (!cue) return { error: 'no-cue' };
    const q = String(question ?? '').trim().slice(0, 200);
    if (!q) return { error: 'bad-request' };
    const key = S.mainKey;
    const ctx = V.contextOf(S.cues, i, titleNow());
    const r = await send({ type: 'ask', selection: cue.text, question: q, context: ctx });
    if (key !== S.mainKey || S.cues[i] !== cue) return { error: 'changed' };
    return r;
  }

  // ---- 한국어 줄(맥 번역): 한 번에 하나씩, 지금 줄 근처부터 ----
  // 지금 줄 근처는 한국어 줄이 보일 때만(층이 꺼졌거나 CC 를 껐으면 맥 번역을 부르지 않는다). [한국어 모두 보기]는 한국어 줄 설정과 상관없이 대본 전체를.
  async function pumpKo() {
    if (S.koBusy || !S.cues.length || !S.id || !(S.koAll || (V.subLayout({ subType: vs().subType, koAbove: vs().koAbove }).showKo && visible()))) return;
    if (S.koErr) {
      if (Date.now() - S.koErrAt < ERR_PAUSE_MS) return;
      S.koErr = '';
    }
    const i = V.koPlan(S.cues.length, S.cur, (k) => Boolean(S.ko[k]) || S.koFail.has(k), S.koAll);
    if (i < 0) return;
    S.koBusy = true;
    const key = `${S.mainKey}|${S.polishVer}`;
    const cue = S.cues[i];
    const text = S.cues[i].text;
    const r = await send({ type: 'mt', text });
    S.koBusy = false;
    if (key !== `${S.mainKey}|${S.polishVer}` || S.cues[i] !== cue) return pumpKo(); // 그 사이 영상·자막이 바뀌었다
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
    const bands = bandsKey(vs());
    const minP = V.minPFor(vs().wordBands);
    const r = await send({ type: 'annotate', words, level, ...(minP !== null && { minP }) });
    S.annotBusy = false;
    if (level !== settings.level || bands !== bandsKey(vs())) return true; // 그 사이 수준·칠 구간이 바뀌었다(apply 가 칠하기를 비웠다): 옛 답은 버리고 다시 묻게
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
      if (it && typeof it === 'object' && typeof it.gloss === 'string') S.hard.set(w.toLowerCase(), { lemma: typeof it.lemma === 'string' ? it.lemma : w.toLowerCase(), gloss: it.gloss, p: typeof it.p === 'number' ? it.p : null });
    }
    S.hardVer++;
    renderLine();
    notify('hard');
    return true;
  }
  function pumpAnnot() {
    const v = vs();
    const needAnnot = v.hard && V.minPFor(v.wordBands) !== null;
    if (!(needAnnot || (v.hide !== 'off' && v.hideTypes?.hard === true)) || !visible() || S.annotBusy || Date.now() - S.annotErrAt < ERR_PAUSE_MS) return; // 층이 보일 때만(대본 전체는 annotateAll)
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
    S.done = new Set(Object.entries(r.saved).filter(([, x]) => x?.review?.done === true).map(([k]) => k)); // 복습 끝난 낱말(28-8)
    S.saved = r.saved; // 패널 '나의 표현' 이 이 영상 주소로 저장한 낱말을 고른다(28-12)
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
  // 설정 탭 [자막 위치 조정](28-11): 자막 층에 끌어 옮기는 띠를 연다.
  window.addEventListener('readgloss:subs-adjust', () => {
    if (!ui) return;
    adjust.on = true;
    adjust.posY = vs().posY;
    render();
    layout();
  });

  // ---- 장면 재생(복습 27-4) ----
  // maxSec 은 구간 길이 상한이다: 일반 장면은 60초(MAX_CLIP), 라운드는 75초(MAX_ROUND)까지(28-14).
  function playClip(start, end, maxSec = V.MAX_CLIP) {
    if (!video) return false;
    const limit = Number(maxSec);
    const stop = Number.isFinite(limit) && limit > 0 ? Math.min(end, start + limit) : end;
    S.clip = { start, end: stop };
    S.pausedFor = -1;
    S.round = null;
    S.roundEnd = null;
    video.currentTime = start + 0.01;
    video.play()?.catch?.(() => {});
    tick(true);
    return true;
  }

  // ---- 1분 라운드(28-14) ----
  const roundList = () => V.rounds(S.cues);
  // 그 라운드 안의 어려운 낱말(원형마다 하나). first 는 대본 줄 번호다.
  function roundHardWords(r) {
    if (!r) return [];
    const slice = S.cues.slice(r.from, r.to + 1);
    return V.previewWords(slice, S.hard).map((w) => ({ ...w, first: w.first + r.from }));
  }
  const roundEndText = (r) => `라운드 ${r.index + 1} 끝 · 어려운 단어 ${roundHardWords(r).length}`;
  // [보기]·[다음]: 라운드를 장면 구간처럼 재생하되 길이 상한만 75초로 넓힌다.
  function playRound(i) {
    if (!video) return false;
    const list = roundList();
    const r = list[i];
    if (!r) return false;
    if (!playClip(r.start, r.end, V.MAX_ROUND)) return false;
    S.round = { index: i, total: list.length, start: r.start, end: r.end, from: r.from, to: r.to };
    S.roundEnd = null;
    notify('round');
    render();
    return true;
  }
  function nextRound(r) {
    if (!playRound(r.index + 1)) toast('마지막 라운드예요');
  }

  // ---- 자동 자막 다듬기(28-17) ----
  // 다리 /video/polish 에 낱말 시각을 보내고, 돌아온 문장 줄로 지금 자막을 바꾼다. 자동으로 부르지 않는다(구독 한도).
  function polishFailed() {
    S.polishBusy = false;
    S.polishErr = 'bad-polish';
    S.polishErrAt = Date.now();
    S.polishDoneAt = 0;
    S.msg = '';
    render();
    notify('track');
  }
  function applyPolish(main, words, lines) {
    const polished = V.polishedCues(words, lines);
    if (!polished.length) return polishFailed();
    // 6000낱말을 넘는 긴 자막은 앞부분만 다듬고, 그 뒤 줄은 지금 줄을 그대로 붙인다.
    const all = Array.isArray(main.words) ? main.words : [];
    const cues = all.length > words.length
      ? polished.concat(main.cues.filter((c) => c.start >= polished[polished.length - 1].end))
      : polished;
    S.polished = { lines: lines.length, words: words.length };
    S.polishBusy = false;
    S.polishErr = '';
    S.polishErrAt = 0;
    S.polishDoneAt = Date.now();
    S.polishVer++;
    S.cues = cues;
    S.ko = new Array(cues.length).fill('');
    S.koFail = new Set();
    S.koErr = '';
    if (S.koTrack?.cues?.length) V.alignKo(cues, S.koTrack.cues).forEach((t, i) => { if (t) S.ko[i] = t; });
    S.cur = -1;
    S.revealed = -1;
    S.pausedFor = -1;
    S.prevT = video?.currentTime ?? 0;
    S.mem = { repeatedFor: -1, gapTo: -1 };
    S.msg = '';
    notify('track');
    tick(true);
    pumpKo();
    pumpAnnot();
  }
  async function requestPolish() {
    if (S.polishBusy || !S.id || !video) return;
    const main = S.main;
    const all = Array.isArray(main?.words) ? main.words : [];
    if (main?.kind !== 'asr' || !all.length) return;
    const words = all.slice(0, MAX_POLISH_WORDS).map((w) => ({ t: w.t, w: w.w }));
    const key = `${S.mainKey}|${S.polishVer}`;
    S.polishBusy = true;
    S.polishErr = '';
    S.polishErrAt = 0;
    S.polishDoneAt = 0;
    S.msg = '';
    render();
    notify('track');
    const r = await send({ type: 'video-polish', id: S.id, words });
    if (key !== `${S.mainKey}|${S.polishVer}` || S.main !== main) return; // 그 사이 자막이 바뀌었다
    if (!r?.lines || !V.validPolish(r.lines, words.length)) return polishFailed();
    applyPolish(main, words, r.lines);
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
  const spherical = () => site.yieldKeys(player);
  const inOtherScreen = (path) => path.some((n) => typeof n?.localName === 'string' && n.localName.startsWith('readgloss-') && n !== host);
  // 자막 층 shadow 는 closed 라 composedPath 에 안 보이니, 그 안 포커스(말풍선 묻기 입력칸 등)는 root.activeElement 로 본다
  const typingInLayer = () => Sel.isEditableElement(ui?.lines?.getRootNode?.()?.activeElement);
  function keyBlocked(e) {
    const path = e.composedPath();
    if (Sel.isTypingPath(path, e.isComposing) || typingInLayer()) return true;
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
    // 리스닝 드릴(28-8): Space 누름 = 자막 보이기, 뗀 뒤 0.28초 안의 다시 누름 = 재생/정지(그 누름은 보이지 않는다).
    // 입력칸 밖·자막 층이 보일 때만 가로채고, 유튜브로 넘기지 않는다. 반복 키는 막기만 하고 다시 처리하지 않는다.
    if (S.drill && e.code === 'Space') {
      if (!visible() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || keyBlocked(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const r = V.drillSpace({ now: Date.now() / 1000, lastUp: S.drillLastUp });
      S.drillLastUp = r.nextLastUp;
      S.drillPress = r.action;
      if (r.action === 'toggle') {
        if (video) {
          if (video.paused) video.play()?.catch?.(() => {});
          else video.pause();
        }
        S.drillReveal = false;
        render();
        return;
      }
      S.drillReveal = true;
      render();
      return;
    }
    const act = V.keyAction(e);
    if (!act || !visible()) return;
    if ((act === 'prev' || act === 'repeat' || act === 'next' || act === 'focusMode') && spherical()) return;
    // 패널이 열려 있으면 / 로 닫을 수 있다(28-13): 열 때 포커스가 패널 탭으로 가므로 다른 화면 키 막힘보다 먼저 본다.
    // 패널 안 입력칸에서는 그대로 타이핑한다.
    if (act === 'panel' && S.panelOpen) {
      if (Sel.isTypingPath(e.composedPath(), e.isComposing) || typingInLayer()) return;
      e.preventDefault();
      e.stopPropagation();
      run(act);
      return;
    }
    if (keyBlocked(e)) return;
    e.preventDefault();
    e.stopPropagation();
    run(act);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!e.isTrusted) return;
    if (S.drill && S.drillPress && e.code === 'Space') {
      const action = S.drillPress;
      S.drillPress = null;
      if (action === 'reveal') {
        S.drillReveal = false;
        S.drillLastUp = Date.now() / 1000; // 이 뗀 시각부터 0.28초 안의 다시 누름이 토글
        render();
      }
      if (visible() && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing && !keyBlocked(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key !== 'Shift' || !shiftDown) return;
    const tap = V.shiftTapAction({ downAt: shiftDown.at, upAt: Date.now(), interrupted: shiftDown.interrupted });
    shiftDown = null;
    if (tap !== 'saveLine' || !visible() || S.cur < 0) return;
    if (keyBlocked(e)) return;
    saveLine(S.cur);
  }, true);
  window.addEventListener('pointerdown', () => { if (shiftDown) shiftDown.interrupted = true; }, true);
  window.addEventListener('blur', () => { if (shiftDown) shiftDown.interrupted = true; }); // 창을 떠나며 Shift 를 놓친 경우

  if (site.navEvent) document.addEventListener(site.navEvent, checkPage);
  window.addEventListener('resize', () => layout());
  // 페이지가 스크롤되면 fixed 인 막대·구간 눈금 자리를 플레이어 rect 로 다시 잡는다(프레임당 한 번)
  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; layout(); });
  }, { passive: true, capture: true });
  document.addEventListener('fullscreenchange', () => layout());
  document.addEventListener('webkitfullscreenchange', () => layout());
  setInterval(checkPage, 1000); // 주소 바뀜·플레이어 교체·안내 시간을 함께 본다
  checkPage();

  globalThis.readglossVideoUi = {
    state: () => ({ id: S.id, title: titleNow(), cues: S.cues, kind: S.main?.kind ?? null, ko: S.ko, cur: S.cur, hard: S.hard, koAll: S.koAll, message: S.msg, polished: Boolean(S.polished), polishBusy: S.polishBusy, polishVer: S.polishVer, canPolish: Boolean(S.main?.kind === 'asr' && S.main.words?.length) }),
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
    polish: () => requestPolish(),
    playScene,
    // 1분 라운드(28-14): 대본의 라운드 목록과 그 라운드 재생, 지금 라운드 상태(끝났는지 포함).
    rounds: () => roundList(),
    playRound: (i) => playRound(i),
    round: () => (S.roundEnd ? { ...S.roundEnd, ended: true } : S.round ? { ...S.round, ended: false } : null),
    // 패널 대본 칠하기·거르기(28-12): hard·저장 활용형·복습 끝·저장 구를 한 번에 읽는다.
    panelData: () => ({ hard: S.hard, forms: S.savedForms, done: S.done, phrases: S.phrases, version: `${S.hardVer}|${S.savedVer}` }),
    // 패널 '나의 표현'(28-12): background {type:'words', op:'get'} 으로 받아 둔 저장 낱말·구·문장.
    library: () => ({ saved: S.saved, phrases: S.phrases, version: S.savedVer }),
    explainAt: (i, force) => explainAt(i, force),
    askAt: (i, question) => askAt(i, question),
  };
})();
