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
  // 마지막 학습 배지(28-19): 오늘이면 "오늘", 지난 날이면 "N일 전 학습", 기록이 없으면 안 보인다.
  function reviewAgeLabel(last, now = Date.now()) {
    if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) return '';
    const then = new Date(last);
    const today = new Date(now);
    const dayNumber = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
    const days = Math.round(dayNumber(today) - dayNumber(then));
    if (days <= 0) return '오늘';
    return `${days}일 전 학습`;
  }

  const counts = (s) => ({ saved: Object.keys(s.saved).length, known: Object.keys(s.known).length, history: s.history.length });

  // 단어장 내보내기(28-24): 형식별 파일 이름·미디어 타입과 다리에 보낼 요청.
  const EXPORT_FORMATS = [
    { id: 'csv', title: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8' },
    { id: 'anki', title: 'Anki', ext: 'txt', mime: 'text/tab-separated-values;charset=utf-8' },
  ];
  function exportFilename(format, now = Date.now()) {
    const d = new Date(now);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const meta = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0];
    return `readgloss-words-${date}.${meta.ext}`;
  }
  const exportRequest = (format) => ({ type: 'words', op: 'export', format });

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

  // 구 기본형(base, 28-15)으로 묶기: 같은 base(대소문자·앞뒤 공백 무시)의 줄은 첫 줄 아래 scenes 로 모은다.
  // base 가 없는 줄(옛 항목·문장)은 그대로 둔다. rows 순서는 첫 줄이 나온 자리를 지킨다.
  function groupByBase(rows) {
    const out = [];
    const groups = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const base = String(row?.base ?? '').replace(/\s+/g, ' ').trim();
      if (!base) {
        out.push(row);
        continue;
      }
      const key = base.toLowerCase();
      const hit = groups.get(key);
      if (hit) {
        hit.scenes.push(row);
        continue;
      }
      const group = { ...row, base, scenes: [] };
      groups.set(key, group);
      out.push(group);
    }
    return out;
  }

  // 구·문장: 최근 저장순. 검색은 원문·맥 번역·문맥 번역·출처 문장 어디든 포함 일치(대소문자 무시). filter: all·expression·sentence.
  // base 가 있으면 기본형으로 묶고, 같은 base 의 다른 장면은 scenes 로 넘긴다(28-15).
  function phraseRows(phrases, query = '', filter = 'all') {
    const q = norm(query).trim();
    const rows = Object.entries(phrases ?? {})
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => b.ts - a.ts)
      .filter((p) => (filter === 'expression' || filter === 'sentence' ? kindOf(p) === filter : true))
      .filter((p) => !q || [p.text, p.translation, p.context?.translation, p.context?.note, p.sentence, p.base].some((f) => norm(f).includes(q)))
      .map((p) => ({
        id: p.id, text: p.text, preview: clip(p.text, 300), translation: p.translation ?? '', context: p.context ?? null,
        kind: kindOf(p), sentence: p.sentence ?? '', primary: phrasePrimary(p), sourceTitle: p.title ?? '', memo: p.memo ?? '',
        title: p.title || hostOf(p.url ?? ''), href: safeHref(p.url ?? ''), ts: p.ts, base: p.base ?? '',
      }));
    return groupByBase(rows);
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

  // ---- 대화 + 빈칸 타이핑 복습(변경 기록 28-20) 순수 함수 ----
  // 대소문자·앞뒤 공백 무시(28-20). 안쪽 공백은 그대로 둔다.
  const typedNorm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

  // 한 글자 바꿈·넣음·뺌만 다른가. 길이가 같으면 바꿈, 1 차이면 넣음/뺌.
  function oneEditApart(a, b) {
    if (a === b) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); // 바꿈
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    if (long.length - short.length !== 1) return false;
    return short.slice(i) === long.slice(i + 1); // 넣음·뺌
  }

  // 입력 판정(28-20): 'ok' | 'almost' | 'wrong'. 여러 정답 중 하나와 같으면 맞음,
  // 네 글자 이상 정답과 한 글자만 다르면 거의 맞음. 짧은 낱말(cat/car)은 거의 맞음으로 치지 않는다.
  function judgeTyped(input, answers) {
    const value = typedNorm(input);
    if (!value) return 'wrong';
    const list = (Array.isArray(answers) ? answers : []).map(typedNorm).filter(Boolean);
    if (list.includes(value)) return 'ok';
    if (list.some((a) => a.length >= 4 && oneEditApart(value, a))) return 'almost';
    return 'wrong';
  }

  // 정답 후보: 다리 answer + 카드 기본형(낱말은 lemma, 구는 base) + 저장 표면형.
  function typedAnswers(card, drill, phraseBase = '') {
    if (!card) return [];
    const isWord = card.type === 'word';
    const base = isWord ? card.lemma || card.key : phraseBase || card.base || '';
    const surface = isWord ? card.word || card.key : card.text;
    return [...new Set([drill?.answer, base, surface].filter((v) => typeof v === 'string' && v.trim()))];
  }

  // 예문에서 정답 자리를 찾아 앞뒤로 가른다(입력칸 자리). 낱말 경계를 지키고(maskWord 와 같은 기준),
  // 첫 출현만 입력칸이 되고 나머지 출현은 ____로 가려서 정답이 화면에 드러나지 않게 한다.
  // 정답이 없으면 문장 뒤에 입력칸을 둔다.
  function blankParts(text, answer) {
    const s = String(text ?? '');
    const w = String(answer ?? '').trim();
    if (!w) return { before: s, after: '', found: false };
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
    const m = re.exec(s);
    if (!m) return { before: s, after: '', found: false };
    const at = m.index;
    return { before: s.slice(0, at), after: s.slice(at + m[0].length).replace(re, '____'), found: true };
  }

  // 한국어 문장에서 표현(뜻) 부분을 초록으로 표시할 자리를 찾는다. 뜻 전체가 없으면 앞 2글자 이상으로 찾는다.
  function koParts(ko, gloss) {
    const text = String(ko ?? '');
    const g = String(gloss ?? '').trim();
    if (!g) return { before: text, expr: '', after: '' };
    for (let n = g.length; n >= 2; n--) {
      const at = text.toLowerCase().indexOf(g.slice(0, n).toLowerCase());
      if (at >= 0) return { before: text.slice(0, at), expr: text.slice(at, at + n), after: text.slice(at + n) };
    }
    return { before: text, expr: '', after: '' };
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

  // ---- 복습 방식(T51d, 변경 기록 27-4) ----
  const REVIEW_MODES = [{ id: 'flip', title: '뒤집기' }, { id: 'choice', title: '고르기' }, { id: 'listen', title: '듣기' }, { id: 'type', title: '빈칸' }];
  // 유형 이름(안내 줄용). 빈칸은 28-20 에서 화면이 붙었다.
  const MODE_TITLES = { flip: '뒤집기', choice: '고르기', listen: '듣기', type: '빈칸' };
  const MODE_ORDER = ['flip', 'choice', 'listen', 'type'];
  // 상자 5 카드에서 아직 못 맞힌 유형(순서: 뒤집기·고르기·듣기·빈칸). modes 에 있는 것만.
  const remainingModes = (modes, passed) => MODE_ORDER.filter((m) => (modes ?? []).includes(m) && !(passed ?? []).includes(m));
  // 이 카드를 실제로 보여 줄 방식(28-19). 상자 5 에서 고른 방식을 이미 맞혔거나 이 카드에 없으면 남은 첫 유형으로 바꾼다.
  // 남은 게 없으면 고른 방식 그대로. 그 밖에는 고른 방식(이 카드에 없으면 뒤집기).
  function cardMode({ chosen, modes, passed, box } = {}) {
    const usable = (modes ?? []).includes(chosen);
    if (box >= 5 && (!usable || (passed ?? []).includes(chosen))) {
      const rest = remainingModes(modes, passed);
      if (rest.length) return rest[0];
    }
    return usable ? chosen : 'flip';
  }
  const CHOICE_MAX = 80; // 보기 글 상한(구 번역은 길어서 자른다)
  const shortChoice = (s) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > CHOICE_MAX ? `${t.slice(0, CHOICE_MAX - 1)}…` : t;
  };
  // 고르기 보기 4개: 정답(그 카드의 뜻) + 단어장 다른 항목의 뜻 3개. 같은 뜻·빈 뜻은 빼고, 같은 종류(낱말·구)를 먼저 쓴다.
  // 3개를 못 채우면 null(그 카드는 뒤집기로). rand 는 시험이 고정한다.
  function quizChoices(card, state, rand = Math.random) {
    const isWord = card?.type === 'word';
    const answer = shortChoice(isWord ? card?.gloss : card?.translation);
    if (!answer) return null;
    const seen = new Set([answer]);
    const same = [];
    const other = [];
    const add = (list, text) => {
      const t = shortChoice(text);
      if (t && !seen.has(t)) {
        seen.add(t);
        list.push(t);
      }
    };
    for (const [k, v] of Object.entries(state?.saved ?? {})) if (!(isWord && k === card.key)) add(isWord ? same : other, v?.gloss);
    for (const [k, v] of Object.entries(state?.phrases ?? {})) if (!(!isWord && k === card.key)) add(isWord ? other : same, v?.translation);
    const pick = (list, n) => {
      const a = [...list];
      const out = [];
      while (a.length && out.length < n) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]);
      return out;
    };
    const wrong = pick(same, 3);
    if (wrong.length < 3) wrong.push(...pick(other, 3 - wrong.length));
    if (wrong.length < 3) return null;
    const all = [{ text: answer, correct: true }, ...wrong.map((text) => ({ text, correct: false }))];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  }
  // 듣기·🔊 로 읽을 글: 낱말 카드는 저장 문장(없으면 낱말), 구 카드는 영어 글
  const listenText = (card) => (card?.type === 'word' ? card.sentence || card.word || card.key || '' : card?.text || '');
  // 브라우저 음성: en-US(맥 Samantha·Google 이름 먼저) > 다른 영어
  function pickVoice(voices) {
    const en = (Array.isArray(voices) ? voices : []).filter((v) => /^en[-_]/i.test(v?.lang ?? ''));
    const us = en.filter((v) => /^en[-_]us$/i.test(v.lang));
    return us.find((v) => /samantha|google/i.test(v.name ?? '')) ?? us[0] ?? en[0] ?? null;
  }
  function speak(text) {
    const syn = globalThis.speechSynthesis;
    const t = String(text ?? '').trim().slice(0, 1000);
    if (!syn || typeof globalThis.SpeechSynthesisUtterance !== 'function' || !t) return false;
    syn.cancel();
    const u = new globalThis.SpeechSynthesisUtterance(t);
    u.lang = 'en-US';
    const v = pickVoice(syn.getVoices?.());
    if (v) u.voice = v;
    u.rate = 0.95;
    syn.speak(u);
    return true;
  }

  globalThis.readglossWords = {
    LISTS, SUBS, formatDate, reviewAgeLabel, counts, countsAll, actionsFor, rowsFor, buttonModel, eventDetail, wordEventDetail, messageFor,
    EXPORT_FORMATS, exportFilename, exportRequest,
    clip, PHRASE_FILTERS, phraseCounts, phrasePrimary, phraseRows, groupByBase, pickWord, lookupDetail, mydictRows, checkMydict, mydictMessage, mydictEventDetail, unsavePhraseMessage, memoMessage,
    memoKey, memoOk, memoErrorText,
    maskWord, nextCardState,
    REVIEW_MODES, MODE_TITLES, remainingModes, cardMode, quizChoices, listenText, pickVoice, speak,
    judgeTyped, typedAnswers, blankParts, koParts,
  };

  // ---- 그리기 ----
  const MESSAGES = { 'bridge-off': '다리가 꺼져 있어요. 터미널에서 node ~/dev/readgloss/bridge/server.mjs 를 실행해 주세요', unauthorized: '다리와 연결하지 못했어요(인증). 확장을 다시 불러와 주세요', 'ext-reloaded': '확장이 새로 로드됐어요. 이 페이지를 새로고침해 주세요', 'http-404': '다리가 이 기능을 아직 몰라요. 다리를 다시 시작해 주세요' };
  const errText = (r, head = '문제가 생겼어요') => MESSAGES[r?.error] ?? `${head}(${r?.error ?? '응답 없음'})`;

  // 패널 껍데기가 정한 토큰(--rg-*)을 쓰고, 껍데기 없이 시험할 때를 위해 밝은/어두운 기본값을 둔다.
  const CSS = `
    .rgw { --w-fg: var(--rg-fg, #1f2328); --w-muted: var(--rg-muted, #656d76); --w-border: var(--rg-border, #e3e6ea); --w-accent: var(--rg-accent, #2f6feb);
      --w-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); --w-ink: var(--rg-accent-ink, #245ac4); --w-err: #b31d28; --w-ok: #116329;
      color: var(--w-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgw { --w-fg: var(--rg-fg, #e6e8eb); --w-muted: var(--rg-muted, #9aa3ad); --w-border: var(--rg-border, #343a44); --w-accent: var(--rg-accent, #6b9bff);
        --w-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); --w-ink: var(--rg-accent-ink, #8db4ff); --w-err: #ff7b72; --w-ok: #3fb950; }
    }
    :host([data-theme="light"]) .rgw { --w-err: #b31d28; --w-ok: #116329; }
    :host([data-theme="dark"]) .rgw { --w-err: #ff7b72; --w-ok: #3fb950; }
    .rgw .subs { display: flex; gap: 4px; flex-wrap: wrap; }
    .rgw button { font: inherit; color: inherit; cursor: pointer; }
    .rgw button:focus-visible, .rgw input:focus-visible, .rgw summary:focus-visible, .rgw a:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
    .rgw .sub { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--w-border); background: none; font-size: 13px; }
    .rgw .sub[aria-pressed="true"] { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-ink); font-weight: 600; }
    .rgw .n { margin-left: 4px; font-variant-numeric: tabular-nums; opacity: .8; }
    .rgw .q { box-sizing: border-box; width: 100%; margin: 10px 0 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--w-border); background: none; color: inherit; font: inherit; }
    .rgw .w-status { color: var(--w-muted); font-size: 13px; padding: 6px 0; word-break: keep-all; overflow-wrap: anywhere; }
    .rgw .exportbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 4px 0 2px; }
    .rgw .exportbar .export-hint { color: var(--w-muted); font-size: 12.5px; }
    .rgw ul { list-style: none; margin: 0; padding: 0; }
    .rgw li { padding: 9px 0; border-top: 1px solid var(--w-border); }
    .rgw .top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .rgw .lemma { font-weight: 700; font-size: 15px; }
    .rgw .gloss { color: var(--w-fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rgw .wrap { white-space: normal; overflow-wrap: anywhere; }
    .rgw .sent { color: var(--w-muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rgw .sent.wrap { white-space: normal; overflow-wrap: anywhere; }
    .rgw .memo { color: var(--w-muted); font-size: 12.5px; margin-top: 3px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .rgw .memo::before { content: "메모 · "; color: var(--w-accent); font-weight: 600; }
    .rgw .exp { color: var(--w-muted); font-size: 12.5px; min-width: 0; overflow-wrap: anywhere; }
    .rgw .meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .rgw .date { color: var(--w-muted); font-size: 12px; margin-right: auto; font-variant-numeric: tabular-nums; }
    .rgw .src { color: var(--w-accent); font-size: 12px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rgw .act { min-height: 24px; padding: 1px 9px; border-radius: 7px; border: 1px solid var(--w-border); background: none; font-size: 12.5px; }
    .rgw .act:hover { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-ink); }
    .rgw .act[disabled] { opacity: .55; cursor: default; }
    .rgw .act.primary { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-ink); font-weight: 600; }
    .rgw .ptext { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 600; overflow-wrap: anywhere; }
    .rgw .ptrans { margin-top: 2px; overflow-wrap: anywhere; }
    .rgw .plabel { margin-top: 4px; color: var(--w-accent); font-size: 12px; font-weight: 700; }
    .rgw .pexp { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .rgw .badge { flex: none; padding: 0 7px; border-radius: 999px; background: var(--w-soft); color: var(--w-ink); font-size: 11.5px; font-weight: 700; }
    .rgw .psent { margin-top: 2px; color: var(--w-muted); font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .rgw .pbase { margin-bottom: 3px; color: var(--w-accent); font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
    .rgw .pscenes { margin: 6px 0 0 10px; border-left: 2px solid var(--w-border); padding-left: 8px; }
    .rgw .pscenes .pscene { padding: 6px 0; border-top: 0; }
    .rgw .pscenes .ptext { font-weight: 400; font-size: 13px; }
    .rgw .kinds { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
    .rgw .chip { min-height: 24px; padding: 1px 9px; border-radius: 999px; border: 1px solid var(--w-border); background: none; font-size: 12.5px; }
    .rgw .chip[aria-pressed="true"] { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-ink); font-weight: 600; }
    .rgw .lk { cursor: text; }
    .rgw .form { display: grid; gap: 6px; padding: 8px 0; }
    .rgw .form label { display: grid; gap: 2px; font-size: 12px; color: var(--w-muted); }
    .rgw .form input { box-sizing: border-box; width: 100%; padding: 4px 8px; border-radius: 7px; border: 1px solid var(--w-border); background: none; color: var(--w-fg); font: inherit; font-size: 13.5px; }
    .rgw .form textarea { box-sizing: border-box; width: 100%; min-height: 44px; padding: 4px 8px; border-radius: 7px; border: 1px solid var(--w-border); background: none; color: var(--w-fg); font: inherit; font-size: 13.5px; resize: vertical; }
    .rgw .btns { display: flex; gap: 6px; justify-content: flex-end; }
    .rgw .err { color: var(--w-err); font-size: 12.5px; overflow-wrap: anywhere; }
    .rgw .addbar { margin: 8px 0 0; }
    .rgw .rev-pane { display: grid; gap: 12px; padding: 10px 0; }
    .rgw .rev-remain { color: var(--w-muted); font-size: 13px; font-weight: 600; }
    .rgw .rev-card { border: 1px solid var(--w-border); border-radius: 10px; padding: 16px; background: none; display: grid; gap: 10px; }
    .rgw .rev-head { font-size: 20px; font-weight: 700; color: var(--w-fg); line-height: 1.3; }
    .rgw .rev-last { color: var(--w-muted); font-size: 12.5px; }
    .rgw .rev-phrase-text { font-size: 16px; }
    .rgw .rev-sent { color: var(--w-fg); font-size: 14px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
    .rgw .rev-gloss { font-size: 16px; font-weight: 600; color: var(--w-accent); }
    .rgw .rev-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
    .rgw .rev-btn { padding: 6px 14px; font-size: 13.5px; border-radius: 8px; }
    .rgw .kbd { display: inline-block; margin-left: 6px; padding: 0 5px; font-size: 11.5px; font-weight: 600; font-family: inherit; border-radius: 4px; border: 1px solid var(--w-border); background: var(--w-soft); color: var(--w-fg); }
    .rgw .rev-done { padding: 24px 0; text-align: center; display: grid; gap: 6px; }
    .rgw .rev-done-title { font-size: 16px; font-weight: 700; color: var(--w-fg); }
    .rgw .rev-done-sub { font-size: 13px; color: var(--w-muted); }
    .rgw .rev-modes { display: flex; gap: 6px; flex-wrap: wrap; }
    .rgw .rev-mode { min-height: 26px; padding: 2px 11px; border-radius: 999px; border: 1px solid var(--w-border); background: none; font-size: 12.5px; }
    .rgw .rev-mode:hover { border-color: var(--w-accent); }
    .rgw .rev-mode[aria-pressed="true"] { background: var(--w-soft); border-color: var(--w-accent); color: var(--w-ink); font-weight: 600; }
    .rgw .rev-tools { display: flex; gap: 6px; flex-wrap: wrap; }
    .rgw .rev-tool { display: inline-flex; align-items: center; gap: 5px; min-width: 28px; min-height: 28px; padding: 2px 9px; }
    .rgw .rev-tool svg { flex: none; width: 16px; height: 16px; }
    .rgw .rev-tool .kbd { margin-left: 1px; }
    .rgw .rev-hint { color: var(--w-muted); font-size: 12.5px; }
    .rgw .rev-listen { color: var(--w-muted); font-size: 14px; }
    .rgw .rev-dialogue { display: grid; gap: 6px; }
    .rgw .rev-bubble { max-width: 92%; padding: 6px 10px; border-radius: 10px; background: var(--w-soft); }
    .rgw .rev-bubble:nth-child(even) { margin-left: auto; }
    .rgw .rev-bubble-en { font-size: 13.5px; line-height: 1.5; color: var(--w-fg); }
    .rgw .rev-bubble-ko { margin-top: 2px; font-size: 12.5px; line-height: 1.5; color: var(--w-muted); }
    .rgw .rev-ko { font-size: 14px; line-height: 1.6; color: var(--w-fg); }
    .rgw .rev-expr { color: var(--w-ok); font-weight: 700; }
    .rgw .rev-typed-sent { font-size: 14px; line-height: 1.9; color: var(--w-fg); overflow-wrap: anywhere; }
    .rgw .rev-type-input { min-width: 7em; max-width: 100%; padding: 1px 6px; border: 0; border-bottom: 2px solid var(--w-accent); background: var(--w-soft); color: var(--w-fg); font: inherit; }
    .rgw .rev-type-input:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
    .rgw .rev-chip { display: inline-block; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--w-border); background: var(--w-soft); font-size: 12.5px; color: var(--w-fg); }
    .rgw .rev-note { color: var(--w-muted); font-size: 12.5px; }
    .rgw .rev-reveal { color: var(--w-ok); font-size: 14px; font-weight: 700; }
    .rgw .rev-choices { display: grid; gap: 6px; }
    .rgw .rev-choices:focus { outline: none; }
    .rgw .rev-choices:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 3px; border-radius: 8px; }
    .rgw .rev-choice { display: flex; align-items: baseline; gap: 6px; text-align: left; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--w-border); background: none; font-size: 13.5px; overflow-wrap: anywhere; }
    .rgw .rev-choice:hover:not([disabled]) { border-color: var(--w-accent); background: var(--w-soft); }
    .rgw .rev-choice.ok { border-color: var(--w-ok); background: color-mix(in srgb, var(--w-ok) 12%, transparent); color: inherit; }
    .rgw .rev-choice.bad { border-color: var(--w-err); background: color-mix(in srgb, var(--w-err) 10%, transparent); color: inherit; }
    .rgw .rev-choice[disabled] { cursor: default; }
    .rgw .rev-choice[disabled]:not(.ok):not(.bad) { opacity: .6; }
    .rgw .rev-mark { flex: none; min-width: 1em; font-weight: 700; }
    .rgw .rev-choice.ok .rev-mark { color: var(--w-ok); }
    .rgw .rev-choice.bad .rev-mark { color: var(--w-err); }
    .rgw [hidden] { display: none !important; }
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
  // 선 아이콘(24 격자, paragraph.js 와 같은 방식). 글자 대신 쓰는 장식이라 읽어 주지 않는다
  function icon(paths) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
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

  // 내보낸 글자를 파일로 내려받는다(Blob + 임시 링크). 패널은 페이지 위에 떠 있어도 문서에 붙여 눌러야 브라우저가 받는다.
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
    let quiz = null; // 고르기: { key, choices(null = 보기 모자람), picked }
    let typing = null; // 빈칸(28-20): { key, value, hint, wrongs, result, held, focus }
    const drillCache = new Map(); // 빈칸: 'word:apple' -> { ok, data }
    const drillPending = new Set();
    let heardFor = ''; // 듣기: 이 카드는 이미 한 번 들려줬다
    let adding = false;
    let editing = null; // 고치는 중인 key
    let draft = { ko: '', note: '' };
    let memoEdit = null; // 메모 고치는 중인 { kind: 'word'|'phrase', key }
    let memoDraft = '';
    let memoErr = '';
    let focusMemo = false;
    let confirming = null; // 한 번 더 눌러야 지워지는 key
    let expandedBase = new Set(); // 기본형으로 묶인 구에서 펼친 줄(28-15)
    let formErr = { where: '', text: '' };
    let selfEvent = false;
    let selfWords = false;
    let exporting = false; // 내보내기 형식 고르는 중
    let exportStatus = ''; // 내보내기 안내(보내는 중·실패)

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
    const status = el('div', 'w-status'); // 껍데기 머리의 .status 규칙이 걸리지 않게 w- 이름
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
    const exportBar = el('div', 'exportbar');
    exportBar.setAttribute('role', 'group');
    exportBar.setAttribute('aria-label', '단어장 내보내기');
    root.append(style, subs, kinds, search, exportBar, status, addBar, revPane, ul);
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

    // 복습 단축키(Space: 뒤집기, 1: 아직, 2: 알아요 · 고르기는 1~4 다음 Space · 듣기는 R 다시 듣기) — 패널 shadow 안에서 입력칸 밖일 때만 동작
    root.addEventListener('keydown', (e) => {
      if (list !== 'review') return;
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      const isInput = target?.matches?.('input, textarea, [contenteditable="true"]') || target?.isContentEditable;
      if (isInput || e.ctrlKey || e.metaKey || e.altKey) return; // 입력칸·브라우저 단축키(Cmd+1 등)는 건드리지 않는다

      const due = reviewData?.due || [];
      if (cardState.index >= due.length) return;
      // 빈칸(28-20)은 입력칸과 [확인]·[힌트] 단추가 직접 처리한다. Space 뒤집기·1/2 단축키를 쓰지 않는다.
      if (shownMode(due[cardState.index]) === 'type') return;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.code === 'KeyR' && !e.shiftKey && shownMode((reviewData?.due || [])[cardState.index]) === 'listen') {
        stop();
        playCard(due[cardState.index]);
        return;
      }
      if (quiz?.choices) {
        // 고르기: 1~4 는 고르기, Space·Enter 는 고른 뒤 다음. 눌러 둔 키(반복)·고르기 전 Space·Enter 는 먹어서
        // 새 카드 첫 보기가 저절로 눌리지 않게 한다. 다만 Tab 으로 간 단추 위의 Space·Enter 는 그 단추를 누른다.
        const pick = /^[1-4]$/.test(e.key);
        const next = e.key === ' ' || e.code === 'Space' || e.key === 'Enter';
        if (!pick && !next) return;
        if (next && !e.repeat && target?.localName === 'button') return void e.stopPropagation(); // 단추 기본 동작은 두고 페이지(유튜브 Space)로만 안 새게
        stop();
        if (e.repeat) return;
        if (pick && quiz.picked < 0) answerChoice(Number(e.key) - 1);
        else if (next && quiz.picked >= 0) nextAfterChoice();
        return;
      }

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
      if (p.base) li.append(el('div', 'pbase', `기본형 · ${p.base}`));
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
      // 같은 기본형의 다른 장면(28-15): 한 줄 아래 펼침. 각 줄은 그 장면 원문·날짜·출처·빼기.
      if (p.scenes?.length) {
        const key = p.base.toLowerCase();
        const open = expandedBase.has(key);
        li.append(btn(open ? `다른 장면 ${p.scenes.length}개 접기` : `다른 장면 ${p.scenes.length}개 펼치기`, () => {
          if (open) expandedBase.delete(key);
          else expandedBase.add(key);
          draw();
        }, 'act', `${p.base} 의 다른 장면 ${p.scenes.length}개 ${open ? '접기' : '펼치기'}`));
        if (open) {
          const ul = el('ul', 'pscenes');
          for (const s of p.scenes) {
            const scene = el('li', 'pscene');
            scene.append(el('span', 'ptext', s.preview ?? s.text));
            const smeta = el('div', 'meta');
            smeta.append(el('span', 'date', W.formatDate(s.ts)));
            if (s.href) {
              const a = el('a', 'src', s.title || s.href);
              a.href = s.href;
              a.target = '_blank';
              a.rel = 'noopener';
              a.title = s.href;
              smeta.append(a);
            }
            smeta.append(btn('빼기', () => removePhrase(s), 'act', `${String(s.preview ?? s.text).slice(0, 30)} 단어장에서 빼기`));
            scene.append(smeta);
            ul.append(scene);
          }
          li.append(ul);
        }
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

    // 이 카드의 복습 상태(마지막 학습 배지용). 복습 목록 카드에는 없어서 단어장 상태에서 찾는다.
    function reviewOf(card) {
      if (!card) return null;
      if (card.review) return card.review;
      return (card.type === 'phrase' ? state?.phrases?.[card.key]?.review : state?.saved?.[card.key]?.review) ?? null;
    }
    // 이 카드에서 지금 화면으로 낼 수 있는 복습 유형(28-19). 고르기는 보기 3개를 만들 수 있을 때만.
    function reviewModesFor(card) {
      return W.REVIEW_MODES.map((m) => m.id).filter((id) => {
        if (id === 'choice') return Boolean(W.quizChoices(card, state));
        if (id === 'type') {
          const base = card?.base ?? state?.phrases?.[card?.key]?.base;
          return card?.type === 'word' ? Boolean(card?.sentence) : Boolean(base);
        }
        return true;
      });
    }
    // 복습 결과(know: 알아요, again: 아직)를 다리 op 'review' 로 보낸다. 저장되면 true.
    async function sendResult(card, result) {
      busy = true;
      const isPhrase = card.type === 'phrase';
      const msg = {
        type: 'words',
        op: 'review',
        ...(isPhrase ? { id: card.key } : { lemma: card.key }),
        result,
        mode: shownMode(card),
        modes: reviewModesFor(card),
      };
      const r = await ctx.send(msg);
      busy = false;
      if (r?.error || !r) {
        reviewErr = '저장하지 못했어요';
        return false;
      }
      reviewErr = '';
      reviewedCount++;
      if (r?.counts) {
        reviewData.counts = r.counts;
      } else if (reviewData?.counts) {
        if (reviewData.counts.due > 0) reviewData.counts.due--;
      }
      return true;
    }
    // 다음 카드로. 다 봤는데 counts.due 가 남았으면(50개 넘게 밀림) 다시 받는다.
    function nextCard() {
      const due = reviewData?.due || [];
      quiz = null;
      cardState = W.nextCardState(cardState, 'next');
      if (cardState.index >= due.length && (reviewData?.counts?.due ?? 0) > 0) {
        loadReview(false);
        return;
      }
      draw();
    }
    // 복습 카드에 답하기(뒤집기·듣기의 1·2)
    async function answerReview(result) {
      if (busy) return;
      const card = (reviewData?.due || [])[cardState.index];
      if (!card) return;
      if (!(await sendResult(card, result))) return draw();
      nextCard();
    }
    // 고르기: 고르면 바로 맞음 = 알아요, 틀림 = 아직으로 저장하고 뒷면을 펼친다. [다음]으로 넘어간다.
    async function answerChoice(k) {
      const card = (reviewData?.due || [])[cardState.index];
      if (busy || !card || !quiz?.choices || quiz.picked >= 0 || !quiz.choices[k]) return;
      quiz.picked = k;
      if (!(await sendResult(card, quiz.choices[k].correct ? 'know' : 'again'))) {
        quiz.picked = -1;
        return draw();
      }
      cardState = { ...cardState, side: 'back' };
      draw();
    }
    const nextAfterChoice = () => !busy && nextCard();
    // 이 카드를 지금 보여 주는 방식(고르기 보기 모자람·상자 5 남은 유형 반영). 결과에도 이 값을 보낸다.
    function shownMode(card) {
      const m = W.cardMode({ chosen: reviewMode(), modes: reviewModesFor(card), passed: card?.passed, box: card?.box });
      return m;
    }
    const reviewMode = () => (W.REVIEW_MODES.some((m) => m.id === ctx.settings?.reviewMode) ? ctx.settings.reviewMode : 'flip');
    // 장면(영상 주소 + t 또는 clip): 지금 그 영상 페이지면 그 자리에서, 아니면 새 탭에서 그 구간만(27-4)
    async function openScene(scene) {
      if (globalThis.readglossVideoUi?.playScene?.(scene)) return;
      // 연습 페이지 장면(28-23)은 자막 파일을 다시 골라야 해서 새 탭으로 열 수 없다: 안내만 한다.
      if (/^https?:/i.test(String(scene.id))) {
        reviewErr = '연습 페이지에서 파일을 다시 골라 주세요';
        draw();
        return;
      }
      const c = scene.clip ?? { start: scene.t, end: scene.t + 8 };
      const r = await ctx.send({ type: 'video-open', url: scene.url, clip: { id: scene.id, start: c.start, end: c.end } });
      if (r?.error) {
        reviewErr = '영상을 열지 못했어요';
        draw();
      }
    }
    // 듣기: 같은 영상이면 장면 소리, 아니면 브라우저 음성
    function playCard(card) {
      if (!card) return;
      const scene = globalThis.readglossVideo?.sceneOf?.(card);
      if (scene && globalThis.readglossVideoUi?.playScene?.(scene)) return;
      W.speak(W.listenText(card));
    }

    // ---- 빈칸 타이핑 복습(28-20) ----
    const drillKeyOf = (card) => `${card?.type ?? ''}:${card?.key ?? ''}`;
    const phraseBaseOf = (card) => (card?.type === 'phrase' ? state?.phrases?.[card.key]?.base ?? card?.base ?? '' : '');
    const drillData = (card) => {
      const hit = drillCache.get(drillKeyOf(card));
      return hit?.ok ? hit.data : null;
    };
    // 다리 요청: 낱말은 lemma·저장 문장, 구는 text·기본형. 뜻이 없으면 대화를 만들 수 없어 저장 문장 빈칸으로 간다.
    function drillRequestFor(card) {
      if (!card) return null;
      const isWord = card.type === 'word';
      const gloss = String((isWord ? card.gloss : card.translation) ?? '').trim();
      if (!gloss) return null;
      const sentence = isWord ? card.sentence : phraseBaseOf(card);
      return {
        type: 'review-drill',
        key: String(card.key),
        ...(isWord ? { lemma: String(card.lemma || card.key) } : { text: String(card.text || '') }),
        gloss,
        ...(sentence && { sentence: String(sentence) }),
      };
    }
    // 카드마다 한 번만 다리에 묻는다. 실패해도 그 카드는 저장 문장 빈칸으로 계속 쓸 수 있다.
    function ensureDrill(card) {
      const key = drillKeyOf(card);
      if (!card || drillCache.has(key) || drillPending.has(key)) return;
      const req = drillRequestFor(card);
      if (!req) {
        drillCache.set(key, { ok: false });
        return;
      }
      drillPending.add(key);
      ctx.send(req).then(
        (r) => drillCache.set(key, { ok: Boolean(r && Array.isArray(r.dialogue) && typeof r.en === 'string' && typeof r.answer === 'string' && r.answer), data: r }),
        () => drillCache.set(key, { ok: false }),
      ).finally(() => {
        drillPending.delete(key);
        if (root.isConnected) draw();
      });
    }
    // 다리가 실패했을 때 쓰는 저장 문장 빈칸: 낱말은 저장 표면형, 구는 기본형(없으면 저장 글)을 가린다.
    function fallbackTyped(card) {
      const isWord = card?.type === 'word';
      const text = isWord ? String(card?.sentence ?? '') : String(card?.text ?? '');
      const base = isWord ? String(card?.word || card?.lemma || card?.key || '') : phraseBaseOf(card);
      const answer = base && (isWord || text.includes(base)) ? base : text;
      return { text, answer };
    }
    function typedSentence(card, parts, placeholder = '빈칸에 들어갈 표현') {
      const line = el('div', 'rev-typed-sent');
      if (parts.before) line.append(el('span', '', parts.before));
      const input = el('input', 'rev-type-input');
      input.type = 'text';
      input.value = typing?.value ?? '';
      input.maxLength = 120;
      input.placeholder = placeholder;
      input.setAttribute('aria-label', '빈칸에 들어갈 표현');
      input.addEventListener('input', () => {
        if (typing) typing.value = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.isComposing || e.key !== 'Enter') return;
        e.stopPropagation();
        if (typing?.result === 'almost') nextCard();
        else submitTyped(card);
      });
      line.append(input);
      if (parts.after) line.append(el('span', '', parts.after));
      if (typing?.focus) {
        typing.focus = false;
        requestAnimationFrame(() => {
          input.focus();
          const end = input.value.length;
          input.setSelectionRange?.(end, end);
        });
      }
      return line;
    }
    // 판정 흐름(28-20): 맞음 = 알아요(type) · 거의 맞음 = 정답 보이고 hold · 첫 번째 틀림 = 첫 글자 보이고 다시 · 두 번째 = 아직.
    async function submitTyped(card) {
      if (busy || !typing || typing.result === 'almost') return;
      const value = String(typing.value ?? '').trim();
      if (!value) {
        typing.focus = true;
        return draw();
      }
      const drill = drillData(card);
      const verdict = W.judgeTyped(value, W.typedAnswers(card, drill, phraseBaseOf(card)));
      if (verdict === 'ok') {
        if (await sendResult(card, 'know')) nextCard();
        else draw();
        return;
      }
      if (verdict === 'almost') {
        typing.result = 'almost';
        if (!typing.held) {
          typing.held = true;
          if (!(await sendResult(card, 'hold'))) {
            typing.result = '';
            typing.held = false;
          }
        }
        return draw();
      }
      typing.wrongs += 1;
      if (typing.wrongs >= 2) {
        if (await sendResult(card, 'again')) nextCard();
        else draw();
        return;
      }
      typing.hint = true;
      typing.focus = true;
      typing.value = '';
      draw();
    }

    // 복습 화면 그리기
    function drawReview() {
      // 자동 포커스는 "그 직전에 포커스가 이미 이 복습 보기(패널 shadow) 안에 있었을 때"만 한다.
      const activeEl = root.getRootNode?.()?.activeElement;
      const hadFocus = Boolean(activeEl && root.contains(activeEl));

      revPane.replaceChildren();

      if (reviewMessage) {
        revPane.append(el('div', 'w-status', reviewMessage));
        return;
      }

      // 복습 방식 고르기(27-4): 뒤집기 · 고르기 · 듣기
      const mode = reviewMode();
      const modeBar = el('div', 'rev-modes');
      modeBar.setAttribute('role', 'group');
      modeBar.setAttribute('aria-label', '복습 방식');
      for (const m of W.REVIEW_MODES) {
        const b = btn(m.title, () => {
          if (m.id === mode) return;
          const answered = quiz?.picked >= 0; // 고르기에서 이미 답한 카드는 결과가 저장됐다: 같은 카드를 다시 답하지 않게 다음으로
          ctx.setSettings({ reviewMode: m.id });
          reviewErr = '';
          if (answered) return nextCard();
          quiz = null;
          typing = null;
          cardState = { ...cardState, side: 'front' };
          draw();
        }, 'rev-mode', `복습 방식: ${m.title}`);
        b.setAttribute('aria-pressed', String(m.id === mode));
        modeBar.append(b);
      }
      revPane.append(modeBar);

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
      const cardKey = `${card.type}:${card.key}:${curIndex}`;
      const shown = shownMode(card);
      // 고르기를 골랐지만 이 카드에서 보기를 못 만들어(또는 아직 단어장이 안 와서) 뒤집기로 바꾼 경우.
      // 상자 5 에서 남은 유형이 뒤집기라 바꾼 경우는 여기 들지 않는다(그때는 진짜 뒤집기 화면).
      const choiceFellBack = mode === 'choice' && shown === 'flip' && !reviewModesFor(card).includes('choice');
      if (shown === 'choice' || choiceFellBack) {
        // 보기는 단어장(GET /words)이 와야 만든다. 아직이면 기다렸다가 다시 만든다.
        // 답하기 전 단어장이 바뀌어 화면 방식이 달라지면 다시 만든다(화면 = 기록).
        if (quiz?.key !== cardKey || (quiz.waiting && state) || (!quiz.waiting && quiz.picked < 0 && Boolean(quiz.choices) !== (shown === 'choice'))) quiz = { key: cardKey, choices: state ? W.quizChoices(card, state) : null, picked: -1, waiting: !state };
      } else quiz = null;
      const choosing = Boolean(quiz?.choices);
      const listening = shown === 'listen';
      const isTyping = shown === 'type';
      if (isTyping && typing?.key !== cardKey) typing = { key: cardKey, value: '', hint: false, wrongs: 0, result: '', held: false, focus: false };
      if (!isTyping && typing?.key !== cardKey) typing = null;
      if (isTyping) {
        ensureDrill(card);
        if (hadFocus) typing.focus = true;
      }
      const scene = globalThis.readglossVideo?.sceneOf?.(card) ?? null;
      const remaining = due.length - curIndex;
      revPane.append(el('div', 'rev-remain', `남은 ${remaining}`));

      const cardBox = el('div', 'rev-card');
      const isWord = card.type === 'word';
      const isBack = cardState.side === 'back';
      // 상자 5 에서 고른 방식을 이미 맞혀 다른 유형으로 바뀌었으면 남은 유형을 알린다(28-19)
      if (shown !== mode && card.box >= 5) {
        const rest = W.remainingModes(reviewModesFor(card), card.passed);
        if (rest.length) cardBox.append(el('div', 'rev-last', `남은 유형: ${rest.map((m) => W.MODE_TITLES[m]).join('·')}`));
      }
      const lastLabel = W.reviewAgeLabel(reviewOf(card)?.last);
      if (lastLabel) cardBox.append(el('div', 'rev-last', lastLabel));

      if (isTyping) {
        // 앞면 = 대화 말풍선 → 한국어 문장(표현 부분 초록) → 영어 예문 빈칸. 다리가 실패하면 저장 문장 빈칸으로.
        const drill = drillData(card);
        const fallback = fallbackTyped(card);
        const answer = String(drill?.answer || fallback.answer || '').trim();
        if (drill) {
          const dialogue = el('div', 'rev-dialogue');
          for (const line of drill.dialogue) {
            const bubble = el('div', 'rev-bubble');
            bubble.append(el('div', 'rev-bubble-en', line.en), el('div', 'rev-bubble-ko', line.ko));
            dialogue.append(bubble);
          }
          cardBox.append(dialogue);
          const parts = W.koParts(drill.ko, isWord ? card.gloss : card.translation);
          const koLine = el('div', 'rev-ko');
          if (parts.before) koLine.append(el('span', '', parts.before));
          if (parts.expr) koLine.append(el('span', 'rev-expr', parts.expr));
          if (parts.after) koLine.append(el('span', '', parts.after));
          cardBox.append(koLine);
        } else if (drillPending.has(drillKeyOf(card))) {
          cardBox.append(el('div', 'rev-note', '대화를 준비하는 중…'));
        }
        cardBox.append(typedSentence(card, W.blankParts(drill?.en || fallback.text, answer)));
        const gloss = isWord ? card.gloss : card.translation;
        if (gloss) {
          const chipLine = el('div');
          chipLine.append(el('span', 'rev-chip', gloss));
          cardBox.append(chipLine);
        }
        if (typing.result === 'almost') cardBox.append(el('div', 'rev-reveal', `거의 맞음 — 정답: ${answer}`));
        else if (typing.hint) cardBox.append(el('div', 'rev-note', `힌트: ${answer.slice(0, 1)}… 한 번 더 입력해 보세요`));
      } else if (listening && !isBack) {
        cardBox.append(el('div', 'rev-listen', '들은 말을 떠올려 보세요'));
        // 처음 보일 때 한 번 들려준다(복습 보기가 화면에 보일 때만 — 패널을 열면 모든 탭이 그려진다)
        if (heardFor !== cardKey && list === 'review' && root.isConnected && root.offsetParent !== null && getComputedStyle(root).visibility !== 'hidden') {
          heardFor = cardKey;
          requestAnimationFrame(() => playCard(card));
        }
      } else if (isWord) {
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
      // 소리: [소리](브라우저 음성, 듣기에서는 장면 먼저) · [장면](영상 장면이 있는 카드). 아이콘은 Lucide(ISC) volume-2 · play
      // 빈칸 타이핑(28-20)에서는 정답을 읽어 주지 않도록 [소리]를 두지 않고 [힌트]를 둔다.
      const tools = el('div', 'rev-tools');
      if (isTyping) {
        const b = btn('힌트', () => {
          typing.hint = true;
          typing.focus = true;
          draw();
        }, 'act rev-tool', '힌트: 첫 글자 보기');
        b.title = '힌트: 첫 글자 보기';
        tools.append(b);
      }
      if (!isTyping && W.speak && globalThis.speechSynthesis) {
        const b = btn('', () => (listening ? playCard(card) : W.speak(W.listenText(card))), 'act rev-tool', listening ? '다시 듣기 (R)' : '소리 내어 읽기');
        b.title = listening ? '다시 듣기 (R)' : '소리 내어 읽기';
        b.append(icon(['M11 5 6 9H2v6h4l5 4V5z', 'M15.54 8.46a5 5 0 0 1 0 7.07', 'M19.07 4.93a10 10 0 0 1 0 14.14']));
        if (listening) b.append('다시 듣기', el('span', 'kbd', 'R'));
        tools.append(b);
      }
      if (scene) {
        // 새 탭을 여는 단추라 페이지 스크립트의 .click() 은 무시한다(패널 shadow 는 open, panel.js 의 AI 단추와 같은 방식)
        const b = btn('', (e) => e.isTrusted !== false && openScene(scene), 'act rev-tool', '원래 영상 장면 듣기');
        b.append(icon(['M6 3l14 9-14 9V3z']), isTyping ? '장면 듣기' : '장면');
        tools.append(b);
      }
      if (tools.childElementCount) cardBox.append(tools);
      revPane.append(cardBox);

      const btnBar = el('div', 'rev-btns');
      if (isTyping) {
        // 빈칸: 확인(Enter) · 거의 맞음이면 정답을 보인 뒤 다음. 포커스는 입력칸에 둔다.
        const b = el('button', 'act primary rev-btn');
        b.type = 'button';
        const next = typing.result === 'almost';
        b.append(next ? '다음' : '확인', el('span', 'kbd', 'Enter'));
        b.setAttribute('aria-label', next ? '다음 (Enter)' : '확인 (Enter)');
        b.addEventListener('click', () => (next ? nextCard() : submitTyped(card)));
        btnBar.append(b);
      } else if (choosing) {
        // 고르기: 보기 4개(1~4). 고른 뒤에는 맞음·틀림을 색과 표시(✓ 정답 · ✕ 내 답)로 보이고 [다음]
        const box = el('div', 'rev-choices');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', '뜻 고르기 (1~4)');
        box.tabIndex = -1; // 새 카드에서 포커스는 묶음에: 첫 보기에 두면 Enter·Space 한 번에 그 보기가 골라진다
        const answered = quiz.picked >= 0;
        quiz.choices.forEach((c, k) => {
          const b = btn('', () => answerChoice(k), 'rev-choice', `${k + 1}번 ${c.text}`);
          const mark = answered && c.correct ? '✓' : answered && k === quiz.picked ? '✕' : '';
          const m = el('span', 'rev-mark', mark);
          m.setAttribute('aria-hidden', 'true');
          b.append(m, el('span', '', `${k + 1}. ${c.text}`));
          if (answered) {
            b.disabled = true;
            if (c.correct) {
              b.classList.add('ok');
              b.setAttribute('aria-label', `정답${k === quiz.picked ? '(내 답)' : ''}: ${k + 1}번 ${c.text}`);
            } else if (k === quiz.picked) {
              b.classList.add('bad');
              b.setAttribute('aria-label', `내 답(틀림): ${k + 1}번 ${c.text}`);
            }
          }
          box.append(b);
        });
        revPane.append(box);
        if (answered) {
          const right = quiz.choices[quiz.picked].correct;
          const text = `${right ? '맞았어요' : '아직이에요'} · 다음`;
          const nextBtn = el('button', 'act primary rev-btn');
          nextBtn.type = 'button';
          nextBtn.append(text, el('span', 'kbd', 'Space'));
          nextBtn.setAttribute('aria-label', `${text} (Space)`);
          nextBtn.addEventListener('click', nextAfterChoice);
          btnBar.append(nextBtn);
          if (hadFocus) requestAnimationFrame(() => nextBtn.focus());
        } else if (hadFocus) requestAnimationFrame(() => box.focus());
      } else if (!isBack) {
        if (choiceFellBack) revPane.append(el('div', 'rev-hint', quiz?.waiting ? '보기를 준비하는 중…' : '보기를 만들 단어가 모자라서 뒤집기로 볼게요'));
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

    async function doExport(format) {
      const meta = W.EXPORT_FORMATS.find((f) => f.id === format) ?? W.EXPORT_FORMATS[0];
      exportStatus = '내보내는 중…';
      draw();
      const r = await ctx.send(W.exportRequest(meta.id));
      if (typeof r?.text !== 'string') {
        exporting = false;
        exportStatus = '';
        message = errText(r, '내보내지 못했어요');
        draw();
        return;
      }
      downloadText(W.exportFilename(meta.id), r.text, meta.mime);
      exporting = false;
      exportStatus = '';
      message = `${meta.title} 파일을 내려받았어요`;
      draw();
    }

    function drawExport(isReview) {
      const have = !isReview && Boolean(state);
      exportBar.hidden = !have;
      if (!have) {
        exportBar.replaceChildren();
        return;
      }
      if (!exporting) {
        exportBar.replaceChildren(btn('내보내기', () => { exporting = true; exportStatus = ''; draw(); }, 'act', '단어장 내보내기: CSV 또는 Anki 형식 고르기'));
        return;
      }
      const parts = [el('span', 'export-hint', '형식:')];
      for (const f of W.EXPORT_FORMATS) {
        parts.push(btn(f.title, () => doExport(f.id), f.id === 'csv' ? 'act primary' : 'act', `${f.title} 형식으로 내려받기`));
      }
      parts.push(btn('취소', () => { exporting = false; exportStatus = ''; draw(); }, 'act', '내보내기 취소'));
      if (exportStatus) parts.push(el('span', 'export-hint', exportStatus));
      exportBar.replaceChildren(...parts);
    }

    function draw() {
      const isReview = list === 'review';
      const isMine = list === 'mydict';
      const dueCount = reviewData?.counts?.due ?? reviewData?.due?.length ?? 0;
      const c = state || mine ? W.countsAll(state ?? { saved: {}, known: {}, history: [] }, mine) : null;
      drawExport(isReview);
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
