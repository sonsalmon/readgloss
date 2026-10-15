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

  // 화면 가운데 y에 가장 가까운 블록 인덱스(0부터) 반환.
  // 가운데를 덮는 블록이 있으면 그것, 없으면 위·아래 거리 최소, 블록이 없으면 -1.
  function pickCenterBlock(blocks, viewportHeight) {
    if (!Array.isArray(blocks) || blocks.length === 0 || typeof viewportHeight !== 'number' || !Number.isFinite(viewportHeight)) {
      return -1;
    }
    const centerY = viewportHeight / 2;
    let bestIndex = -1;
    let minDistance = Infinity;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b || typeof b.top !== 'number' || typeof b.bottom !== 'number' || !Number.isFinite(b.top) || !Number.isFinite(b.bottom)) {
        continue;
      }
      let dist = 0;
      if (b.top <= centerY && b.bottom >= centerY) {
        dist = 0;
      } else if (b.bottom < centerY) {
        dist = centerY - b.bottom;
      } else {
        dist = b.top - centerY;
      }

      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = i;
        if (dist === 0) {
          // 가운데를 덮는 첫 번째 블록 발견
          break;
        }
      }
    }

    return bestIndex;
  }

  // 소제목 목록과 메모 목록을 소제목별 칸으로 묶음. 칸 안 메모는 ts 오름차순.
  function buildSections(headings, memos, pageTitle) {
    const memoList = Array.isArray(memos) ? memos.filter(Boolean) : [];
    const sortedAll = [...memoList].sort((a, b) => (a?.ts ?? 0) - (b?.ts ?? 0));

    if (!Array.isArray(headings) || headings.length === 0) {
      return [
        {
          key: '_page',
          text: pageTitle ?? '',
          level: 1,
          memos: sortedAll,
        },
      ];
    }

    // 대소문자 및 공백 정리 비교용 정규화 함수
    const norm = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '');

    const sections = headings.map((h) => ({
      key: h.key,
      text: h.text,
      level: h.level,
      memos: [],
    }));

    for (const m of sortedAll) {
      let targetIndex = 0; // 일치하는 소제목을 못 찾으면 첫 칸
      if (Array.isArray(m?.headings) && m.headings.length > 0) {
        const lastHeadingText = norm(m.headings[m.headings.length - 1]);
        if (lastHeadingText) {
          const found = sections.findIndex((s) => norm(s.text) === lastHeadingText);
          if (found !== -1) {
            targetIndex = found;
          }
        }
      }
      sections[targetIndex].memos.push(m);
    }

    return sections;
  }

  // top <= viewportHeight / 3 인 것 중 마지막 key, 없으면 첫 key, 빈 배열이면 '_page'
  function activeSectionKey(headingTops, viewportHeight) {
    if (!Array.isArray(headingTops) || headingTops.length === 0) {
      return '_page';
    }
    const vh = typeof viewportHeight === 'number' && Number.isFinite(viewportHeight) ? viewportHeight : 0;
    const threshold = vh / 3;

    let lastKey = null;
    for (const h of headingTops) {
      if (h && typeof h.top === 'number' && Number.isFinite(h.top) && h.top <= threshold) {
        lastKey = h.key;
      }
    }

    if (lastKey !== null) {
      return lastKey;
    }
    return headingTops[0]?.key ?? '_page';
  }

  // now - lastTypedAt >= 1500 판정
  function shouldMoveCaret(lastTypedAt, now) {
    if (typeof lastTypedAt !== 'number' || !Number.isFinite(lastTypedAt) || lastTypedAt <= 0) return true; // 0 = 아직 안 침
    if (typeof now !== 'number' || !Number.isFinite(now)) return true;
    return now - lastTypedAt >= 1500;
  }

  // v2 키 판정: Enter(⌘·ctrl 없음) = 'newline', ⌘Enter 또는 ctrl+Enter(조합 중 아님) = 'save', Escape = 'fold', 그 밖 null
  function padKeyV2(e) {
    if (!e || typeof e !== 'object' || e.isComposing) return null;
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) return 'save';
      return 'newline';
    }
    if (e.key === 'Escape') return 'fold';
    return null;
  }

  // 페이지의 입력칸(input·textarea·select·편집 영역)인지. 메모장이 커서를 빼앗지 않을지 가릴 때 쓴다.
  function isPageField(el) {
    if (!el || typeof el !== 'object') return false;
    if (el.isContentEditable === true) return true;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  }

  // width 260~640, height 200~vh-40로 자르고, 창 전체가 화면 안에 들어오게 left·top을 당긴다(0 이상, 오른쪽·아래는 화면 - 창 크기까지).
  // 창이 화면보다 크면 상한이 먼저 줄어든다(화면 밖으로 나가지 않게).
  function clampRect(rect, viewport) {
    const vw = viewport && typeof viewport.vw === 'number' && Number.isFinite(viewport.vw) ? viewport.vw : 0;
    const vh = viewport && typeof viewport.vh === 'number' && Number.isFinite(viewport.vh) ? viewport.vh : 0;

    const rawW = rect && typeof rect.width === 'number' && Number.isFinite(rect.width) ? rect.width : 260;
    const rawH = rect && typeof rect.height === 'number' && Number.isFinite(rect.height) ? rect.height : 200;
    const rawL = rect && typeof rect.left === 'number' && Number.isFinite(rect.left) ? rect.left : 0;
    const rawT = rect && typeof rect.top === 'number' && Number.isFinite(rect.top) ? rect.top : 0;

    const width = Math.min(Math.max(260, Math.min(640, rawW)), vw > 0 ? vw : Infinity);
    const height = Math.min(Math.max(200, Math.min(vh - 40, rawH)), vh > 0 ? vh : Infinity);

    const maxLeft = Math.max(0, vw - width);
    const maxTop = Math.max(0, vh - height);

    const left = Math.max(0, Math.min(rawL, maxLeft));
    const top = Math.max(0, Math.min(rawT, maxTop));

    return { left, top, width, height };
  }

  // 메모장 사각영역을 화면 모서리 기준 좌표({ ax, x, ay, y, width, height })로 변환.
  // 놓을 때 메모장 가운데가 화면 왼쪽 절반이면 ax='left', 오른쪽이면 'right'; 세로도 동일.
  function toAnchored(rect, viewport) {
    const vw = viewport && typeof viewport.vw === 'number' && Number.isFinite(viewport.vw) ? viewport.vw : 0;
    const vh = viewport && typeof viewport.vh === 'number' && Number.isFinite(viewport.vh) ? viewport.vh : 0;

    const rawW = rect && typeof rect.width === 'number' && Number.isFinite(rect.width) ? rect.width : 260;
    const rawH = rect && typeof rect.height === 'number' && Number.isFinite(rect.height) ? rect.height : 200;
    const rawL = rect && typeof rect.left === 'number' && Number.isFinite(rect.left) ? rect.left : 0;
    const rawT = rect && typeof rect.top === 'number' && Number.isFinite(rect.top) ? rect.top : 0;

    const centerX = rawL + rawW / 2;
    const centerY = rawT + rawH / 2;

    const ax = centerX < vw / 2 ? 'left' : 'right';
    const ay = centerY < vh / 2 ? 'top' : 'bottom';

    const x = ax === 'right' ? vw - (rawL + rawW) : rawL;
    const y = ay === 'bottom' ? vh - (rawT + rawH) : rawT;

    return {
      ax,
      x: Math.round(x),
      ay,
      y: Math.round(y),
      width: Math.round(rawW),
      height: Math.round(rawH),
    };
  }

  // 저장된 모서리 기준 좌표({ ax, x, ay, y, width, height })를 화면 안 보이는 위치({ left, top, width, height })로 변환.
  // 화면 안으로 당김(clampRect 재사용). 옛 저장 모양({ left, top, width, height })이 오면 toAnchored로 바꿔 읽는다.
  function fromAnchored(saved, viewport) {
    if (!saved || typeof saved !== 'object') {
      return clampRect({ left: 0, top: 0, width: 260, height: 200 }, viewport);
    }

    let anchored = saved;
    // 옛 저장 모양({ left, top, width, height })이 오면 toAnchored로 바꿔 읽는다.
    if (!anchored.ax || !anchored.ay) {
      anchored = toAnchored(anchored, viewport);
    }

    const vw = viewport && typeof viewport.vw === 'number' && Number.isFinite(viewport.vw) ? viewport.vw : 0;
    const vh = viewport && typeof viewport.vh === 'number' && Number.isFinite(viewport.vh) ? viewport.vh : 0;

    const rawW = typeof anchored.width === 'number' && Number.isFinite(anchored.width) ? anchored.width : 260;
    const rawH = typeof anchored.height === 'number' && Number.isFinite(anchored.height) ? anchored.height : 200;
    const rawX = typeof anchored.x === 'number' && Number.isFinite(anchored.x) ? anchored.x : 0;
    const rawY = typeof anchored.y === 'number' && Number.isFinite(anchored.y) ? anchored.y : 0;

    const rawLeft = anchored.ax === 'right' ? vw - rawW - rawX : rawX;
    const rawTop = anchored.ay === 'bottom' ? vh - rawH - rawY : rawY;

    return clampRect({ left: rawLeft, top: rawTop, width: rawW, height: rawH }, viewport);
  }

  // 글이 공백뿐이고 quote 없으면 false
  function canSave(text, quote) {
    const hasText = typeof text === 'string' && text.trim().length > 0;
    let hasQuote = false;
    if (typeof quote === 'string') {
      hasQuote = quote.trim().length > 0;
    } else if (quote && typeof quote === 'object') {
      hasQuote = typeof quote.exact === 'string' && quote.exact.trim().length > 0;
    }
    return hasText || hasQuote;
  }

  // 메모장 붙이기 폭 계산(260~0.5vw로 자름, 기본 360)
  function dockWidth(saved, vw) {
    const rawW = typeof saved === 'number' && Number.isFinite(saved) ? saved : 360;
    const viewportW = typeof vw === 'number' && Number.isFinite(vw) ? vw : 0;
    const maxW = viewportW > 0 ? viewportW * 0.5 : Infinity;
    if (maxW >= 260) {
      return Math.round(Math.min(Math.max(260, rawW), maxW));
    }
    return 260;
  }

  // 쓰는 칸 기본 포커스 복귀 판정 (순수 함수)
  function shouldReturnFocus(params) {
    if (!params || typeof params !== 'object') return false;
    const { selectionCollapsed, cardOpen, activeKind, padHasFocus, padOpen } = params;
    if (!padOpen) return false;
    if (!selectionCollapsed) return false;
    if (cardOpen) return false;
    if (padHasFocus) return false;
    if (activeKind && activeKind !== 'none' && activeKind !== 'other' && activeKind !== 'body') {
      return false;
    }
    return true;
  }

  globalThis.readglossMemo = {
    normalizeUrl,
    currentHeading,
    centerParagraphText,
    orderForList,
    padKey,
    formatDateMD,
    previewText,
    pickCenterBlock,
    buildSections,
    activeSectionKey,
    shouldMoveCaret,
    padKeyV2,
    clampRect,
    toAnchored,
    fromAnchored,
    isPageField,
    canSave,
    dockWidth,
    shouldReturnFocus,
  };
})();

