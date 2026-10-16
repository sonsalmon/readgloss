// "내 단어" 탭(단어장 / 아는 단어 / 최근 찾은 단어) + 카드 버튼 상태 판단.
// 위쪽은 DOM 을 만지지 않는 순수 함수(globalThis.readglossWords, node --test 가 같은 파일을 import 한다).
// content.js 의 사전 카드도 클릭 시점에 이 순수 함수를 쓴다. 아래쪽 render 는 패널 Shadow DOM 안 container 에 그린다.
(() => {
  // ---- 순수 로직 ----
  const LISTS = [
    { id: 'saved', title: '단어장', empty: '아직 단어장에 담은 단어가 없어요. 단어 카드에서 ☆ 단어장에 추가를 눌러 보세요.' },
    { id: 'known', title: '아는 단어', empty: '아는 단어로 표시한 단어가 없어요. 카드에서 ✓ 알아요를 누르면 이 단어에는 주석이 붙지 않아요.' },
    { id: 'history', title: '최근 찾은 단어', empty: '아직 찾아본 단어가 없어요. 영어 단어를 더블클릭해 보세요.' },
  ];

  const pad = (n) => String(n).padStart(2, '0');
  function formatDate(ts) {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : '';
  }

  const counts = (s) => ({ saved: Object.keys(s.saved).length, known: Object.keys(s.known).length, history: s.history.length });

  // 줄마다 동작 버튼. 단어장: 빼기·알아요 / 아는 단어: 알아요 취소 / 최근: 단어장에 추가·알아요(이미 했으면 되돌리기)
  function actionsFor(list, isSaved, isKnown) {
    const known = isKnown ? { op: 'unknown', label: '알아요 취소' } : { op: 'known', label: '알아요' };
    if (list === 'saved') return [{ op: 'unsave', label: '빼기' }, known];
    if (list === 'known') return [{ op: 'unknown', label: '알아요 취소' }];
    return [isSaved ? { op: 'unsave', label: '단어장에서 빼기' } : { op: 'save', label: '단어장에 추가' }, known];
  }

  // 상태 + 하위 목록 + 검색어(원형 앞부분 일치) -> 줄 목록. 아는 단어 줄은 단어장·최근 기록에서 뜻과 문장을 빌려 온다.
  function rowsFor(state, list, query = '') {
    const q = String(query).trim().toLowerCase();
    const idx = (o) => Object.entries(o).map(([lemma, v]) => ({ lemma, ...v }));
    const byNew = (a, b) => b.ts - a.ts;
    let rows;
    if (list === 'saved') rows = idx(state.saved).sort(byNew);
    else if (list === 'known') {
      rows = idx(state.known)
        .sort(byNew)
        .map((k) => {
          const o = state.saved[k.lemma] ?? state.history.find((h) => h.lemma === k.lemma) ?? {};
          return { lemma: k.lemma, word: o.word ?? k.lemma, gloss: o.gloss ?? '', sentence: o.sentence ?? '', url: o.url ?? '', ts: k.ts };
        });
    } else rows = state.history.map((h) => ({ ...h }));
    return rows
      .filter((r) => r.lemma.startsWith(q))
      .map((r) => ({ ...r, actions: actionsFor(list, Object.hasOwn(state.saved, r.lemma), Object.hasOwn(state.known, r.lemma)) }));
  }

  // 사전 카드의 두 버튼. aria-label 은 보이는 글자를 포함한다.
  function buttonModel({ saved = false, known = false } = {}) {
    const save = saved ? { op: 'unsave', text: '★ 단어장에 있음', label: '★ 단어장에 있음, 누르면 빼기' } : { op: 'save', text: '☆ 단어장에 추가', label: '☆ 단어장에 추가' };
    const mark = known ? { op: 'unknown', text: '알아요 취소', label: '알아요 취소, 이 단어에 주석을 다시 붙이기' } : { op: 'known', text: '✓ 알아요', label: '✓ 알아요, 이 단어에 주석 붙이지 않기' };
    return { save, known: mark };
  }

  // 알아요/취소는 페이지의 주석을 걷거나 되살려야 해서 이벤트를 보낸다(계약 C). 그 밖의 동작은 null.
  function eventDetail(op, lemma) {
    if (op === 'known') return { known: [lemma], unknown: [] };
    if (op === 'unknown') return { known: [], unknown: [lemma] };
    return null;
  }

  // 저장·알아요 성공 뒤 카드가 쏘는 window 'readgloss:words' detail. known·unknown 은 기존 계약 그대로 두고(annotate.js 가 읽는다),
  // 단어장 저장·빼기는 saved·unsaved 키를 더한다(패널이 숫자·목록을 다시 읽는 신호).
  function wordEventDetail(op, lemma) {
    if (op === 'known') return { known: [lemma], unknown: [] };
    if (op === 'unknown') return { known: [], unknown: [lemma] };
    if (op === 'save') return { known: [], unknown: [], saved: [lemma] };
    if (op === 'unsave') return { known: [], unknown: [], unsaved: [lemma] };
    return null;
  }

  // 동작 -> 다리에 보낼 메시지. save 는 줄이 가진 단어·뜻·문장·주소를 그대로 싣는다.
  const messageFor = (op, row) => (op === 'save' ? { type: 'words', op, lemma: row.lemma, word: row.word, gloss: row.gloss, sentence: row.sentence, url: row.url } : { type: 'words', op, lemma: row.lemma });

  // ---- 구·문장 / 내 사전(T14c) / 복습(T44c) ----
  const SUBS = [
    { id: 'review', title: '복습', empty: '오늘 복습할 단어가 없어요.' },
    ...LISTS,
    { id: 'phrases', title: '구·문장', empty: '아직 담은 구·문장이 없어요. 드래그 번역 카드에서 단어장에 담으면 여기에 모여요.' },
    { id: 'mydict', title: '내 용어집', empty: '내 용어집이 비어 있어요. 약어나 전문 용어의 뜻을 직접 적어 두면 어디서든 그 뜻이 먼저 나와요.' },
  ];
  const countsAll = (s, mine) => ({ ...counts(s), phrases: Object.keys(s.phrases ?? {}).length, mydict: Object.keys(mine ?? {}).length });

  // 두 줄 말줄임은 CSS 가 하고, 이건 아주 긴 글을 화면에 올리지 않으려는 상한이다(전체는 title 로 남긴다).
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
  const safeHref = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '';
    } catch {
      return '';
    }
  };
  const hostOf = (u) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  };
  const norm = (s) => String(s ?? '').toLowerCase();

  // 구·문장 종류 칩(T17). kind 가 없거나 모르는 값이면 문장(옛 기록).
  const PHRASE_FILTERS = [{ id: 'all', title: '전체' }, { id: 'expression', title: '표현' }, { id: 'sentence', title: '문장' }];
  const kindOf = (p) => (p?.kind === 'expression' ? 'expression' : 'sentence');
  const phraseCounts = (phrases) => {
    const kinds = Object.values(phrases ?? {}).map(kindOf);
    return { all: kinds.length, expression: kinds.filter((k) => k === 'expression').length, sentence: kinds.filter((k) => k === 'sentence').length };
  };

  // 주 번역: 문맥 번역(넓으면 넓은 문맥 번역)이 있으면 그것, 맥 번역은 문맥 번역이 없을 때만 보인다. 표현의 translation 은 이 문맥의 뜻이다.
  function phrasePrimary(p) {
    const c = p?.context?.translation;
    return c ? { title: p.context.wide ? '넓은 문맥 번역' : '문맥 번역', text: c } : { title: '', text: p?.translation ?? '' };
  }

  // 구·문장: 최근 저장순. 검색은 원문·맥 번역·문맥 번역·출처 문장 어디든 포함 일치(대소문자 무시). filter: all·expression·sentence.
  function phraseRows(phrases, query = '', filter = 'all') {
    const q = norm(query).trim();
    return Object.entries(phrases ?? {})
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => b.ts - a.ts)
      .filter((p) => (filter === 'expression' || filter === 'sentence' ? kindOf(p) === filter : true))
      .filter((p) => !q || [p.text, p.translation, p.context?.translation, p.context?.note, p.sentence].some((f) => norm(f).includes(q)))
      .map((p) => ({
        id: p.id, text: p.text, preview: clip(p.text, 300), translation: p.translation ?? '', context: p.context ?? null,
        kind: kindOf(p), sentence: p.sentence ?? '', primary: phrasePrimary(p), sourceTitle: p.title ?? '', memo: p.memo ?? '',
        title: p.title || hostOf(p.url ?? ''), href: safeHref(p.url ?? ''), ts: p.ts,
      }));
  }

  // ---- 저장된 문장에서 낱말 더블클릭 -> 원래 사이트에서처럼 사전 카드(window 'readgloss:lookup') ----
  const pickWord = (raw) => globalThis.readgloss.cleanSelection(raw);
  // 카드가 쓰는 모양: sentence·context 는 저장 문장(1000자까지), source 는 저장된 출처(주소가 없으면 빼서 카드가 지금 페이지를 쓴다). rect 는 뷰포트 좌표.
  function lookupDetail({ word, sentence, rect, url, title }) {
    const s = String(sentence ?? '').slice(0, 1000);
    const t = String(title ?? '');
    return {
      word, sentence: s, rect: { left: rect.left, top: rect.top, bottom: rect.bottom },
      context: { before: s, after: '', title: t, headings: [] },
      ...(url && { source: { url, title: t } }),
    };
  }

  // 내 사전: 최근에 고친 순. 검색은 key 앞부분 또는 뜻·풀이·메모 포함.
  function mydictRows(entries, query = '') {
    const q = norm(query).trim();
    return Object.entries(entries ?? {})
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.ts - a.ts)
      .filter((e) => !q || e.key.startsWith(q) || [e.ko, e.exp, e.note].some((f) => norm(f).includes(q)));
  }

  // 내 사전 입력 검사(다리 계약과 같은 규칙: key 는 소문자·공백 정리 1~80자 [a-z0-9 '’.-], ko 1~80, exp 0~120, note 0~200).
  function checkMydict({ key = '', ko = '', exp = '', note = '' }) {
    const k = String(key).trim().toLowerCase().replace(/\s+/g, ' ');
    const v = { key: k, ko: String(ko).trim(), exp: String(exp).trim(), note: String(note).trim() };
    const fail = (field, error) => ({ ok: false, field, error });
    if (!k) return fail('key', '낱말이나 약어를 적어 주세요');
    if (k.length > 80) return fail('key', '낱말은 80자까지예요');
    if (!/^[a-z0-9 '’.-]+$/.test(k)) return fail('key', "영문 낱말만 쓸 수 있어요(영문자·숫자·공백·' . - )");
    if (!v.ko) return fail('ko', '뜻을 적어 주세요');
    if (v.ko.length > 80) return fail('ko', '뜻은 80자까지예요');
    if (v.exp.length > 120) return fail('exp', '풀이는 120자까지예요');
    if (v.note.length > 200) return fail('note', '메모는 200자까지예요');
    return { ok: true, value: v };
  }
  const mydictMessage = (v, old = {}) => {
    const m = { type: 'mydict', op: 'set', key: v.key, ko: v.ko };
    for (const f of ['exp', 'note']) if (v[f]) m[f] = v[f];
    for (const f of ['url', 'title']) if (old[f]) m[f] = old[f]; // 고칠 때 출처를 잃지 않게 그대로 다시 보낸다
    return m;
  };
  // 내 사전이 바뀌면 주석을 걷고 다시 입히라고 알리는 이벤트(window 'readgloss:mydict')
  const mydictEventDetail = (op, key) => (op === 'delete' ? { set: [], delete: [key] } : { set: [key], delete: [] });
  const unsavePhraseMessage = (id) => ({ type: 'words', op: 'unsave-phrase', id });
  // T19: 메모 저장 메시지. byId 면 구·문장(id), 아니면 단어(lemma).
  const memoMessage = (key, memo, byId = false) => ({ type: 'words', op: 'memo', ...(byId ? { id: key } : { lemma: key }), memo: String(memo ?? '') });

  // ---- 확인 메시지의 [메모] 판단(T20) ----
  // 메모 입력칸 keydown: Enter = 저장, Shift+Enter = 줄바꿈, 그 밖에는 null. 한글 조합 중(e.isComposing) Enter 는 저장하지 않는다.
  function memoKey({ key, shiftKey = false, isComposing = false } = {}) {
    if (key !== 'Enter' || isComposing) return null;
    return shiftKey ? 'newline' : 'save';
  }
  // 메모 응답 계약(다리): 성공이면 error 칸이 없는 객체, 실패면 { error }. 404 'not-found' 도 실패로 본다.
  const memoOk = (r) => !!r && typeof r === 'object' && !r.error;
  // 저장 실패 문구. 404(단어장에 없음)는 구분해서 알린다.
  const memoErrorText = (r) => (r?.error === 'not-found' ? '단어장에서 찾지 못했어요' : '메모를 저장하지 못했어요');

  // ---- 복습(T44c) 순수 함수 ----
  // 저장한 문장에서 단어(표면형 word, 대소문자 무시, 낱말 경계)를 ____로 가린다.
  function maskWord(sentence, word) {
    if (!sentence || !word) return sentence || '';
    const s = String(sentence);
    const w = String(word).trim();
    if (!w) return s;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    return s.replace(re, '____');
  }

  // 카드 상태 전이: front → back(flip), back → 다음(next / know / again).
  function nextCardState(state, action) {
    const act = typeof action === 'string' ? action : action?.type;
    const curIndex = state?.index ?? 0;
    const curSide = state?.side ?? 'front';
    if (act === 'flip') {
      return { ...state, side: curSide === 'front' ? 'back' : 'front' };
    }
    if (act === 'next' || act === 'know' || act === 'again') {
      return { ...state, index: curIndex + 1, side: 'front' };
    }
    return state;
  }

  globalThis.readglossWords = {
    LISTS, SUBS, formatDate, counts, countsAll, actionsFor, rowsFor, buttonModel, eventDetail, wordEventDetail, messageFor,
    clip, PHRASE_FILTERS, phraseCounts, phrasePrimary, phraseRows, pickWord, lookupDetail, mydictRows, checkMydict, mydictMessage, mydictEventDetail, unsavePhraseMessage, memoMessage,
    memoKey, memoOk, memoErrorText,
    maskWord, nextCardState,
  };

  // ---- 그리기 ----
  const MESSAGES = { 'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요', unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요', 'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요', 'http-404': '다리가 이 기능을 아직 몰라요. 다리를 다시 시작해 주세요' };
  const errText = (r, head = '문제가 생겼어요') => MESSAGES[r?.error] ?? `${head}(${r?.error ?? '응답 없음'})`;

  // 패널 껍데기가 정한 토큰(--rg-*)을 쓰고, 껍데기 없이 시험할 때를 위해 밝은/어두운 기본값을 둔다.
  const CSS = `
    .rgw { --w-fg: var(--rg-fg, #1f2328); --w-muted: var(--rg-muted, #656d76); --w-border: var(--rg-border, #e3e6ea); --w-accent: var(--rg-accent, #2f6feb);
      --w-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); --w-err: #d1242f; color: var(--w-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgw { --w-fg: var(--rg-fg, #e6e8eb); --w-muted: var(--rg-muted, #9aa3ad); --w-border: var(--rg-border, #343a44); --w-accent: var(--rg-accent, #6b9bff);
        --w-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); --w-err: #ff7b72; }
    }
    :host([data-theme="light"]) .rgw { --w-err: #d1242f; }
    :host([data-theme="dark"]) .rgw { --w-err: #ff7b72; }
    .subs { display: flex; gap: 4px; flex-wrap: wrap; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
    .sub { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--w-border); background: none; font-size: 13px; }
    .sub[aria-pressed="true"] { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-accent); font-weight: 600; }
    .n { margin-left: 4px; font-variant-numeric: tabular-nums; opacity: .8; }
    .q { box-sizing: border-box; width: 100%; margin: 10px 0 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--w-border); background: none; color: inherit; font: inherit; }
    .status { color: var(--w-muted); font-size: 13px; padding: 6px 0; word-break: keep-all; overflow-wrap: anywhere; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { padding: 9px 0; border-top: 1px solid var(--w-border); }
    .top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .lemma { font-weight: 700; font-size: 15px; }
    .gloss { color: var(--w-fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wrap { white-space: normal; overflow-wrap: anywhere; }
    .sent { color: var(--w-muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sent.wrap { white-space: normal; overflow-wrap: anywhere; }
    .memo { color: var(--w-muted); font-size: 12.5px; margin-top: 3px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .memo::before { content: "메모 · "; color: var(--w-accent); font-weight: 600; }
    .exp { color: var(--w-muted); font-size: 12.5px; min-width: 0; overflow-wrap: anywhere; }
    .meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .date { color: var(--w-muted); font-size: 12px; margin-right: auto; font-variant-numeric: tabular-nums; }
    .src { color: var(--w-accent); font-size: 12px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act { padding: 1px 9px; border-radius: 7px; border: 1px solid var(--w-border); background: none; font-size: 12.5px; }
    .act:hover { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-accent); }
    .act[disabled] { opacity: .55; cursor: default; }
    .act.primary { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-accent); font-weight: 600; }
    .ptext { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 600; overflow-wrap: anywhere; }
    .ptrans { margin-top: 2px; overflow-wrap: anywhere; }
    .plabel { margin-top: 4px; color: var(--w-accent); font-size: 12px; font-weight: 700; }
    .pexp { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .badge { flex: none; padding: 0 7px; border-radius: 999px; background: var(--w-soft); color: var(--w-accent); font-size: 11.5px; font-weight: 700; }
    .psent { margin-top: 2px; color: var(--w-muted); font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .kinds { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
    .chip { padding: 1px 9px; border-radius: 999px; border: 1px solid var(--w-border); background: none; font-size: 12.5px; }
    .chip[aria-pressed="true"] { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-accent); font-weight: 600; }
    .lk { cursor: text; }
    .form { display: grid; gap: 6px; padding: 8px 0; }
    .form label { display: grid; gap: 2px; font-size: 12px; color: var(--w-muted); }
    .form input { box-sizing: border-box; width: 100%; padding: 4px 8px; border-radius: 7px; border: 1px solid var(--w-border); background: none; color: var(--w-fg); font: inherit; font-size: 13.5px; }
    .form textarea { box-sizing: border-box; width: 100%; min-height: 44px; padding: 4px 8px; border-radius: 7px; border: 1px solid var(--w-border); background: none; color: var(--w-fg); font: inherit; font-size: 13.5px; resize: vertical; }
    .btns { display: flex; gap: 6px; justify-content: flex-end; }
    .err { color: var(--w-err); font-size: 12.5px; overflow-wrap: anywhere; }
    .addbar { margin: 8px 0 0; }
    .rev-pane { display: grid; gap: 12px; padding: 10px 0; }
    .rev-remain { color: var(--w-muted); font-size: 13px; font-weight: 600; }
    .rev-card { border: 1px solid var(--w-border); border-radius: 10px; padding: 16px; background: none; display: grid; gap: 10px; }
    .rev-head { font-size: 20px; font-weight: 700; color: var(--w-fg); line-height: 1.3; }
    .rev-phrase-text { font-size: 16px; }
    .rev-sent { color: var(--w-fg); font-size: 14px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
    .rev-gloss { font-size: 16px; font-weight: 600; color: var(--w-accent); }
    .rev-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
    .rev-btn { padding: 6px 14px; font-size: 13.5px; border-radius: 8px; }
    .kbd { display: inline-block; margin-left: 6px; padding: 1px 5px; font-size: 11px; font-family: inherit; border-radius: 4px; border: 1px solid var(--w-border); opacity: .8; background: var(--w-soft); color: var(--w-accent); }
    .rev-done { padding: 24px 0; text-align: center; display: grid; gap: 6px; }
    .rev-done-title { font-size: 16px; font-weight: 700; color: var(--w-fg); }
    .rev-done-sub { font-size: 13px; color: var(--w-muted); }
    [hidden] { display: none !important; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(label, onclick, cls = 'act', aria) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onclick);
    return b;
  }
  function field(labelText, value = '', maxLength) {
    const input = el('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = maxLength; // 입력칸 자체도 상한을 건다(검사는 checkMydict 가 다시 한다)
    const label = el('label', '', labelText);
    label.append(input);
    return { label, input };
  }

  function render(container, ctx) {
    const W = globalThis.readglossWords;
    let state = null; // GET /words 응답(단어장·아는 단어·최근 찾은 단어·phrases)
    let mine = null; // GET /mydict 의 entries
    let reviewData = null; // GET /words/review 응답(due: [], counts: { due, done, total })
    let list = 'saved';
    let phraseKind = 'all'; // 구·문장 종류 칩(전체·표현·문장)
    let query = '';
    let busy = false;
    let message = '불러오는 중…';
    let mineMessage = '불러오는 중…';
    let reviewMessage = '불러오는 중…';
    let cardState = { index: 0, side: 'front' };
    let reviewErr = '';
    let reviewedCount = 0;
    let adding = false;
    let editing = null; // 고치는 중인 key
    let draft = { ko: '', note: '' };
    let memoEdit = null; // 메모 고치는 중인 { kind: 'word'|'phrase', key }
    let memoDraft = '';
    let memoErr = '';
    let focusMemo = false;
    let confirming = null; // 한 번 더 눌러야 지워지는 key
    let formErr = { where: '', text: '' };
    let selfEvent = false;
    let selfWords = false;

    const root = el('div', 'rgw');
    const style = el('style');
    style.textContent = CSS;
    const subs = el('div', 'subs');
    subs.setAttribute('role', 'group');
    subs.setAttribute('aria-label', '내 단어 목록');
    const kinds = el('div', 'kinds');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', '구·문장 종류');
    const search = el('input', 'q');
    search.type = 'search';
    search.placeholder = '찾기: 단어는 앞부분, 구·문장·내 용어집은 포함';
    search.setAttribute('aria-label', '찾기: 단어는 앞부분, 구·문장·내 용어집은 포함');
    const status = el('div', 'status');
    status.setAttribute('role', 'status');

    // 내 사전 맨 위: [직접 추가] 버튼과 접히는 입력 폼(한 번만 만들고 hidden 으로 여닫는다)
    const addBar = el('div', 'addbar');
    const addToggle = btn('+ 직접 추가', () => {
      adding = !adding;
      formErr = { where: '', text: '' };
      draw();
      if (adding) kField.input.focus();
    }, 'act primary');
    addToggle.setAttribute('aria-label', '내 용어집에 직접 추가');
    const addForm = el('div', 'form');
    addForm.setAttribute('role', 'group');
    addForm.setAttribute('aria-label', '내 용어집에 추가');
    const kField = field('낱말·약어 (영문)', '', 80);
    const koField = field('뜻', '', 80);
    const expField = field('풀이 (선택, 예: Principal Component Analysis)', '', 120);
    const addErr = el('div', 'err');
    addErr.setAttribute('role', 'alert');
    const addBtns = el('div', 'btns');
    addBtns.append(
      btn('취소', () => { adding = false; draw(); }, 'act', '내 용어집 추가 취소'),
      btn('추가', () => addEntry(), 'act primary', '내 용어집에 추가하기'),
    );
    addForm.append(kField.label, koField.label, expField.label, addErr, addBtns);
    addBar.append(addToggle, addForm);

    const revPane = el('div', 'rev-pane');
    const ul = el('ul');
    root.append(style, subs, kinds, search, status, addBar, revPane, ul);
    container.replaceChildren(root);

    const subBtns = W.SUBS.map((l) => {
      const b = el('button', 'sub');
      b.type = 'button';
      b.addEventListener('click', () => {
        list = l.id;
        editing = confirming = memoEdit = null;
        reviewErr = '';
        draw();
      });
      subs.append(b);
      return b;
    });

    // 복습 단축키(Space: 뒤집기, 1: 아직, 2: 알아요) — 패널 shadow 안에서 입력칸 밖일 때만 동작
    root.addEventListener('keydown', (e) => {
      if (list !== 'review') return;
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      const isInput = target?.matches?.('input, textarea, [contenteditable="true"]') || target?.isContentEditable;
      if (isInput || e.ctrlKey || e.metaKey || e.altKey) return; // 입력칸·브라우저 단축키(Cmd+1 등)는 건드리지 않는다

      const due = reviewData?.due || [];
      if (cardState.index >= due.length) return;

      if (cardState.side === 'front') {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          e.stopPropagation();
          cardState = W.nextCardState(cardState, 'flip');
          reviewErr = '';
          draw();
        }
      } else if (cardState.side === 'back') {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === '1') {
          e.preventDefault();
          e.stopPropagation();
          answerReview('again');
        } else if (e.key === '2') {
          e.preventDefault();
          e.stopPropagation();
          answerReview('know');
        }
      }
    });
    const chipBtns = W.PHRASE_FILTERS.map((f) => {
      const b = el('button', 'chip');
      b.type = 'button';
      b.addEventListener('click', () => {
        phraseKind = f.id;
        memoEdit = null;
        draw();
      });
      kinds.append(b);
      return b;
    });
    search.addEventListener('input', () => {
      query = search.value;
      draw();
    });

    // 다른 곳(카드)에서 단어장·아는 단어(readgloss:words)나 내 사전(readgloss:mydict)이 바뀌면 다시 읽는다.
    // 패널이 새로 그려져 이 노드가 떨어지면 스스로 거둔다(panel-study.js 와 같은 방식).
    const onWords = () => {
      if (!root.isConnected) return window.removeEventListener('readgloss:words', onWords);
      if (!selfWords) {
        loadWords(); // 입력칸의 draft 는 draw 가 그대로 살린다
        loadReview(true);
      }
    };
    window.addEventListener('readgloss:words', onWords);
    const onMine = () => {
      if (!root.isConnected) return window.removeEventListener('readgloss:mydict', onMine);
      if (selfEvent) return;
      loadMine();
      loadWords(); // 내 사전이 바뀌어도 단어장 숫자·목록을 다시 맞춘다
    };
    window.addEventListener('readgloss:mydict', onMine);

    async function act(op, row) {
      if (busy) return;
      busy = true;
      const r = await ctx.send(W.messageFor(op, row));
      busy = false;
      if (r?.known && r.saved && r.history) {
        state = r;
        message = '';
        const detail = W.eventDetail(op, row.lemma);
        if (detail) {
          selfWords = true; // 패널 자신이 낸 이벤트로 다시 읽는 되돌이를 막는다
          window.dispatchEvent(new CustomEvent('readgloss:words', { detail }));
          selfWords = false;
        }
      } else message = errText(r);
      draw();
    }

    async function removePhrase(row) {
      if (busy) return;
      busy = true;
      const r = await ctx.send(W.unsavePhraseMessage(row.id));
      busy = false;
      const ok = r && !r.error;
      if (ok) {
        const { [row.id]: _gone, ...rest } = state.phrases;
        state = { ...state, phrases: r?.phrases ?? rest }; // 다리가 새 목록을 주면 그것을, 아니면 이 줄만 뺀다
      }
      message = ok ? '' : errText(r);
      draw();
    }

    // T19: 메모 고치기. Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소, keydown 은 페이지로 새지 않게 멈춘다.
    function memoForm(kind, key) {
      const form = el('div', 'form');
      const ta = el('textarea');
      ta.value = memoDraft;
      ta.maxLength = 1000;
      ta.rows = 2;
      ta.setAttribute('aria-label', '메모 (Enter 저장, Shift+Enter 줄바꿈)');
      ta.addEventListener('input', () => (memoDraft = ta.value));
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          memoEdit = null;
          memoErr = '';
          draw();
          return;
        }
        if (W.memoKey(e) === 'save') {
          e.preventDefault(); // Enter 로 저장한다(줄바꿈은 Shift+Enter, 한글 조합 중 Enter 는 무시). 이 입력칸 안에서만 막는다.
          saveMemo(kind, key);
        }
      });
      form.append(ta);
      if (memoErr) {
        const err = el('div', 'err', memoErr);
        err.setAttribute('role', 'alert');
        form.append(err);
      }
      return form;
    }

    async function saveMemo(kind, key) {
      if (busy) return;
      busy = true;
      const r = await ctx.send(W.memoMessage(key, memoDraft, kind === 'phrase'));
      busy = false;
      if (r?.error) memoErr = errText(r);
      else {
        memoErr = '';
        memoEdit = null;
        if (kind === 'word') state = r; // 단어 메모 응답은 전체 상태
        else if (r?.phrases) state = { ...state, phrases: r.phrases }; // 구 메모 응답은 { id, phrases }
      }
      draw();
    }

    // 내 사전 쓰기 한 번: 성공하면 entries 를 받고 이벤트를 쏜다. 실패하면 실패 글을 돌려준다.
    async function mineSend(msg, detail) {
      if (busy) return '잠시만요, 처리 중이에요';
      busy = true;
      const r = await ctx.send(msg);
      busy = false;
      if (!r?.entries) return errText(r);
      mine = r.entries;
      mineMessage = '';
      selfEvent = true;
      window.dispatchEvent(new CustomEvent('readgloss:mydict', { detail }));
      selfEvent = false;
      return '';
    }

    async function addEntry() {
      const c = W.checkMydict({ key: kField.input.value, ko: koField.input.value, exp: expField.input.value });
      if (!c.ok) {
        formErr = { where: 'add', text: c.error };
      } else {
        const text = await mineSend(W.mydictMessage(c.value), W.mydictEventDetail('set', c.value.key));
        formErr = { where: text ? 'add' : '', text };
        if (!text) {
          adding = false;
          kField.input.value = koField.input.value = expField.input.value = '';
        }
      }
      draw();
    }

    async function saveEdit(row) {
      const c = W.checkMydict({ key: row.key, ko: draft.ko, exp: row.exp, note: draft.note });
      if (!c.ok) formErr = { where: row.key, text: c.error };
      else {
        const text = await mineSend(W.mydictMessage(c.value, row), W.mydictEventDetail('set', row.key));
        formErr = { where: text ? row.key : '', text };
        if (!text) editing = null;
      }
      draw();
    }

    async function removeEntry(row) {
      if (confirming !== row.key) {
        confirming = row.key;
        return draw();
      }
      confirming = null;
      const text = await mineSend({ type: 'mydict', op: 'delete', key: row.key }, W.mydictEventDetail('delete', row.key));
      formErr = { where: text ? row.key : '', text };
      draw();
    }

    // 저장된 문장(단어장 예문·구·문장 원문·표현의 출처 문장)에서 낱말을 더블클릭하면 원래 사이트에서처럼 사전 카드가 뜬다(content.js 가 'readgloss:lookup' 을 받는다).
    const sources = new WeakMap(); // 노드 -> { sentence, url, title }
    const lookable = (node, src) => {
      node.classList.add('lk');
      sources.set(node, src);
      return node;
    };
    root.addEventListener('dblclick', (e) => {
      const src = sources.get(e.target?.closest?.('.lk'));
      if (!src) return;
      const sel = root.getRootNode().getSelection?.() ?? getSelection(); // 패널은 Shadow DOM 이라 document 선택에는 안 잡힌다
      const picked = W.pickWord(sel?.toString());
      if (!picked) return;
      let rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect || (rect.width === 0 && rect.height === 0)) rect = { left: e.clientX, top: e.clientY, bottom: e.clientY + 18 };
      window.dispatchEvent(new CustomEvent('readgloss:lookup', { detail: W.lookupDetail({ word: picked.word, sentence: src.sentence, rect, url: src.url, title: src.title }) }));
    });

    function wordRow(r) {
      const li = el('li');
      const top = el('div', 'top');
      top.append(el('span', 'lemma', r.lemma));
      if (r.gloss) top.append(el('span', 'gloss', r.gloss));
      li.append(top);
      if (r.sentence) {
        const s = lookable(el('div', 'sent', r.sentence), { sentence: r.sentence, url: r.url, title: '' });
        s.title = r.sentence;
        li.append(s);
      }
      // T19: 메모는 단어장(saved) 줄에서만 보이고 고칠 수 있다(다리도 saved 에만 붙인다).
      const editingMemo = list === 'saved' && memoEdit?.kind === 'word' && memoEdit.key === r.lemma;
      if (editingMemo) li.append(memoForm('word', r.lemma));
      else if (list === 'saved' && r.memo) li.append(el('div', 'memo', r.memo));
      const meta = el('div', 'meta');
      meta.append(el('span', 'date', W.formatDate(r.ts)));
      if (list === 'saved' && !editingMemo) {
        meta.append(btn(r.memo ? '메모 고치기' : '메모', () => { memoEdit = { kind: 'word', key: r.lemma }; memoDraft = r.memo ?? ''; memoErr = ''; focusMemo = true; draw(); }, 'act', `${r.lemma} 메모`));
      }
      for (const a of r.actions) meta.append(btn(a.label, () => act(a.op, r), 'act', `${r.lemma} ${a.label}`));
      li.append(meta);
      return li;
    }

    function phraseRow(p) {
      const li = el('li');
      const src = { url: p.href, title: p.sourceTitle };
      if (p.kind === 'expression') {
        const top = el('div', 'pexp');
        top.append(el('span', 'badge', '표현'), el('span', 'ptext', p.preview), el('span', 'ptrans', `— ${p.primary.text}`));
        li.append(top);
        if (p.sentence) {
          const sent = lookable(el('div', 'psent', p.sentence), { sentence: p.sentence, ...src });
          sent.title = p.sentence;
          li.append(sent);
        }
      } else {
        const t = lookable(el('div', 'ptext', p.preview), { sentence: p.text, ...src });
        t.title = p.text;
        li.append(t);
        if (p.primary.title) li.append(el('div', 'plabel', p.primary.title));
        if (p.primary.text) li.append(el('div', 'ptrans', p.primary.text));
        if (p.context?.note) li.append(el('div', 'exp', p.context.note));
      }
      const editingMemo = memoEdit?.kind === 'phrase' && memoEdit.key === p.id;
      if (editingMemo) li.append(memoForm('phrase', p.id));
      else if (p.memo) li.append(el('div', 'memo', p.memo));
      const meta = el('div', 'meta');
      meta.append(el('span', 'date', W.formatDate(p.ts)));
      if (p.href) {
        const a = el('a', 'src', p.title || p.href);
        a.href = p.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = p.href;
        meta.append(a);
      }
      if (!editingMemo) meta.append(btn(p.memo ? '메모 고치기' : '메모', () => { memoEdit = { kind: 'phrase', key: p.id }; memoDraft = p.memo ?? ''; memoErr = ''; focusMemo = true; draw(); }, 'act', `${p.preview.slice(0, 30)} 메모`));
      meta.append(btn('빼기', () => removePhrase(p), 'act', `${p.preview.slice(0, 30)} 단어장에서 빼기`));
      li.append(meta);
      return li;
    }

    function mineRow(e) {
      const li = el('li');
      const top = el('div', 'top');
      top.append(el('span', 'lemma', e.key));
      if (e.exp) top.append(el('span', 'exp', e.exp));
      li.append(top);
      if (editing === e.key) {
        const form = el('div', 'form');
        const ko = field('뜻', draft.ko, 80);
        const note = field('메모 (선택)', draft.note, 200);
        ko.input.addEventListener('input', () => (draft.ko = ko.input.value));
        note.input.addEventListener('input', () => (draft.note = note.input.value));
        const err = el('div', 'err', formErr.where === e.key ? formErr.text : '');
        err.setAttribute('role', 'alert');
        const bs = el('div', 'btns');
        bs.append(btn('취소', () => { editing = null; formErr = { where: '', text: '' }; draw(); }, 'act', `${e.key} 고치기 취소`), btn('저장', () => saveEdit(e), 'act primary', `${e.key} 고친 내용 저장`));
        form.append(ko.label, note.label, err, bs);
        li.append(form);
        return li;
      }
      li.append(el('div', 'gloss wrap', e.ko));
      if (e.note) li.append(el('div', 'sent wrap', e.note));
      if (formErr.where === e.key) {
        const err = el('div', 'err', formErr.text);
        err.setAttribute('role', 'alert');
        li.append(err);
      }
      const meta = el('div', 'meta');
      meta.append(el('span', 'date', W.formatDate(e.ts)));
      meta.append(btn('고치기', () => {
        editing = e.key;
        confirming = null;
        draft = { ko: e.ko, note: e.note ?? '' };
        formErr = { where: '', text: '' };
        draw();
      }, 'act', `${e.key} 고치기`));
      meta.append(btn(confirming === e.key ? '정말 지우기' : '지우기', () => removeEntry(e), 'act', confirming === e.key ? `${e.key} 정말 지우기, 한 번 더 누르면 지워져요` : `${e.key} 지우기`));
      li.append(meta);
      return li;
    }

    // 복습 카드에 답하기(know: 알아요, again: 아직) -> 다리 op 'review' 전송
    async function answerReview(result) {
      if (busy) return;
      const due = reviewData?.due || [];
      const card = due[cardState.index];
      if (!card) return;
      busy = true;
      const isPhrase = card.type === 'phrase';
      const msg = {
        type: 'words',
        op: 'review',
        ...(isPhrase ? { id: card.key } : { lemma: card.key }),
        result,
      };
      const r = await ctx.send(msg);
      busy = false;
      if (r?.error || !r) {
        reviewErr = '저장하지 못했어요';
        draw();
        return;
      }
      reviewErr = '';
      reviewedCount++;
      if (r?.counts) {
        reviewData.counts = r.counts;
      } else if (reviewData?.counts) {
        if (reviewData.counts.due > 0) reviewData.counts.due--;
      }
      cardState = W.nextCardState(cardState, 'next');
      if (cardState.index >= due.length && (reviewData?.counts?.due ?? 0) > 0) {
        loadReview(false);
        return;
      }
      draw();
    }

    // 복습 화면 그리기
    function drawReview() {
      // 자동 포커스는 "그 직전에 포커스가 이미 이 복습 보기(패널 shadow) 안에 있었을 때"만 한다.
      const activeEl = root.getRootNode?.()?.activeElement;
      const hadFocus = Boolean(activeEl && root.contains(activeEl));

      revPane.replaceChildren();

      if (reviewMessage) {
        revPane.append(el('div', 'status', reviewMessage));
        return;
      }

      const due = reviewData?.due || [];
      const curIndex = cardState.index;
      const counts = reviewData?.counts || { due: 0, done: 0, total: 0 };

      if (curIndex >= due.length) {
        const doneBox = el('div', 'rev-done');
        const countText = reviewedCount > 0 ? `오늘 복습 끝 · ${reviewedCount}개` : '오늘 복습할 단어가 없어요';
        const doneTotal = counts.done ?? 0;
        doneBox.append(
          el('div', 'rev-done-title', countText),
          el('div', 'rev-done-sub', `복습 끝낸 단어 ${doneTotal}개`),
        );
        revPane.append(doneBox);
        return;
      }

      const card = due[curIndex];
      const remaining = due.length - curIndex;
      revPane.append(el('div', 'rev-remain', `남은 ${remaining}`));

      const cardBox = el('div', 'rev-card');
      const isWord = card.type === 'word';
      const isBack = cardState.side === 'back';

      if (isWord) {
        const lemmaText = card.lemma || card.key;
        cardBox.append(el('div', 'rev-head', lemmaText));

        if (!isBack) {
          if (card.sentence) {
            const masked = W.maskWord(card.sentence, card.word || card.key);
            cardBox.append(el('div', 'rev-sent', masked));
          }
        } else {
          if (card.gloss) {
            cardBox.append(el('div', 'rev-gloss', card.gloss));
          }
          if (card.memo) {
            cardBox.append(el('div', 'memo', card.memo));
          }
          if (card.sentence) {
            cardBox.append(el('div', 'rev-sent', card.sentence));
          }
        }
      } else {
        cardBox.append(el('div', 'rev-head rev-phrase-text', card.text));
        if (isBack) {
          if (card.translation) {
            cardBox.append(el('div', 'rev-gloss', card.translation));
          }
          if (card.memo) {
            cardBox.append(el('div', 'memo', card.memo));
          }
        }
      }
      revPane.append(cardBox);

      const btnBar = el('div', 'rev-btns');
      if (!isBack) {
        const flipBtn = el('button', 'act primary rev-btn');
        flipBtn.type = 'button';
        flipBtn.append('뒤집기', el('span', 'kbd', 'Space'));
        flipBtn.setAttribute('aria-label', '뒤집기 (Space)');
        flipBtn.addEventListener('click', () => {
          cardState = W.nextCardState(cardState, 'flip');
          reviewErr = '';
          draw();
        });
        btnBar.append(flipBtn);
        if (hadFocus) {
          requestAnimationFrame(() => flipBtn.focus());
        }
      } else {
        const againBtn = el('button', 'act rev-btn');
        againBtn.type = 'button';
        againBtn.append('아직', el('span', 'kbd', '1'));
        againBtn.setAttribute('aria-label', '아직 (1)');
        againBtn.addEventListener('click', () => answerReview('again'));

        const knowBtn = el('button', 'act primary rev-btn');
        knowBtn.type = 'button';
        knowBtn.append('알아요', el('span', 'kbd', '2'));
        knowBtn.setAttribute('aria-label', '알아요 (2)');
        knowBtn.addEventListener('click', () => answerReview('know'));

        btnBar.append(againBtn, knowBtn);
        // 뒤집은 뒤 [알아요]에 자동 포커스하지 않는다(포커스는 카드 영역 또는 그대로).
        cardBox.tabIndex = -1;
        if (hadFocus) {
          requestAnimationFrame(() => cardBox.focus());
        }
      }
      revPane.append(btnBar);

      if (reviewErr) {
        const errEl = el('div', 'err', reviewErr);
        errEl.setAttribute('role', 'alert');
        revPane.append(errEl);
      }
    }

    function draw() {
      const isReview = list === 'review';
      const isMine = list === 'mydict';
      const dueCount = reviewData?.counts?.due ?? reviewData?.due?.length ?? 0;
      const c = state || mine ? W.countsAll(state ?? { saved: {}, known: {}, history: [] }, mine) : null;
      W.SUBS.forEach((l, i) => {
        if (l.id === 'review') {
          subBtns[i].replaceChildren(l.title, ...(dueCount > 0 ? [el('span', 'n', String(dueCount))] : []));
        } else {
          const have = l.id === 'mydict' ? mine : state;
          subBtns[i].replaceChildren(l.title, ...(c && have ? [el('span', 'n', String(c[l.id]))] : []));
        }
        subBtns[i].setAttribute('aria-pressed', String(l.id === list));
      });

      revPane.hidden = !isReview;
      ul.hidden = isReview;
      search.hidden = isReview;
      kinds.hidden = isReview || list !== 'phrases' || !state;
      addBar.hidden = isReview || !isMine || !mine;

      if (isReview) {
        status.textContent = '';
        drawReview();
        return;
      }

      const sub = W.SUBS.find((l) => l.id === list);
      const loaded = isMine ? mine : state;
      let rows = [];
      let build = wordRow;
      if (loaded) {
        if (list === 'phrases') [rows, build] = [W.phraseRows(state.phrases, query, phraseKind), phraseRow];
        else if (isMine) [rows, build] = [W.mydictRows(mine, query), mineRow];
        else rows = W.rowsFor(state, list, query);
      }
      const msg = isMine ? mineMessage : message;
      status.textContent = msg || (loaded && !rows.length ? (query.trim() ? '찾는 항목이 없어요' : sub.empty) : '');
      const pc = W.phraseCounts(state?.phrases);
      W.PHRASE_FILTERS.forEach((f, i) => {
        chipBtns[i].replaceChildren(f.title, el('span', 'n', String(pc[f.id])));
        chipBtns[i].setAttribute('aria-pressed', String(f.id === phraseKind));
      });
      addForm.hidden = !adding;
      addErr.textContent = formErr.where === 'add' ? formErr.text : '';
      addToggle.setAttribute('aria-expanded', String(adding));
      ul.replaceChildren(...rows.map(build));
      if (focusMemo) {
        focusMemo = false;
        root.querySelector?.('textarea')?.focus?.();
      }
    }

    async function loadMine() {
      const r = await ctx.send({ type: 'mydict', op: 'get' });
      if (r?.entries) {
        mine = r.entries;
        mineMessage = '';
      } else mineMessage = errText(r, '불러오지 못했어요');
      draw();
    }

    async function loadWords() {
      const r = await ctx.send({ type: 'words', op: 'get' });
      if (r?.known && r.saved && r.history) {
        state = r;
        message = '';
      } else message = errText(r, '불러오지 못했어요');
      draw();
    }

    async function loadReview(preserveState = false) {
      const prevCard = reviewData?.due?.[cardState.index];
      const prevKey = prevCard?.key;
      const prevSide = cardState.side;

      const r = await ctx.send({ type: 'words', op: 'review-queue' });
      if (r?.due && r.counts) {
        reviewData = r;
        if (preserveState && prevKey) {
          const nextIdx = r.due.findIndex((c) => c.key === prevKey);
          if (nextIdx >= 0) {
            cardState = { index: nextIdx, side: prevSide };
          } else {
            cardState = { index: 0, side: 'front' };
          }
        } else {
          cardState = { index: 0, side: 'front' };
        }
        reviewMessage = '';
      } else {
        reviewMessage = errText(r, '복습 목록을 불러오지 못했어요');
      }
      draw();
    }

    draw();
    loadMine();
    loadWords();
    loadReview();
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'words', title: '내 단어', order: 20, render });
})();
