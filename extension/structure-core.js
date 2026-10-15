// 문장 구조 찾기 코어(T42b): 전치사 + 관계사 구절 탐색 및 주변 문장 추출(순수 함수).
// classic script: globalThis.readglossStructureCore 에 등록(node --test 와 브라우저 모두 지원).
(() => {
  // 21-1 전치사 목록
  const PREPOSITIONS = [
    'in', 'on', 'at', 'for', 'of', 'to', 'from', 'by', 'with', 'under',
    'through', 'during', 'without', 'about', 'over', 'into', 'upon', 'within',
    'among', 'between', 'across', 'behind', 'beyond', 'via', 'against',
    'toward', 'towards',
  ].join('|');
  const RELATIVES = 'which|whom|whose';

  // 특별 구절 (전체 일치, 긴 구절 우선)
  const SPECIAL = 'the\\s+extent\\s+to\\s+which|the\\s+degree\\s+to\\s+which|the\\s+way\\s+in\\s+which';
  const GENERAL = `(?:${PREPOSITIONS})\\s+(?:${RELATIVES})`;
  const PHRASE_RE = new RegExp(`\\b(?:${SPECIAL}|${GENERAL})\\b`, 'gi');

  // 문장 경계: . ! ? (따옴표/괄호 가능) 뒤 공백 또는 끝, 또는 줄바꿈
  const SENTENCE_END = /[.!?]["')\]”’]*(?=\s|$)|[\r\n]+/g;
  const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'cf', 'mr', 'mrs', 'ms', 'dr', 'fig', 'no', 'approx', 'inc', 'st']);

  function isAbbreviation(text, dotIndex) {
    if (text[dotIndex] !== '.') return false;
    const token = /[^\s(]*$/.exec(text.slice(Math.max(0, dotIndex - 12), dotIndex))?.[0]?.toLowerCase();
    return token ? ABBREVIATIONS.has(token) : false;
  }

  // text 안에서 구절을 찾아 [{start, end, phrase}] 목록을 돌려준다.
  // 겹치면 긴 것만 남긴다.
  function findPhrases(text) {
    if (typeof text !== 'string' || !text) return [];
    PHRASE_RE.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = PHRASE_RE.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        phrase: m[0],
      });
    }

    if (matches.length <= 1) return matches;

    // start 오름차순, 길이 내림차순 정렬
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    const out = [];
    for (const item of matches) {
      const prev = out[out.length - 1];
      if (!prev) {
        out.push(item);
        continue;
      }
      // 겹치는지 검사 (item.start < prev.end)
      if (item.start < prev.end) {
        // 이미 앞선 것이 더 길거나 같음. 만약 현재 것이 더 길다면 교체
        const prevLen = prev.end - prev.start;
        const curLen = item.end - item.start;
        if (curLen > prevLen) {
          out[out.length - 1] = item;
        }
      } else {
        out.push(item);
      }
    }
    return out;
  }

  // 구절(start~end)이 포함된 문장(마침표·물음표·느낌표·줄바꿈 기준, ≤600자)을 돌려준다.
  function sentenceAround(text, start, end) {
    text = String(text ?? '');
    if (!text) return '';
    start = Math.max(0, Math.min(start | 0, text.length));
    end = Math.max(start, Math.min(end | 0, text.length));

    let sStart = 0;
    let sEnd = text.length;

    SENTENCE_END.lastIndex = 0;
    let m;
    while ((m = SENTENCE_END.exec(text)) !== null) {
      if (isAbbreviation(text, m.index)) continue;
      const at = m.index + m[0].length;
      if (at <= start) {
        sStart = at;
      } else if (m.index >= end) {
        sEnd = at;
        break;
      }
    }

    const seg = text.slice(sStart, sEnd);
    const lead = seg.length - seg.trimStart().length;
    const body = seg.trim();
    const norm = body.replace(/\s+/g, ' ');

    const MAX_LEN = 600;
    if (norm.length <= MAX_LEN) return norm;

    // 600자를 넘으면 구절을 중심으로 자른다
    const relOffset = seg.slice(lead, Math.max(lead, start - sStart)).replace(/\s+/g, ' ').length;
    const from = Math.min(Math.max(relOffset - Math.floor(MAX_LEN / 2), 0), norm.length - MAX_LEN);
    return norm.slice(from, from + MAX_LEN).trim();
  }

  // 블록 내 노드 목록을 이어 붙여 텍스트를 만든다(21-1, FX-J 2).
  // 노드 경계(다른 BLOCK 또는 br) 사이에는 줄바꿈('\n')을 넣어 sentenceAround 가 문단을 넘지 않게 한다.
  function blockText(nodes) {
    if (!Array.isArray(nodes)) return '';
    let out = '';
    for (const n of nodes) {
      if (!n) continue;
      if (typeof n === 'string') {
        if (n === '\n') {
          if (out && !out.endsWith('\n')) out += '\n';
        } else {
          out += n;
        }
        continue;
      }
      const tag = (n.tagName || n.nodeName || '').toLowerCase();
      const isBr = tag === 'br' || n.isBr === true;
      const isBlock = n.isBlock === true || (n.nodeType === 1 && tag !== 'br');
      const isBoundary = n.isBoundary === true || n.separator === true || isBr || isBlock;

      if (isBoundary) {
        if (out && !out.endsWith('\n')) out += '\n';
        continue;
      }

      const val = typeof n.text === 'string'
        ? n.text
        : (typeof n.nodeValue === 'string' ? n.nodeValue : '');
      out += val;
    }
    return out;
  }

  // nodes 배열로부터 전체 텍스트와 각 텍스트 노드의 오프셋 표를 만든다(FX-J 6).
  function buildNodeIndex(nodes) {
    if (!Array.isArray(nodes)) return { text: '', entries: [] };
    let text = '';
    const entries = [];
    for (const n of nodes) {
      if (!n) continue;
      if (typeof n === 'string') {
        if (n === '\n') {
          if (text && !text.endsWith('\n')) {
            entries.push({ isBoundary: true, start: text.length, end: text.length + 1 });
            text += '\n';
          }
        } else {
          const start = text.length;
          text += n;
          entries.push({ text: n, start, end: text.length, isText: true });
        }
        continue;
      }

      const tag = (n.tagName || n.nodeName || '').toLowerCase();
      const isBr = tag === 'br' || n.isBr === true;
      const isBlock = n.isBlock === true || (n.nodeType === 1 && tag !== 'br');
      const isBoundary = n.isBoundary === true || n.separator === true || isBr || isBlock;

      if (isBoundary) {
        if (text && !text.endsWith('\n')) {
          entries.push({ isBoundary: true, node: n.node || n, start: text.length, end: text.length + 1 });
          text += '\n';
        }
        continue;
      }

      const val = typeof n.text === 'string'
        ? n.text
        : (typeof n.nodeValue === 'string' ? n.nodeValue : '');
      if (val) {
        const start = text.length;
        text += val;
        entries.push({
          node: n.node || n,
          text: val,
          start,
          end: text.length,
          isText: true,
        });
      }
    }
    return { text, entries };
  }

  // 전체 텍스트의 start~end 범위를 (startNode, startOffset)과 (endNode, endOffset)으로 매핑한다(FX-J 6).
  function resolveNodeOffsets(entries, start, end) {
    if (!Array.isArray(entries) || typeof start !== 'number' || typeof end !== 'number' || start >= end) {
      return null;
    }
    const textEntries = entries.filter((e) => e && e.isText && e.node);
    if (!textEntries.length) return null;

    let startLoc = null;
    let endLoc = null;

    for (const e of textEntries) {
      if (!startLoc && start >= e.start && start < e.end) {
        startLoc = { node: e.node, offset: start - e.start };
      }
      if (end > e.start && end <= e.end) {
        endLoc = { node: e.node, offset: end - e.start };
      }
    }

    if (startLoc && endLoc) {
      return {
        startNode: startLoc.node,
        startOffset: startLoc.offset,
        endNode: endLoc.node,
        endOffset: endLoc.offset,
      };
    }
    return null;
  }

  // 제목 자르기(긴 제목 400 방지, FX-J 3)
  function truncateTitle(title, max = 300) {
    if (typeof title !== 'string') return '';
    return title.slice(0, max);
  }

  // 구조 카드 열기 판정(순수 함수, FX-J 4, 7)
  function shouldOpenOnClick({ inLink = false, altKey = false, inOurUi = false, selectionEmpty = true } = {}) {
    if (inOurUi) return false;
    if (!selectionEmpty) return false;
    return !inLink || Boolean(altKey);
  }

  globalThis.readglossStructureCore = {
    findPhrases,
    sentenceAround,
    blockText,
    buildNodeIndex,
    resolveNodeOffsets,
    truncateTitle,
    shouldOpenOnClick,
  };
})();
