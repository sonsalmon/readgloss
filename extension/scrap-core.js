// 문장 다시 찾기(앵커링) 순수 함수.
// DOM 을 직접 만지지 않으며 classic script 로 전역 readglossScrap 에 등록한다.
(() => {
  const CONTEXT_LEN = 32; // 앞뒤 문맥 길이(Hypothesis 기본값과 같음)
  const MAX_ERRORS_RATIO = 0.1; // 최대 허용 오차 비율(10%)
  const APPROX_MIN_LEN = 20; // 이보다 짧은 인용은 근사 검색 안 함(짧은 말은 엉뚱한 곳에 잘 맞음)
  const APPROX_MAX_TEXT = 300000; // 본문이 이보다 길면 근사 검색 안 함(시간 상한)
  const APPROX_MAX_EXACT = 1000; // 인용이 이보다 길면 근사 검색 안 함(시간 상한)
  const APPROX_MAX_REPEAT = 20; // 같은 글자가 이만큼 연속이면 근사 검색 안 함(반복 문자 때문에 느려짐)

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

  // 문맥 점수: prefix 끝부분·suffix 앞부분이 맞는 글자 수
  function contextScore(c, fullText, prefix, suffix) {
    return matchPrefixLength(fullText, prefix, c.start) + matchSuffixLength(fullText, suffix, c.end);
  }

  // 최종 점수: 문맥 점수 + posHint 거리(가까울수록 높음, 작은 가중치)
  // 정확 일치 → 근사 일치(approx-string-match) 후 앞뒤 문맥 일치 글자 수 + 위치 힌트로 고름.
  // (Hypothesis match-quote.ts 의 앵커링 아이디어를 참고했으나 같은 코드는 아님)
  function scoreCandidate(c, fullText, prefix, suffix, posHint) {
    let posScore = 0;
    if (typeof posHint === 'number' && Number.isFinite(posHint)) {
      const dist = Math.abs(c.start - posHint);
      // 가까울수록 높게, 작은 가중치(문맥 글자 수 1점 미만으로 유지하여 동점 시 타이브레이커)
      posScore = (1 / (1 + dist)) * 0.1;
    }
    return contextScore(c, fullText, prefix, suffix) + posScore;
  }

  // 지정 구간을 같은 길이의 가림 문자로 바꿈(글자 위치는 그대로)
  function maskRanges(fullText, ranges) {
    if (ranges.length === 0) return fullText;
    const parts = [];
    let pos = 0;
    for (const r of ranges) {
      parts.push(fullText.slice(pos, r.start), '\uFFFF'.repeat(r.end - r.start));
      pos = r.end;
    }
    parts.push(fullText.slice(pos));
    return parts.join('');
  }

  // 근사 검색을 해도 되는 인용인지(짧음·긴 본문·같은 글자 반복이면 안 함)
  function canApprox(fullText, exact) {
    if (exact.length < APPROX_MIN_LEN) return false;
    if (exact.length > APPROX_MAX_EXACT) return false;
    if (fullText.length > APPROX_MAX_TEXT) return false;
    if (new RegExp('(.)\\1{' + (APPROX_MAX_REPEAT - 1) + ',}', 's').test(exact)) return false;
    return true;
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
    const candidates = [];
    let idx = fullText.indexOf(exact);
    while (idx !== -1) {
      candidates.push({ start: idx, end: idx + exact.length, errors: 0 });
      idx = fullText.indexOf(exact, idx + 1);
    }

    // 2. 근사 검색은 (a) 정확 일치가 없거나, (b) 문맥(prefix/suffix)이 있는데 정확 후보들의 문맥 점수가 모두 0일 때만 한다.
    const hasContext = prefix.length > 0 || suffix.length > 0;
    const exactHasContext = candidates.some((c) => contextScore(c, fullText, prefix, suffix) > 0);
    const needApprox = candidates.length === 0 || (hasContext && !exactHasContext);
    if (needApprox && canApprox(fullText, exact)) {
      const approx = globalThis.readglossApprox;
      if (!approx || typeof approx.search !== 'function') {
        if (candidates.length === 0) return null;
      } else {
        const maxErrors = Math.floor(exact.length * MAX_ERRORS_RATIO);
        // approx.search 는 오차가 가장 적은 것만 돌려주므로, 이미 잡은 정확 일치 자리는 가려서 다음 후보가 나오게 함
        const approxMatches = approx.search(maskRanges(fullText, candidates), exact, maxErrors) || [];
        const seen = new Set(candidates.map((c) => c.start + ':' + c.end));
        for (const m of approxMatches) {
          if (m.errors > maxErrors) continue;
          const key = m.start + ':' + m.end;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ start: m.start, end: m.end, errors: m.errors });
        }
      }
    }
    if (candidates.length === 0) return null;

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
