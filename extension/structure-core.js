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

  globalThis.readglossStructureCore = {
    findPhrases,
    sentenceAround,
  };
})();
