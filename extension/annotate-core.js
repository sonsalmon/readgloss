// 자동 주석의 판단 로직(후보 단어 고르기, 개수·반복, 텍스트 쪼개기, 설정->CSS 변수)과, 주석 노드를 그리고 걷는 함수.
// DOM 은 인자로 받은 노드·문서만 쓴다(전역 document 를 모른다). 관찰·요청 같은 페이지 접착은 annotate.js 가 한다.
// text.js 와 같이 import/export 없는 classic script 로 두고 전역 readglossAnnotate 와 readglossAnnotStyle(계약 F)로 등록한다. node --test 도 같은 파일을 쓴다.
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

  // 후보(occ) 중 어려운 단어(items 에 있는 것)만 고른다. seen = 이미 주석이 붙은 원형 집합(새로 고른 것도 더한다, null 이면 같은 원형도 매번).
  // skip = 아는 단어 원형(건너뜀), limit = 이번에 더 붙일 수 있는 개수.
  function chooseSpans(occs, items, seen = new Set(), { skip, limit = Infinity } = {}) {
    const out = [];
    for (const o of occs) {
      if (out.length >= limit) break;
      const it = items[o.word];
      if (!it || skip?.has(it.lemma) || seen?.has(it.lemma)) continue;
      seen?.add(it.lemma);
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

  // 본문 글자색(computed color)이 밝으면 어두운 배경 페이지다. 못 읽으면 prefers-color-scheme: dark 설정을 따른다.
  function isDarkColor(textColor, prefersDark) {
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(textColor ?? '');
    if (!m || Number(m[4] ?? 1) === 0) return prefersDark === true;
    return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 > 0.6;
  }

  // ---- 설정 -> 동작 판단 ----

  // 켜짐 범위(계약 D): 전체 끄기·이 페이지만 끄기·끌 사이트 목록에 걸리면 자동 주석과 문단 번역 버튼이 꺼진다. 더블클릭 사전 카드는 이 판정을 안 쓴다.
  function enabledHere(settings, hostname, pageOff = false) {
    return settings.enabled === true && pageOff !== true && !globalThis.readglossSettings.siteBlocked(settings, hostname);
  }
  // 자동 주석을 실제로 그리는가: 켜짐 범위 안이고, 뜻 위치와 단어 표시가 모두 "없음"이 아니어야 한다(둘 다 없음이면 그릴 것이 없으니 다리도 안 부른다).
  function annotating(settings, hostname, pageOff = false) {
    return enabledHere(settings, hostname, pageOff) && (settings.annotation.position !== 'none' || settings.mark !== 'none');
  }
  // DOM 구조(또는 다리 요청)가 달라지는 값. 이 값이 바뀌면 다 걷고 다시 그린다. 크기·색·불투명도·굵기·간격·복사 허용은 CSS 변수만 바꾼다.
  const structuralKey = (s) => [s.annotation.position, s.mark, s.repeat, s.maxPerParagraph, s.level].join('|');

  // readgloss:words 이벤트 detail({known, unknown}) 반영: known 원형은 건너뛸 집합 skip 에 더하고, unknown 은 뺀다(pageSeen 을 주면 거기서도: 이 페이지에서 한 번만 붙이는 기록 때문에 새 글에서 주석이 막히지 않게). 새로 걷어야 할 known 원형 집합을 돌려준다.
  function applyWords(skip, detail, pageSeen) {
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
    const known = new Set(list(detail?.known));
    for (const l of list(detail?.unknown)) (skip.delete(l), pageSeen?.delete(l));
    for (const l of known) skip.add(l);
    return known;
  }

  // ---- 주석 노드 그리기·걷기 (계약 B) ----
  // 위: <ruby data-readgloss="ann" data-lemma>단어<rt data-readgloss="gloss">뜻</rt></ruby>
  // 오른쪽: <span data-readgloss="ann" data-lemma>단어<span data-readgloss="gloss">(뜻)</span></span>
  // 뜻 없음(mark 만): <span data-readgloss="ann" data-lemma>단어</span>
  // 단어 표시(mark)가 있을 때만 단어를 <span data-rg-word> 로 한 번 더 감싼다 — 감싸개에 글자색·밑줄·배경을 입히면 뜻 글자(자식)까지 물들기 때문이다.
  function makeAnnotation(doc, piece, position, mark) {
    const ann = doc.createElement(position === 'top' ? 'ruby' : 'span');
    ann.setAttribute('data-readgloss', 'ann');
    ann.setAttribute('data-lemma', piece.lemma);
    let base = ann;
    if (mark !== 'none') {
      base = doc.createElement('span');
      base.setAttribute('data-rg-word', '');
      ann.append(base);
    }
    base.append(doc.createTextNode(piece.text));
    if (position !== 'none') {
      const g = doc.createElement(position === 'top' ? 'rt' : 'span');
      g.setAttribute('data-readgloss', 'gloss');
      g.setAttribute('lang', 'ko');
      g.textContent = position === 'top' ? piece.gloss : `(${piece.gloss})`; // innerHTML 은 쓰지 않는다
      ann.append(g);
    }
    return ann;
  }

  const isGloss = (n) => n.nodeType === 1 && n.getAttribute('data-readgloss') === 'gloss';
  // 주석 감싸개에서 뜻 글자를 뺀 원래 단어 글자(감싸개 바로 아래 글자 노드든 data-rg-word 안이든)
  const wordOf = (ann) => [...ann.childNodes].filter((n) => !isGloss(n)).map((n) => n.textContent).join('');

  // root 아래 주석을 걷어 원래 글자로 되돌린다. lemmas(Set)를 주면 그 원형만. 쪼개졌던 글자 노드는 normalize 로 다시 붙는다.
  function unwrapAnnotations(root, lemmas) {
    const parents = new Set();
    for (const ann of [...root.querySelectorAll('[data-readgloss="ann"]')]) {
      if (lemmas && !lemmas.has(ann.getAttribute('data-lemma'))) continue;
      parents.add(ann.parentNode);
      ann.replaceWith(ann.ownerDocument.createTextNode(wordOf(ann)));
    }
    for (const p of parents) p?.normalize();
  }

  // 한 블록(job = { nodes, texts, occs })에 주석을 붙인다. state = { pageSeen(페이지에서 한 번 용 원형 집합), skip(아는 단어 원형) }. 붙인 개수를 돌려준다.
  function annotateBlock(block, job, items, settings, state) {
    const { position } = settings.annotation;
    if (position === 'none' && settings.mark === 'none') return 0;
    const { nodes, texts, occs } = job;
    const existing = [...block.querySelectorAll('[data-readgloss="ann"]')];
    const limit = settings.maxPerParagraph === 0 ? Infinity : settings.maxPerParagraph - existing.length;
    if (limit <= 0) return 0;
    // 그 사이 페이지가 글을 바꾼 노드는 건드리지 않는다
    const live = occs.filter((o) => nodes[o.node].isConnected && nodes[o.node].nodeValue === texts[o.node]);
    const seen = settings.repeat === 'page' ? state.pageSeen : settings.repeat === 'paragraph' ? new Set(existing.map((a) => a.getAttribute('data-lemma'))) : null;
    const spans = chooseSpans(live, items, seen, { skip: state.skip, limit });
    for (const [i, node] of nodes.entries()) {
      const mine = spans.filter((sp) => sp.node === i);
      if (!mine.length) continue;
      const doc = node.ownerDocument;
      const frag = doc.createDocumentFragment();
      for (const piece of splitText(texts[i], mine)) frag.append(piece.gloss ? makeAnnotation(doc, piece, position, settings.mark) : doc.createTextNode(piece.text));
      node.replaceWith(frag);
    }
    return spans.length;
  }

  // ---- 모양: 공유 스타일시트 + CSS 변수 (계약 F) ----
  const ACCENT = '#2f6feb';
  const ACCENT_DARK = '#6b9bff';
  const WEIGHT = { light: 300, normal: 400, bold: 600 };

  // 설정(normalize 된 값) -> { '--rg-…': 값 }. dark = 배경이 어두운가(강조색을 밝은 파랑으로).
  function cssVars(s, dark = false) {
    const a = s.annotation;
    const accent = dark ? ACCENT_DARK : ACCENT;
    return {
      '--rg-ann-size': `${a.sizePct}%`,
      '--rg-ann-color': a.color === 'text' ? 'currentColor' : a.color === 'accent' ? accent : a.customColor,
      '--rg-ann-opacity': String(a.opacityPct / 100),
      '--rg-ann-weight': String(WEIGHT[a.weight]),
      '--rg-ann-gap': `${a.gapEm}em`,
      '--rg-ann-select': s.allowCopy ? 'text' : 'none',
      '--rg-mark-color': s.mark === 'color' ? accent : 'currentColor',
      '--rg-mark-bg': s.mark === 'background' ? (dark ? 'rgba(107,155,255,.22)' : 'rgba(47,111,235,.14)') : 'transparent',
      '--rg-mark-line': s.mark === 'underline' ? 'underline' : 'none',
    };
  }

  // 간격(gapEm): 위 = 주석 단어 좌우 바깥 여백, 오른쪽 = 단어와 "(뜻)" 사이.
  const ANNOT_CSS = `
ruby[data-readgloss="ann"] { ruby-position: over; ruby-align: center; margin-inline: var(--rg-ann-gap, 0em); }
rt[data-readgloss="gloss"] { white-space: nowrap; }
[data-rg-word] { color: var(--rg-mark-color, currentColor); background-color: var(--rg-mark-bg, transparent); text-decoration-line: var(--rg-mark-line, none);
  text-decoration-style: dotted; text-decoration-thickness: 1.5px; text-underline-offset: .18em; border-radius: 2px; }
[data-readgloss="gloss"] { font-size: var(--rg-ann-size, 55%); color: var(--rg-ann-color, currentColor); opacity: var(--rg-ann-opacity, .7); font-weight: var(--rg-ann-weight, 400);
  font-family: inherit; font-style: normal; letter-spacing: normal; text-transform: none; text-decoration: none; background: none;
  -webkit-user-select: var(--rg-ann-select, none); user-select: var(--rg-ann-select, none); }
span[data-readgloss="gloss"] { margin-inline-start: var(--rg-ann-gap, 0em); }
`;
  let sheet = null;
  try {
    if (typeof CSSStyleSheet === 'function') {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(ANNOT_CSS);
    }
  } catch {
    sheet = null; // 안 되는 환경: annotate.js 가 <style> 로 대신한다
  }

  const norm = (s) => globalThis.readglossSettings?.normalize(s) ?? s;

  // target(기본 문서 루트)에 CSS 변수만 쓴다(DOM 구조는 안 건드린다). dark 를 안 주면 target 글자색으로 판단.
  function apply(settings, target = globalThis.document?.documentElement, dark) {
    const doc = target.ownerDocument;
    if (dark === undefined) {
      const probe = doc && target === doc.documentElement && doc.body ? doc.body : target;
      const color = typeof getComputedStyle === 'function' ? getComputedStyle(probe).color : '';
      dark = isDarkColor(color, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
    }
    for (const [k, v] of Object.entries(cssVars(norm(settings), dark))) target.style.setProperty(k, v);
  }

  const SAMPLE = 'Attackers exploit unpatched services to escalate privileges and exfiltrate data.';
  const SAMPLE_ITEMS = Object.assign(Object.create(null), {
    exploit: { lemma: 'exploit', gloss: '이용하다' },
    escalate: { lemma: 'escalate', gloss: '단계적으로 확대하다' },
    exfiltrate: { lemma: 'exfiltrate', gloss: '유출하다' },
  });

  // container 를 비우고 예시 문장 하나를 실제 그리기 함수(annotateBlock)로 그린다. 뜻은 다리 없이 고정값.
  function renderPreview(container, settings) {
    const s = norm(settings);
    apply(s, container);
    while (container.firstChild) container.firstChild.remove();
    const doc = container.ownerDocument;
    const p = doc.createElement('p');
    p.style.margin = '0';
    const text = doc.createTextNode(SAMPLE);
    p.append(text);
    container.append(p);
    const occs = blockCandidates([SAMPLE]).filter((o) => SAMPLE_ITEMS[o.word]);
    annotateBlock(p, { nodes: [text], texts: [SAMPLE], occs }, SAMPLE_ITEMS, { ...s, maxPerParagraph: 0, repeat: 'always' }, { pageSeen: new Set(), skip: new Set() });
  }

  globalThis.readglossAnnotate = {
    MAX_WORDS, candidates, blockCandidates, chooseSpans, splitText, chunk, isDarkColor,
    enabledHere, annotating, structuralKey, applyWords, makeAnnotation, unwrapAnnotations, annotateBlock, cssVars,
  };
  globalThis.readglossAnnotStyle = { sheet, css: ANNOT_CSS, apply, renderPreview };
})();

