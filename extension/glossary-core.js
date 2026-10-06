// 분야 용어집의 확장 쪽 순수 판단: 수학·ML 페이지인가, 다리에 실을 힌트(host·domains), 카드의 "용어:" 줄.
// 읽는 것은 인자로 받은 문서의 질의 결과뿐이다(전역 document 를 모른다). text.js 와 같이 import/export 없는 classic script 로 두고 전역 readglossGlossary 로 등록한다.
(() => {
  const MATH_DOM = 'mjx-container, .MathJax, .katex, math, script[type^="math/tex"]';
  const MAX_TEXT = 300; // 요소 하나에서 보는 글자 수
  const MAX_NODES = 300;

  // 수식 DOM 이 없는 사이트(HTB 는 수식도 평범한 글자: <code>A^T</code>, ```x_t```)용: 코드·제목 글자에서 수식 표기를 찾는다. 요소 하나가 여럿 걸려도 1로 센다.
  const NOTATION = [
    /\b[A-Za-z]\^(?:T|\{-?[A-Za-z0-9]+\}|-?[A-Za-z0-9]+)(?![A-Za-z0-9])/, // A^T, A^{-1}, e^x, x^2
    /\b[A-Za-z]_\{?[A-Za-z0-9]\}?(?![A-Za-z0-9_])/, // x_t (user_id·snake_case 는 안 걸린다)
    /\b(?:det|tr|Var|Cov|ln|log\d+|exp|argmax|argmin)\(|\bE\[/, // det(A), Var(X), E[X] (console.log( 는 제외)
    /[Σ∑∫∂∇√]/,
  ];
  const KEYWORD = /\b(?:matri(?:x|ces)|vectors?|eigen\w*|determinants?|transpose|derivatives?|gradients?|probability|variance|covariance|linear algebra|calculus|logarithms?)\b/i;

  // { hasMathDom, codeTexts, headingTexts } -> 수학 글이 많은 페이지인가. 수식 DOM 이 있거나, 수식 표기 둘 이상, 또는 표기 하나 + 제목의 수학 낱말.
  // ponytail: 낱말만으로는 수학 페이지로 안 본다(Matrix 영화 제목 등). 표기를 못 읽는 수학 글은 놓칠 수 있다 — 그러면 용어집이 안 켜질 뿐이다.
  function detectMath({ hasMathDom = false, codeTexts = [], headingTexts = [] } = {}) {
    if (hasMathDom) return true;
    const notation = [...codeTexts, ...headingTexts].filter((t) => NOTATION.some((re) => re.test(t))).length;
    if (notation >= 2) return true;
    return notation >= 1 && headingTexts.some((t) => KEYWORD.test(t));
  }

  // 머신러닝 글인가: 제목 둘 이상에 ML 낱말. 겹치는 용어(binary 이진/바이너리, exploitation 활용/악용 등)가 ML 뜻으로 먼저 나오게 하려는 것이다.
  const ML_KEYWORD = /\b(?:machine learning|deep learning|neural network\w*|supervised|unsupervised|reinforcement|q-learning|regression|classification|classifier|clustering|perceptrons?|gradient descent|decision trees?|naive bayes|support vector|overfitting|underfitting|backpropagation|k-means|hyperplane|dimensionality|anomaly detection|isolation forest|principal component)\b/i;
  const detectMl = ({ headingTexts = [] } = {}) => headingTexts.filter((t) => ML_KEYWORD.test(t)).length >= 2;

  const texts = (list) => Array.from(list).slice(0, MAX_NODES).map((n) => String(n.textContent ?? '').slice(0, MAX_TEXT));
  function inputFromDoc(doc) {
    return { hasMathDom: !!doc.querySelector(MATH_DOM), codeTexts: texts(doc.querySelectorAll('code')), headingTexts: texts(doc.querySelectorAll('h1, h2, h3')) };
  }

  // 다리 요청에 실을 필드. 설정이 'off' 면 아무것도 싣지 않는다(host 도 안 보낸다). domains 는 페이지가 알려 주는 분야(앞쪽이 우선): ML 글이면 'ml', 수학 글이면 'math'.
  function hint(settings, doc, hostname) {
    if (settings?.glossary === 'off') return {};
    const domains = [];
    try {
      const input = inputFromDoc(doc);
      if (detectMl(input)) domains.push('ml');
      if (detectMath(input)) domains.push('math');
    } catch {
      // 판단 실패는 "힌트 없음"
    }
    return { host: hostname, domains };
  }
  const hintKey = (h) => (h?.host === undefined ? '' : `${h.host}|${(h.domains ?? []).join(',')}`);

  const LABEL = { security: '보안', ml: '머신러닝', math: '수학' };
  function termLine(term) {
    if (!term || typeof term.ko !== 'string' || !term.ko) return '';
    return LABEL[term.domain] ? `용어: ${term.ko} · ${LABEL[term.domain]}` : `용어: ${term.ko}`;
  }

  globalThis.readglossGlossary = { detectMath, detectMl, inputFromDoc, hint, hintKey, termLine };
})();
