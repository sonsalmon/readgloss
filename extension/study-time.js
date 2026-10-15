// extension/study-time.js
// 섹션별 공부 시간 측정 content script (T40a, 변경 기록 19).
(() => {
  const core = globalThis.readglossStudyTimeCore;
  const settingsCore = globalThis.readglossSettings;
  const memoCore = globalThis.readglossMemo;

  let active = false;
  let tickTimer = null;
  let flushTimer = null;
  let lastActivity = Date.now();
  let lastMouseMoveTime = 0;
  const buckets = new Map();

  let todayPageSeconds = 0; // 이 탭에서 센 누적 초(보낸 것 포함)
  const sectionSecondsMap = new Map(); // 소제목(정규화 텍스트) -> 누적 초
  let countingState = false;

  // 정규화 텍스트
  function normHeading(s) {
    return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  }

  // 외부(메모장·패널 등)에서 읽을 수 있는 전역 API 등록
  globalThis.readglossStudyTime = {
    pageSecondsToday: () => todayPageSeconds,
    sectionSeconds: (headingText) => {
      const k = normHeading(headingText);
      return k ? (sectionSecondsMap.get(k) || 0) : 0;
    },
    isCounting: () => countingState,
  };

  // 서울 날짜 (YYYY-MM-DD)
  function getSeoulDate() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  // 동영상 재생 여부: document.querySelectorAll('video') 중 !paused && !ended 가 하나라도 있으면 true
  function isVideoPlaying() {
    try {
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (!v.paused && !v.ended) return true;
      }
    } catch {}
    return false;
  }

  // 페이지 소제목 모으기: 본문의 h1~h3 (우리 노드 및 숨은 요소 제외)
  function collectHeadings() {
    const headings = [];
    const elements = document.querySelectorAll('h1, h2, h3');
    let seq = 0;
    for (const el of elements) {
      if (el.closest('[data-readgloss], readgloss-memo-pad, readgloss-ui, readgloss-card, readgloss-toast')) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const level = parseInt(el.tagName.slice(1), 10) || 1;
      const key = `h${seq}:${text.slice(0, 40)}`;
      headings.push({ key, text, level, el });
      seq++;
    }
    return headings;
  }

  // 소제목 사슬(앞선 상위 소제목들 + 지금 소제목, ≤3개, 각 ≤200자)
  function getHeadingChain(headings, targetKey) {
    if (!Array.isArray(headings) || headings.length === 0) return [];
    const idx = headings.findIndex((h) => h.key === targetKey);
    if (idx === -1) return [];
    const current = headings[idx];
    const chain = [current.text];
    let currentLevel = current.level;
    for (let i = idx - 1; i >= 0; i--) {
      if (headings[i].level < currentLevel) {
        chain.unshift(headings[i].text);
        currentLevel = headings[i].level;
        if (currentLevel === 1) break;
      }
    }
    return chain.slice(-3).map((t) => t.slice(0, 200));
  }

  // 지금 보는 소제목 사슬
  function getCurrentHeadingChain() {
    const headings = collectHeadings();
    if (!headings.length) return [];
    const headingTops = headings.map((h) => ({
      key: h.key,
      top: h.el.getBoundingClientRect().top,
    }));
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const activeKey = memoCore?.activeSectionKey
      ? memoCore.activeSectionKey(headingTops, vh)
      : (headings[0]?.key || '_page');

    if (activeKey === '_page') return [];
    return getHeadingChain(headings, activeKey);
  }

  // 전송 실패 시 items를 buckets에 되돌린다
  function restoreItems(items) {
    if (!core || !Array.isArray(items)) return;
    for (const item of items) {
      const key = core.bucketKey(item.date, item.url, item.headings);
      core.addSecond(buckets, key, item, item.seconds);
    }
  }

  // 30초마다 및 떠날 때 모은 초를 다리에 보낸다
  function flush() {
    if (!active || !core || buckets.size === 0) return;
    const items = core.drainBuckets(buckets, 50, 120);
    if (!items || items.length === 0) return;

    if (!chrome?.runtime?.id) {
      stop();
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'study-time', op: 'add', items }, (res) => {
        if (chrome.runtime.lastError || res?.error) {
          restoreItems(items);
        }
      });
    } catch {
      restoreItems(items);
      stop();
    }
  }

  // 1초 타이머: isCounting이면 지금 소제목 사슬에 1초 더함
  function tick() {
    if (!active || !core) return;
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus();
    const msSinceActivity = Date.now() - lastActivity;
    const videoPlaying = isVideoPlaying();

    const counting = core.isCounting({
      visible,
      focused,
      msSinceActivity,
      videoPlaying,
      idleMs: 300000,
    });
    countingState = counting;

    if (!counting) return;

    const date = getSeoulDate();
    const url = typeof location !== 'undefined' ? location.href : '';
    const rawTitle = typeof document !== 'undefined' ? (document.title || '') : '';
    const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 300);
    const chain = getCurrentHeadingChain();
    const key = core.bucketKey(date, url, chain);

    core.addSecond(buckets, key, { date, url, title, headings: chain }, 1);
    todayPageSeconds++;
    if (chain.length > 0) {
      const last = normHeading(chain[chain.length - 1]);
      if (last) {
        sectionSecondsMap.set(last, (sectionSecondsMap.get(last) || 0) + 1);
      }
    }
  }

  // 사용자 활동 감지 리스너
  function onActivity() {
    lastActivity = Date.now();
  }

  function onMouseMove() {
    const now = Date.now();
    if (now - lastMouseMoveTime >= 1000) {
      lastMouseMoveTime = now;
      lastActivity = now;
    }
  }

  function stop() {
    active = false;
    countingState = false;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  function start() {
    active = true;
    lastActivity = Date.now();

    document.addEventListener('scroll', onActivity, { capture: true, passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });
    window.addEventListener('pagehide', () => {
      flush();
    });

    tickTimer = setInterval(tick, 1000);
    flushTimer = setInterval(flush, 30000);
  }

  // 초기 시작: 사이트 차단 여부 확인
  async function init() {
    try {
      if (settingsCore?.load) {
        const settings = await settingsCore.load();
        const hostname = typeof location !== 'undefined' ? location.hostname : '';
        if (settingsCore.siteBlocked && settingsCore.siteBlocked(settings, hostname)) {
          return; // 차단 사이트면 아무것도 하지 않는다
        }
      }
    } catch {}

    start();
  }

  init();
})();
