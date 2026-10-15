// bridge/wstat.mjs
// 단어별 주석 통계(wstat) 저장·확률 계산·기준선 자동 조절.
import { dateOf } from '../scripts/export-day.mjs';

export const LEMMA_RE = /^[a-z][a-z'’-]{0,63}$/;
export const MAX_STAT_ITEMS = 500;
const DAY_MS = 86_400_000;

export const BASE_P = {
  A1: 0.02,
  A2: 0.05,
  B1: 0.15,
  B2: 0.35,
  C1: 0.60,
  C2: 0.75,
};

// 출발점(등급표 등급에 따른 모를 확률 바탕값, 목록 밖·null은 .72)
export function baseP(level) {
  return BASE_P[level] ?? 0.72;
}

// 20-1 규칙: 내 기록으로 단어마다 모를 확률 계산
export function probability({ level, saved = false, lookups = 0, stat = null }) {
  let p = baseP(level);

  // 주석이 떴는데 "봤다"가 없음: 뜬 횟수 s가 3 이상이고 본 횟수 0이면 p * .7^(s-2)
  const s = Array.isArray(stat?.shownDays) ? stat.shownDays.length : 0;
  const seen = stat?.seen ?? 0;
  if (s >= 3 && seen === 0) {
    p = p * (0.7 ** (s - 2));
  }

  // 감소는 saved·lookups로 올린 값에는 적용하지 않는다(찾아본 단어는 안 줄임)
  if (saved) {
    p = Math.max(p, 0.95);
  }
  const n = typeof lookups === 'number' ? lookups : (lookups ? 1 : 0);
  if (n >= 1) {
    const lookupP = Math.min(0.99, 0.90 + 0.02 * (n - 1));
    p = Math.max(p, lookupP);
  }

  return Math.round(p * 1e6) / 1e6; // 부동소수 꼬리(0.9400000000000001) 정리
}

export const BASE_THRESHOLDS = {
  A2: 0.04,
  B1: 0.10,
  B2: 0.30,
  C1: 0.50,
  C2: 0.70,
};

// 기준값 = 설정 수준의 바탕값 + 자동 조절 offset
export function threshold(level, offset = 0) {
  const base = BASE_THRESHOLDS[level] ?? BASE_THRESHOLDS.B2;
  const off = Number(offset) || 0;
  return Math.round((base + off) * 1e4) / 1e4;
}

// 20-2 규칙: 하루 한 번 지난 7일 기록으로 기준 자동 조절(범위 -.15~+.15, 한 번에 ±.03)
export function adjustOffset({ offset = 0, shown = 0, seen = 0, missedLookups = 0 }) {
  let delta = 0;
  const s = Number(shown) || 0;
  const v = Number(seen) || 0;
  const m = Number(missedLookups) || 0;
  const cur = Number(offset) || 0;

  // 뜬 주석 중 본 비율이 10% 미만이고 뜬 수 >= 100 -> +.03(주석 줄임)
  if (s >= 100 && (v / s) < 0.10) {
    delta += 0.03;
  }
  // 주석 없던 단어를 더블클릭한 수가 뜬 수의 5% 이상(뜬 수 >= 50) -> -.03(주석 늘림)
  if (s >= 50 && (m / s) >= 0.05) {
    delta -= 0.03;
  }

  const next = Math.max(-0.15, Math.min(0.15, Math.round((cur + delta) * 100) / 100));
  return next;
}

export function createWstat({ db, now = Date.now }) {
  const stmtGetMeta = db.raw.prepare('SELECT value FROM meta WHERE key = ?');
  const stmtSetMeta = db.raw.prepare(`
    INSERT INTO meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  function getMeta(key, fallback = null) {
    const row = stmtGetMeta.get(key);
    return row ? row.value : fallback;
  }

  function setMeta(key, value) {
    stmtSetMeta.run(key, String(value));
  }

  return {
    // get(lemma): 단어 원형의 wstat data 반환
    get(lemma) {
      if (typeof lemma !== 'string') return { shownDays: [], shown: 0, seen: 0, lastShown: null, lastSeen: null };
      const w = lemma.toLowerCase();
      const node = db.get(`ws_${w}`);
      return node?.data ?? { shownDays: [], shown: 0, seen: 0, lastShown: null, lastSeen: null };
    },

    // record({ shown, seen }): 단어 목록 기록 (각 목록 <= 500)
    record({ shown = [], seen = [] }) {
      const t = now();
      const today = dateOf(t);

      const items = new Map();
      const getEntry = (w) => {
        if (!items.has(w)) {
          const node = db.get(`ws_${w}`);
          const data = node?.data ? {
            shownDays: Array.isArray(node.data.shownDays) ? [...node.data.shownDays] : [],
            shown: node.data.shown ?? 0,
            seen: node.data.seen ?? 0,
            lastShown: node.data.lastShown ?? null,
            lastSeen: node.data.lastSeen ?? null,
          } : { shownDays: [], shown: 0, seen: 0, lastShown: null, lastSeen: null };
          items.set(w, data);
        }
        return items.get(w);
      };

      for (const raw of shown) {
        if (typeof raw !== 'string') continue;
        const w = raw.toLowerCase();
        if (!LEMMA_RE.test(w)) continue;
        const d = getEntry(w);
        if (!d.shownDays.includes(today)) {
          d.shownDays.push(today);
          if (d.shownDays.length > 30) {
            d.shownDays = d.shownDays.slice(-30);
          }
        }
        d.shown += 1;
        d.lastShown = t;
      }

      for (const raw of seen) {
        if (typeof raw !== 'string') continue;
        const w = raw.toLowerCase();
        if (!LEMMA_RE.test(w)) continue;
        const d = getEntry(w);
        d.seen += 1;
        d.lastSeen = t;
      }

      for (const [w, data] of items) {
        db.put({
          id: `ws_${w}`,
          kind: 'wstat',
          key: w,
          data,
          ts: t,
        });
      }
    },

    // last7(): 최근 7일 간의 통계 집계
    // ponytail: 7일 안 기록을 정확히 추적하려면 일별 카운트가 필요하지만, DB 크기를 아끼기 위해 7일 안 shownDays 개수 합과 7일 안 lastSeen 있는 원형의 seen 합으로 근사한다.
    last7() {
      const t = now();
      const recent7Dates = new Set();
      for (let i = 0; i < 7; i++) {
        const d = new Date(t);
        d.setDate(d.getDate() - i);
        recent7Dates.add(dateOf(d.getTime()));
      }
      const cutoffTs = t - 7 * DAY_MS;

      let totalShown = 0;
      let totalSeen = 0;

      const nodes = db.byKind('wstat');
      for (const node of nodes) {
        const d = node?.data;
        if (!d) continue;
        if (Array.isArray(d.shownDays)) {
          for (const day of d.shownDays) {
            if (recent7Dates.has(day)) totalShown++;
          }
        }
        if (d.lastSeen && (d.lastSeen >= cutoffTs || recent7Dates.has(dateOf(d.lastSeen)))) {
          totalSeen += (d.seen ?? 0);
        }
      }

      return { shown: totalShown, seen: totalSeen };
    },

    getOffset() {
      const v = getMeta('annot_offset');
      return v !== null ? Number(v) : 0;
    },

    setOffset(offset) {
      setMeta('annot_offset', String(offset));
    },

    getOffsetDay() {
      return getMeta('annot_offset_day');
    },

    setOffsetDay(day) {
      setMeta('annot_offset_day', day);
    },

    getAuto() {
      return getMeta('annot_auto', '1') !== '0';
    },

    setAuto(on) {
      setMeta('annot_auto', on ? '1' : '0');
    },
  };
}
