// 어려운 영어 단어 판정과 짧은 한국어 뜻(/annotate). AI 는 쓰지 않는다: 분야 용어집 → 활성 분야 표시가 붙은 사전 뜻 → 맥 영한사전 첫 표제어의 첫 뜻 순으로 다듬는다.
import { readFileSync } from 'node:fs';
import { createGlossary } from './glossary.mjs';
import { baseP, threshold } from './wstat.mjs';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const DEFAULT_LEVEL = 'B2';
export const ANNOTATE_LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2']; // 요청에서 고를 수 있는 기준 등급
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

// 분야 표시 뜻 고르기. 사전은 뜻 앞에 〔수학〕〔컴퓨터〕 같은 분야 표시를 붙인다. 같은 〔 〕가 〔…에의〕 같은 문법 메모에도 쓰여서, 아래 분야 낱말에 드는 것만 분야 표시로 본다.
// 활성 분야(요청 domains)마다 보는 표시. 앞선 분야가 우선이고, 한 분야 안에서는 사전에 먼저 나온 뜻이 이긴다.
const DOMAIN_TAGS = new Map([
  ['math', ['수학', '통계', '기하', '대수', '확률']],
  ['ml', ['컴퓨터', '통계', '수학']],
  ['security', ['컴퓨터', '통신']],
]);
const FIELD_WORDS = new Set([...DOMAIN_TAGS.values()].flat());
const TAG_GROUP = /〔([^〕]*)〕/g;

// 사전 표제어 배열(parseEntry 결과) -> 분야 표시가 붙은 뜻 목록 [{ tags, ko }](사전에 나온 순서). 분야와 무관하게 만들어서 단어 하나에 한 번만 만들고 캐시한다.
// 표시가 뜻 맨 앞이 아니어도("빼기, 감하기; 〔수학〕 뺄셈") 표시부터의 첫 조각을 다듬는다. 같은 철자 표제어가 여럿이면 모두 본다.
// 표시 바로 뒤에 〈…이〉·（…의） 같은 쓰임 제한이 붙은 뜻("〔수학〕 〈근을〉 구하다")은 건너뛴다: 짧게 다듬으면 제한이 빠져 뜻이 틀려 보인다(extract 가 "구하다").
const RESTRICTED = /^\s*[〈（]/;
export function taggedGlosses(entries) {
  const out = [];
  for (const e of entries ?? []) {
    for (const { text } of e?.senses ?? []) {
      if (typeof text !== 'string') continue;
      for (const m of text.matchAll(TAG_GROUP)) {
        const tags = m[1].split(/[·,，、\s]+/).filter((w) => FIELD_WORDS.has(w));
        const rest = text.slice(m.index + m[0].length);
        const ko = tags.length && !RESTRICTED.test(rest) ? shortGloss(rest) : '';
        if (ko) out.push({ tags, ko });
      }
    }
  }
  return out;
}

// 분야 표시 뜻 목록 + 활성 분야(우선순위 순) -> { ko, tag } | null. null 이면 첫 뜻을 쓴다.
export function pickSense(tagged, domains = []) {
  for (const d of domains) {
    const list = DOMAIN_TAGS.get(d);
    if (!list) continue;
    for (const t of tagged) {
      const tag = t.tags.find((x) => list.includes(x));
      if (tag) return { ko: t.ko, tag };
    }
  }
  return null;
}

// 흔한 낱말(A1~B1)은 분야 표시 뜻을 안 쓴다. 글 전체 힌트로는 문장 속 뜻을 못 가려서, 일상 뜻이 맞는 낱말(base 밑변, simple 단일의, produce 연장하다…)이 틀려진다. 목록 밖(null)·B2 이상은 쓴다.
// 흔한 낱말의 분야 뜻은 용어집에 넣어 정한다. 기준을 바꾸려면 아래 등급만 고친다.
const COMMON_MAX = 'B1';
export const isCommon = (level) => LEVELS.includes(level) && LEVELS.indexOf(level) <= LEVELS.indexOf(COMMON_MAX);

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ·]/g, '').toLowerCase().replace(/^[-\s]+|[-\s]+$/g, '');

