// 유튜브 플레이어가 받아 오는 자막(/api/timedtext)을 엿듣는다(변경 기록 27-1). MAIN world(페이지 쪽)·document_start 에서 돈다 — 확장 API 없음.
// 플레이어의 XHR·fetch 응답을 바꾸지 않고 글만 읽어 window.postMessage 로 content script(video-subs.js)에 넘긴다.
// 늦게 뜬 content script 를 위해 최근 것을 몇 개 들고 있다가 {source, type:'replay'} 를 받으면 다시 보낸다.
(() => {
  const FLAG = '__readglossYtHook';
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  const SOURCE = 'readgloss-yt';
  const MAX_KEEP = 8;
  const MAX_BODY = 4_000_000; // 자막 하나가 이보다 크면 버린다
  const URL_KEY = Symbol('readglossUrl');
  const kept = [];

  function isTimedtext(u) {
    try {
      const x = new URL(String(u), location.href);
      return /(^|\.)youtube\.com$/.test(x.hostname) && x.pathname === '/api/timedtext';
    } catch {
      return false;
    }
  }

  function post(url, body) {
    if (typeof body !== 'string' || !body || body.length > MAX_BODY) return;
    const msg = { source: SOURCE, type: 'timedtext', url: String(url).slice(0, 4000), body };
    kept.push(msg);
    if (kept.length > MAX_KEEP) kept.shift();
    window.postMessage(msg, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== SOURCE || e.data.type !== 'replay') return;
    for (const m of kept) window.postMessage(m, location.origin);
  });

  // XHR 응답 글: responseType 에 따라 꺼낸다(blob 은 비동기라 따로)
  function readXhr(xhr, url) {
    const t = xhr.responseType;
    if (t === '' || t === 'text') return post(url, xhr.responseText);
    if (t === 'json') return post(url, JSON.stringify(xhr.response));
    if (t === 'arraybuffer' && xhr.response) return post(url, new TextDecoder().decode(xhr.response));
    if (t === 'blob' && typeof xhr.response?.text === 'function') xhr.response.text().then((s) => post(url, s), () => {});
  }

  const proto = window.XMLHttpRequest?.prototype;
  if (proto) {
    const open = proto.open;
    const send = proto.send;
    proto.open = function (method, url) {
      try {
        this[URL_KEY] = url;
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
      return open.apply(this, arguments);
    };
    proto.send = function () {
      try {
        if (isTimedtext(this[URL_KEY])) {
          this.addEventListener('load', () => {
            try {
              if (this.status >= 200 && this.status < 300) readXhr(this, this.responseURL || this[URL_KEY]);
            } catch {
              // 못 읽으면 그만
            }
          });
        }
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
      return send.apply(this, arguments);
    };
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        // 페이지보다 먼저 then 을 걸어 본문을 읽기 전에 복제한다
        if (isTimedtext(url)) p.then((res) => (res.ok ? res.clone().text() : null)).then((s) => s && post(url, s), () => {});
      } catch {
        // 페이지를 깨뜨리지 않는다
      }
      return p;
    };
  }
})();
