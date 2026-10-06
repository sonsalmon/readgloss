// 분야 용어집: 사전 첫 뜻보다 먼저 쓰는 "분야별 정식 번역어". AI 는 쓰지 않고, 파일 세 개(bridge/glossaries/*.json)를 한 번 읽어 둔다.
// 데이터를 만든 방법·출처는 bridge/glossaries/SOURCE.md. 두 단어 이상(phrases-*.json)은 아직 쓰지 않는다.
import { readFileSync } from 'node:fs';

export const DOMAINS = ['security', 'ml', 'math'];
export const MAX_TERMS = 30; // 번역 프롬프트에 싣는 용어 지정 개수 상한
const MAX_HOST = 253;

// 사이트 규칙(하위 도메인 포함). 값의 순서가 분야 우선순위다.
export const SITE_RULES = { 'academy.hackthebox.com': ['security', 'ml', 'math'] };

export function loadGlossaries() {
  return Object.fromEntries(DOMAINS.map((d) => [d, JSON.parse(readFileSync(new URL(`./glossaries/${d}.json`, import.meta.url), 'utf8'))]));
}

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

export function createGlossary(data = loadGlossaries()) {
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

  return {
    find,
    // 요청 { host?, domains? } -> 활성 분야(우선순위 순). 페이지가 알려 준 힌트가 앞, 사이트 기본값이 뒤. 이상한 값은 조용히 버린다.
    domains(req) {
      const hints = Array.isArray(req?.domains) ? req.domains.filter((d) => DOMAINS.includes(d)) : [];
      const host = typeof req?.host === 'string' && req.host.length <= MAX_HOST ? req.host.toLowerCase() : '';
      const site = Object.entries(SITE_RULES).find(([h]) => host === h || host.endsWith(`.${h}`))?.[1] ?? [];
      return [...new Set([...hints, ...site])];
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
