// 스크랩 저장소: data/scraps.json
// 단일 JSON 파일 저장. 변경 시 임시 파일 -> rename (원자적 교체).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// 할 일 id 형식: S1-04, S1-02b, BUF-01. 여기서만 정의하고 task-guess도 이 값을 쓴다.
export const TASK_RE = /^(?:S\d-\d{2}[a-z]?|BUF-\d{2})$/;
// 글 안에서 id를 찾는 형식(앞뒤가 영숫자·하이픈이 아닐 때만 — S1-02b를 S1-02로 읽지 않게).
export const TASK_FIND_RE = /(?<![A-Za-z0-9-])(?:S\d-\d{2}[a-z]?|BUF-\d{2})(?![A-Za-z0-9])/;
export const SCRAP_ID_RE = /^[0-9a-f]{12}$/;
const LIMIT = {
  exact: 1000,
  prefix: 64,
  suffix: 64,
  headingsCount: 3,
  headingLength: 200,
  title: 300,
  url: 2000,
  translation: 2000,
  memo: 1000,
};

// 주소 정규화: # 뒤를 버리고, utm_* 쿼리만 지우고, 끝 /를 뗀다. 나머지 쿼리는 원문 조각을 유지한다.
export function normalizeUrl(input) {
  if (typeof input !== 'string') return '';
  const u = input.trim();
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const withoutHash = u.split('#')[0];
    const qIndex = withoutHash.indexOf('?');
    const queryPart = qIndex === -1 ? '' : withoutHash.slice(qIndex + 1);

    const pathname = parsed.pathname.replace(/\/+$/, '');
    const base = `${parsed.protocol}//${parsed.host}${pathname}`;

    const kept = queryPart
      .split('&')
      .filter((part) => part.length > 0 && !part.startsWith('utm_'));
    const query = kept.length > 0 ? `?${kept.join('&')}` : '';
    return `${base}${query}`;
  } catch {
    return '';
  }
}

// 스크랩 id: 정규화 주소 + exact + prefix 를 \u0000 으로 구분해 sha1 앞 12자
export function scrapId(url, exact, prefix = '') {
  const normUrl = normalizeUrl(url);
  const text = `${normUrl}\u0000${exact ?? ''}\u0000${prefix ?? ''}`;
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

// 상한 검사 헬퍼: undefined/null 은 기본값, 문자열이고 상한 이내면 그대로, 초과하거나 문자열 아니면 null
const strField = (v, max, def = '') =>
  v === undefined || v === null ? def : typeof v === 'string' && v.length <= max ? v : null;

// 요청 본문 파싱 및 검증: 상한 넘으면 null (자르지 않음)
export function parseScrapOp(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;

  if (v.op === 'save') {
    if (typeof v.url !== 'string' || v.url.length > LIMIT.url) return null;
    const url = normalizeUrl(v.url);
    if (!url) return null;

    let task = null;
    if (v.task !== undefined && v.task !== null) {
      if (typeof v.task !== 'string' || !TASK_RE.test(v.task)) return null;
      task = v.task;
    }

    const title = strField(v.title, LIMIT.title, '');
    if (title === null) return null;

    let headings = [];
    if (v.headings !== undefined && v.headings !== null) {
      if (!Array.isArray(v.headings) || v.headings.length > LIMIT.headingsCount) return null;
      for (const h of v.headings) {
        if (typeof h !== 'string' || h.length > LIMIT.headingLength) return null;
      }
      headings = [...v.headings];
    }

    if (!v.quote || typeof v.quote !== 'object' || Array.isArray(v.quote)) return null;
    const exact = v.quote.exact;
    if (typeof exact !== 'string' || exact.length < 1 || exact.length > LIMIT.exact) return null;

    const prefix = strField(v.quote.prefix, LIMIT.prefix, '');
    const suffix = strField(v.quote.suffix, LIMIT.suffix, '');
    if (prefix === null || suffix === null) return null;

    let pos = 0;
    if (v.pos !== undefined && v.pos !== null) {
      if (typeof v.pos !== 'number' || !Number.isFinite(v.pos)) return null;
      pos = v.pos;
    }

    const translation = strField(v.translation, LIMIT.translation, '');
    const memo = strField(v.memo, LIMIT.memo, '');
    if (translation === null || memo === null) return null;

    return {
      op: 'save',
      task,
      url,
      title,
      headings,
      quote: { exact, prefix, suffix },
      pos,
      translation,
      memo,
    };
  }

  if (v.op === 'remove') {
    if (typeof v.id !== 'string' || !SCRAP_ID_RE.test(v.id)) return null;
    return { op: 'remove', id: v.id };
  }

  if (v.op === 'memo') {
    if (typeof v.id !== 'string' || !SCRAP_ID_RE.test(v.id)) return null;
    if (typeof v.memo !== 'string' || v.memo.length > LIMIT.memo) return null;
    return { op: 'memo', id: v.id, memo: v.memo };
  }

  if (v.op === 'move') {
    if (typeof v.id !== 'string' || !SCRAP_ID_RE.test(v.id)) return null;
    let task = null;
    if (v.task === null || v.task === 'inbox') {
      task = null;
    } else if (typeof v.task === 'string' && TASK_RE.test(v.task)) {
      task = v.task;
    } else {
      return null;
    }
    return { op: 'move', id: v.id, task };
  }

  return null;
}

function isValidStoredScrap(s) {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    SCRAP_ID_RE.test(s.id) &&
    (s.task === null || (typeof s.task === 'string' && TASK_RE.test(s.task))) &&
    typeof s.url === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.headings) &&
    s.quote &&
    typeof s.quote.exact === 'string' &&
    Number.isFinite(s.pos) &&
    typeof s.translation === 'string' &&
    typeof s.memo === 'string' &&
    Number.isFinite(s.ts)
  );
}

