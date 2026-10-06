// 분야 용어집: 사전 첫 뜻보다 먼저 쓰는 "분야별 정식 번역어". AI 는 쓰지 않고, 파일 세 개(bridge/glossaries/*.json)를 한 번 읽어 둔다.
// 데이터를 만든 방법·출처는 bridge/glossaries/SOURCE.md. 두 단어 이상(phrases-*.json)은 낱말 용어집에 섞지 않고, 드래그 번역(/mt)이 구 전체가 같을 때만 findPhrase 로 찾는다.
import { readFileSync } from 'node:fs';

export const DOMAINS = ['security', 'ml', 'math'];
export const MAX_TERMS = 30; // 번역 프롬프트에 싣는 용어 지정 개수 상한

export function loadGlossaries() {
  return Object.fromEntries(DOMAINS.map((d) => [d, JSON.parse(readFileSync(new URL(`./glossaries/${d}.json`, import.meta.url), 'utf8'))]));
}

export const loadAcronyms = () => JSON.parse(readFileSync(new URL('./glossaries/acronyms.json', import.meta.url), 'utf8'));

export const loadPhrases = () => Object.fromEntries(DOMAINS.map((d) => [d, JSON.parse(readFileSync(new URL(`./glossaries/phrases-${d}.json`, import.meta.url), 'utf8'))]));

// 낱말 -> 용어집에서 찾아볼 후보 철자(원형 먼저, 복수형 규칙만).
// ponytail: -ing·-ed 는 일부러 안 푼다(meaning -> mean 같은 오탐). 그런 활용형은 사전이 준 원형으로 다시 찾는다.
export function variants(word) {
  const w = String(word).toLowerCase();
  const out = [w];
  if (/ies$/.test(w)) out.push(w.slice(0, -3) + 'y');
  if (/ices$/.test(w)) out.push(w.slice(0, -4) + 'ix');
  if (/(?:s|x|z|ch|sh)es$/.test(w)) out.push(w.slice(0, -2));
  if (/[^s]s$/.test(w)) out.push(w.slice(0, -1));
  return out;
}

export function createGlossary(data = loadGlossaries(), phrases = loadPhrases(), acronyms = loadAcronyms()) {
  const find = (word, active = []) => {
    for (const v of variants(word)) {
      for (const d of active) {
        // 자기 속성만: 'constructor' 같은 상속 속성이 용어로 잡히지 않게
        const ko = data[d] && Object.hasOwn(data[d], v) ? data[d][v] : null;
        if (typeof ko === 'string' && ko) return { ko, domain: d, key: v };
      }
    }
    return null;
  };

  // 구 전체(공백 정리·소문자·앞뒤 부호 제거)가 켜진 분야의 구와 같을 때만. 부분 일치·활용형은 안 푼다(없으면 맥 번역 결과만 보인다).
  const findPhrase = (text, active = []) => {
    const key = String(text).toLowerCase().replace(/\s+/g, ' ').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    for (const d of active) {
      const ko = key && phrases[d] && Object.hasOwn(phrases[d], key) ? phrases[d][key] : null;
      if (typeof ko === 'string' && ko) return { ko, domain: d };
    }
    return null;
  };

  // 약어(소문자 키) -> { exp, ko, d } | null. active 를 주면 그 약어의 분야가 활성일 때만(/annotate), 안 주면 분야와 무관(/dict).
  const acronym = (key, active) => {
    const a = typeof key === 'string' && Object.hasOwn(acronyms, key) ? acronyms[key] : null;
    return a && (!active || active.includes(a.d)) ? a : null;
  };

  return {
    find,
    findPhrase,
    acronym,
    // 요청 { domains? } -> 활성 분야(우선순위 순 = 힌트 순서). 어느 사이트에서 용어집을 켤지는 확장 설정(glossarySites)이 정하고, 다리는 보내 준 힌트만 믿는다(host 는 안 본다). 이상한 값은 조용히 버린다.
    domains(req) {
      const hints = Array.isArray(req?.domains) ? req.domains.filter((d) => DOMAINS.includes(d)) : [];
      return [...new Set(hints)];
    },
    // 활성 분야 조합 -> 캐시 키에 붙이는 문자열(순서가 우선순위라 순서도 키의 일부)
    keyOf: (active) => active.join(','),
    // 글 안의 용어집 단어 -> ["transpose=전치(행렬)", ...] 나온 순서, 중복 없이 최대 MAX_TERMS
    termsIn(text, active) {
      const out = [];
      const seen = new Set();
      if (!active.length) return out;
      for (const m of String(text).toLowerCase().matchAll(/[a-z]+/g)) {
        const t = find(m[0], active);
        if (!t || seen.has(t.key)) continue;
        seen.add(t.key);
        out.push(`${t.key}=${t.ko}`);
        if (out.length >= MAX_TERMS) break;
      }
      return out;
    },
  };
}
