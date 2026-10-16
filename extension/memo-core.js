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

  // 글을 고른 채 단축키 판정 순수 함수 (T48): 'tab-quote' | 'concept' | 'code' | null
  // Tab = 인용 메모장, d·D·ㅇ·KeyD = 내 개념 칸, c·C·ㅊ·KeyC = 코드 인용(다음 작업용).
  // 고른 글 없음, 페이지 입력칸, 우리 화면 안, 조합키(shift/alt/ctrl/meta), 한글 조합 중이면 null.
  function shortcutAction(e, ctx) {
    if (!e || typeof e !== 'object') return null;
    const c = (ctx && typeof ctx === 'object') ? ctx : {};

    const shift = Boolean(e.shiftKey ?? e.shift ?? c.shiftKey ?? c.shift);
    const alt = Boolean(e.altKey ?? e.alt ?? c.altKey ?? c.alt);
    const ctrl = Boolean(e.ctrlKey ?? e.ctrl ?? c.ctrlKey ?? c.ctrl);
    const meta = Boolean(e.metaKey ?? e.meta ?? c.metaKey ?? c.meta);
    const composing = Boolean(e.isComposing ?? e.composing ?? c.isComposing ?? c.composing);

    if (shift || alt || ctrl || meta || composing) return null;

    const hasSelection = Boolean(c.hasSelection ?? e.hasSelection);
    const pageField = Boolean(c.pageField ?? e.pageField);
    const inOurUi = Boolean(c.inOurUi ?? e.inOurUi);

    if (!hasSelection || pageField || inOurUi) return null;

    const key = e.key;
    const code = e.code;

    if (key === 'Tab') {
      return 'tab-quote';
    }
    if (key === 'd' || key === 'D' || key === 'ㅇ' || code === 'KeyD') {
      return 'concept';
    }
    if (key === 'c' || key === 'C' || key === 'ㅊ' || code === 'KeyC') {
      return 'code';
    }
    return null;
  }

  // 글을 고른 채 Tab = 고른 글을 인용으로 메모장 열기 (shortcutAction과 합침)
  function shouldTabQuote(params) {
    if (!params || typeof params !== 'object') return false;
    return shortcutAction(params, params) === 'tab-quote';
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

  // 본문 오른쪽 여백 계산 (순수 함수): open && docked 이면 폭(px), 아니면 원래 값
  function pageMarginFor(params) {
    if (!params || typeof params !== 'object') return '';
    const { open, docked, width, original } = params;
    if (Boolean(open) && Boolean(docked)) {
      if (typeof width === 'number' && Number.isFinite(width)) {
        return `${width}px`;
      }
      if (typeof width === 'string' && width.trim().length > 0) {
        return width.endsWith('px') ? width.trim() : `${width.trim()}px`;
      }
      return '360px';
    }
    return typeof original === 'string' ? original : (original != null ? String(original) : '');
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

  // 첫 정의 항목 추출 (마크다운 목록 앞머리 제외)
  function firstDefinitionItem(def) {
    if (typeof def !== 'string') return '';
    const lines = def.split('\n');
    for (const l of lines) {
      const cleaned = l.replace(/^\s*[-*]\s*/, '').trim();
      if (cleaned) return cleaned;
    }
    return '';
  }

  // 모양 줄 텍스트 생성 (3번 명세)
  // 인용: ❝ + 첫 120자. 개념: ◆ 이름 — 정의 첫 항목. 나중에: ? 이름. 단어: Aa 원형 — 뜻. 구·문장: Aa 글 — 번역.
  function formatShapeLine(item) {
    if (!item || typeof item !== 'object') return '';
    const kind = item.kind;
    if (kind === 'scrap') {
      const raw = typeof item.text === 'string' && item.text ? item.text : (item.quote?.exact || '');
      const clean = raw.replace(/\s+/g, ' ').trim();
      return `❝ ${clean.slice(0, 120)}`;
    }
    if (kind === 'concept') {
      const name = item.name || '';
      const first = firstDefinitionItem(item.definition);
      return first ? `◆ ${name} — ${first}` : `◆ ${name}`;
    }
    if (kind === 'later') {
      return `? ${item.name || ''}`;
    }
    if (kind === 'word') {
      const lemma = item.lemma || item.word || '';
      const gloss = item.gloss || '';
      return gloss ? `Aa ${lemma} — ${gloss}` : `Aa ${lemma}`;
    }
    if (kind === 'phrase') {
      const text = item.text || '';
      const tr = item.translation || '';
      return tr ? `Aa ${text} — ${tr}` : `Aa ${text}`;
    }
    if (kind === 'memo') {
      return item.text || '';
    }
    return '';
  }

  // 쓰는 칸 첫 줄이 !이름 또는 ?이름(이름 1~80자)일 때 판정 (순수 함수)
  function parseConceptCommand(text) {
    if (typeof text !== 'string') return null;
    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    if (!firstLine.startsWith('!') && !firstLine.startsWith('?')) {
      return null;
    }
    const prefix = firstLine[0];
    const name = firstLine.slice(1).trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 80) {
      return null;
    }
    const kind = prefix === '!' ? 'concept' : 'later';
    const definition = kind === 'concept' ? lines.slice(1).join('\n') : '';
    return {
      kind,
      name,
      definition,
    };
  }

  // 소제목 목록과 다양한 모양의 항목들을 소제목별 칸으로 묶음.
  // items: {kind:'memo'|'scrap'|'concept'|'later'|'word'|'phrase', headings?:string[], ts, ...}
  // 각 항목을 headings 마지막 글과 같은 글의 소제목 칸에 넣고(앞뒤 공백 무시), 없거나 못 찾으면 _page 칸.
  // 칸 안은 ts 오름차순. 메모는 지금 buildSections 규칙을 그대로 따른다(못 찾으면 첫 칸).
  function assignToSections(sections, items) {
    if (!Array.isArray(sections)) return [];
    const norm = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '');

    const outSections = sections.map((s) => ({
      ...s,
      items: Array.isArray(s.items) ? [...s.items] : [],
      memos: Array.isArray(s.memos) ? [...s.memos] : [],
    }));

    const getOrCreatePageSection = () => {
      let pageSec = outSections.find((s) => s.key === '_page');
      if (!pageSec) {
        pageSec = {
          key: '_page',
          text: '이 페이지에서',
          level: 2,
          items: [],
          memos: [],
        };
        outSections.push(pageSec);
      }
      return pageSec;
    };

    const itemList = Array.isArray(items) ? items.filter(Boolean) : [];

    for (const item of itemList) {
      let targetSection = null;
      if (Array.isArray(item.headings) && item.headings.length > 0) {
        const lastHeadingText = norm(item.headings[item.headings.length - 1]);
        if (lastHeadingText) {
          const found = outSections.find((s) => norm(s.text) === lastHeadingText);
          if (found) {
            targetSection = found;
          }
        }
      }

      if (!targetSection) {
        if (item.kind === 'memo') {
          // 메모는 buildSections 규칙 준수: 못 찾으면 첫 칸(outSections[0])
          targetSection = outSections[0] || getOrCreatePageSection();
        } else {
          // 스크랩, 개념, 나중에, 단어, 구문장은 _page 칸
          targetSection = getOrCreatePageSection();
        }
      }

      targetSection.items.push(item);
      // buildSections 가 이미 넣은 메모와 같은 id 면 두 번 세지 않는다
      if (item.kind === 'memo' && !targetSection.memos.some((m) => item.id && m.id === item.id)) {
        targetSection.memos.push(item);
      }
    }

    // 각 칸 안 항목들을 ts 오름차순 정렬
    for (const sec of outSections) {
      sec.items.sort((a, b) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0));
      sec.memos.sort((a, b) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0));
    }

    return outSections;
  }

  // 이 페이지 오늘 시간 시계 형식 포맷팅: mm:ss (한 시간 넘으면 h:mm:ss)
  function formatClock(seconds) {
    const total = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.floor(seconds)
      : 0;
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  // 초를 분 라벨 문자열로 변환 (60초 이상이면 'N분', 60초 미만은 '')
  function minutesLabel(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 60) {
      return '';
    }
    const mins = Math.floor(seconds / 60);
    return `${mins}분`;
  }

  // 목차 한 줄 라벨 텍스트 생성 (T36, T40b)
  // 소제목 글 · N분(60초 이상) · 메모 N(그 칸 메모 개수, 0이면 생략) · 쓰던 글(drafts)이 있으면 "쓰는 중"
  function tocLabel(params) {
    if (!params || typeof params !== 'object') return '';
    const title = typeof params.title === 'string' ? params.title.trim() : '';
    const minutes = typeof params.minutes === 'number' && Number.isFinite(params.minutes) && params.minutes > 0
      ? Math.floor(params.minutes)
      : 0;
    const memoCount = typeof params.memoCount === 'number' && Number.isFinite(params.memoCount) && params.memoCount > 0
      ? params.memoCount
      : 0;
    const hasDraft = Boolean(params.hasDraft);

    const parts = [];
    if (title) parts.push(title);
    if (minutes > 0) parts.push(`${minutes}분`);
    if (memoCount > 0) parts.push(`메모 ${memoCount}`);
    if (hasDraft) parts.push('쓰는 중');

    return parts.join(' · ');
  }

  // 쓰는 칸 높이 계산 (T36)
  // 처음 5줄 높이, 치면 내용에 맞춰 늘고(scrollHeight), 칸 목록 높이의 절반까지, 그 뒤는 쓰는 칸 안 스크롤
  function textareaHeight(params) {
    if (!params || typeof params !== 'object') return 100;
    const lineHeight = typeof params.lineHeight === 'number' && Number.isFinite(params.lineHeight) && params.lineHeight > 0
      ? params.lineHeight
      : 20;
    const minH = 5 * lineHeight;
    const listHeight = typeof params.listHeight === 'number' && Number.isFinite(params.listHeight) && params.listHeight > 0
      ? params.listHeight
      : 0;
    const maxH = listHeight > 0 ? listHeight / 2 : minH;
    const scrollHeight = typeof params.scrollHeight === 'number' && Number.isFinite(params.scrollHeight)
      ? params.scrollHeight
      : 0;

    const effectiveMax = Math.max(minH, maxH);
    return Math.min(Math.max(scrollHeight, minH), effectiveMax);
  }

  // 본문 스크롤에 따른 소제목 칸 전환 허용 여부 판정 (T36)
  // 쓰는 중(쓰는 칸에 포커스가 있고 마지막 입력 뒤 1.5초 안)에는 지금 칸을 바꾸지 않는다.
  function shouldSwitchSection(params) {
    if (!params || typeof params !== 'object') return true;
    const typingFocused = Boolean(params.typingFocused);
    if (!typingFocused) return true;

    const msSinceInput = typeof params.msSinceInput === 'number' && Number.isFinite(params.msSinceInput)
      ? params.msSinceInput
      : Infinity;

    return msSinceInput >= 1500;
  }

  // 붙여넣은 글 판정 (T37b): 'page' | 'tutor' | 'text'
  // 공백 정리 뒤 15자 미만이면 기본 동작('text').
  // 15자 이상일 때: 본문에 있으면 'page', 없으면 튜터에서 찾았을 때 'tutor', 못 찾으면 'text'.
  function classifyPaste(params) {
    if (!params || typeof params !== 'object') return 'text';
    const rawText = typeof params.text === 'string' ? params.text : '';
    const clean = rawText.trim().replace(/\s+/g, ' ');
    if (clean.length < 15) return 'text';
    if (params.inPage) return 'page';
    if (params.tutorFound) return 'tutor';
    return 'text';
  }

  // 붙여넣기 결과를 넣을 대상 key 판정 (17-1, FX-F 1번)
  // 시작 때 잡은 key 우선, 없으면 fallback (기본 '_page')
  function targetKeyOnPaste(capturedKey, fallbackKey) {
    if (typeof capturedKey === 'string' && capturedKey.length > 0) {
      return capturedKey;
    }
    if (typeof fallbackKey === 'string' && fallbackKey.length > 0) {
      return fallbackKey;
    }
    return '_page';
  }

  // 붙여넣기 응답 뒤 포커스 복구 여부 판정 (FX-F 2번)
  // 응답을 기다리는 사이 사용자가 다른 곳(페이지 입력칸, 우리 다른 칸 등)에 커서를 옮겼으면 포커스를 뺏지 않는다.
  function shouldRestorePasteFocus(params) {
    if (!params || typeof params !== 'object') return false;
    const { initialDocActive, currentDocActive, initialShadowActive, currentShadowActive, isPageField, activeKind } = params;
    if (isPageField) return false;
    if (activeKind && activeKind !== 'none' && activeKind !== 'other' && activeKind !== 'body') return false;
    if (initialDocActive && currentDocActive && initialDocActive !== currentDocActive) return false;
    if (initialShadowActive && currentShadowActive && initialShadowActive !== currentShadowActive) return false;
    return true;
  }

  // 칸을 다시 그릴 때(rebuildSectionsUI) 포커스 복귀 여부 판정 (16-6, FX-F 3번)
  // 메모장 안에 이미 커서가 있었을 때(padHadFocus)만 무조건 되돌리고,
  // 아니면 기본 포커스 판정(shouldReturnFocus)을 거쳐 허용될 때만 포커스.
  function shouldFocusOnRebuild(params) {
    if (!params || typeof params !== 'object') return false;
    const { padHadFocus, selectionCollapsed, cardOpen, activeKind, padOpen } = params;
    if (!padOpen) return false;
    if (padHadFocus) return true;
    return shouldReturnFocus({ selectionCollapsed, cardOpen, activeKind, padHasFocus: false, padOpen });
  }

  // 공부 모드 중 붙이기 상태 저장값 계산 (FX-F 7번)
  // 공부 모드 중에는 폭만 저장하고 on 값은 공부 모드 전 저장값을 유지.
  function dockStateToSave(params) {
    if (!params || typeof params !== 'object') return { on: false, width: 360 };
    const { studyMode, preStudyDockState, isDocked, dockWidthValue } = params;
    const on = (studyMode && preStudyDockState) ? Boolean(preStudyDockState.docked) : Boolean(isDocked);
    return { on, width: typeof dockWidthValue === 'number' && Number.isFinite(dockWidthValue) ? dockWidthValue : 360 };
  }

  // Backspace 로 인용 빼기 판정 (순수 함수, T45c)
  // Backspace이고(조합 중 아님, 조합키 없음) 쓰는 칸 값이 비었거나 커서가 0 위치(선택 없음)이며 그 칸에 인용이 있으면 true
  function shouldDropQuoteOnBackspace(params) {
    if (!params || typeof params !== 'object') return false;
    const { key, composing, mods, value, selStart, selEnd, hasQuote } = params;

    if (key !== 'Backspace') return false;
    if (composing === true) return false;

    // 조합키 검사 (shift, alt, ctrl, meta)
    if (typeof mods === 'boolean') {
      if (mods) return false;
    } else if (mods && typeof mods === 'object') {
      if (Boolean(mods.shift || mods.shiftKey || mods.alt || mods.altKey || mods.ctrl || mods.ctrlKey || mods.meta || mods.metaKey)) {
        return false;
      }
    } else if (mods) {
      return false;
    }

    if (!hasQuote) return false;

    const isValEmpty = typeof value === 'string' ? value.length === 0 : (value == null || !value);
    const isZeroNoSel = typeof selStart === 'number' && typeof selEnd === 'number' && selStart === 0 && selEnd === 0;

    return isValEmpty || isZeroNoSel;
  }

  // 인라인/블록 코드 인용 판정 (T49)
  // 줄바꿈 없고 120자 이하이면 'inline', 아니면 'block'
  function codeQuoteKind(text) {
    if (typeof text !== 'string') return 'inline';
    if (!/[\r\n]/.test(text) && text.length <= 120) {
      return 'inline';
    }
    return 'block';
  }

  const CODE_LANG_LIST = [
    '자동', 'plaintext', 'bash', 'python', 'javascript', 'typescript',
    'json', 'html', 'css', 'sql', 'c', 'cpp', 'java', 'go', 'rust',
    'powershell', 'yaml', 'http',
  ];

  const SUPPORTED_CODE_LANG_SET = new Set(
    CODE_LANG_LIST.filter((lang) => lang !== '자동')
  );

  const CODE_LANG_ALIASES = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    ps1: 'powershell',
    'c++': 'cpp',
  };

  // 언어 짐작 순수 함수 (T49)
  // classNames[] -> 'language-xxx'·'lang-xxx'·'hljs xxx'에서 지원 목록 안의 이름, 없으면 ''
  function guessCodeLang(classNames) {
    if (!Array.isArray(classNames) || classNames.length === 0) return '';
    const tokens = [];
    for (const item of classNames) {
      if (typeof item === 'string' && item.trim()) {
        const parts = item.trim().split(/\s+/);
        for (const p of parts) {
          if (p) tokens.push(p);
        }
      }
    }
    if (tokens.length === 0) return '';

    // 1. language-xxx 또는 lang-xxx 패턴 우선 검색
    for (const t of tokens) {
      const m = t.match(/^(?:language|lang)-([a-z0-9+#-]+)$/i);
      if (m) {
        const raw = m[1].toLowerCase();
        const resolved = CODE_LANG_ALIASES[raw] || raw;
        if (SUPPORTED_CODE_LANG_SET.has(resolved)) {
          return resolved;
        }
      }
    }

    // 2. hljs가 포함된 경우: hljs가 아닌 다른 클래스 중 지원 언어 검색
    const hasHljs = tokens.some((t) => t.toLowerCase() === 'hljs');
    if (hasHljs) {
      for (const t of tokens) {
        const raw = t.toLowerCase();
        if (raw === 'hljs') continue;
        const resolved = CODE_LANG_ALIASES[raw] || raw;
        if (SUPPORTED_CODE_LANG_SET.has(resolved)) {
          return resolved;
        }
      }
    }

    // 3. 토큰 자체가 지원 언어이거나 별칭인 경우
    for (const t of tokens) {
      const raw = t.toLowerCase();
      const resolved = CODE_LANG_ALIASES[raw] || raw;
      if (SUPPORTED_CODE_LANG_SET.has(resolved)) {
        return resolved;
      }
    }

    return '';
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
    shouldTabQuote,
    shortcutAction,
    canSave,
    dockWidth,
    pageMarginFor,
    shouldReturnFocus,
    assignToSections,
    parseConceptCommand,
    formatShapeLine,
    tocLabel,
    textareaHeight,
    shouldSwitchSection,
    classifyPaste,
    targetKeyOnPaste,
    shouldRestorePasteFocus,
    shouldFocusOnRebuild,
    dockStateToSave,
    formatClock,
    minutesLabel,
    shouldDropQuoteOnBackspace,
    codeQuoteKind,
    guessCodeLang,
    CODE_LANG_LIST,
  };
})();

