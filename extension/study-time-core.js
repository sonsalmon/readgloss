// extension/study-time-core.js
// 섹션별 공부 시간 측정 순수 로직 (T40a, 변경 기록 19).
// 브라우저 확장(content script)과 Node.js(테스트) 양쪽에서 쓸 수 있게 전역 및 모듈로 노출한다.
(() => {
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

  // buckets(Map) 안 key의 seconds에 초를 더한다. 기본 1초.
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
    }
    entry.seconds += s;
  }

  // 다리에 보낼 items 배열을 뽑고 buckets에서 꺼낸 만큼 차감/제거한다.
  // - 항목당 120초(maxSeconds)를 넘으면 120초씩 나눠 여러 항목으로 만든다.
  // - 한 번에 최대 maxItems(기본 50개)까지만 꺼낸다.
  // - 다 꺼낸 버킷은 buckets에서 삭제되고, 50개 상한에 걸려 남은 초는 버킷에 보존된다.
  // - 상한에 걸리지 않는 일반적인 상황에서는 buckets가 완전히 빈다.
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

  const core = {
    bucketKey,
    isCounting,
    addSecond,
    drainBuckets,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.readglossStudyTimeCore = core;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }
})();
