// 공부 기록: 사용자가 본 것(사전 카드·번역·AI 뜻·단어장 추가 등)을 한 줄씩 남긴다(JSONL). 기록 실패는 응답에 영향 주지 않는다(호출한 쪽이 try/catch).
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const KINDS = ['dict', 'mt', 'context', 'aigloss', 'paragraph', 'save', 'known', 'mydict', 'scrap'];
export const RETENTION_DAYS = 90;
export const MAX_DAYS = 60;
export const DEFAULT_DAYS = 7;
const MAX_TEXT = 200;
const MAX_URL = 2000;
const MAX_ITEMS_PER_DAY = 200;
const DAY_MS = 86_400_000;

const pad = (n) => String(n).padStart(2, '0');
// 로컬 날짜(toISOString 은 UTC 라 쓰지 않는다)
const dateOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const clip = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// 줄 하나 -> 항목 | null(깨졌거나 모양이 틀림)
function parseLine(line) {
  try {
    const v = JSON.parse(line);
    if (v && KINDS.includes(v.kind) && Number.isFinite(v.ts) && typeof v.text === 'string') return v;
  } catch {
    // 깨진 줄은 건너뛴다(쓰다 끊긴 마지막 줄 등)
  }
  return null;
}

// 파일의 비지 않은 줄들(없으면 [])
function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const readAll = (file) => readLines(file).map(parseLine).filter(Boolean);

// ?days= 값(문자열|undefined) -> 정수 1~60(기본 7) | null(틀림)
export function parseDays(v) {
  if (v === undefined || v === null) return DEFAULT_DAYS;
  if (!/^\d{1,3}$/.test(String(v))) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_DAYS ? n : null;
}

export function createStudy({ file, now = Date.now }) {
  // 기동 때 90일보다 오래된 줄과 깨진 줄을 정리한다(바뀐 것이 있을 때만 임시 파일 -> rename).
  const lines = readLines(file);
  const cutoff = now() - RETENTION_DAYS * DAY_MS;
  const fresh = lines.map(parseLine).filter((v) => v && v.ts >= cutoff);
  if (fresh.length !== lines.length) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, fresh.map((v) => `${JSON.stringify(v)}\n`).join(''));
    renameSync(tmp, file);
  }

  return {
    // { kind, text, ko?, url? } 한 줄 추가. 모양이 틀리면 조용히 버린다.
    // ponytail: 줄 하나를 append 한다(매번 파일 전체를 다시 쓰지 않는다). 쓰다 끊긴 줄은 읽을 때 건너뛴다.
    record({ kind, text, ko, url }) {
      const t = clip(text, MAX_TEXT);
      if (!KINDS.includes(kind) || !t) return;
      const k = clip(ko, MAX_TEXT);
      const u = typeof url === 'string' && url.length <= MAX_URL && /^https?:\/\//i.test(url) ? url : '';
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify({ ts: now(), kind, text: t, ...(k && { ko: k }), ...(u && { url: u }) })}\n`);
    },
    // 최근 days 일(오늘 포함, 로컬 날짜) 묶음. 기록이 없는 날도 0 으로 채워서, 최신 날이 앞이다.
    report(days = DEFAULT_DAYS) {
      const t = now();
      const out = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(t);
        d.setDate(d.getDate() - i);
        out.push({ date: dateOf(d.getTime()), counts: Object.fromEntries(KINDS.map((k) => [k, 0])), items: [] });
      }
      const byDate = new Map(out.map((d) => [d.date, d]));
      for (const v of readAll(file).sort((a, b) => b.ts - a.ts)) {
        const day = byDate.get(dateOf(v.ts));
        if (!day || v.ts > t) continue;
        day.counts[v.kind]++;
        if (day.items.length < MAX_ITEMS_PER_DAY) day.items.push({ ts: v.ts, kind: v.kind, text: v.text, ...(v.ko && { ko: v.ko }), ...(v.url && { url: v.url }) });
      }
      return { days: out };
    },
  };
}
