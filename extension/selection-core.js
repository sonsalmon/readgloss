// 드래그 번역의 판단 로직(선택 분류, 문맥 만들기). DOM 을 직접 만지지 않는 순수 함수만 둔다.
// text.js 와 같이 import/export 없는 classic script 로 두고 전역 readglossSelection 으로 등록한다. text.js(readgloss)가 먼저 로드돼야 한다.
(() => {
  const MAX_TEXT = 1000; // 다리의 LIMITS.text 등과 맞춘다(넘으면 다리가 413)
  const MAX_SIDE = 1500;
  const MAX_TITLE = 200; // 제목·소제목 한 줄의 상한
  const MAX_HEADINGS = 3;
  const WIDE_SIDE = 6000; // [더 넓게 보기]: 앞뒤 각 6000자·소제목(목차) 20개(다리의 wide 상한과 맞춘다)
  const WIDE_HEADINGS = 20;
  const MIN_LATIN_RATIO = 0.5; // 글자(\p{L}) 중 영어 알파벳 비율
  const NONE = Object.freeze({ kind: 'none' });

  const norm = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

  // 선택 글자 -> { kind: 'word', word } | { kind: 'phrase', text } | { kind: 'long' } | { kind: 'none' }
  // word: 영어 낱말 하나(더블클릭과 같이 사전 카드로), phrase: 영어 낱말 둘 이상 1000자 이하(번역 카드), long: 1000자 초과, none: 영어가 거의 없거나 낱말이 하나뿐인 조각.
  function classify(raw) {
    const text = norm(raw);
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    if (latin < 2 || latin / letters < MIN_LATIN_RATIO) return NONE;
    const w = globalThis.readgloss.cleanSelection(text);
    if (w) return { kind: 'word', word: w.word };
    if ((text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length < 2) return NONE;
    return text.length > MAX_TEXT ? { kind: 'long' } : { kind: 'phrase', text };
  }

  // 선택 시작 블록에서 선택 앞 글자(head)와 끝 블록에서 선택 뒤 글자(tail). 주석 뜻 글자·번역 노드는 text.js 의 plainTextAt 이 걸러 준다.
  function around(startBlock, startNode, startOffset, endBlock, endNode, endOffset) {
    const { plainTextAt } = globalThis.readgloss;
    const a = plainTextAt(startBlock, startNode, startOffset);
    const b = plainTextAt(endBlock, endNode, endOffset);
    return { head: a.text.slice(0, a.offset), tail: b.text.slice(b.offset) };
  }

  // 다리에 싣는 문맥. prev·next: 앞·뒤 블록 글(문서 순서), headings: 선택 위쪽 소제목(문서 순서, 가까운 쪽이 끝). 선택에 가까운 글을 남긴다.
  // wide: [더 넓게 보기] 용(앞뒤 6000자, 소제목 20개).
  function buildContext({ prev = [], head = '', tail = '', next = [], title = '', headings = [], wide = false }) {
    const side = wide ? WIDE_SIDE : MAX_SIDE;
    const before = norm([...prev, head].join(' '));
    const after = norm([tail, ...next].join(' '));
    return {
      before: before.slice(-side).trimStart(),
      after: after.slice(0, side).trimEnd(),
      title: norm(title).slice(0, MAX_TITLE),
      headings: headings.map((h) => norm(h).slice(0, MAX_TITLE)).filter(Boolean).slice(wide ? -WIDE_HEADINGS : -MAX_HEADINGS),
    };
  }

  // 페이지 목차(문서 순서) 중 max 개: 많으면 선택 위치(before = 선택 위쪽 제목 수) 근처를 남겨 현재 절이 들어가게 한다. 위쪽 70%.
  function pickHeadings(list, before, max = WIDE_HEADINGS) {
    if (list.length <= max) return list;
    const start = Math.min(Math.max(before - Math.ceil(max * 0.7), 0), list.length - max);
    return list.slice(start, start + max);
  }

  // ---- [문맥 번역]/[AI 문맥 뜻] -> [더 넓게 보기] -> 숨김 ----
  const STAGE_FIRST = { ctx: ['문맥 번역', '문맥 번역: 앞뒤 문맥을 보고 AI 가 번역'], ai: ['AI 문맥 뜻', 'AI 문맥 뜻: 이 문장 속 뜻 보기'] };
  const STAGE_WIDE_LABEL = { ctx: '더 넓게 보기: 글 앞뒤와 목차를 더 넓게 보고 다시 번역', ai: '더 넓게 보기: 글 앞뒤와 목차를 더 넓게 보고 뜻 찾기' };
  // kind: 'ctx'(드래그 카드) | 'ai'(사전 카드). done: 짧은 문맥 결과가 나왔나, wide: 넓은 결과까지 나왔나. wide 는 누르면 wide 로 요청한다는 뜻.
  function stageButton(kind, { done = false, wide = false } = {}) {
    if (wide) return { hidden: true, wide: false, text: '', label: '' };
    if (done) return { hidden: false, wide: true, text: '더 넓게 보기', label: STAGE_WIDE_LABEL[kind] };
    const [text, label] = STAGE_FIRST[kind];
    return { hidden: false, wide: false, text, label };
  }

  // ---- 내 사전 ----
  const clip = (s, n) => norm(s).slice(0, n);
  const KEY_RE = /^[a-z0-9 '’.-]{1,80}$/;
  // 선택 원문 -> 내 사전 키(소문자·공백 정리). 키 규칙(1~80자, [a-z0-9 '’.-])에 안 맞으면 null.
  const mydictKey = (raw) => {
    const k = norm(raw).toLowerCase();
    return KEY_RE.test(k) ? k : null;
  };

  // 사전 뜻 글 -> 첫 뜻만: 〈…〉《…》(…)[…] 설명을 걷고 ; 앞까지.
  const firstMeaning = (text) => norm(norm(text).replace(/[〈《(（[][^〉》)）\]]*[〉》)）\]]/g, '').split(/[;；]/)[0]);

  // 내 사전에 넣을 기본 뜻: 넓은 문맥 번역 > 문맥 번역 > AI 문맥 뜻 > 약어 뜻 > 맥 번역 > 용어 > 사전 분야 뜻 > 사전 첫 뜻. 80자까지.
  const MEANING_ORDER = ['wide', 'ctx', 'ai', 'acr', 'mt', 'term', 'sense', 'first'];
  function bestMeaning(m = {}) {
    for (const k of MEANING_ORDER) if (norm(m[k])) return clip(m[k], 80);
    return '';
  }

  // 다리 /mydict 'set' 요청. 상한(ko 80·exp 120·note 200)에 맞추고 빈 칸은 뺀다.
  function mydictMessage({ key, ko, exp, note, url, title }) {
    const msg = { type: 'mydict', op: 'set', key, ko: clip(ko, 80) };
    for (const [k, v, n] of [['exp', exp, 120], ['note', note, 200], ['url', url, 2000], ['title', title, 200]]) if (clip(v, n)) msg[k] = clip(v, n);
    return msg;
  }

  // ---- 구·문장 단어장 ----
  // mt: 맥 번역, ctx: 문맥(또는 넓은 문맥) 번역, wide: ctx 가 넓은 문맥 결과인가. 맥 번역이 없어도 저장된다(translation 0자 허용).
  function phraseMessage({ text, mt = '', ctx = '', ctxNote = '', wide = false, url, title }) {
    const msg = { type: 'words', op: 'save-phrase', text, translation: clip(mt, 2000) };
    if (norm(ctx)) {
      msg.context = { translation: clip(ctx, 2000) };
      if (norm(ctxNote)) msg.context.note = clip(ctxNote, 400);
      if (wide) msg.context.wide = true;
    }
    if (clip(url, 2000)) msg.url = clip(url, 2000);
    if (clip(title, 200)) msg.title = clip(title, 200);
    return msg;
  }
  const findPhrase = (phrases, text) => Object.entries(phrases ?? {}).find(([, p]) => p?.text === text)?.[0] ?? null;

  // ---- 기억할 표현(다리가 문맥·문단 번역에 붙여 주는 expressions) ----
  const MAX_EXPRESSIONS = 6;
  // 응답 값 -> 보여 줄 줄 [{ en, ko, id }]. 다리가 이미 걸렀어도 모양이 틀린 항목(en 2~60자 영어, ko 1~60자)은 버린다. id: 이미 담은 구·문장 id(없으면 null).
  function expressionRows(list, phrases) {
    const rows = [];
    for (const x of Array.isArray(list) ? list : []) {
      const en = norm(x?.en);
      const ko = norm(x?.ko);
      if (en.length < 2 || en.length > 60 || !/[A-Za-z]/.test(en) || !ko || ko.length > 60) continue;
      rows.push({ en, ko, id: findPhrase(phrases, en) });
      if (rows.length === MAX_EXPRESSIONS) break;
    }
    return rows;
  }
  // note 는 표현 목록이 비었을 때만 보인다(둘이 겹치지 않게). 보일 글을 돌려준다.
  const noteText = (note, rows) => (rows.length === 0 ? norm(note) : '');
  const expressionButton = (en, saved) =>
    saved ? { text: '★', label: `★ ${en} 단어장에 있음, 누르면 빼기` } : { text: '☆', label: `☆ ${en} 단어장에 추가` };
  // 줄 하나의 단추 -> 다리에 보낼 메시지. src: { sentence: 표현이 나온 원문, url, title }
  function expressionToggle({ en, ko, id }, { sentence = '', url, title } = {}) {
    if (id) return { type: 'words', op: 'unsave-phrase', id };
    const msg = { type: 'words', op: 'save-phrase', text: en, translation: clip(ko, 2000), kind: 'expression' };
    if (clip(sentence, MAX_TEXT)) msg.sentence = clip(sentence, MAX_TEXT);
    if (clip(url, 2000)) msg.url = clip(url, 2000);
    if (clip(title, 200)) msg.title = clip(title, 200);
    return msg;
  }

  // ---- window 'readgloss:lookup' 의 덧붙임(패널의 저장 문장에서 낱말을 더블클릭할 때) ----
  // context: 그 문장을 앞뒤 문맥으로 쓴다. source: 단어장에 담을 때 출처 주소. 페이지가 보낼 수도 있는 이벤트라 모양이 틀리면 버린다(주소는 http·https 만).
  function lookupExtras(d) {
    const c = d?.context;
    const s = d?.source;
    const before = typeof c?.before === 'string' ? clip(c.before, MAX_SIDE) : '';
    const context = before ? { before, after: clip(c.after, MAX_SIDE), title: clip(c.title, MAX_TITLE), headings: [] } : undefined;
    const source = typeof s?.url === 'string' && /^https?:\/\//.test(s.url) ? { url: s.url.slice(0, 2000), title: clip(s.title, MAX_TITLE) } : undefined;
    // drag: 드래그로 연 카드(더블클릭 아님)는 공부 기록에 남기지 않는다. content.js 가 이 값을 dict 요청 nolog 로 싣는다.
    return { context, source, nolog: d?.drag === true };
  }

  // ---- 약어 ----
  const isAcronym = (s) => typeof s === 'string' && /^[A-Z]{2,6}$/.test(s);
  const STOP = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'to', 'a', 'an', 'with', 'by', 'or']);
  const MAX_EXPAND_WORDS = 8;

  // 페이지 글에서 "(PCA)" 앞의 낱말들 중 머리글자가 약어와 맞는 구를 찾는다(소문자로). (PCAs) 같은 복수도 본다. 못 찾으면 null.
  // 하이픈은 낱말 경계(Cross-Site). 작은 낱말(of·and·the…)은 머리글자가 안 맞으면 건너뛴다. 문장 부호는 넘지 않는다. 최대 8낱말.
  // ponytail: 머리글자가 아닌 약어(XSS = cross-site scripting 의 X)는 못 찾는다 — 그러면 약어집·내 사전이 답이다.
  function expandAcronym(text, acronym) {
    if (!isAcronym(acronym) || typeof text !== 'string') return null;
    const letters = [...acronym];
    const paren = new RegExp(`\\(\\s*${acronym}(?:s|'s|’s)?\\s*\\)`, 'g');
    for (const m of text.matchAll(paren)) {
      const pre = text.slice(Math.max(0, m.index - 300), m.index);
      const toks = [...pre.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)].map((t) => ({ word: t[0], start: t.index, end: t.index + t[0].length }));
      const last = toks.at(-1);
      if (!last || pre.slice(last.end).trim() !== '') continue;
      let i = letters.length - 1;
      let first = null;
      for (let j = toks.length - 1, used = 0; j >= 0 && used < MAX_EXPAND_WORDS && i >= 0; j--, used++) {
        if (j < toks.length - 1 && /[,;:.!?()[\]]/.test(pre.slice(toks[j].end, toks[j + 1].start))) break; // 문장 부호를 넘지 않는다
        const w = toks[j].word;
        if (w[0].toUpperCase() === letters[i]) (first = toks[j], i--);
        else if (!(i < letters.length - 1 && STOP.has(w.toLowerCase()))) break;
      }
      if (i < 0) return norm(pre.slice(first.start, last.end)).toLowerCase();
    }
    return null;
  }

  // 카드 맨 위 약어 줄: "PCA = principal component analysis · 주성분 분석 (이 페이지)". 풀이가 없으면 ''.
  const acronymLine = ({ word, exp, ko, page }) => (exp ? `${word} = ${exp}${ko ? ` · ${ko}` : ''}${page ? ' (이 페이지)' : ''}` : '');

  // ---- 스크랩(T24) 순수 함수 ----
  // 주소 정규화: # 뒤를 버리고, utm_* 쿼리만 지우고, 끝 /를 뗀다.
  function normalizeUrl(input) {
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

  // 밖 페이지 질문 기억 키: 그날(서울 날짜) 동안 다시 안 물음
  function scrapAskKey(dateStr, url) {
    return `scrapAsk:${dateStr}:${normalizeUrl(url)}`;
  }

  // 맥 로컬 날짜 문자열 YYYY-MM-DD (scripts/export-day.mjs 의 dateOf 와 같은 계산)
  function localDateStr(ts = Date.now()) {
    const d = new Date(Number(ts));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const TASK_RE = /^S\d-\d{2}$/;
  // 다리 /scraps 'save' 요청 모양 생성. headings 최대 3개(가까운 쪽 끝), 각 200자, quote.exact 1000자, prefix/suffix 64자, translation 2000자, title 300자.
  function scrapMessage({ url = '', title = '', headings = [], quote = {}, pos = 0, translation = '', task = null }) {
    const normUrl = normalizeUrl(url);
    const t = typeof task === 'string' && TASK_RE.test(task) ? task : null;
    const hList = (Array.isArray(headings) ? headings : [])
      .map((h) => clip(h, 200))
      .filter(Boolean)
      .slice(-3);
    const exact = typeof quote?.exact === 'string' ? quote.exact.slice(0, 1000) : '';
    const prefix = typeof quote?.prefix === 'string' ? quote.prefix.slice(-64) : '';
    const suffix = typeof quote?.suffix === 'string' ? quote.suffix.slice(0, 64) : '';
    const p = typeof pos === 'number' && Number.isFinite(pos) ? Math.max(0, Math.floor(pos)) : 0;
    return {
      type: 'scraps',
      op: 'save',
      url: normUrl,
      title: clip(title, 300),
      headings: hList,
      quote: { exact, prefix, suffix },
      pos: p,
      translation: clip(translation, 2000),
      task: t,
    };
  }

  globalThis.readglossSelection = {
    MAX_TEXT, MAX_SIDE, MAX_TITLE, MAX_HEADINGS, WIDE_SIDE, WIDE_HEADINGS,
    classify, around, buildContext, pickHeadings, stageButton, mydictKey, firstMeaning, bestMeaning, mydictMessage, phraseMessage, findPhrase, MAX_EXPRESSIONS, expressionRows, noteText, expressionButton, expressionToggle, lookupExtras, isAcronym, expandAcronym, acronymLine,
    normalizeUrl, scrapAskKey, localDateStr, scrapMessage,
  };
})();
