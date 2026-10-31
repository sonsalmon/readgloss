// 패널 [영상] 탭(변경 기록 27-5·28-12): 유튜브에서만 등록한다.
// 작은 탭 셋 [자막 · 나의 표현 · 풀이]. 자막은 대본·거르기·칠하기, 나의 표현은 이 영상에서 저장한 낱말·구,
// 풀이는 지금 줄 앞뒤 두 줄을 문맥으로 한 AI 카드다.
// 자막 층(video-subs.js)이 내놓은 globalThis.readglossVideoUi 를 읽고 부르기만 한다. 판단은 아래 순수 함수와 video-core.js 가 한다.
// 패널의 탭들은 shadow root 하나를 같이 쓴다: 이 탭 CSS 는 모두 .rgv 아래로 묶고 이름에 v- 를 붙여 다른 탭과 서로 새지 않게 한다.
(() => {
  const V = globalThis.readglossVideo;
  const Sel = globalThis.readglossSelection;
  const Marks = globalThis.readglossSavedMarksCore;

  // ---- 순수 함수: 패널 목록의 거르기·표현 고르기·표현이 든 줄 찾기 ----
  // 자막 층과 달리 패널 대본은 구간 거르기 없이 S.hard 전부를 칠한다(28-9·28-12).
  const PANEL_BANDS = Object.freeze({ easy: true, medium: true, hard: true });
  const PANEL_FILTERS = Object.freeze([
    { id: 'all', title: '전체' },
    { id: 'learning', title: '학습 표현 포함' },
    { id: 'saved', title: '저장됨' },
  ]);
  const EXPR_FILTERS = Object.freeze([
    { id: 'all', title: '전체' },
    { id: 'new', title: '복습 전' },
    { id: 'doing', title: '복습 중' },
    { id: 'done', title: '끝' },
  ]);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const hardAt = (hard, word) => (hard instanceof Map ? hard.get(word) : isObj(hard) && Object.hasOwn(hard, word) ? hard[word] : undefined);
  const hasForm = (forms, word) => Boolean(forms && typeof forms.has === 'function' && forms.has(word));
  const formLemma = (forms, word) => (forms && typeof forms.get === 'function' ? forms.get(word) ?? word : word);
  const findPhraseId = (phrases, text) => {
    if (typeof Sel?.findPhrase === 'function') return Sel.findPhrase(phrases, text);
    return Object.entries(isObj(phrases) ? phrases : {}).find(([, p]) => p?.text === text)?.[0] ?? null;
  };
  // 한 낱말의 칠: 복습 끝(초록) > 고른 구간(주황) > 저장만 됨(✓). 패널은 모든 구간을 고른 것으로 본다.
  function wordColor(lower, data) {
    const h = hardAt(data?.hard, lower);
    const saved = hasForm(data?.forms, lower);
    const done = data?.done?.has?.(formLemma(data?.forms, lower)) === true;
    const color = V ? V.tokenColor({ p: h?.p, bands: PANEL_BANDS, saved, done, known: false }) : null;
    // 어려운 단어로 잡혔는데 확률 p 가 없는 옛 응답도 패널은 주황으로 칠한다(구간 거르기 없이 S.hard 전부).
    return color || (h ? 'orange' : null);
  }
  // 대본 한 줄의 거르기 표시: 학습 표현(주황·초록 낱말 또는 저장한 구)이 있는지, 이 줄을 ☆ 저장했는지.
  function panelLineFlags(cue, data) {
    const text = String(cue?.text ?? '');
    const tokens = V ? V.tokenize(text) : [];
    let learning = false;
    for (const tk of tokens) {
      if (!tk?.w) continue;
      const color = wordColor(tk.lower, data);
      if (color === 'orange' || color === 'green') {
        learning = true;
        break;
      }
    }
    if (!learning && V && V.phraseSpans(tokens, data?.phrases ?? {}).length) learning = true;
    return { learning, saved: findPhraseId(data?.phrases, text) !== null };
  }
  function passesFilter(flags, filter) {
    if (filter === 'learning') return flags?.learning === true;
    if (filter === 'saved') return flags?.saved === true;
    return true;
  }
  // 복습 단계: 아직 한 번도 안 봄(복습 전) · 1~4상자(복습 중) · done(끝)
  function stageOf(review) {
    if (review?.done === true) return 'done';
    if (!isObj(review) || !(Number(review.count) > 0)) return 'new';
    return 'doing';
  }
  const stageText = (expr) => {
    if (expr?.stage === 'done') return '끝';
    if (expr?.stage === 'doing') return `복습 중 · ${Number(expr.box) || 1}상자`;
    return '복습 전';
  };
  // base(28-15)로 묶기: panel-words 의 순수 함수를 쓴다(먼저 로드된다). 없으면(시험에서 단독 로드) 그대로 둔다.
  const groupExpressions = (rows) => (typeof globalThis.readglossWords?.groupByBase === 'function' ? globalThis.readglossWords.groupByBase(rows) : rows);
  // 이 영상 주소(같은 v)로 저장한 낱말·구. 저장한 문장 줄은 나의 표현이 아니므로 뺀다.
  // 구의 기본형은 저장할 때 남긴 base(28-15), 없으면 그 장면 원문이다.
  function videoExpressions(library, id) {
    const out = [];
    if (!id || !V) return out;
    const saved = isObj(library?.saved) ? library.saved : {};
    const phrases = isObj(library?.phrases) ? library.phrases : {};
    for (const [lemma, item] of Object.entries(saved)) {
      if (V.videoIdOf(item?.url) !== id) continue;
      const review = isObj(item.review) ? item.review : null;
      out.push({
        type: 'word', key: lemma, title: lemma, text: String(item.word || lemma), gloss: String(item.gloss || ''),
        stage: stageOf(review), box: Number(review?.box) || 0, url: item.url,
      });
    }
    for (const [pid, item] of Object.entries(phrases)) {
      if (!isObj(item) || item.kind === 'sentence') continue;
      if (V.videoIdOf(item.url) !== id) continue;
      const review = isObj(item.review) ? item.review : null;
      out.push({
        type: 'phrase', key: pid, title: String(item.base || item.text || ''), text: String(item.text || ''),
        base: String(item.base || ''), gloss: String(item.translation || ''), stage: stageOf(review), box: Number(review?.box) || 0, url: item.url,
      });
    }
    return groupExpressions(out).sort((a, b) => a.title.localeCompare(b.title));
  }
  // 그 표현이 들은 이 영상 줄 번호들. 낱말은 저장 단어의 흔한 활용형까지(saved-marks-core), 구는 글자 무시 대조.
  // base 로 묶인 구는 같은 기본형의 다른 장면 원문도 함께 찾는다(28-15).
  function expressionLines(cues, expr) {
    const list = Array.isArray(cues) ? cues : [];
    const out = [];
    if (!V) return out;
    if (expr?.type === 'word') {
      const forms = Marks?.buildFormSet?.([String(expr.key || expr.title || expr.text || '')]) ?? new Map();
      list.forEach((c, i) => {
        if (Marks?.findSavedTokens?.(c?.text, forms).length) out.push(i);
      });
      return out;
    }
    const texts = [expr?.text, expr?.title, ...(Array.isArray(expr?.scenes) ? expr.scenes.flatMap((s) => [s?.text, s?.title]) : [])]
      .map((s) => String(s || ''))
      .filter(Boolean);
    if (!texts.length) return out;
    const spans = texts.map((text) => ({ text }));
    list.forEach((c, i) => {
      if (V.phraseSpans(V.tokenize(c?.text), spans).length) out.push(i);
    });
    return out;
  }

  globalThis.readglossVideoPanel = {
    PANEL_BANDS, PANEL_FILTERS, EXPR_FILTERS, wordColor, panelLineFlags, passesFilter, stageOf, stageText, videoExpressions, expressionLines,
  };

  // 지원 사이트(유튜브·넷플릭스·로컬 연습 페이지 28-23)에서 [영상] 탭을 붙인다. 판정은 video-core adapterFor 가 한다.
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  if (!V || !Sel) return;
  const SITE = V.adapterFor?.(location);
  if (!SITE) return;
  const isPractice = SITE.name === 'practice';
  const PAGE_HINT = isPractice ? '연습 페이지에서 자막 파일을 골라 주세요' : `${SITE.label} 영상 페이지에서 보여요`;

  const FOLLOW_MS = 3000; // 사용자가 대본을 스크롤하면 이만큼은 지금 줄을 따라가지 않는다
  const SMALL_TABS = Object.freeze([
    { id: 'script', title: '자막' },
    { id: 'expressions', title: '나의 표현' },
    { id: 'explain', title: '풀이' },
  ]);

  const CSS = `
    .rgv { --v-fg: var(--rg-fg, #1f2328); --v-muted: var(--rg-muted, #656d76); --v-border: var(--rg-border, #e3e6ea); --v-accent: var(--rg-accent, #2f6feb);
      --v-soft: var(--rg-accent-soft, rgba(47,111,235,.10)); --v-ink: var(--rg-accent-ink, #245ac4);
      --v-orange: #b4451f; --v-green: #116329;
      color: var(--v-fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .rgv { --v-fg: var(--rg-fg, #e6e8eb); --v-muted: var(--rg-muted, #9aa3ad); --v-border: var(--rg-border, #343a44); --v-accent: var(--rg-accent, #6b9bff);
        --v-soft: var(--rg-accent-soft, rgba(107,155,255,.14)); --v-ink: var(--rg-accent-ink, #8db4ff);
        --v-orange: #ffa26b; --v-green: #3fb950; }
    }
    .rgv button { box-sizing: border-box; margin: 0; font: inherit; color: inherit; background: none; cursor: pointer; }
    .rgv button:focus-visible { outline: 2px solid var(--v-accent); outline-offset: 2px; }
    .rgv .v-title { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
    .rgv .v-info, .rgv .v-status { color: var(--v-muted); font-size: 12.5px; font-weight: 400; }
    .rgv .v-tools { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .rgv .v-act { min-height: 28px; padding: 3px 12px; border-radius: 7px; border: 1px solid var(--v-border); font-size: 12.5px; font-weight: 400; }
    .rgv .v-act:hover { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-ink); }
    .rgv .v-act[aria-pressed="true"], .rgv .v-act[aria-selected="true"] { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-ink); font-weight: 600; }
    .rgv .v-subtabs { display: flex; gap: 4px; margin: 2px 0 10px; border-bottom: 1px solid var(--v-border); }
    .rgv .v-subtab { min-height: 32px; padding: 3px 10px; border: 0; border-bottom: 2px solid transparent; border-radius: 7px 7px 0 0;
      color: var(--v-muted); font-size: 13px; }
    .rgv .v-subtab:hover { background: var(--v-soft); color: var(--v-ink); }
    .rgv .v-subtab[aria-selected="true"] { background: var(--v-soft); border-bottom-color: var(--v-accent); color: var(--v-ink); font-weight: 700; }
    .rgv .v-filters { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 8px; }
    .rgv .v-fchip { min-height: 26px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--v-border); font-size: 12.5px; }
    .rgv .v-fchip:hover { border-color: var(--v-accent); background: var(--v-soft); }
    .rgv .v-fchip[aria-pressed="true"] { background: var(--v-soft); border-color: var(--v-accent); color: var(--v-ink); font-weight: 600; }
    .rgv .v-hard { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }
    /* 1분 라운드(28-14): 맨 위 라운드 줄과, 라운드가 끝났을 때의 어려운 낱말 칩 줄 */
    .rgv .v-rounds { margin: 2px 0 10px; }
    .rgv .v-roundline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 7px; border: 1px solid transparent; }
    .rgv .v-roundline.v-live { background: var(--v-soft); border-color: var(--v-accent); }
    .rgv .v-roundtext { font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .rgv .v-roundline .v-act { min-height: 26px; padding: 2px 9px; }
    .rgv .v-roundchips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
    .rgv .v-chip { min-height: 26px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--v-border); font-size: 12.5px; text-align: left; }
    .rgv .v-chip:hover { border-color: var(--v-accent); background: var(--v-soft); }
    .rgv .v-chip .v-g { color: var(--v-muted); }
    .rgv .v-empty { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 8px 0; padding: 10px 2px; color: var(--v-muted); font-size: 13px; }
    .rgv .v-list { list-style: none; margin: 0; padding: 0; }
    .rgv .v-row { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: start; margin: 0; padding: 6px 4px; border-top: 1px solid var(--v-border); border-radius: 6px; }
    .rgv .v-row:hover:not(.v-cur) { background: color-mix(in srgb, var(--v-soft) 50%, transparent); }
    .rgv .v-row.v-cur { background: var(--v-soft); }
    .rgv .v-t { min-width: 40px; min-height: 24px; padding: 0 4px; border: 0; border-radius: 5px; color: var(--v-ink); font-size: 12px; font-variant-numeric: tabular-nums; }
    .rgv .v-txt { min-width: 0; cursor: pointer; overflow-wrap: anywhere; font-weight: 400; }
    .rgv .v-txt:hover .v-en { text-decoration: underline; text-underline-offset: 2px; }
    .rgv .v-ko { color: var(--v-muted); font-size: 12.5px; }
    .rgv .v-or { color: var(--v-orange); font-weight: 600; }
    .rgv .v-gr { color: var(--v-green); font-weight: 600; }
    .rgv .v-chk::after { content: '✓'; margin-left: .12em; color: var(--v-green); font-size: .85em; }
    .rgv .v-star { min-width: 28px; min-height: 28px; padding: 0; border: 0; border-radius: 6px; color: var(--v-ink); font-size: 15px; line-height: 1; }
    .rgv .v-star:hover { background: var(--v-soft); }
    .rgv .v-pane { display: block; }
    .rgv .v-exlist { list-style: none; margin: 0; padding: 0; }
    .rgv .v-ex { border-top: 1px solid var(--v-border); padding: 5px 2px; }
    .rgv .v-exrow { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; min-height: 28px;
      padding: 4px 6px; border: 0; border-radius: 6px; text-align: left; }
    .rgv .v-exrow:hover { background: var(--v-soft); }
    .rgv .v-exrow[aria-expanded="true"] { background: var(--v-soft); }
    .rgv .v-extitle { font-weight: 700; overflow-wrap: anywhere; }
    .rgv .v-exgloss { color: var(--v-muted); font-size: 12.5px; overflow-wrap: anywhere; }
    .rgv .v-exmeta { color: var(--v-muted); font-size: 12px; }
    .rgv .v-exlines { list-style: none; margin: 2px 0 4px; padding: 0 0 0 10px; border-left: 2px solid var(--v-border); }
    .rgv .v-exline { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; }
    .rgv .v-extime { flex: none; min-height: 24px; padding: 0 4px; border: 0; border-radius: 5px; color: var(--v-ink); font-size: 12px; font-variant-numeric: tabular-nums; }
    .rgv .v-extime:hover { background: var(--v-soft); }
    .rgv .v-extext { font-size: 12.5px; overflow-wrap: anywhere; }
    .rgv .v-card { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--v-border); border-radius: 8px; }
    .rgv .v-curline { margin: 0 0 8px; color: var(--v-muted); font-size: 12.5px; overflow-wrap: anywhere; }
    .rgv .v-curline .v-en { color: var(--v-fg); font-size: 13px; }
    .rgv .v-cardtitle { font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
    .rgv .v-tr { margin-top: 6px; overflow-wrap: anywhere; }
    .rgv .v-note { margin-top: 4px; color: var(--v-muted); overflow-wrap: anywhere; }
    .rgv .v-exps { margin: 6px 0 0; padding-left: 16px; }
    .rgv .v-exps li { margin: 2px 0; overflow-wrap: anywhere; }
    .rgv .v-exps .v-ko { font-size: 12.5px; }
    .rgv .v-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    /* 지금 줄에 묻기(28-18): 풀이 탭 아래 한 줄 입력칸(200자)과 답 칸 */
    .rgv .v-ask { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--v-border); }
    .rgv .v-asktitle { color: var(--v-muted); font-size: 12.5px; }
    .rgv .v-askrow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .rgv .v-q { flex: 1 1 160px; min-width: 0; box-sizing: border-box; min-height: 28px; padding: 3px 8px; border-radius: 7px;
      border: 1px solid var(--v-border); background: transparent; color: var(--v-fg); font: inherit; font-size: 13px; }
    .rgv .v-q:focus-visible { outline: 2px solid var(--v-accent); outline-offset: 2px; }
    .rgv .v-askout { margin-top: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .rgv .v-askout.err { color: var(--v-muted); }
    .rgv [hidden] { display: none !important; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(text, label, onclick, cls = 'v-act') {
    const b = el('button', cls, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onclick);
    return b;
  }
  // 대본을 담은 스크롤 상자(패널 본문): 가장 가까운 overflow-y auto·scroll 조상
  function scrollerOf(node) {
    for (let n = node?.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if (o === 'auto' || o === 'scroll') return n;
    }
    return null;
  }
  // 오류 코드를 한국어 한 줄로. 다리 오류 표는 자막 층과 같은 말을 쓴다.
  // aiHead 는 묻기(28-18)처럼 '풀이'가 아닌 요청에만 넘긴다: 다리 ai-failed 를 그 요청의 말로 바꾼다.
  function errorText(r, head, aiHead) {
    if (r?.error === 'ai-failed' && aiHead) return aiHead;
    const known = {
      'bridge-off': '다리가 꺼져 있어요', 'mt-unavailable': '맥 번역 도우미가 없어요', 'ext-reloaded': '확장이 새로 로드됐어요. 페이지를 새로고침해 주세요',
      'pair-failed': '다리와 연결하지 못했어요(인증)', unauthorized: '다리와 연결하지 못했어요(인증)', timeout: '시간이 오래 걸려요. 잠시 뒤 다시 눌러 주세요',
      'ai-failed': '풀이를 가져오지 못했어요', 'no-cue': '지금 줄이 없어요', changed: '그 사이 줄이 바뀌었어요',
    };
    return known[r?.error] ?? `${head}(${r?.error ?? '응답 없음'})`;
  }

  function render(container) {
    const root = el('div', 'rgv');
    const style = el('style');
    style.textContent = CSS;
    const titleEl = el('div', 'v-title');
    const infoEl = el('div', 'v-info'); // 줄마다 바뀌는 번역 진행은 여기 말고 [한국어] 단추에(읽어 주기가 줄마다 울리지 않게)

    // 1분 라운드(28-14): [영상] 탭 맨 위. 지금 재생 위치가 든 라운드를 강조하고 [‹] [보기] [›]로 고른다.
    const roundBox = el('div', 'v-rounds');
    roundBox.hidden = true;
    const roundLine = el('div', 'v-roundline');
    roundLine.setAttribute('role', 'group');
    roundLine.setAttribute('aria-label', '1분 라운드');
    const roundText = el('span', 'v-roundtext');
    const roundPrev = btn('‹', '이전 라운드', () => stepRound(-1), 'v-act');
    const roundPlay = btn('보기', '이 라운드 재생', () => playShownRound(), 'v-act');
    const roundNext = btn('›', '다음 라운드', () => stepRound(1), 'v-act');
    roundLine.append(roundText, roundPrev, roundPlay, roundNext);
    const roundChips = el('div', 'v-roundchips');
    roundChips.hidden = true;
    roundChips.setAttribute('role', 'group');
    roundChips.setAttribute('aria-label', '라운드 어려운 단어');
    roundBox.append(roundLine, roundChips);

    // 작은 탭 셋(28-12): 고른 탭은 설정에 남기지 않고 이 그리기(패널을 닫을 때까지) 안에서만 기억한다.
    const subtabs = el('div', 'v-subtabs');
    subtabs.setAttribute('role', 'tablist');
    subtabs.setAttribute('aria-label', '영상 보기');
    const subtabBtn = {};
    for (const t of SMALL_TABS) {
      const b = btn(t.title, `${t.title} 보기`, () => selectSmall(t.id), 'v-subtab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `rgv-pane-${t.id}`);
      subtabBtn[t.id] = b;
      subtabs.append(b);
    }

    // --- 자막 ---
    const scriptPane = el('div', 'v-pane');
    scriptPane.id = 'rgv-pane-script';
    scriptPane.setAttribute('role', 'tabpanel');
    const hardBtn = btn('어려운 단어 보기', '이 영상의 어려운 단어 미리 보기', () => showHard());
    const koBtn = btn('한국어 모두 보기', '대본 전체를 맥 번역으로', () => ui()?.setKoAll(!ui().state().koAll));
    // 자동 자막 다듬기(28-17): 자동 생성(kind=asr)일 때만 보인다. 누를 때만 AI 를 부른다.
    const polishBtn = btn('자막 다듬기(AI)', '자동 생성 자막을 AI 로 문장 단위로 다듬기', () => ui()?.polish?.());
    const tools = el('div', 'v-tools');
    tools.append(hardBtn, koBtn, polishBtn);
    const scriptFilters = el('div', 'v-filters');
    scriptFilters.setAttribute('role', 'group');
    scriptFilters.setAttribute('aria-label', '대본 거르기');
    const scriptFilterBtn = {};
    for (const f of PANEL_FILTERS) {
      const b = btn(f.title, `대본 ${f.title}`, () => {
        scriptFilter = f.id;
        paintScriptFilters();
        applyScriptFilter();
        follow(true); // 거르기를 바꿔 다시 보인 지금 줄을 표시한다
      }, 'v-fchip');
      scriptFilterBtn[f.id] = b;
      scriptFilters.append(b);
    }
    const hardBox = el('div', 'v-hard');
    hardBox.hidden = true;
    hardBox.setAttribute('role', 'group');
    hardBox.setAttribute('aria-label', '어려운 단어');
    const list = el('ol', 'v-list');
    list.setAttribute('aria-label', '대본');
    const scriptEmpty = el('div', 'v-empty');
    scriptEmpty.hidden = true;
    scriptPane.append(tools, scriptFilters, hardBox, scriptEmpty, list);

    // --- 나의 표현 ---
    const exprPane = el('div', 'v-pane');
    exprPane.id = 'rgv-pane-expressions';
    exprPane.setAttribute('role', 'tabpanel');
    const exprFilters = el('div', 'v-filters');
    exprFilters.setAttribute('role', 'group');
    exprFilters.setAttribute('aria-label', '표현 거르기');
    const exprFilterBtn = {};
    for (const f of EXPR_FILTERS) {
      const b = btn(f.title, `표현 ${f.title}`, () => {
        exprFilter = f.id;
        paintExprFilters();
        paintExpressions();
      }, 'v-fchip');
      exprFilterBtn[f.id] = b;
      exprFilters.append(b);
    }
    const exprStatus = el('div', 'v-status');
    exprStatus.setAttribute('role', 'status');
    const exprList = el('ul', 'v-exlist');
    exprPane.append(exprFilters, exprStatus, exprList);

    // --- 풀이 ---
    const explainPane = el('div', 'v-pane');
    explainPane.id = 'rgv-pane-explain';
    explainPane.setAttribute('role', 'tabpanel');
    const explainBody = el('div', 'v-explain');
    explainBody.setAttribute('role', 'status');
    // 지금 줄에 묻기(28-18): 한 줄 입력칸(200자)과 답 칸. [묻기]로 다리 /ask 에 보낸다.
    const askBox = el('div', 'v-ask');
    const askInput = el('input', 'v-q');
    askInput.type = 'text';
    askInput.maxLength = 200;
    askInput.setAttribute('aria-label', '이 줄에 대해 질문');
    askInput.placeholder = '이 줄에 대해 묻기';
    const askGo = btn('묻기', '이 줄에 질문 보내기', () => submitAsk());
    const askRow = el('div', 'v-askrow');
    askRow.append(askInput, askGo);
    const askOut = el('div', 'v-askout');
    askOut.setAttribute('role', 'status');
    askOut.hidden = true;
    askBox.append(el('div', 'v-asktitle', '이 줄에 묻기'), askRow, askOut);
    explainPane.append(explainBody, askBox);

    root.append(style, titleEl, infoEl, roundBox, subtabs, scriptPane, exprPane, explainPane);
    container.replaceChildren(root);

    let rows = []; // 줄마다 { li, ko, star, flags }
    let builtKey = '';
    let curRow = -1;
    let userScrollAt = 0;
    let auto = false;
    let hardOpen = false;
    let scroller = null; // 스크롤 듣기를 단 상자(패널 본문은 다시 그려도 그대로라 끊을 때 뗀다)
    let small = 'script'; // 지금 고른 작은 탭
    let scriptFilter = 'all';
    let exprFilter = 'all';
    let roundChoice = null; // [‹] [›]로 고른 라운드(없으면 지금 재생 위치가 든 라운드)
    let roundShown = 0;
    let roundLive = -1; // 앞 그리기의 지금 라운드(재생이 다른 라운드로 넘어가면 고른 것을 놓는다)
    let expanded = new Set(); // 펼친 표현 열쇠(`${type}:${key}`)
    let explain = { i: -1, state: 'idle', data: null, error: '', busy: false };
    let ask = { i: -1, busy: false, answer: '', error: '' };
    const ui = () => globalThis.readglossVideoUi;
    const panelData = () => ui()?.panelData?.() ?? { hard: new Map(), forms: new Map(), done: new Set(), phrases: {}, version: '' };
    const library = () => ui()?.library?.() ?? { saved: {}, phrases: {} };

    function onScroll() {
      if (auto) auto = false;
      else userScrollAt = Date.now();
    }

    // 작은 탭 고르기: 자막은 그대로, 나의 표현은 목록을 다시 읽고, 풀이는 지금 줄이 바뀌었으면 그 줄 풀이를 부른다.
    function paintPanes() {
      const hasPage = Boolean(ui()?.state()?.id);
      for (const t of SMALL_TABS) {
        const on = t.id === small;
        subtabBtn[t.id].setAttribute('aria-selected', String(on));
        subtabBtn[t.id].tabIndex = on ? 0 : -1;
      }
      scriptPane.hidden = !hasPage || small !== 'script';
      exprPane.hidden = !hasPage || small !== 'expressions';
      explainPane.hidden = !hasPage || small !== 'explain';
    }
    function selectSmall(id) {
      small = SMALL_TABS.some((t) => t.id === id) ? id : 'script';
      paintPanes();
      if (small === 'expressions') paintExpressions();
      if (small === 'explain') {
        const i = ui()?.state()?.cur ?? -1;
        if (i >= 0 && explain.i !== i) loadExplain(false);
        else paintExplain();
      }
    }
    subtabs.addEventListener('keydown', (e) => {
      const at = SMALL_TABS.findIndex((t) => t.id === small);
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: SMALL_TABS.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      selectSmall(SMALL_TABS[(to + SMALL_TABS.length) % SMALL_TABS.length].id);
      subtabBtn[small].focus();
    });

    // ---- 1분 라운드(28-14) ----
    // 지금 재생 위치(줄 번호)가 든 라운드. 없으면 -1.
    const currentRoundOf = (list, cur) => {
      if (!Number.isInteger(cur) || cur < 0) return -1;
      return list.findIndex((r) => cur >= r.from && cur <= r.to);
    };
    // 그 라운드 안 어려운 낱말(원형마다 하나). first 는 대본 줄 번호로 옮긴다.
    const roundWords = (st, r) => {
      const slice = (st?.cues ?? []).slice(r.from, r.to + 1);
      return V.previewWords(slice, st?.hard ?? new Map()).map((w) => ({ ...w, first: w.first + r.from }));
    };
    function stepRound(d) {
      const list = ui()?.rounds?.() ?? [];
      if (!list.length) return;
      roundChoice = Math.min(list.length - 1, Math.max(0, roundShown + d));
      paintRounds();
    }
    function playShownRound() {
      if (ui()?.playRound?.(roundShown)) {
        roundChoice = roundShown;
        paintRounds();
      }
    }
    function paintRoundChips(st, list) {
      const state = ui()?.round?.();
      const r = state?.ended === true ? list[state.index] : null;
      roundChips.hidden = !r;
      if (!r) {
        roundChips.replaceChildren();
        return;
      }
      const words = roundWords(st, r);
      const kids = [el('span', 'v-status', `라운드 ${state.index + 1} 끝`)];
      for (const w of words) {
        const b = btn('', `${w.word} ${w.gloss || ''}, 그 줄로`, () => ui()?.seek(w.first), 'v-chip');
        b.append(`${w.word} `, el('span', 'v-g', w.gloss || '뜻 없음'));
        kids.push(b);
      }
      if (!words.length) kids.push(el('span', 'v-status', '어려운 단어가 없어요'));
      if (state.index + 1 < list.length) {
        kids.push(btn('다음 라운드', '다음 라운드 재생', () => {
          roundChoice = state.index + 1;
          if (ui()?.playRound?.(state.index + 1)) paintRoundChips(st, list);
        }));
      } else {
        kids.push(el('span', 'v-status', '마지막 라운드예요'));
      }
      roundChips.replaceChildren(...kids);
    }
    function paintRounds() {
      const st = ui()?.state();
      const list = ui()?.rounds?.() ?? [];
      if (!st?.id || !list.length) {
        roundBox.hidden = true;
        roundChips.hidden = true;
        roundChips.replaceChildren();
        return;
      }
      roundBox.hidden = false;
      const live = currentRoundOf(list, st.cur ?? -1);
      // 재생이 다른 라운드로 넘어가면 [‹] [›]로 고른 것을 놓고 지금 라운드를 따라간다.
      if (live !== roundLive) {
        roundLive = live;
        if (live >= 0) roundChoice = null;
      }
      roundShown = Math.min(list.length - 1, Math.max(0, roundChoice ?? (live >= 0 ? live : 0)));
      const r = list[roundShown];
      const hard = roundWords(st, r).length;
      roundText.textContent = `${roundShown + 1} / ${list.length} · ${V.fmtTime(r.start)}–${V.fmtTime(r.end)} · 어려운 단어 ${hard}`;
      roundPrev.disabled = roundShown <= 0;
      roundNext.disabled = roundShown >= list.length - 1;
      const isLive = roundShown === live;
      roundLine.classList.toggle('v-live', isLive);
      if (isLive) roundLine.setAttribute('aria-current', 'true');
      else roundLine.removeAttribute('aria-current');
      const active = ui()?.round?.();
      roundPlay.setAttribute('aria-pressed', String(Boolean(active && active.ended !== true && active.index === roundShown)));
      paintRoundChips(st, list);
    }

    function paintScriptFilters() {
      for (const f of PANEL_FILTERS) scriptFilterBtn[f.id].setAttribute('aria-pressed', String(f.id === scriptFilter));
    }
    function paintExprFilters() {
      for (const f of EXPR_FILTERS) exprFilterBtn[f.id].setAttribute('aria-pressed', String(f.id === exprFilter));
    }

    // 대본 글: 학습 표현은 주황 글자, 복습 끝은 초록 글자, 저장만 된 낱말은 ✓.
    // 저장한 구(28-9)는 낱말 칠과 별개로 구 전체를 한 덩어리로 칠한다(복습 끝 = 초록, 아니면 주황).
    function paintCueText(box, text, data) {
      const toks = V.tokenize(text);
      const spanAt = new Map(V.phraseSpans(toks, data?.phrases ?? {}).map((s) => [s.start, s]));
      for (let k = 0; k < toks.length;) {
        const span = spanAt.get(k);
        if (span) {
          const wrap = el('span', span.done ? 'v-gr' : 'v-or');
          for (let j = k; j <= span.end && j < toks.length; j++) wrap.append(toks[j].t);
          box.append(wrap);
          k = span.end + 1;
          continue;
        }
        const tk = toks[k++];
        if (!tk.w) {
          box.append(tk.t);
          continue;
        }
        const color = wordColor(tk.lower, data);
        const cls = color === 'green' ? 'v-gr' : color === 'orange' ? 'v-or' : color === 'check' ? 'v-chk' : '';
        box.append(el('span', cls, tk.t));
      }
    }

    function build() {
      const st = ui()?.state();
      const data = panelData();
      const key = st ? [st.id, st.cues.length, st.cues[0]?.start, st.kind, st.polishVer, data.version, st.ko.length].join('|') : '';
      if (key === builtKey) {
        // 같은 대본이어도 한국어 줄은 바뀔 수 있다(나중에 온 유튜브 한국어 자막은 'ko' 알림 없이 한꺼번에 채워진다)
        rows.forEach((r, i) => {
          const t = st?.ko[i] || '';
          if (r.ko.textContent !== t) r.ko.textContent = t;
        });
        return;
      }
      builtKey = key;
      curRow = -1;
      rows = (st?.cues ?? []).map((c, i) => {
        const li = el('li', 'v-row');
        const t = btn(V.fmtTime(c.start), `${V.fmtTime(c.start)} 그 장면으로`, () => ui()?.seek(i), 'v-t');
        const txt = el('div', 'v-txt');
        const en = el('div', 'v-en');
        paintCueText(en, c.text, data);
        txt.append(en);
        const ko = el('div', 'v-ko', st.ko[i] || '');
        txt.append(ko);
        txt.addEventListener('click', () => ui()?.seek(i));
        const star = btn('☆', '이 줄 구·문장에 저장', () => ui()?.saveLine(i, star), 'v-star');
        li.append(t, txt, star);
        return { li, ko, star, flags: panelLineFlags(c, data) };
      });
      list.replaceChildren(...rows.map((r) => r.li));
      rows.forEach((_, i) => paintStar(i));
      applyScriptFilter();
      follow(true);
    }

    function paintStar(i) {
      const r = rows[i];
      if (!r) return;
      const saved = ui()?.isSaved(i) === true;
      r.star.textContent = saved ? '★' : '☆';
      r.star.setAttribute('aria-label', saved ? '이 줄 저장 빼기' : '이 줄 구·문장에 저장');
    }

    // 거르기: 줄을 지우지 않고 숨긴다(지금 줄 따라가기·☆ 다시 그리기가 줄 번호로 그대로 돈다).
    function applyScriptFilter() {
      const st = ui()?.state();
      rows.forEach((r) => { r.li.hidden = !passesFilter(r.flags, scriptFilter); });
      const any = rows.some((r) => !r.li.hidden);
      const showEmpty = Boolean(st?.id) && Boolean(st.cues.length) && !any;
      scriptEmpty.hidden = !showEmpty;
      if (!showEmpty) {
        scriptEmpty.replaceChildren();
        return;
      }
      if (scriptFilter === 'learning') {
        scriptEmpty.replaceChildren(
          document.createTextNode('이 영상에 학습 표현이 아직 없어요 — '),
          btn('어려운 단어 보기', '이 영상의 어려운 단어 미리 보기', () => showHard()),
        );
      } else if (scriptFilter === 'saved') {
        scriptEmpty.textContent = '저장한 줄이 없어요 — 자막의 ☆ 나 Shift 로 저장해요';
      } else {
        scriptEmpty.textContent = '보여 줄 줄이 없어요';
      }
    }

    function paintHead() {
      const st = ui()?.state();
      if (!st?.id) {
        titleEl.textContent = '';
        infoEl.textContent = PAGE_HINT;
        tools.hidden = true;
        subtabs.hidden = true;
        scriptPane.hidden = true;
        exprPane.hidden = true;
        explainPane.hidden = true;
        return;
      }
      titleEl.textContent = st.title;
      subtabs.hidden = false;
      paintPanes();
      tools.hidden = !st.cues.length;
      polishBtn.hidden = !(st.cues.length && st.kind === 'asr' && st.canPolish && !st.polished);
      polishBtn.disabled = st.polishBusy;
      polishBtn.textContent = st.polishBusy ? '다듬는 중…' : '자막 다듬기(AI)';
      if (!st.cues.length) {
        infoEl.textContent = st.message || '자막을 기다리는 중… (유튜브 자막(CC)을 켜 주세요)';
        return;
      }
      infoEl.textContent = st.polished
        ? `AI 가 다듬은 자막 · 영어 자막 ${st.cues.length}줄`
        : `영어 자막 · ${st.cues.length}줄 · ${st.kind === 'asr' ? '자동 생성' : '사람이 씀'}`;
      const done = st.ko.filter(Boolean).length;
      koBtn.textContent = st.koAll ? `한국어 받는 중 ${done}/${st.cues.length} · 멈추기` : done >= st.cues.length ? '한국어 모두 받음' : '한국어 모두 보기';
      koBtn.setAttribute('aria-pressed', String(st.koAll));
    }

    // 지금 줄 강조·따라 스크롤(사용자가 막 스크롤했으면 안 따라감). 거르기로 숨은 줄은 따라가지 않는다.
    function follow(force = false) {
      const st = ui()?.state();
      const i = st?.cur ?? -1;
      if (i === curRow && !force) return;
      rows[curRow]?.li.classList.remove('v-cur');
      rows[curRow]?.li.removeAttribute('aria-current');
      curRow = i;
      const r = rows[i];
      if (!r || r.li.hidden) return;
      r.li.classList.add('v-cur');
      r.li.setAttribute('aria-current', 'true');
      if (!scroller) {
        scroller = scrollerOf(root);
        scroller?.addEventListener('scroll', onScroll, { passive: true });
      }
      if (small === 'script' && scroller && !root.closest?.('[hidden]') && Date.now() - userScrollAt > FOLLOW_MS) {
        // offsetTop 은 가장 가까운 위치 잡힌 조상(패널) 기준이라 스크롤 상자 안 자리를 화면 좌표 차이로 잰다
        const top = scroller.scrollTop + r.li.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2 + r.li.offsetHeight / 2;
        if (Math.abs(scroller.scrollTop - top) > 4) {
          auto = true; // 우리가 낸 스크롤은 사용자 스크롤로 치지 않는다
          scroller.scrollTop = Math.max(0, top);
          setTimeout(() => { auto = false; }, 120);
        }
      }
    }

    async function showHard() {
      hardOpen = !hardOpen;
      hardBtn.setAttribute('aria-pressed', String(hardOpen));
      hardBox.hidden = !hardOpen;
      if (!hardOpen) return;
      hardBox.replaceChildren(el('span', 'v-status', '대본 전체 낱말을 보는 중…'));
      const ok = await ui()?.annotateAll();
      if (!root.isConnected || !hardOpen) return;
      if (!ok) return hardBox.replaceChildren(el('span', 'v-status', '다리에 연결하지 못했어요'));
      paintHard();
    }
    function paintHard() {
      const st = ui()?.state();
      const words = st ? V.previewWords(st.cues, st.hard) : [];
      if (!words.length) return hardBox.replaceChildren(el('span', 'v-status', '지금 수준에서 어려운 단어가 없어요'));
      hardBox.replaceChildren(...words.map((w) => {
        const b = btn('', `${w.word} ${w.gloss}, ${w.count}번, 처음 나온 줄로`, () => ui()?.seek(w.first), 'v-chip');
        b.append(`${w.word} `, el('span', 'v-g', `${w.gloss}${w.count > 1 ? ` ×${w.count}` : ''}`));
        return b;
      }));
    }

    // --- 나의 표현 그리기 ---
    function paintExpressions() {
      const st = ui()?.state();
      const id = st?.id ?? null;
      const all = videoExpressions(library(), id);
      const shown = all.filter((x) => exprFilter === 'all' || x.stage === exprFilter);
      if (!id) {
        exprStatus.textContent = PAGE_HINT;
        exprList.replaceChildren();
        return;
      }
      if (!all.length) {
        exprStatus.textContent = '이 영상에서 저장한 표현이 없어요 — 자막의 낱말을 눌러 저장해요';
        exprList.replaceChildren();
        return;
      }
      exprStatus.textContent = exprFilter === 'all' ? `저장한 표현 ${all.length}개` : `${EXPR_FILTERS.find((f) => f.id === exprFilter)?.title} ${shown.length}개 · 전체 ${all.length}개`;
      if (!shown.length) {
        exprList.replaceChildren(el('li', 'v-status', '고른 단계에 표현이 없어요'));
        return;
      }
      exprList.replaceChildren(...shown.map((x) => expressionRow(x, st)));
    }
    function expressionRow(x, st) {
      const key = `${x.type}:${x.key}`;
      const open = expanded.has(key);
      const li = el('li', 'v-ex');
      const head = btn('', `${x.title} ${open ? '접기' : '펼치기'}`, () => {
        if (open) expanded.delete(key);
        else expanded.add(key);
        paintExpressions();
      }, 'v-exrow');
      head.setAttribute('aria-expanded', String(open));
      head.append(
        el('span', 'v-extitle', x.title),
        el('span', 'v-exgloss', x.gloss || '뜻 없음'),
        el('span', 'v-exmeta', `${x.type === 'word' ? '낱말' : '구'} · ${stageText(x)}${x.scenes?.length ? ` · 장면 ${x.scenes.length + 1}` : ''}`),
      );
      li.append(head);
      if (open) {
        const lines = el('ul', 'v-exlines');
        const idxs = expressionLines(st?.cues ?? [], x);
        if (!idxs.length) lines.append(el('li', 'v-status', '이 영상 줄에서는 찾지 못했어요'));
        for (const i of idxs) {
          const c = st.cues[i];
          if (!c) continue;
          const row = el('li', 'v-exline');
          row.append(
            btn(`${V.fmtTime(c.start)} ›`, `${V.fmtTime(c.start)} 그 장면으로`, () => ui()?.seek(i), 'v-extime'),
            el('span', 'v-extext', c.text),
          );
          lines.append(row);
        }
        li.append(lines);
      }
      return li;
    }

    // --- 풀이 그리기 ---
    function paintExplain() {
      const st = ui()?.state();
      const i = st?.cur ?? -1;
      const cue = st?.cues?.[i];
      const cur = el('div', 'v-curline');
      if (!st?.id) {
        explainBody.replaceChildren(el('div', 'v-status', PAGE_HINT));
        return;
      }
      if (!cue) {
        explainBody.replaceChildren(el('div', 'v-status', '지금 줄이 없어요'));
        return;
      }
      cur.append(el('div', 'v-en', cue.text));
      if (explain.i !== i) {
        explainBody.replaceChildren(
          cur,
          el('div', 'v-status', explain.busy ? '풀이를 가져오는 중…' : '이 줄 풀이가 아직 없어요'),
          actionRow([btn('이 줄 풀이', '지금 줄 AI 풀이', () => loadExplain(false))]),
        );
        return;
      }
      if (explain.state === 'loading') {
        explainBody.replaceChildren(cur, el('div', 'v-status', '풀이를 가져오는 중…'));
        return;
      }
      if (explain.state !== 'done' || !explain.data) {
        explainBody.replaceChildren(cur, el('div', 'v-status', explain.error || '풀이를 가져오지 못했어요'));
        explainBody.append(actionRow([btn('다시 만들기', '이 줄 풀이를 다시 만들기', () => loadExplain(true))]));
        return;
      }
      const data = explain.data;
      const lines = String(data.note || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const transLines = String(data.translation || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const title = lines[0] || transLines[0] || '이 장면 풀이';
      const noteRest = lines.slice(1).join(' ');
      // 제목이 번역 첫 줄이면 본문에서 그 줄을 빼고, 제목이 풀이 첫 줄이면 번역은 그대로 보인다.
      const transBody = lines.length ? transLines.join(' ') : transLines.slice(1).join(' ');
      const kids = [
        cur,
        el('div', 'v-card'),
      ];
      const card = kids[1];
      card.append(el('div', 'v-cardtitle', title));
      if (transBody) card.append(el('div', 'v-tr', transBody));
      if (noteRest) card.append(el('div', 'v-note', noteRest));
      const exps = Array.isArray(data.expressions) ? data.expressions : [];
      if (exps.length) {
        const ul = el('ul', 'v-exps');
        for (const e of exps) {
          const li = el('li');
          li.append(el('span', 'v-exen', String(e?.en ?? '')), ' — ', el('span', 'v-ko', String(e?.ko ?? '')));
          ul.append(li);
        }
        card.append(ul);
      }
      kids.push(actionRow([btn('다시 만들기', '이 줄 풀이를 캐시를 건너뛰고 다시 만들기', () => loadExplain(true))]));
      explainBody.replaceChildren(...kids);
    }
    function actionRow(items) {
      const box = el('div', 'v-actions');
      box.append(...items);
      return box;
    }
    async function loadExplain(force) {
      const st = ui()?.state();
      const i = st?.cur ?? -1;
      if (!ui() || i < 0 || !st?.cues?.[i]) return paintExplain();
      if (explain.busy || typeof ui().explainAt !== 'function') return;
      explain = { i, state: 'loading', data: null, error: '', busy: true };
      paintExplain();
      const r = await ui().explainAt(i, force === true);
      if (explain.i !== i || !root.isConnected) return;
      if (typeof r?.translation === 'string' && r.translation) explain = { i, state: 'done', data: r, error: '', busy: false };
      else explain = { i, state: 'error', data: null, error: errorText(r, '풀이를 가져오지 못했어요'), busy: false };
      paintExplain();
    }

    // 지금 줄에 묻기(28-18): 지금 줄을 selection 으로, 앞뒤 3줄을 문맥으로 보낸다. 줄이 바뀌어도 받은 답은 그대로 보여 준다.
    function paintAsk() {
      if (ask.busy) {
        askOut.hidden = false;
        askOut.className = 'v-askout';
        askOut.textContent = '답을 가져오는 중…';
      } else if (ask.error) {
        askOut.hidden = false;
        askOut.className = 'v-askout err';
        askOut.textContent = ask.error;
      } else if (ask.answer) {
        askOut.hidden = false;
        askOut.className = 'v-askout';
        askOut.textContent = ask.answer;
      } else {
        askOut.hidden = true;
        askOut.textContent = '';
      }
      askGo.disabled = ask.busy;
    }
    async function submitAsk() {
      const st = ui()?.state();
      const i = st?.cur ?? -1;
      const cue = st?.cues?.[i];
      const question = askInput.value.trim();
      if (!cue || ask.busy || typeof ui().askAt !== 'function') {
        if (!cue) {
          ask = { i: -1, busy: false, answer: '', error: '지금 줄이 없어요' };
          paintAsk();
        }
        return;
      }
      if (!question) {
        ask = { i, busy: false, answer: '', error: '질문을 적어 주세요' };
        paintAsk();
        return;
      }
      ask = { i, busy: true, answer: '', error: '' };
      paintAsk();
      const r = await ui().askAt(i, question);
      if (!root.isConnected) return;
      if (typeof r?.answer === 'string' && r.answer) ask = { i, busy: false, answer: r.answer, error: '' };
      else ask = { i, busy: false, answer: '', error: errorText(r, '답을 가져오지 못했어요', '답을 가져오지 못했어요. 다시 시도해 주세요') };
      paintAsk();
    }

    function refresh() {
      if (!ui()) {
        infoEl.textContent = '영상 자막 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요';
        tools.hidden = true;
        subtabs.hidden = true;
        return;
      }
      build();
      paintHead();
      paintRounds();
      paintScriptFilters();
      paintExprFilters();
      if (small === 'expressions') paintExpressions();
      if (small === 'explain') paintExplain();
      paintAsk();
      follow();
    }

    // 패널이 새로 그려져 이 노드가 떨어지면 스스로 구독을 끊는다(panel-words.js 와 같은 방식)
    const off = ui()?.onChange((what, i) => {
      if (!root.isConnected) {
        scroller?.removeEventListener('scroll', onScroll);
        return off?.();
      }
      if (what === 'ko' && rows[i]) {
        rows[i].ko.textContent = ui().state().ko[i] || '';
        return paintHead();
      }
      if (what === 'saved') {
        (Number.isInteger(i) ? [i] : rows.map((_, k) => k)).forEach(paintStar);
        build(); // 저장·해제로 칠하기와 거르기가 달라진다
        applyScriptFilter();
        if (small === 'expressions') paintExpressions();
        return;
      }
      if (what === 'hard') {
        build();
        applyScriptFilter();
        if (hardOpen) paintHard();
        paintRounds();
        return;
      }
      if (what === 'cur') {
        follow();
        paintRounds(); // 지금 재생 위치가 든 라운드를 강조한다(28-14)
        if (small === 'explain') paintExplain(); // 줄이 바뀌면 [이 줄 풀이]로 알린다(자동으로 AI 를 부르지 않는다)
        return;
      }
      if (what === 'round') return paintRounds();
      if (what === 'koAll' || what === 'message') return paintHead();
      if (what === 'page') {
        explain = { i: -1, state: 'idle', data: null, error: '', busy: false };
        ask = { i: -1, busy: false, answer: '', error: '' };
        askInput.value = '';
        paintAsk();
        expanded = new Set();
        roundChoice = null;
        roundShown = 0;
        roundLive = -1;
        hardOpen = false; // 새 영상의 어려운 단어 칩을 옛 영상 것으로 두지 않는다
        hardBox.hidden = true;
        hardBtn.setAttribute('aria-pressed', 'false');
      }
      refresh();
    });
    refresh();
    selectSmall(small);
  }

  (globalThis.readglossPanelTabs ||= []).push({ id: 'video', title: '영상', order: 5, render });
})();
