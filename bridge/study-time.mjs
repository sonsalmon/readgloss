// bridge/study-time.mjs
// 섹션별 공부 시간 저장소 (T40a, 변경 기록 19).
// SQLite db(nodes, edges)를 이용해 dwell 점 및 in_task 선을 관리한다.
import { createHash } from 'node:crypto';
import { normalizeUrl } from './scraps.mjs';

// 날짜 범위 검사: YYYY-MM-DD 형식, from <= to, 최대 62일
export function parseStudyTimeRange(from, to) {
  if (typeof from !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  if (typeof to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;

  const dFrom = new Date(from + 'T00:00:00Z');
  const dTo = new Date(to + 'T00:00:00Z');
  if (Number.isNaN(dFrom.getTime()) || Number.isNaN(dTo.getTime())) return null;

  const diffDays = Math.round((dTo - dFrom) / 86400000) + 1;
  if (diffDays < 1 || diffDays > 62) return null;

  return { from, to };
}

// 요청 본문 파싱 및 유효성 검사
export function parseStudyTimeOp(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;

  if (v.op === 'add') {
    if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > 50) return null;
    const items = [];

    for (const item of v.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return null;
      if (typeof item.url !== 'string' || item.url.length > 2000) return null;

      const norm = normalizeUrl(item.url);
      if (!norm) return null;

      let title = '';
      if (item.title !== undefined && item.title !== null) {
        if (typeof item.title !== 'string' || item.title.length > 300) return null;
        title = item.title;
      }

      let headings = [];
      if (item.headings !== undefined && item.headings !== null) {
        if (!Array.isArray(item.headings) || item.headings.length > 3) return null;
        for (const h of item.headings) {
          if (typeof h !== 'string' || h.length > 200) return null;
          headings.push(h);
        }
      }

      if (typeof item.seconds !== 'number' || !Number.isInteger(item.seconds) || item.seconds < 1 || item.seconds > 120) {
        return null;
      }

      items.push({
        date: item.date,
        url: norm,
        title,
        headings,
        seconds: item.seconds,
      });
    }

    return { op: 'add', items };
  }

  if (v.op === 'get') {
    const range = parseStudyTimeRange(v.from, v.to);
    if (!range) return null;
    return { op: 'get', ...range };
  }

  return null;
}

// 공부 시간 점 id 생성: dw_ + sha1(date|정규화 주소|headings.join('\0')) 앞 16자
export function studyTimeId(date, normUrl, headings = []) {
  const chain = Array.isArray(headings) ? headings : [];
  const hashInput = `${date}|${normUrl}|${chain.join('\u0000')}`;
  const sha1 = createHash('sha1').update(hashInput).digest('hex');
  return `dw_${sha1.slice(0, 16)}`;
}

// 공부 시간 저장소 생성
export function createStudyTime({ db, guessTaskFor, now = Date.now }) {
  if (!db) {
    throw new Error('db is required for createStudyTime');
  }

  // 항목들 추가/누적: 있으면 seconds 더하기, 없으면 만들고 task = guessTaskFor(url)
  function add(items) {
    if (!Array.isArray(items)) return [];
    const nowTs = typeof now === 'function' ? now() : now;
    const results = [];

    for (const item of items) {
      const norm = normalizeUrl(item.url);
      if (!norm) continue;
      const headings = Array.isArray(item.headings) ? item.headings : [];
      const id = studyTimeId(item.date, norm, headings);

      const existing = db.get(id);
      if (existing && existing.kind === 'dwell') {
        const data = { ...(existing.data || {}) };
        data.seconds = (data.seconds || 0) + item.seconds;
        db.put({
          id,
          kind: 'dwell',
          key: norm,
          data,
          ts: nowTs,
        });
        results.push(data);
      } else {
        let task = null;
        if (typeof guessTaskFor === 'function') {
          const g = guessTaskFor(norm);
          task = typeof g === 'object' && g !== null ? (g.task ?? null) : (typeof g === 'string' ? g : null);
        }

        const data = {
          id,
          date: item.date,
          url: norm,
          title: item.title || '',
          headings,
          seconds: item.seconds,
          task,
        };

        db.put({
          id,
          kind: 'dwell',
          key: norm,
          data,
          ts: nowTs,
        });

        if (task) {
          const taskId = `task:${task}`;
          if (!db.get(taskId)) {
            db.put({
              id: taskId,
              kind: 'task',
              key: task,
              data: { id: task },
              ts: nowTs,
            });
          }
          db.link(id, taskId, 'in_task', nowTs);
        }

        results.push(data);
      }
    }

    return results;
  }

  // 날짜 범위 조회 (최대 62일)
  function list(from, to) {
    const range = parseStudyTimeRange(from, to);
    if (!range) return [];

    const nodes = db.byKind('dwell');
    const items = [];

    for (const node of nodes) {
      const d = node.data || {};
      if (d.date >= range.from && d.date <= range.to) {
        items.push({
          id: node.id,
          date: d.date,
          url: d.url ?? node.key ?? '',
          title: d.title ?? '',
          headings: Array.isArray(d.headings) ? [...d.headings] : [],
          seconds: d.seconds ?? 0,
          task: d.task ?? null,
        });
      }
    }

    items.sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url) || a.id.localeCompare(b.id));
    return items;
  }

  return {
    add,
    list,
  };
}
