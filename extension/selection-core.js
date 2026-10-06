// 드래그 번역의 판단 로직(선택 분류, 문맥 만들기). DOM 을 직접 만지지 않는 순수 함수만 둔다.
// text.js 와 같이 import/export 없는 classic script 로 두고 전역 readglossSelection 으로 등록한다. text.js(readgloss)가 먼저 로드돼야 한다.
(() => {
  const MAX_TEXT = 1000; // 다리의 LIMITS.text 등과 맞춘다(넘으면 다리가 413)
  const MAX_SIDE = 1500;
  const MAX_TITLE = 200; // 제목·소제목 한 줄의 상한
  const MAX_HEADINGS = 3;
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
  function buildContext({ prev = [], head = '', tail = '', next = [], title = '', headings = [] }) {
    const before = norm([...prev, head].join(' '));
    const after = norm([tail, ...next].join(' '));
    return {
      before: before.slice(-MAX_SIDE).trimStart(),
      after: after.slice(0, MAX_SIDE).trimEnd(),
      title: norm(title).slice(0, MAX_TITLE),
      headings: headings.map((h) => norm(h).slice(0, MAX_TITLE)).filter(Boolean).slice(-MAX_HEADINGS),
    };
  }

  globalThis.readglossSelection = { MAX_TEXT, MAX_SIDE, MAX_TITLE, MAX_HEADINGS, classify, around, buildContext };
})();
