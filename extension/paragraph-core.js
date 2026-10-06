// 문단 번역의 판단 로직(블록 판정, 텍스트 뽑기, 삽입 위치, 버튼 위치). DOM 을 직접 만지지 않는 순수 함수만 둔다.
// text.js 와 같이 import/export 없는 classic script 로 두고, 전역은 text.js 의 readgloss 와 겹치지 않게 readglossParagraph 로 등록한다.
// node --test 도 같은 파일을 import 해서 쓴다.
(() => {
  const MAX_TEXT = 4000; // 다리의 MAX_TEXT 와 맞춘다(넘으면 다리가 413)
  const MIN_TEXT = 20;
  const MIN_ENGLISH_RATIO = 0.6; // 글자(\p{L}) 중 영어 알파벳 비율

  const TRANSLATION_TAG = 'readgloss-translation';
  // 페이지 글꼴·색을 그대로 물려받아 읽기 흐름을 유지한다. 페이지 CSS 가 덮어쓰기 어렵게 인라인 style 로 둔다.
  const TRANSLATION_STYLE =
    'display:block;margin:.35em 0 .8em;padding:.15em 0 .15em .75em;border-left:3px solid rgba(47,111,235,.45);' +
    'color:inherit;opacity:.88;font:inherit;font-size:.96em;line-height:inherit;white-space:pre-wrap';

  const BLOCK = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'DT', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FIGCAPTION']);
  // 이 요소 안(또는 위)을 클릭한 건 대상이 아니다. 링크·버튼 같은 원래 동작은 건드리지 않는다.
  const IGNORE = new Set(['A', 'BUTTON', 'LABEL', 'SELECT', 'INPUT', 'TEXTAREA', 'PRE', 'CODE']);
  const INSIDE_END = new Set(['LI', 'TD', 'TH']); // 이 블록은 번역을 안쪽 끝에 넣는다(안 그러면 목록·표 구조가 깨진다)
  const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  // 이 태그의 경계에서는 글자가 붙지 않게 공백을 둔다(innerText 가 줄을 바꾸는 곳)
  const BREAK = new Set(['BR', 'P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DD', 'DT', 'TABLE', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR']);

  const BUTTON_SIZE = 22;
  const BUTTON_GAP = 6;
  const MIN_LEFT_MARGIN = 32;

  const normalizeText = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

  function isTargetText(text) {
    const t = normalizeText(text);
    if (t.length < MIN_TEXT) return false;
    const letters = (t.match(/\p{L}/gu) ?? []).length;
    const latin = (t.match(/[A-Za-z]/g) ?? []).length;
    return letters >= 10 && latin / letters >= MIN_ENGLISH_RATIO;
  }

  // el 에서 위로 올라가며 가장 가까운 글 블록을 찾는다. 위쪽에 막는 조상(링크·pre·입력창·편집 영역·우리 노드)이 있으면 null.
  function findBlock(el) {
    let block = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute?.('data-readgloss') || n.isContentEditable === true || IGNORE.has(n.tagName)) return null;
      if (!block && BLOCK.has(n.tagName)) block = n;
    }
    return block;
  }

  const insertPlacement = (tagName) => (INSIDE_END.has(String(tagName).toUpperCase()) ? 'beforeend' : 'afterend');

  // node 아래 글자를 모은 정규화 문자열. 우리가 넣은 번역 노드는 건너뛴다(li·td 는 번역을 안에 넣으므로 다시 번역할 때 한국어가 섞이지 않게).
  // opts.isHidden(el): 화면에 안 보이는 요소(display:none 등)를 건너뛰는 훅. innerText 대신 직접 걷는 이유: 번역 노드 제외를 DOM 없이 시험하려고.
  function textOf(node, { isHidden } = {}) {
    const parts = [];
    (function walk(n) {
      if (n.nodeType === 3) return void parts.push(n.nodeValue);
      if (n.nodeType !== 1 || n.hasAttribute?.('data-readgloss') || SKIP_TEXT.has(n.tagName) || isHidden?.(n)) return;
      const brk = BREAK.has(n.tagName);
      if (brk) parts.push(' ');
      for (const c of n.childNodes) walk(c);
      if (brk) parts.push(' ');
    })(node);
    return normalizeText(parts.join(''));
  }

  // 번역 버튼 위치(뷰포트 좌표). blockRect: 블록 사각형, firstLine: 블록 첫 줄 사각형(없으면 블록 맨 위).
  // 왼쪽 바깥 여백이 모자라면(left < 32) 블록 안쪽 왼쪽 위에 겹친다.
  function buttonPosition({ blockRect, firstLine = { top: blockRect.top, height: BUTTON_SIZE }, size = BUTTON_SIZE }) {
    const inside = blockRect.left < MIN_LEFT_MARGIN;
    return {
      left: inside ? blockRect.left + 2 : blockRect.left - size - BUTTON_GAP,
      top: firstLine.top + (firstLine.height - size) / 2,
      inside,
    };
  }

  globalThis.readglossParagraph = {
    MAX_TEXT, MIN_TEXT, BUTTON_SIZE, TRANSLATION_TAG, TRANSLATION_STYLE,
    normalizeText, isTargetText, findBlock, insertPlacement, textOf, buttonPosition,
  };
})();