function load(file, now) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return new Map();
  }
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && v.v === 1 && v.scraps && typeof v.scraps === 'object' && !Array.isArray(v.scraps)) {
      const map = new Map();
      for (const [k, s] of Object.entries(v.scraps)) {
        if (s && s.id === k && isValidStoredScrap(s)) {
          map.set(k, {
            id: s.id,
            task: s.task,
            url: s.url,
            title: s.title,
            headings: [...s.headings],
            quote: { exact: s.quote.exact, prefix: s.quote.prefix ?? '', suffix: s.quote.suffix ?? '' },
            pos: s.pos,
            translation: s.translation,
            memo: s.memo,
            ts: s.ts,
          });
        }
      }
      return map;
    }
  } catch {
    // 파싱 오류
  }
  // 깨진 파일은 <파일>.bad-<ts> 로 이름 바꿔 보존 후 빈 목록
  try {
    renameSync(file, `${file}.bad-${now()}`);
  } catch {
    // 백업 실패 무시
  }
  return new Map();
}

export function createScraps({ file, now = Date.now }) {
  const scraps = load(file, now);

  const copy = (s) => ({
    id: s.id,
    task: s.task,
    url: s.url,
    title: s.title,
    headings: [...s.headings],
    quote: { ...s.quote },
    pos: s.pos,
    translation: s.translation,
    memo: s.memo,
    ts: s.ts,
  });

  const all = () => Array.from(scraps.values()).map(copy);

  function persist() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, scraps: Object.fromEntries(scraps) }));
    renameSync(tmp, file);
  }

  return {
    all,
    has(id) {
      return scraps.has(id);
    },
    forUrl(url) {
      const norm = normalizeUrl(url);
      return Array.from(scraps.values())
        .filter((s) => s.url === norm)
        .map(copy);
    },
    apply(op) {
      if (!op || typeof op !== 'object') return null;

      if (op.op === 'save') {
        const id = scrapId(op.url, op.quote.exact, op.quote.prefix);
        const existing = scraps.get(id);
        const scrap = {
          id,
          task: op.task,
          url: op.url,
          title: op.title,
          headings: [...op.headings],
          quote: {
            exact: op.quote.exact,
            prefix: op.quote.prefix,
            suffix: op.quote.suffix,
          },
          pos: op.pos,
          translation: op.translation,
          memo: existing ? existing.memo : op.memo,
          ts: existing ? existing.ts : now(),
        };
        scraps.set(id, scrap);
        persist();
        return all();
      }

      if (op.op === 'remove') {
        if (!scraps.has(op.id)) return null;
        scraps.delete(op.id);
        persist();
        return all();
      }

      if (op.op === 'memo') {
        const existing = scraps.get(op.id);
        if (!existing) return null;
        existing.memo = op.memo;
        scraps.set(op.id, existing);
        persist();
        return all();
      }

      if (op.op === 'move') {
        const existing = scraps.get(op.id);
        if (!existing) return null;
        existing.task = op.task;
        scraps.set(op.id, existing);
        persist();
        return all();
      }

      return null;
    },
  };
}
