// 내 사전: 사용자가 직접 정한 뜻(약어·낱말·구). 키는 소문자·공백 정리한 철자. 파일 하나(JSON), 쓸 때마다 임시 파일 -> rename.
// 우선순위가 가장 높다: /annotate·/dict·/mt 는 내 사전을 먼저 보고(캐시 밖에서 읽는다), 번역 프롬프트에는 "용어 지정"으로 싣는다.
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { variants } from './glossary.mjs';

export const MAX_KEY = 80;
const LIMIT = { ko: 80, exp: 120, note: 200, url: 2000, title: 200 };
const KEY_RE = /^[a-z0-9 '’.-]+$/;
const ALNUM = /[a-z0-9]/;

const clean = (s) => s.replace(/\s+/g, ' ').trim();

// 아무 철자 -> 키(소문자·공백 정리) | null(비었거나 80자 초과, 허용 글자 밖)
export function normalizeKey(s) {
  if (typeof s !== 'string') return null;
  const k = clean(s).toLowerCase();
  return k && k.length <= MAX_KEY && KEY_RE.test(k) ? k : null;
}

// 선택한 글 전체가 키와 같은지 볼 때: 그대로 정리한 철자, 안 되면 앞뒤 부호를 걷은 철자("PCA." -> pca)
export function keysOfText(text) {
  const k = normalizeKey(text);
  const stripped = typeof text === 'string' ? normalizeKey(text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')) : null;
  return [...new Set([k, stripped].filter(Boolean))];
}

// 요청 본문 -> { op:'set', key, ko, exp, note, url, title } | { op:'delete', key } | null. 길이를 넘으면 자르지 않고 거절(null)한다.
export function parseMydictOp(v) {
  if (!v || typeof v !== 'object') return null;
  const key = normalizeKey(v.key);
  if (!key) return null;
  if (v.op === 'delete') return { op: 'delete', key };
  if (v.op !== 'set') return null;
  const field = (name, min) => {
    const raw = v[name] ?? '';
    if (typeof raw !== 'string') return null;
    const s = clean(raw);
    return s.length >= min && s.length <= LIMIT[name] ? s : null;
  };
  const ko = field('ko', 1);
  const exp = field('exp', 0);
  const note = field('note', 0);
  const title = field('title', 0);
  const urlRaw = v.url ?? '';
  if (ko === null || exp === null || note === null || title === null || typeof urlRaw !== 'string' || urlRaw.length > LIMIT.url) return null;
  if (urlRaw && !/^https?:\/\//i.test(urlRaw)) return null; // 패널이 링크로 쓸 수 있으니 http(s) 만
  return { op: 'set', key, ko, exp, note, url: urlRaw, title };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// 파일이 깨졌으면 빈 상태로 시작하되 원본은 .broken 으로 남긴다.
function load(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const v = JSON.parse(raw);
    if (isObj(v?.entries)) return v.entries;
  } catch {
    // 아래에서 처리
  }
  try {
    copyFileSync(file, `${file}.broken`);
  } catch {
    // 백업 실패는 무시
  }
  return {};
}

// 저장된 항목 -> 응답 모양. 빈 exp·note·url·title 은 뺀다.
const view = (e) => ({ ko: e.ko, ...(e.exp && { exp: e.exp }), ...(e.note && { note: e.note }), ...(e.url && { url: e.url }), ...(e.title && { title: e.title }), ts: e.ts });

export function createMydict({ file, now = Date.now }) {
  // Map 이라 constructor 같은 키도 평범한 키로 다룬다.
  const map = new Map();
  for (const [k, v] of Object.entries(load(file))) {
    if (normalizeKey(k) === k && isObj(v) && typeof v.ko === 'string' && v.ko) {
      map.set(k, { ko: str(v.ko, LIMIT.ko), exp: str(v.exp, LIMIT.exp), note: str(v.note, LIMIT.note), url: str(v.url, LIMIT.url), title: str(v.title, LIMIT.title), ts: Number.isFinite(v.ts) ? v.ts : 0 });
    }
  }

  const all = () => ({ entries: Object.fromEntries([...map].map(([k, e]) => [k, view(e)])) });

  function persist() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all()));
    renameSync(tmp, file); // 원자적 교체
  }

  // 키 하나(철자 그대로) -> { key, ...항목 } | null
  const get = (key) => (map.has(key) ? { key, ...view(map.get(key)) } : null);

  return {
    all,
    get,
    // 낱말 -> 내 사전 항목. 복수형 규칙(variants)까지 본다. 내 사전의 원형이 key.
    find(word) {
      for (const v of variants(word)) {
        const e = get(v);
        if (e) return e;
      }
      return null;
    },
    // 선택한 글 전체가 키와 같은가(/mt)
    findText(text) {
      for (const k of keysOfText(text)) {
        const e = get(k);
        if (e) return e;
      }
      return null;
    },
    // 글 안에 나온 키 -> ["pca=주성분 분석", ...] 나온 순서, 최대 max. 키는 낱말 경계에서만(뒤에 복수 s 허용).
    termsIn(text, max = 30) {
      const t = String(text).toLowerCase().replace(/\s+/g, ' ');
      const hits = [];
      for (const [key, e] of map) {
        for (let at = t.indexOf(key); at >= 0; at = t.indexOf(key, at + 1)) {
          let end = at + key.length;
          if (t[end] === 's' && !ALNUM.test(t[end + 1] ?? '')) end++;
          if (!ALNUM.test(t[at - 1] ?? '') && !ALNUM.test(t[end] ?? '')) {
            hits.push({ at, term: `${key}=${e.ko}` });
            break;
          }
        }
      }
      return hits.sort((a, b) => a.at - b.at).slice(0, max).map((h) => h.term);
    },
    // parseMydictOp 를 통과한 요청만 받는다. 바뀐 전체 상태를 돌려준다.
    // ponytail: 메모리를 먼저 바꾸고 쓴다. 디스크 쓰기가 실패하면 이 실행 동안만 메모리와 파일이 어긋난다(파일은 rename 으로 안 깨진다).
    apply(op) {
      if (op.op === 'delete') map.delete(op.key);
      else map.set(op.key, { ko: op.ko, exp: op.exp, note: op.note, url: op.url, title: op.title, ts: now() });
      persist();
      return all();
    },
  };
}
