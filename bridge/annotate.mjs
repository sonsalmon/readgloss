// 어려운 영어 단어 판정과 짧은 한국어 뜻(/annotate). AI 는 쓰지 않는다: 맥 영한사전 첫 표제어의 첫 뜻을 다듬는다.
import { readFileSync } from 'node:fs';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const DEFAULT_LEVEL = 'B2';
export const ANNOTATE_LEVELS = ['A2', 'B1', 'B2', 'C1']; // 요청에서 고를 수 있는 기준 등급
const FILES = ['cefrj-vocabulary-profile-1.5.csv', 'octanove-vocabulary-profile-c1c2-1.0.csv'];
const MAX_CACHE = 50_000;
const MAX_GLOSS = 12;

// CSV 의 앞 세 칸(headword,pos,CEFR)만 쓴다. headword·pos 칸에는 따옴표 쉼표가 없다(따옴표는 뒷칸 설명에만). 같은 단어는 가장 쉬운 등급.
export function parseWordLevels(csv, into = new Map()) {
  for (const line of String(csv).split(/\r?\n/).slice(1)) {
    const cols = line.split(',');
    const level = cols[2];
    if (!LEVELS.includes(level)) continue;
    for (const v of (cols[0] ?? '').split('/')) {
      const w = v.trim().toLowerCase();
      if (!/^[a-z][a-z'’-]*$/.test(w)) continue; // 'a.m.', 'according to' 같은 건 낱말 하나로 안 걸린다
      const old = into.get(w);
      if (old === undefined || LEVELS.indexOf(level) < LEVELS.indexOf(old)) into.set(w, level);
    }
  }
  return into;
}

export function loadWordLevels() {
  const m = new Map();
  for (const f of FILES) parseWordLevels(readFileSync(new URL(`./wordlists/${f}`, import.meta.url), 'utf8'), m);
  return m;
}

// 《》〈〉〔〕【】{}()（）[] 로 묶인 설명·문법 표지([불][가])·대안 표기(이용[활용]하다)를 한 규칙으로 지운다.
const GROUPS = /《[^》]*》|〈[^〉]*〉|〔[^〕]*〕|【[^】]*】|\([^)]*\)|（[^）]*）|\[[^\]]*\]|\{[^}]*\}/g; // {…} 는 어원 풀이
const LEAD_POS = /^(?:(?:타|자)[∙·])?(?:자동사|타동사|동사|명사|형용사|부사|전치사|접속사|대명사)[,\s]*/; // 사전 평문이 품사를 못 가르면 본문 앞에 남는 품사 표지
const LEAD_NUM = /^(?:\d{1,2}\.|[①-⑳])\s*/; // 뜻 번호
const OBJECT_MARK = /…(?:에게|으로|로|을|를|이|가|에|의|와|과|도)?/g; // "…을 " 같은 말줄임 목적어 표시

// 사전 첫 뜻 문장 -> 12자 안팎의 짧은 뜻. 한글이 없으면 ''(주석 없음).
export function shortGloss(sense) {
  if (typeof sense !== 'string') return '';
  let s = sense.replace(GROUPS, '').split(/[,;:，；：]/)[0];
  s = s.replace(OBJECT_MARK, '').replace(/[.。]+$/, '').replace(/\s+/g, ' ').trim().replace(LEAD_POS, '').replace(LEAD_NUM, '');
  if (!/[가-힣]/.test(s)) return '';
  if (s.length > MAX_GLOSS) {
    const cut = s.lastIndexOf(' ', MAX_GLOSS);
    s = cut >= 2 ? s.slice(0, cut) : s.slice(0, MAX_GLOSS); // ponytail: 형태소 분석 없이 띄어쓰기·글자 수로만 자른다
  }
  return s;
}

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ·]/g, '').toLowerCase().replace(/^[-\s]+|[-\s]+$/g, '');

// 사전 표제어 -> 원형 낱말. 도우미의 headword 는 입력 철자(mitigations)나 악센트 철자(páylòad)일 수 있어서
// 본문 머리("mit·i·ga·tion | …", "ex·ploit 2 | …")를 먼저 본다.
export function lemmaOf(entry, word) {
  const raw = entry?.raw ?? '';
  const i = raw.indexOf(' | ');
  for (const c of [i > 0 && i <= 60 ? raw.slice(0, i).replace(/\s+\d{1,2}$/, '') : '', entry?.headword ?? '']) {
    const n = plain(c);
    if (/^[a-z][a-z'’-]*$/.test(n)) return n;
  }
  return word;
}

// dict: createDict() 같은 { lookup(word) }. levels: 낱말 -> 등급 Map.
// 돌려주는 함수: (words, level) -> { word: { lemma, level, gloss } } — 어려운 단어만.
export function createAnnotate({ dict, levels = loadWordLevels() }) {
  const known = new Map(); // 낱말 -> { lemma, level, gloss } | null(사전에 없음·뜻 없음). 기준 등급과 무관해서 등급이 달라도 재사용한다.
  const rank = (l) => LEVELS.indexOf(l);

  async function resolve(word) {
    if (known.has(word)) return known.get(word);
    const r = await dict.lookup(word); // 오류는 캐시하지 않고 올린다
    let v = null;
    const e = r.found ? r.entries?.[0] : null;
    const gloss = e ? shortGloss(e.senses?.[0]?.text) : '';
    if (gloss) {
      const lemma = lemmaOf(e, word);
      v = { lemma, level: levels.get(lemma) ?? null, gloss };
    }
    if (known.size >= MAX_CACHE) known.clear();
    known.set(word, v);
    return v;
  }

  return async function annotate(words, level = DEFAULT_LEVEL) {
    const min = rank(level);
    const items = {};
    for (const w of new Set(words)) {
      // ponytail: 표면형이 목록에서 이미 기준 미만이면 원형 확인 없이 쉬움. 흔한 단어는 표제어가 많아 사전이 20ms 쯤 걸리기 때문이고, 어긋나면 주석이 덜 붙을 뿐이다.
      const own = levels.get(w);
      if (own !== undefined && rank(own) < min) continue;
      const v = await resolve(w);
      if (v && (v.level === null || rank(v.level) >= min)) items[w] = v;
    }
    return items;
  };
}
