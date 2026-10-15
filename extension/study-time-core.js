// extension/study-time-core.js
// 섹션별 공부 시간 측정 순수 로직 (T40a, 변경 기록 19, 과제 FX-H).
// 브라우저 확장(content script)과 Node.js(테스트) 양쪽에서 쓸 수 있게 전역 및 모듈로 노출한다.
(() => {
  const MAX_BUCKETS = 2000; // 버킷 메모리 상한

  // 소제목 사슬과 날짜·주소로 버킷 키를 만든다.
  function bucketKey(date, url, headings) {
    const d = typeof date === 'string' ? date : '';
    const u = typeof url === 'string' ? url : '';
    const chain = Array.isArray(headings) ? headings.filter((h) => typeof h === 'string') : [];
    return `${d}|${u}|${chain.join('\u0000')}`;
  }

  // 언제 시계가 가나 (변경 기록 19-1)
  // - 이 탭이 보이고(visible) 창이 앞에 있고(focused)
  // - 마지막 움직임 뒤 5분(idleMs = 300,000ms) 안일 때만 true
  // - 페이지 안 동영상이 재생 중(videoPlaying)이면 움직임이 없어도 true
  function isCounting({ visible, focused, msSinceActivity, videoPlaying, idleMs = 300000 }) {
    if (!visible || !focused) return false;
    if (videoPlaying === true) return true;
    if (typeof msSinceActivity !== 'number' || !Number.isFinite(msSinceActivity)) return false;
    return msSinceActivity >= 0 && msSinceActivity <= idleMs;
  }

  // 동영상 재생 중 판정 (FX-H 2번):
  // !paused && !ended && !muted && volume > 0 이고 화면에 보이는 크기(폭 200px 이상)일 때만 true.
  function isVideoCounting(v) {
    if (!v || typeof v !== 'object') return false;
    if (v.paused === true || v.ended === true || v.muted === true) return false;
    if (typeof v.volume !== 'number' || v.volume <= 0) return false;

    let w = 0;
    if (typeof v.width === 'number' && Number.isFinite(v.width)) {
      w = v.width;
    } else if (typeof v.offsetWidth === 'number' && Number.isFinite(v.offsetWidth)) {
      w = v.offsetWidth;
    } else if (typeof v.clientWidth === 'number' && Number.isFinite(v.clientWidth)) {
      w = v.clientWidth;
    } else if (typeof v.getBoundingClientRect === 'function') {
      try {
        const r = v.getBoundingClientRect();
        if (typeof r?.width === 'number') w = r.width;
      } catch {}
    }
    return w >= 200;
  }

  // buckets(Map) 안 key의 seconds에 초를 더한다. 기본 1초.
  // 버킷에 쌓인 항목이 2000개를 넘으면 가장 오래된 것부터 버린다(FX-H 1번).
  function addSecond(buckets, key, info, seconds = 1) {
    if (!buckets || typeof buckets.get !== 'function') return;
    if (typeof key !== 'string' || !key) return;
    const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 1;

    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        date: typeof info?.date === 'string' ? info.date : '',
        url: typeof info?.url === 'string' ? info.url : '',
        title: typeof info?.title === 'string' ? info.title : '',
        headings: Array.isArray(info?.headings) ? [...info.headings] : [],
        seconds: 0,
      };
      buckets.set(key, entry);

      // 버킷 상한(2000개): 초과 시 가장 오래된 것부터 버림
      while (buckets.size > MAX_BUCKETS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey === undefined) break;
        buckets.delete(oldestKey);
      }
    }
    entry.seconds += s;
  }

  // 다리에 보낼 items 배열을 뽑고 buckets에서 꺼낸 만큼 차감/제거한다.
  function drainBuckets(buckets, maxItems = 50, maxSeconds = 120) {
    if (!buckets || typeof buckets.entries !== 'function') return [];
    const items = [];
    const limitItems = typeof maxItems === 'number' && maxItems > 0 ? maxItems : 50;
    const limitSec = typeof maxSeconds === 'number' && maxSeconds > 0 ? maxSeconds : 120;

    for (const [key, entry] of buckets.entries()) {
      while (entry.seconds > 0 && items.length < limitItems) {
        const take = Math.min(entry.seconds, limitSec);
        items.push({
          date: entry.date,
          url: entry.url,
          title: entry.title,
          headings: [...entry.headings],
          seconds: take,
        });
        entry.seconds -= take;
      }
      if (entry.seconds <= 0) {
        buckets.delete(key);
      }
      if (items.length >= limitItems) break;
    }

    return items;
  }

  // 보내기 전에 주소 >2000자(버림)·제목 >300자·소제목 >200자(자름) 정리 (FX-H 1번)
  function cleanItem(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.url !== 'string' || item.url.length > 2000) return null;
    const date = typeof item.date === 'string' ? item.date : '';
    const rawTitle = typeof item.title === 'string' ? item.title : '';
    const title = rawTitle.slice(0, 300);
    const rawHeadings = Array.isArray(item.headings) ? item.headings : [];
    const headings = rawHeadings.slice(0, 3).map((h) => (typeof h === 'string' ? h.slice(0, 200) : ''));
    const seconds = typeof item.seconds === 'number' && Number.isFinite(item.seconds) && item.seconds > 0
      ? Math.round(item.seconds)
      : 0;
    if (seconds <= 0) return null;
    return {
      date,
      url: item.url,
      title,
      headings,
      seconds,
    };
  }

  function cleanItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(cleanItem).filter(Boolean);
  }

  // 한 번에 보내는 묶음 크기를 JSON 길이 100KB 이하로 나눠 보낸다 (FX-H 1번)
  function splitBatches(items, maxBytes = 100 * 1024) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const batches = [];
    let currentBatch = [];

    for (const item of items) {
      const candidate = [...currentBatch, item];
      if (currentBatch.length > 0 && JSON.stringify(candidate).length > maxBytes) {
        batches.push(currentBatch);
        currentBatch = [item];
      } else {
        currentBatch.push(item);
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    return batches;
  }

  // 응답 오류에 따른 되돌림 판정 (FX-H 1번):
  // 400·413이면 되돌리지 않고 버린다. 연결 실패·5xx·401일 때만 되돌린다.
  function shouldRestore(res, err) {
    if (err) return true;
    if (!res) return true;

    const status = res.status;
    const errCode = res.error;

    if (status === 400 || status === 413) return false;
    if (errCode === 'bad-request' || errCode === 'too-large') return false;

    if (status === 401 || errCode === 'unauthorized') return true;
    if (typeof status === 'number' && status >= 500 && status < 600) return true;
    if (errCode === 'internal' || errCode === 'timeout' || errCode === 'ai-failed') return true;

    if (res.ok === true || status === 200) return false;

    return false;
  }

  // 기준값 + 탭 카운터 순수 함수 (FX-H 3번)
  function todayTotal(base, local) {
    const b = typeof base === 'number' && Number.isFinite(base) ? base : (Number(base) || 0);
    const l = typeof local === 'number' && Number.isFinite(local) ? local : (Number(local) || 0);
    return Math.max(0, b + l);
  }

  const core = {
    MAX_BUCKETS,
    bucketKey,
    isCounting,
    isVideoCounting,
    addSecond,
    drainBuckets,
    cleanItem,
    cleanItems,
    splitBatches,
    shouldRestore,
    todayTotal,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.readglossStudyTimeCore = core;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }
})();
