// extension/concept-core.js
// 내 개념 핵심 로직: 본문에서 개념어 찾기(순수 함수).
// DOM을 직접 만지지 않는 classic script로 전역 readglossConcept에 등록한다.
(() => {
  const LIMIT = {
    name: 80,
    alias: 80,
    aliasesCount: 5,
    definition: 500,
    relatedCount: 10,
    relatedName: 80,
  };

  // 정규식 특수문자 이스케이프
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 쉼표로 구분된 별칭 문자열 파싱 (최대 5개, 각 최대 80자)
  function parseAliases(raw) {
    if (typeof raw !== 'string') return [];
    return raw
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 0 && s.length <= LIMIT.alias)
      .slice(0, LIMIT.aliasesCount);
  }

  // 본문 fullText에서 terms 목록을 찾아 일치 구간 반환
  // - terms: [{ id, term }] (term은 이름 또는 별칭)
  // - 대소문자 무시, 낱말 경계(앞뒤가 영숫자가 아님), 긴 것 먼저, 겹치면 긴 것만
  // - 정규식 하나로 합쳐 한 번 훑기
  function findTerms(fullText, terms) {
    if (typeof fullText !== 'string' || !fullText || !Array.isArray(terms) || terms.length === 0) {
      return [];
    }

    // 유효한 terms 필터링
    const valid = [];
    for (const t of terms) {
      if (!t || typeof t.term !== 'string') continue;
      const clean = t.term.trim().replace(/\s+/g, ' ');
      if (!clean) continue;
      valid.push({ id: t.id, term: clean });
    }
    if (valid.length === 0) return [];

    // 긴 것 먼저 정렬 (긴 패턴이 alternation 앞에 와야 정규식 엔진이 우선 매칭함)
    valid.sort((a, b) => b.term.length - a.term.length);

    // 소문자 정규화 키 -> id 매핑
    const termMap = new Map();
    const patterns = [];
    const seenKeys = new Set();

    for (const item of valid) {
      const k = item.term.toLowerCase();
      if (!termMap.has(k)) {
        termMap.set(k, item.id);
      }
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        // 단어 내부 공백은 연속 공백 및 줄바꿈도 일치하도록 \s+ 처리
        const pat = item.term.split(/\s+/).map(escapeRegex).join('\\s+');
        patterns.push(pat);
      }
    }

    if (patterns.length === 0) return [];

    // 앞뒤가 영숫자가 아님: (?<![0-9A-Za-z]) ... (?![0-9A-Za-z])
    const regex = new RegExp(`(?<![0-9A-Za-z])(?:${patterns.join('|')})(?![0-9A-Za-z])`, 'gi');
    const results = [];
    let match;

    while ((match = regex.exec(fullText)) !== null) {
      const matchedText = match[0];
      const normKey = matchedText.trim().replace(/\s+/g, ' ').toLowerCase();
      const id = termMap.get(normKey);
      if (id !== undefined) {
        results.push({
          id,
          start: match.index,
          end: match.index + matchedText.length,
        });
      }
    }

    return results;
  }

  globalThis.readglossConcept = {
    LIMIT,
    escapeRegex,
    parseAliases,
    findTerms,
  };
})();
