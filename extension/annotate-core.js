// 자동 주석의 판단 로직(후보 단어 고르기, 첫 등장만, 텍스트 쪼개기, 글자색). DOM 을 만지지 않는 순수 함수만 둔다.
// text.js 와 같이 import/export 없는 classic script 로 두고 전역 readglossAnnotate 로 등록한다. node --test 도 같은 파일을 쓴다.
(() => {
  const MAX_WORDS = 300; // 다리의 /annotate 상한과 맞춘다(넘으면 413)
  const MIN_LENGTH = 4;
  const TOKEN = /[A-Za-z]+(?:-[A-Za-z]+)*/g;
  const NEIGHBOR = /[\p{L}\p{N}_]/u; // 낱말에 바로 붙으면 영어 낱말이 아니다(x86, 2fa, 한글word, snake_case)

  // 문장 첫머리: 앞이 비었거나(블록 맨 앞), 따옴표·괄호·공백을 걷어 낸 앞 글자가 . ! ? 이다.
  const isSentenceStart = (before) => /(?:^|[.!?])[\s"'“”‘’()[\]]*$/.test(before);

  // 낱말 앞뒤 글자로 URL·파일 이름·소유격 밖의 축약형을 거른다.
  function standsAlone(text, start, end) {
    const prev = text[start - 1] ?? '';
    const next = text[end] ?? '';
    const next2 = text[end + 1] ?? '';
    if (NEIGHBOR.test(prev) || NEIGHBOR.test(next) || (prev && '/@#$\\'.includes(prev))) return false;
    if (next === '/' || next === '@' || (next === ':' && next2 === '/')) return false;
    if (prev === '.' && /\p{L}/u.test(text[start - 2] ?? '')) return false; // example.com 의 com
    if (next === '.' && /[\p{L}\p{N}]/u.test(next2)) return false; // node.js, file.txt 의 node·file
    if (/['’]/.test(prev) && /\p{L}/u.test(text[start - 2] ?? '')) return false; // o'brien 의 brien
    if (/['’]/.test(next) && !(next2 === 's' && !/\p{L}/u.test(text[end + 2] ?? ''))) return false; // doesn't 의 doesn. 소유격 's 만 허용
    return true;
  }

  // text 안의 후보 단어 [{ word(소문자), start, end }]. before = 같은 블록에서 text 앞에 있는 글자(문장 첫머리 판단용).
  // 제외: 3글자 이하, 전부 대문자(약어), 안쪽에 대문자(JavaScript, iPhone), 문장 중간의 대문자 시작(고유명사). 문장 첫 단어는 소문자로 바꿔 후보.
  function candidates(text, before = '') {
    const out = [];
    for (const m of String(text).matchAll(TOKEN)) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;
      if (raw.length < MIN_LENGTH || raw === raw.toUpperCase() || /[A-Z]/.test(raw.slice(1))) continue;
      if (!standsAlone(text, start, end)) continue;
      if (/^[A-Z]/.test(raw) && !isSentenceStart(before + text.slice(0, start))) continue;
      out.push({ word: raw.toLowerCase(), start, end });
    }
    return out;
  }

  // 한 블록의 텍스트 노드들(texts)을 이어서 문맥을 보고 후보를 뽑는다. 노드 경계를 걸치는 낱말(pay<b>load</b>)은 버린다.
  // 돌려주는 start/end 는 그 노드 안의 위치, node 는 texts 의 번호.
  function blockCandidates(texts) {
    const starts = [];
    let all = '';
    for (const t of texts) {
      starts.push(all.length);
      all += t;
    }
    const out = [];
    let i = 0;
    for (const c of candidates(all)) {
      while (i + 1 < texts.length && starts[i + 1] <= c.start) i++;
      if (c.end > starts[i] + texts[i].length) continue;
      out.push({ node: i, word: c.word, start: c.start - starts[i], end: c.end - starts[i] });
    }
    return out;
  }

  // 후보(occ) 중 어려운 단어(items 에 있는 것)만, 같은 원형은 블록에서 첫 번째만. seen 은 이미 주석이 붙은 원형 집합(새로 고른 것도 더한다).
  function chooseSpans(occs, items, seen = new Set()) {
    const out = [];
    for (const o of occs) {
      const it = items[o.word];
      if (!it || seen.has(it.lemma)) continue;
      seen.add(it.lemma);
      out.push({ ...o, lemma: it.lemma, gloss: it.gloss });
    }
    return out;
  }

  // text 를 spans([{start,end,gloss,lemma}])에서 쪼갠 조각 [{ text } | { text, gloss, lemma }]. 글자는 하나도 잃지 않는다.
  function splitText(text, spans) {
    const out = [];
    let at = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      if (s.start < at) continue; // 겹침은 앞의 것만
      if (s.start > at) out.push({ text: text.slice(at, s.start) });
      out.push({ text: text.slice(s.start, s.end), gloss: s.gloss, lemma: s.lemma });
      at = s.end;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  // 주석 글자색. 어두운 배경에서도 보이게 밝은 파랑을 쓴다.
  const annotationColor = (dark) => (dark ? 'rgba(107,155,255,.9)' : 'rgba(47,111,235,.85)');

  // 본문 글자색(computed color)이 밝으면 어두운 배경 페이지다. 못 읽으면 prefers-color-scheme: dark 설정을 따른다.
  function isDarkColor(textColor, prefersDark) {
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(textColor ?? '');
    if (!m || Number(m[4] ?? 1) === 0) return prefersDark === true;
    return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 > 0.6;
  }

  globalThis.readglossAnnotate = { MAX_WORDS, candidates, blockCandidates, chooseSpans, splitText, chunk, annotationColor, isDarkColor };
})();