// 굴절 안내 항목: 맥 사전이 활용형 철자에 주는 "mat·ri·ces | méitrisìːz | 명사matrix 의 복수형." 같은 항목. 본문 전체가 "<낱말> 의 복수형·과거(분사)·현재분사·비교급·최상급·3인칭 단수" 한 줄일 때만 본다.
// 자기 뜻이 더 있는 표제어(gone 형용사)나 본문 속 말은 걸리지 않는다. 돌려주는 값은 그 <낱말>(원형), 아니면 null.
const INFLECTION = /^(?:(?:대명사|명사|타동사|자동사|동사|형용사|부사)[,\s∙·]*)*([A-Za-z][A-Za-z'’-]*)\s*[¹²³⁴⁵⁶⁷⁸⁹]*\s*의\s*(?:복수|과거|현재\s*분사|분사|비교급|최상급|3인칭)[가-힣·\s]*[.。]?\s*$/;
export function inflectionOf(entry) {
  const raw = entry?.raw ?? '';
  const body = raw.replace(/^.{1,60}? \| .{0,80}? \| /, '').trim();
  return body.length < 80 ? (INFLECTION.exec(body)?.[1].toLowerCase() ?? null) : null;
}

// 사전 표제어 -> 원형 낱말. 도우미의 headword 는 입력 철자(mitigations)나 악센트 철자(páylòad)일 수 있어서
// 본문 머리("mit·i·ga·tion | …", "ex·ploit 2 | …")를 먼저 본다. 굴절 안내 항목이면 안내가 가리키는 낱말이 원형이다.
export function lemmaOf(entry, word) {
  const infl = inflectionOf(entry);
  if (infl) return infl;
  const raw = entry?.raw ?? '';
  const i = raw.indexOf(' | ');
  // 활용형 조회는 발음 칸(" | ")이 없어 본문 맨 앞 낱말("trans·póse 동사…")이 원형이다.
  const head = raw.match(/^[A-Za-zÀ-ɏ·'’-]+/)?.[0] ?? '';
  for (const c of [i > 0 && i <= 60 ? raw.slice(0, i).replace(/\s+\d{1,2}$/, '') : '', head, entry?.headword ?? '']) {
    const n = plain(c);
    if (/^[a-z][a-z'’-]*$/.test(n)) return n;
  }
  return word;
}

// 사전 표제어 배열 -> { lemma, e }. e 는 뜻을 고를 항목. 첫 항목이 굴절 안내(matrices -> "matrix 의 복수형")면 원형은 안내가 가리키는 낱말이고,
// 뜻은 표제어가 그 낱말인 항목(없으면 안내가 아닌 다음 항목, 그것도 없으면 null)에서 고른다. 아니면 첫 항목이다.
// ponytail: 첫 항목만 본다(ran 처럼 안내가 뒤에 오면 그대로 ran). 안내 항목이 둘(bases)이면 먼저 나온 것을 따른다.
export function pickEntry(entries, word) {
  const first = entries?.[0];
  const base = inflectionOf(first);
  if (!base) return { lemma: first ? lemmaOf(first, word) : word, e: first ?? null };
  const rest = entries.slice(1).filter((x) => !inflectionOf(x));
  return { lemma: base, e: rest.find((x) => plain(x.headword ?? '') === base) ?? rest[0] ?? null };
}

// 흔한 활용형 및 끝말 제거 형태 목록(배열)을 돌려준다.
// formsOf(w) = w, w+s, w+es, w+ed, w+d, w+ing, (끝 e 뺀 w)+ing, (끝 y→i)+es/ed, 자음 하나 겹친 w+ed/ing(run→running), 그리고 반대로 표면형에서 그 끝말을 뺀 형태.
// ponytail: 불규칙 활용(ran→run)은 사전이 원형을 줄 때만 이어진다.
export function formsOf(w) {
  if (typeof w !== 'string' || !w) return [];
  const s = new Set();
  const lower = w.toLowerCase();
  s.add(lower);

  // 앞으로 뻗는 활용 (w + ...)
  s.add(lower + 's');
  s.add(lower + 'es');
  s.add(lower + 'ed');
  s.add(lower + 'd');
  s.add(lower + 'ing');

  // (끝 e 뺀 w) + ing (make -> making)
  if (lower.endsWith('e') && lower.length > 1) {
    s.add(lower.slice(0, -1) + 'ing');
  }

  // (끝 y→i) + es/ed (study -> studies, studied)
  if (lower.endsWith('y') && lower.length > 1) {
    const base = lower.slice(0, -1);
    s.add(base + 'ies');
    s.add(base + 'ied');
  }

  // 자음 하나 겹친 w+ed/ing (run -> running, runned)
  const lastChar = lower[lower.length - 1];
  if (lower.length >= 2 && !'aeiou'.includes(lastChar) && /^[a-z]$/.test(lastChar)) {
    s.add(lower + lastChar + 'ing');
    s.add(lower + lastChar + 'ed');
  }

  // 반대로 표면형에서 그 끝말을 뺀 형태
  // -s
  if (lower.endsWith('s') && lower.length > 2) {
    s.add(lower.slice(0, -1));
  }
  // -es
  if (lower.endsWith('es') && lower.length > 3) {
    s.add(lower.slice(0, -2));
  }
  // -ed
  if (lower.endsWith('ed') && lower.length > 3) {
    s.add(lower.slice(0, -2));
    s.add(lower.slice(0, -1)); // -d 만 뺀 것
  }
  // -d
  if (lower.endsWith('d') && lower.length > 2) {
    s.add(lower.slice(0, -1));
  }
  // -ing
  if (lower.endsWith('ing') && lower.length > 4) {
    s.add(lower.slice(0, -3));
    s.add(lower.slice(0, -3) + 'e'); // making -> make
  }
  // -ies -> -y
  if (lower.endsWith('ies') && lower.length > 4) {
    s.add(lower.slice(0, -3) + 'y');
  }
  // -ied -> -y
  if (lower.endsWith('ied') && lower.length > 4) {
    s.add(lower.slice(0, -3) + 'y');
  }
  // 자음 중복 해제 (running -> run, stopped -> stop)
  if (lower.endsWith('ing') && lower.length > 5) {
    const stem = lower.slice(0, -3);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      s.add(stem.slice(0, -1));
    }
  }
  if (lower.endsWith('ed') && lower.length > 4) {
    const stem = lower.slice(0, -2);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      s.add(stem.slice(0, -1));
    }
  }

  return [...s].filter((f) => f && /^[a-z][a-z'’-]*$/.test(f));
}

// dict: createDict() 같은 { lookup(word) }. levels: 낱말 -> 등급 Map. isKnown: 원형 -> 아는 단어인가(아는 단어는 결과에서 뺀다).
// glossary: createGlossary() 같은 { find(word, 활성 분야) }. 돌려주는 함수: (words, level, domains) -> { word: { lemma, level, gloss } } — 어려운 단어만.
// domains(활성 분야, 우선순위 순)에 용어집 뜻이 있으면 gloss 를 그 뜻으로 바꾸고 term:true, domain 을 붙인다. 용어집에 없고 사전 뜻에 활성 분야 표시(〔수학〕 등)가 있으면 그 뜻을 쓴다. 용어집 덮어쓰기는 사전 캐시(known) 밖에서 해서 분야마다 뜻이 달라도 캐시가 섞이지 않는다.
// mydict: createMydict() 같은 { find(word), get(key) }. 내 사전은 가장 우선이라 기준 등급·아는 단어 판정·사전 캐시 앞에서, 캐시 밖에서 읽는다(바뀌면 바로 반영).
// 돌려주는 함수의 넷째 인자 acronyms(원래 대문자 철자 목록)는 키 = 원래 철자인 { lemma, gloss, term:true, acronym:true, domain|mine } 항목을 더한다. 맥 사전은 안 부른다.
export function createAnnotate({ dict, levels = loadWordLevels(), isKnown = () => false, glossary = createGlossary(), mydict = { find: () => null, get: () => null }, scoreOf, thresholdFor }) {
  const known = new Map(); // 낱말 -> { lemma, level, gloss(첫 뜻), tagged(분야 표시 뜻 목록) } | null(사전에 없음·뜻 없음). 기준 등급·분야와 무관해서 달라도 재사용한다. 분야에 맞는 뜻은 매번 고른다.
  const rank = (l) => LEVELS.indexOf(l);

  async function resolve(word) {
    if (known.has(word)) return known.get(word);
    const r = await dict.lookup(word); // 오류는 캐시하지 않고 올린다
    let v = null;
    const { e, lemma } = r.found ? pickEntry(r.entries, word) : { e: null };
    const gloss = e ? shortGloss(e.senses?.[0]?.text) : '';
    if (gloss) {
      v = { lemma, level: levels.get(lemma) ?? null, gloss, tagged: taggedGlosses(r.entries) };
    }
    if (known.size >= MAX_CACHE) known.clear();
    known.set(word, v);
    return v;
  }

  return async function annotate(words, level = DEFAULT_LEVEL, domains = [], acronyms = [], scoreOfOverride) {
    const effScoreOf = scoreOfOverride !== undefined ? scoreOfOverride : scoreOf;
    const min = rank(level);
    const th = thresholdFor ? thresholdFor(level) : threshold(level, 0);
    const items = {};
    // 약어: 내 사전(분야와 무관) -> 약어집(그 약어의 분야가 활성일 때만). 아는 단어(원형 = 소문자 철자)는 뺀다.
    for (const a of new Set(acronyms)) {
      const key = a.toLowerCase();
      const m = mydict.get(key);
      if (m) items[a] = { lemma: key, gloss: m.ko, term: true, mine: true, acronym: true };
      else if (!isKnown(key)) {
        const g = glossary.acronym(key, domains);
        if (g) items[a] = { lemma: key, gloss: g.ko, term: true, domain: g.d, acronym: true };
      }
    }
    for (const w of new Set(words)) {
      const m = mydict.find(w);
      if (m) {
        items[w] = { lemma: m.key, gloss: m.ko, term: true, mine: true };
        continue;
      }
      // ponytail: 표면형이 목록에서 이미 기준 미만이면 원형 확인 없이 쉬움. 흔한 단어는 표제어가 많아 사전이 20ms 쯤 걸리기 때문이고, 어긋나면 주석이 덜 붙을 뿐이다.
      // scoreOf가 있을 때: 그 등급의 바탕 p가 기준보다 낮고 표면형이 단어장·찾아본 기록에 없으면 사전 없이 건너뛴다(감소는 p를 낮출 뿐이라 결과가 같다).
      const own = levels.get(w);
      if (effScoreOf) {
        const bp = own !== undefined ? baseP(own) : null;
        if (bp !== null && bp < th - 1e-9) {
          const hasSavedOrLookup = typeof effScoreOf.hasSavedOrLookup === 'function'
            ? effScoreOf.hasSavedOrLookup(w)
            : (effScoreOf(w, own) >= 0.90);
          if (!hasSavedOrLookup) continue;
        }
      } else {
        if (own !== undefined && rank(own) < min) continue;
      }
      if (isKnown(w)) continue; // 표면형이 곧 아는 원형이면 사전도 안 부른다
      // 용어집에 철자(복수형 포함)가 있으면 사전은 안 부른다: 용어집 단어는 사전에 없거나 엉뚱한 뜻이 첫 줄인 일이 많다.
      let v;
      const direct = glossary.find(w, domains);
      if (direct) v = { lemma: direct.key, level: levels.get(direct.key) ?? null, gloss: direct.ko, term: true, domain: direct.domain };
      else {
        v = await resolve(w);
        const t = v && glossary.find(v.lemma, domains); // 활용형(normalized)은 사전이 준 원형으로 다시 찾는다
        if (t) v = { lemma: t.key, level: levels.get(t.key) ?? v.level, gloss: t.ko, term: true, domain: t.domain };
        else if (v) v = { lemma: v.lemma, level: v.level, gloss: (isCommon(v.level) ? null : pickSense(v.tagged, domains))?.ko ?? v.gloss }; // 용어집에 없으면 활성 분야의 사전 표시 뜻(흔한 낱말 제외), 없으면 첫 뜻
      }
      // 아는 단어 판정은 캐시(resolve) 밖에서 한다: 취소하면 사전을 다시 부르지 않고 바로 다시 나온다
      if (v && !isKnown(v.lemma)) {
        if (effScoreOf) {
          const p = effScoreOf(v.lemma, v.level, w);
          if (p >= th - 1e-9) items[w] = v;
        } else {
          if (v.level === null || rank(v.level) >= min) items[w] = v;
        }
      }
    }
    return items;
  };
}
