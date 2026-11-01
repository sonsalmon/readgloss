// 넷플릭스 플레이어 연결(변경 기록 28-22). MAIN world·document_start 에서 돈다 — 확장 API 없음.
// ① 페이지의 JSON.parse 응답에서 IMSC 자막 주소·언어를 모아 content script(video-subs.js)에 넘긴다.
// ② 넷플릭스는 video.currentTime 을 직접 쓰면 멈추므로 이동·재생·멈춤·시각 읽기를 플레이어 API 로 대신한다.
// 페이지의 JSON.parse 결과와 예외는 바꾸지 않는다.
(() => {
  const FLAG = '__readglossNfHook';
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  const SOURCE = 'readgloss-nf';
  const MAX_KEEP = 20;
  const kept = [];
  const seen = new Set();

  function post(msg) {
    try {
      window.postMessage(msg, location.origin);
    } catch {
      // 못 보내면 그만
    }
  }

  // 옛 응답은 timedtexttracks[].ttDownloadables, 2026-11 응답은 textTracks[].downloadables 에 주소가 있다.
  // movieId: 이 자막이 어느 화의 것인지. 여러 화를 넘기면 모아 둔 자막을 replay 로 다시 보내므로 화를 같이 싣는다.
  function trackOf(track, movieId) {
    const dl = track?.ttDownloadables ?? track?.downloadables;
    const url = dl?.['imsc1.1']?.urls?.[0]?.url;
    const lang = String(track?.bcp47 || track?.language || '').trim();
    if (typeof url !== 'string' || !url || !lang) return null;
    return movieId ? { url, lang, movieId } : { url, lang };
  }

  // 응답의 (result.)timedtexttracks 또는 (result.)textTracks 에서 imsc1.1 주소와 언어만 골라 모은다.
  function listOf(o) {
    if (Array.isArray(o?.timedtexttracks)) return o.timedtexttracks;
    if (Array.isArray(o?.textTracks) && Array.isArray(o?.audioTracks)) return o.textTracks; // 재생 응답만(다른 textTracks 와 헷갈리지 않게)
    return null;
  }
  function collect(result) {
    const holder = listOf(result) ? result : listOf(result?.result) ? result.result : null;
    const list = holder ? listOf(holder) : null;
    if (!list) return;
    const mid = Number(holder.movieId);
    const movieId = Number.isSafeInteger(mid) && mid > 0 ? String(mid) : '';
    const fresh = [];
    for (const track of list) {
      const tr = trackOf(track, movieId);
      if (!tr) continue;
      const key = `${tr.lang}|${tr.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(tr);
      fresh.push(tr);
    }
    if (kept.length > MAX_KEEP) {
      const gone = kept.splice(0, kept.length - MAX_KEEP);
      for (const tr of gone) seen.delete(`${tr.lang}|${tr.url}`); // 오래된 것은 다시 만나면 새로 모은다
    }
    if (fresh.length) post({ source: SOURCE, type: 'tracks', tracks: fresh });
  }

  // 페이지가 쓰는 JSON.parse 를 감싼다. 원래 결과·예외는 그대로 돌려준다(reviver·this 도 그대로).
  const json = window.JSON ?? JSON;
  if (json && typeof json.parse === 'function') {
    const orig = json.parse;
    json.parse = function () {
      const result = orig.apply(this, arguments);
      try {
        collect(result);
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
      return result;
    };
  }

  // 플레이어 API: 세션 id 중 'watch' 가 든 것을 고른다.
  function player() {
    const app = window.netflix?.appContext?.state?.playerApp;
    const api = app?.getAPI?.()?.videoPlayer;
    if (!api) return null;
    let id = '';
    try {
      const ids = api.getAllPlayerSessionIds?.() ?? [];
      id = ids.find((x) => /watch/i.test(String(x))) ?? ids[0] ?? '';
    } catch {
      // 세션 목록을 못 읽으면 첫 세션을 쓴다
    }
    try {
      return id ? api.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }
  function withPlayer(fn) {
    try {
      const p = player();
      if (p) fn(p);
    } catch {
      // 페이지를 깨뜨리지 않는다
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== SOURCE) return;
    const d = e.data;
    if (d.type === 'replay') {
      if (kept.length) post({ source: SOURCE, type: 'tracks', tracks: kept.slice() });
      return;
    }
    if (d.type === 'seek') {
      const ms = Number(d.ms);
      if (!Number.isFinite(ms) || ms < 0) return;
      withPlayer((p) => p.seek(Math.round(ms)));
    } else if (d.type === 'play') {
      withPlayer((p) => p.play());
    } else if (d.type === 'pause') {
      withPlayer((p) => p.pause());
    } else if (d.type === 'time') {
      withPlayer((p) => {
        const ms = Number(p.getCurrentTime?.());
        if (Number.isFinite(ms)) post({ source: SOURCE, type: 'time', ms });
      });
    }
  });
})();
