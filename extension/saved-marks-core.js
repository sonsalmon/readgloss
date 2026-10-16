// 단어장 단어 칠하기 코어(T45b): 활용형 생성, 단어장 매핑, 본문 단어 검색(순수 함수).
// classic script: globalThis.readglossSavedMarksCore 에 등록(node --test 와 브라우저 모두 지원).
(() => {
  // 흔한 활용형 형태 목록(배열)을 돌려준다.
  // 원형에 뒤가 붙는 형태(s, es, ed, d, ing, e 빼고 ing, y→ies/ied, 자음 겹침+ed/ing)만 생성(FX-L 4).
  function formsOf(w) {
    if (typeof w !== 'string' || !w) return [];
    const s = new Set();
    const lower = w.toLowerCase();
    s.add(lower);

    // 앞으로 뻗는 활용 (w + ...)
    s.add(lower + 's');
    s.add(lower + 'es');
    s.add(lower + 'ed');
    s.add(lower + 'd');
    s.add(lower + 'ing');

    // (끝 e 뺀 w) + ing (make -> making)
    if (lower.endsWith('e') && lower.length > 1) {
      s.add(lower.slice(0, -1) + 'ing');
    }

    // (끝 y→i) + es/ed (study -> studies, studied)
    if (lower.endsWith('y') && lower.length > 1) {
      const base = lower.slice(0, -1);
      s.add(base + 'ies');
      s.add(base + 'ied');
    }

    // 자음 하나 겹친 w+ed/ing (run -> running, runned)
    const lastChar = lower[lower.length - 1];
    if (lower.length >= 2 && !'aeiou'.includes(lastChar) && /^[a-z]$/.test(lastChar)) {
      s.add(lower + lastChar + 'ing');
      s.add(lower + lastChar + 'ed');
    }

    return [...s].filter((f) => f && /^[a-z][a-z'’-]*$/.test(f));
  }

  // 단어장 원형 목록 -> Map(형태 -> 원형)
  function buildFormSet(lemmas) {
    const map = new Map();
    if (!lemmas) return map;
    const list = Array.isArray(lemmas)
      ? lemmas
      : (typeof lemmas[Symbol.iterator] === 'function' ? [...lemmas] : Object.keys(lemmas));

    for (const lemma of list) {
      if (typeof lemma !== 'string' || !lemma) continue;
      const lowerLemma = lemma.toLowerCase();
      const forms = formsOf(lowerLemma);
      for (const form of forms) {
        if (!map.has(form) || form === lowerLemma) {
          map.set(form, lowerLemma);
        }
      }
      if (!map.has(lowerLemma) || map.get(lowerLemma) !== lowerLemma) {
        map.set(lowerLemma, lowerLemma);
      }
    }
    return map;
  }

  const TOKEN_RE = /[A-Za-z]+(?:-[A-Za-z]+)*/g;
  const NEIGHBOR_RE = /[\p{L}\p{N}_]/u;

  // text 안에서 단어장 단어(원형 및 활용형)를 찾아 [{start, end, lemma}] 목록을 돌려준다.
  // 영어 낱말 경계 및 소문자 비교.
  function findSavedTokens(text, formMap) {
    if (typeof text !== 'string' || !text || !formMap || typeof formMap.get !== 'function') {
      return [];
    }
    TOKEN_RE.lastIndex = 0;
    const tokens = [];
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;

      // 앞글자 경계 검사: 숫자, 언더스코어, 다른 문자 등이 바로 붙어있으면 제외
      const prev = text[start - 1];
      if (prev && NEIGHBOR_RE.test(prev)) continue;

      // 뒷글자 경계 검사: 소유격('s, ’s)은 허용, 그 외의 영문자/숫자/언더스코어는 제외
      const next = text[end];
      if (next && NEIGHBOR_RE.test(next)) continue;
      if ((next === "'" || next === '’') && text[end + 1]?.toLowerCase() === 's') {
        const afterS = text[end + 2];
        if (afterS && NEIGHBOR_RE.test(afterS)) continue;
      } else if (next === "'" || next === '’') {
        const afterApos = text[end + 1];
        if (afterApos && NEIGHBOR_RE.test(afterApos)) continue;
      }

      const lower = raw.toLowerCase();
      const lemma = formMap.get(lower);
      if (lemma) {
        tokens.push({ start, end, lemma });
      }
    }
    return tokens;
  }

  // 텍스트 노드 목록에서 전체 문자열과 오프셋 색인을 구축한다.
  function buildNodeIndex(nodes) {
    if (!Array.isArray(nodes)) return { text: '', entries: [] };
    let text = '';
    const entries = [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.isBoundary) {
        if (!text.endsWith('\n')) {
          const start = text.length;
          text += '\n';
          entries.push({ node: n.node || null, text: '\n', start, end: text.length, isBoundary: true });
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

  // 전체 텍스트의 start~end 범위를 (startNode, startOffset)과 (endNode, endOffset)으로 매핑한다.
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

  // 단어장 단어 클릭 시 카드 열기 판정(순수 함수)
  function shouldOpenOnClick({ inLink = false, altKey = false, inOurUi = false, selectionEmpty = true } = {}) {
    if (inOurUi) return false;
    if (!selectionEmpty) return false;
    return !inLink || Boolean(altKey);
  }

  globalThis.readglossSavedMarksCore = {
    formsOf,
    buildFormSet,
    findSavedTokens,
    buildNodeIndex,
    resolveNodeOffsets,
    shouldOpenOnClick,
  };
})();
