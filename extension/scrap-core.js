// 문장 다시 찾기(앵커링) 순수 함수.
// DOM 을 직접 만지지 않으며 classic script 로 전역 readglossScrap 에 등록한다.
(() => {
  const CONTEXT_LEN = 32; // 앞뒤 문맥 길이(Hypothesis 기본값과 같음)
  const MAX_ERRORS_RATIO = 0.1; // 최대 허용 오차 비율(10%)

  // 선택 문장의 앞뒤 문맥(최대 32자)과 인용 추출.
  function quoteOf(fullText, start, end) {
    if (typeof fullText !== 'string') {
      return { exact: '', prefix: '', suffix: '' };
    }
    const s = Math.max(0, Math.min(start ?? 0, fullText.length));
    const e = Math.max(s, Math.min(end ?? s, fullText.length));
    return {
      exact: fullText.slice(s, e),
      prefix: fullText.slice(Math.max(0, s - CONTEXT_LEN), s),
      suffix: fullText.slice(e, Math.min(fullText.length, e + CONTEXT_LEN)),
    };
  }

  // prefix 끝부분이 candidate 앞쪽 텍스트 끝과 얼마나 연속으로 일치하는지(글자 수)
  function matchPrefixLength(text, prefix, matchStart) {
    if (!prefix || matchStart <= 0) return 0;
    let len = 0;
    const max = Math.min(prefix.length, matchStart);
    for (let i = 1; i <= max; i++) {
      if (text[matchStart - i] === prefix[prefix.length - i]) {
        len++;
      } else {
        break;
      }
    }
    return len;
  }

  // suffix 앞부분이 candidate 뒤쪽 텍스트 시작과 얼마나 연속으로 일치하는지(글자 수)
  function matchSuffixLength(text, suffix, matchEnd) {
    if (!suffix || matchEnd >= text.length) return 0;
    let len = 0;
    const max = Math.min(suffix.length, text.length - matchEnd);
    for (let i = 0; i < max; i++) {
      if (text[matchEnd + i] === suffix[i]) {
        len++;
      } else {
        break;
      }
    }
    return len;
  }

  // Hypothesis match-quote.ts (BSD-2-Clause)의 앵커링 점수 계산 방식을 따름.
  // 후보마다 prefix 끝부분·suffix 앞부분 맞춤 글자 수 + posHint 거리(가까울수록 높음, 작은 가중치)
  function scoreCandidate(c, fullText, prefix, suffix, posHint) {
    const pScore = matchPrefixLength(fullText, prefix, c.start);
    const sScore = matchSuffixLength(fullText, suffix, c.end);
    let posScore = 0;
    if (typeof posHint === 'number' && Number.isFinite(posHint)) {
      const dist = Math.abs(c.start - posHint);
      // 가까울수록 높게, 작은 가중치(문맥 글자 수 1점 미만으로 유지하여 동점 시 타이브레이커)
      posScore = (1 / (1 + dist)) * 0.1;
    }
    return pScore + sScore + posScore;
  }

  // fullText 에서 quote 를 찾아 { start, end } 돌려줌. 없으면 null.
  function findQuote(fullText, quote, posHint) {
    if (typeof fullText !== 'string' || !quote || typeof quote.exact !== 'string') {
      return null;
    }
    const exact = quote.exact;
    if (exact.length === 0) return null;

    const prefix = typeof quote.prefix === 'string' ? quote.prefix : '';
    const suffix = typeof quote.suffix === 'string' ? quote.suffix : '';

    // 1. 정확 일치 후보 전부
    const exactMatches = [];
    let idx = fullText.indexOf(exact);
    while (idx !== -1) {
      exactMatches.push({ start: idx, end: idx + exact.length, errors: 0 });
      idx = fullText.indexOf(exact, idx + 1);
    }

    let candidates = exactMatches;

    // 2. 정확 일치 후보가 없으면 approx-string-match 로 근사 검색
    if (candidates.length === 0) {
      const maxErrors = Math.floor(exact.length * MAX_ERRORS_RATIO);
      const approx = globalThis.readglossApprox;
      if (!approx || typeof approx.search !== 'function') {
        return null;
      }
      const approxMatches = approx.search(fullText, exact, maxErrors);
      if (!approxMatches || approxMatches.length === 0) {
        return null;
      }
      candidates = approxMatches.filter((m) => m.errors <= maxErrors);
      if (candidates.length === 0) {
        return null;
      }
    }

    // 3. 최고 점수 후보 하나 선택
    let best = null;
    let bestScore = -1;

    for (const c of candidates) {
      const score = scoreCandidate(c, fullText, prefix, suffix, posHint);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best) return null;
    return { start: best.start, end: best.end };
  }

  globalThis.readglossScrap = {
    quoteOf,
    findQuote,
    MAX_ERRORS_RATIO,
  };
})();
