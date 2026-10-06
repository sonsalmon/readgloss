// 판단 로직(단어·문장 뽑기, 영어 판정, 말풍선 위치). DOM 을 만지지 않는 순수 함수만 둔다.
// content script 는 ES 모듈 import 를 못 쓰므로 import/export 없는 classic script 로 두고 전역에 등록한다.
// node --test 도 같은 파일을 import 해서 globalThis.readgloss 로 쓴다.
(() => {
  const WORD = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;
  const MIN_WORD = 2;
  const MAX_WORD = 64; // 다리의 WORD_RE 와 맞춘다
  // 단어 앞뒤에 붙어도 되는 것: 공백과 문장부호만. 숫자·한글이 붙으면 영어 단어가 아니다(x86, 2fa, 한글word).
  const PUNCT = '[\\s"\'“”‘’()\\[\\]{}<>.,;:!?…—–*_`/\\\\|-]*';
  const SELECTION = new RegExp(`^${PUNCT}([A-Za-z]+(?:['’-][A-Za-z]+)*)${PUNCT}$`);

  const BLOCKED_SELECTOR = 'pre, code, input, textarea, [contenteditable]:not([contenteditable="false"])';

  function isEnglishWord(s) {
    return typeof s === 'string' && s.length >= MIN_WORD && s.length <= MAX_WORD && WORD.test(s);
  }

  // 더블클릭으로 잡힌 선택 문자열 -> { word, start } (start = 원문 안 단어 시작 위치). 영어 단어가 아니면 null.
  function cleanSelection(raw) {
    const m = SELECTION.exec(raw ?? '');
    if (!m || !isEnglishWord(m[1])) return null;
    return { word: m[1], start: m[0].indexOf(m[1]) };
  }

  // 문장 끝 부호 + (닫는 따옴표·괄호) 뒤에 공백이나 끝이 오면 문장 경계. 2.4.1 같은 숫자 안 점은 공백이 안 따라 경계가 아니다.
  const SENTENCE_END = /[.!?]["')\]”’]*(?=\s|$)/g;
  // ponytail: 약어 목록은 흔한 것만. 문장 끝의 etc. 도 약어로 보고 안 끊는다. 한계가 거슬리면 Intl.Segmenter 로 교체한다.
  const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'cf', 'mr', 'mrs', 'ms', 'dr', 'fig', 'no', 'approx', 'inc', 'st']);
  const MAX_SENTENCE = 300;

  function isAbbreviation(text, dotIndex) {
    if (text[dotIndex] !== '.') return false;
    const token = /[^\s(]*$/.exec(text.slice(Math.max(0, dotIndex - 12), dotIndex))[0].toLowerCase();
    return ABBREVIATIONS.has(token);
  }

  // 블록 요소 텍스트(text) 안에서 offset 위치의 단어(length 글자)가 든 문장. 공백은 한 칸으로 정리, 300자 넘으면 단어 주변만.
  function extractSentence(text, offset, length = 0) {
    text = String(text ?? '');
    offset = Math.min(Math.max(offset | 0, 0), Math.max(text.length - 1, 0));
    let start = 0;
    let end = text.length;
    SENTENCE_END.lastIndex = 0;
    for (let m; (m = SENTENCE_END.exec(text)); ) {
      if (isAbbreviation(text, m.index)) continue;
      const at = m.index + m[0].length;
      if (at <= offset) start = at;
      else {
        end = Math.max(at, offset + length);
        break;
      }
    }
    const seg = text.slice(start, end);
    const lead = seg.length - seg.trimStart().length;
    const body = seg.slice(lead);
    const norm = body.replace(/\s+/g, ' ').trim();
    if (norm.length <= MAX_SENTENCE) return norm;
    const rel = body.slice(0, offset - start - lead).replace(/\s+/g, ' ').length;
    const from = Math.min(Math.max(rel - MAX_SENTENCE / 2, 0), norm.length - MAX_SENTENCE);
    return norm.slice(from, from + MAX_SENTENCE);
  }

  // 말풍선 위치(페이지 좌표). rect: 단어의 뷰포트 사각형. 기본은 단어 아래, 아래 공간이 모자라고 위가 넉넉하면 위.
  function positionBubble({ rect, viewport, size, gap = 6, margin = 8 }) {
    const maxLeft = Math.max(margin, viewport.width - size.width - margin);
    const left = Math.min(Math.max(rect.left, margin), maxLeft);
    const fitsBelow = viewport.height - rect.bottom >= size.height + gap + margin;
    const fitsAbove = rect.top >= size.height + gap + margin;
    const top = fitsBelow || !fitsAbove ? rect.bottom + gap : rect.top - gap - size.height;
    return { left: left + viewport.scrollX, top: top + viewport.scrollY };
  }

  globalThis.readgloss = { isEnglishWord, cleanSelection, extractSentence, positionBubble, BLOCKED_SELECTOR };
})();
