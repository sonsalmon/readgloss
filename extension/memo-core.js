// 메모장 순수 로직 (T29b).
// DOM을 직접 다루지 않는 순수 함수 모음이며 전역 readglossMemo에 등록한다.
(() => {
  // 주소 정규화: # 뒤 버림, utm_* 쿼리 파라미터 제외, 끝 / 제거
  function normalizeUrl(input) {
    if (typeof globalThis.readglossSelection?.normalizeUrl === 'function') {
      return globalThis.readglossSelection.normalizeUrl(input);
    }
    if (typeof input !== 'string') return '';
    const u = input.trim();
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      const withoutHash = u.split('#')[0];
      const qIndex = withoutHash.indexOf('?');
      const queryPart = qIndex === -1 ? '' : withoutHash.slice(qIndex + 1);

      const pathname = parsed.pathname.replace(/\/+$/, '');
      const base = `${parsed.protocol}//${parsed.host}${pathname}`;

      const kept = queryPart
        .split('&')
        .filter((part) => part.length > 0 && !part.startsWith('utm_'));
      const query = kept.length > 0 ? `?${kept.join('&')}` : '';
      return `${base}${query}`;
    } catch {
      return '';
    }
  }

  // 화면 위 1/3 선(top <= vh/3) 이하 중 마지막 소제목 객체 반환, 없으면 null
  function currentHeading(headings, viewportHeight) {
    if (!Array.isArray(headings) || typeof viewportHeight !== 'number' || !Number.isFinite(viewportHeight)) {
      return null;
    }
    const threshold = viewportHeight / 3;
    let last = null;
    for (const h of headings) {
      if (h && typeof h.top === 'number' && Number.isFinite(h.top) && h.top <= threshold) {
        last = h;
      }
    }
    return last;
  }

  // 글 앞 300자로 자름
  function centerParagraphText(text) {
    if (typeof text !== 'string') return '';
    return text.slice(0, 300);
  }

  // 목록용 정렬: 이 페이지 메모(정규화 주소 같음) 먼저, 그다음 나머지 최근 순
  function orderForList(memos, url) {
    if (!Array.isArray(memos)) return [];
    const targetUrl = normalizeUrl(url);

    const thisPage = [];
    const otherPage = [];

    for (const m of memos) {
      if (!m) continue;
      const mUrl = normalizeUrl(m.url);
      if (targetUrl && mUrl === targetUrl) {
        thisPage.push(m);
      } else {
        otherPage.push(m);
      }
    }

    const byTsDesc = (a, b) => {
      const ta = typeof a?.ts === 'number' ? a.ts : 0;
      const tb = typeof b?.ts === 'number' ? b.ts : 0;
      if (ta !== tb) return tb - ta;
      return String(b?.id ?? '').localeCompare(String(a?.id ?? ''));
    };

    thisPage.sort(byTsDesc);
    otherPage.sort(byTsDesc);

    return [...thisPage, ...otherPage];
  }

  // 메모장 textarea 안 키 이벤트 판정: Enter=save, Shift+Enter=newline, Esc=fold, 그 밖=null
  function padKey(e) {
    if (!e || typeof e !== 'object' || e.isComposing) return null;
    if (e.key === 'Enter') {
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return 'newline';
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return 'save';
      return null;
    }
    if (e.key === 'Escape') return 'fold';
    return null;
  }

  // 날짜 MM-DD 포맷팅 (현지 시간)
  function formatDateMD(ts) {
    const d = new Date(Number(ts));
    if (!Number.isFinite(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 글 앞 N자 미리보기 (공백 정리)
  function previewText(text, limit = 80) {
    if (typeof text !== 'string') return '';
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.slice(0, limit);
  }

  globalThis.readglossMemo = {
    normalizeUrl,
    currentHeading,
    centerParagraphText,
    orderForList,
    padKey,
    formatDateMD,
    previewText,
  };
})();
