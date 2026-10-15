// extension/study-time.js
// 섹션별 공부 시간 측정 content script (T40a, 변경 기록 19, 과제 FX-H).
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

  // 날짜·주소 상태 및 기준값/로컬 카운터 (FX-H 3번)
  let currentDate = getSeoulDate();
  let currentUrl = typeof location !== 'undefined' ? location.href : '';
  let basePageSeconds = 0; // 다리에서 가져온 오늘 기준값
  let localPageSeconds = 0; // 이 탭에서 센 값(보낸 것·안 보낸 것 포함)
  const baseSectionSecondsMap = new Map(); // 사슬키 -> 다리 기준값
  const localSectionSecondsMap = new Map(); // 사슬키 -> 이 탭에서 센 값
  let countingState = false;

  // 소제목 캐싱 및 MutationObserver (FX-H 8번)
  let cachedHeadings = [];
  let headingsObserver = null;

  // 외부(메모장·패널 등)에서 읽을 수 있는 전역 API 등록
  globalThis.readglossStudyTime = {
    pageSecondsToday: () => {
      return core?.todayTotal ? core.todayTotal(basePageSeconds, localPageSeconds) : (basePageSeconds + localPageSeconds);
    },
    // 소제목 사슬 배열(chain) 또는 문자열을 받아 누적 초 반환 (FX-H 4번)
    sectionSeconds: (chain) => {
      let chainKey = '';
      if (Array.isArray(chain)) {
        chainKey = chain.join('\u0000');
      } else if (typeof chain === 'string') {
        chainKey = chain.trim().replace(/\s+/g, ' ').toLowerCase();
      }
      const bSec = baseSectionSecondsMap.get(chainKey) || 0;
      const lSec = localSectionSecondsMap.get(chainKey) || 0;
      return core?.todayTotal ? core.todayTotal(bSec, lSec) : (bSec + lSec);
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

  // 주소 정규화 도우미
  function getNormUrl(u) {
    if (memoCore?.normalizeUrl) return memoCore.normalizeUrl(u);
    try {
      const parsed = new URL(u);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return (u || '').split('#')[0];
    }
  }

  // 다리에서 오늘 기준값 가져오기 (FX-H 3번)
  function fetchBaseSeconds(date, rawUrl) {
    if (!chrome?.runtime?.id) return;
    const targetNorm = getNormUrl(rawUrl);
    try {
      chrome.runtime.sendMessage({ type: 'study-time', op: 'get', from: date, to: date }, (res) => {
        if (chrome.runtime.lastError || !res || !Array.isArray(res.items)) return;
        let pSec = 0;
        const sMap = new Map();
        for (const item of res.items) {
          const itemNorm = getNormUrl(item.url);
          if (itemNorm === targetNorm) {
            pSec += (Number(item.seconds) || 0);
            const chain = Array.isArray(item.headings) ? item.headings : [];
            const chainKey = chain.join('\u0000');
            sMap.set(chainKey, (sMap.get(chainKey) || 0) + (Number(item.seconds) || 0));
          }
        }
        basePageSeconds = pSec;
        baseSectionSecondsMap.clear();
        for (const [k, v] of sMap.entries()) {
          baseSectionSecondsMap.set(k, v);
        }
      });
    } catch {}
  }

  // 동영상 재생 여부 판정 (FX-H 2번: 순수 함수 core.isVideoCounting 재사용)
  function isVideoPlaying() {
    try {
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (core?.isVideoCounting ? core.isVideoCounting(v) : (!v.paused && !v.ended && !v.muted && v.volume > 0)) {
          return true;
        }
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

  function refreshHeadings() {
    cachedHeadings = collectHeadings();
  }

  function setupHeadingsObserver() {
    if (headingsObserver || typeof MutationObserver === 'undefined') return;
    headingsObserver = new MutationObserver(() => {
      refreshHeadings();
    });
    if (typeof document !== 'undefined' && (document.body || document.documentElement)) {
      headingsObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
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

  // 지금 보는 소제목 사슬 (FX-H 8번: 캐시된 소제목의 위치만 매초 다시 계산)
  function getCurrentHeadingChain() {
    if (!cachedHeadings.length) {
      refreshHeadings();
    }
    const validHeadings = cachedHeadings.filter((h) => h.el && h.el.isConnected);
    if (!validHeadings.length) return [];

    const headingTops = validHeadings.map((h) => ({
      key: h.key,
      top: h.el.getBoundingClientRect().top,
    }));
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const activeKey = memoCore?.activeSectionKey
      ? memoCore.activeSectionKey(headingTops, vh)
      : (validHeadings[0]?.key || '_page');

    if (activeKey === '_page') return [];
    return getHeadingChain(validHeadings, activeKey);
  }

  // 전송 실패 시 items를 buckets에 되돌린다
  function restoreItems(items) {
    if (!core || !Array.isArray(items)) return;
    for (const item of items) {
      const key = core.bucketKey(item.date, item.url, item.headings);
      core.addSecond(buckets, key, item, item.seconds);
    }
  }

  // 30초마다 및 떠날 때 모은 초를 다리에 보낸다 (FX-H 1번: 100KB 분할, 400·413 버림, 5xx 되돌림)
  function flush() {
    if (!active || !core || buckets.size === 0) return;
    const rawItems = core.drainBuckets(buckets, 50, 120);
    if (!rawItems || rawItems.length === 0) return;

    // 주소 >2000자(버림), 제목 >300자·소제목 >200자(자름) 정리
    const cleaned = core.cleanItems ? core.cleanItems(rawItems) : rawItems;
    if (cleaned.length === 0) return;

    // JSON 길이 100KB 이하로 묶음 나누기
    const batches = core.splitBatches ? core.splitBatches(cleaned, 100 * 1024) : [cleaned];

    if (!chrome?.runtime?.id) {
      stop();
      return;
    }

    for (const batch of batches) {
      try {
        chrome.runtime.sendMessage({ type: 'study-time', op: 'add', items: batch }, (res) => {
          const err = chrome.runtime.lastError;
          const needRestore = core.shouldRestore
            ? core.shouldRestore(res, err)
            : Boolean(err || res?.error);
          if (needRestore) {
            restoreItems(batch);
          }
        });
      } catch {
        restoreItems(batch);
        stop();
      }
    }
  }

  // 1초 타이머: isCounting이면 지금 소제목 사슬에 1초 더함
  function tick() {
    if (!active || !core) return;

    // 서울 날짜 변경 감지 (FX-H 3번)
    const nowSeoul = getSeoulDate();
    if (nowSeoul !== currentDate) {
      currentDate = nowSeoul;
      localPageSeconds = 0;
      localSectionSecondsMap.clear();
      basePageSeconds = 0;
      baseSectionSecondsMap.clear();
      fetchBaseSeconds(currentDate, currentUrl);
    }

    // SPA 주소 변경 감지 (FX-H 3번: location.href 1초마다 비교)
    const nowHref = typeof location !== 'undefined' ? location.href : '';
    if (nowHref !== currentUrl) {
      currentUrl = nowHref;
      localPageSeconds = 0;
      localSectionSecondsMap.clear();
      basePageSeconds = 0;
      baseSectionSecondsMap.clear();
      fetchBaseSeconds(currentDate, currentUrl);
    }

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

    const date = currentDate;
    const url = currentUrl;
    const rawTitle = typeof document !== 'undefined' ? (document.title || '') : '';
    const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 300);
    const chain = getCurrentHeadingChain();
    const key = core.bucketKey(date, url, chain);

    core.addSecond(buckets, key, { date, url, title, headings: chain }, 1);
    localPageSeconds++;

    const chainKey = chain.join('\u0000');
    localSectionSecondsMap.set(chainKey, (localSectionSecondsMap.get(chainKey) || 0) + 1);
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
    if (headingsObserver) {
      headingsObserver.disconnect();
      headingsObserver = null;
    }
  }

  function start() {
    if (active) return;
    active = true;
    lastActivity = Date.now();
    currentDate = getSeoulDate();
    currentUrl = typeof location !== 'undefined' ? location.href : '';

    refreshHeadings();
    setupHeadingsObserver();
    fetchBaseSeconds(currentDate, currentUrl);

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

  // 초기 시작 및 사이트 설정 변경 리스너 (FX-H 5번)
  async function init() {
    try {
      if (settingsCore?.load) {
        const settings = await settingsCore.load();
        const hostname = typeof location !== 'undefined' ? location.hostname : '';
        if (settingsCore.siteBlocked && settingsCore.siteBlocked(settings, hostname)) {
          // 차단된 사이트면 시작하지 않음
        } else {
          start();
        }
      } else {
        start();
      }
    } catch {
      start();
    }

    // settings onChange 감지: 끈 사이트가 되면 세기 멈추고 쌓인 것 flush, 켜지면 시작 (FX-H 5번)
    if (settingsCore?.onChange) {
      settingsCore.onChange((newSettings) => {
        const hostname = typeof location !== 'undefined' ? location.hostname : '';
        const blocked = settingsCore.siteBlocked ? settingsCore.siteBlocked(newSettings, hostname) : false;
        if (blocked) {
          if (active) {
            flush();
            stop();
          }
        } else {
          if (!active) {
            start();
          }
        }
      });
    }
  }

  init();
})();
