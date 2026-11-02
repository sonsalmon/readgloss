// bridge/memos.mjs
// 메모 저장소: SQLite db(nodes, edges)를 이용한 memo 점·선 관리.
import { randomBytes } from 'node:crypto';
import { TASK_RE, isMark, normalizeUrl } from './scraps.mjs';

export const MEMO_ID_RE = /^m_[0-9a-f]{12}$/;

export const LIMIT = {
  text: 2000,
  tagsCount: 5,
  tagLength: 20,
  headingsCount: 3,
  headingLength: 200,
  exact: 300,
  prefix: 64,
  suffix: 64,
  selection: 1000,
  title: 300,
  url: 2000,
  quoteExact: 1000,
  quoteExactTable: 4000,
  quoteTranslation: 2000,
  tutorTitle: 120,
};

// 태그 목록 검사: 없으면(null·undefined) 빈 배열, 형식이 틀리면 null
function parseTags(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > LIMIT.tagsCount) return null;
  const tags = [];
  for (const t of v) {
    if (typeof t !== 'string' || t.length < 1 || t.length > LIMIT.tagLength) return null;
    if (/\s/.test(t) || t.includes('#')) return null;
    tags.push(t);
  }
  return tags;
}

// 요청 본문 파싱 및 상한 검사
export function parseMemoOp(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;

  if (v.op === 'save') {
    // 1. text (0~2000자). 빈 글은 인용(quote)이 있을 때만 허용한다(변경 기록 14-4)
    if (typeof v.text !== 'string' || v.text.length > LIMIT.text) {
      return null;
    }
    if (v.text.trim().length < 1 && !(v.quote && typeof v.quote === 'object' && typeof v.quote.exact === 'string' && v.quote.exact.trim())) {
      return null;
    }

    // 2. url (<=2000자 필수, normalizeUrl 유효)
    if (typeof v.url !== 'string' || v.url.length > LIMIT.url) {
      return null;
    }
    const url = normalizeUrl(v.url);
    if (!url) return null;

    // 3. title (<=300자)
    let title = '';
    if (v.title !== undefined && v.title !== null) {
      if (typeof v.title !== 'string' || v.title.length > LIMIT.title) return null;
      title = v.title;
    }

    // 4. headings (<=3개 x <=200자)
    let headings = [];
    if (v.headings !== undefined && v.headings !== null) {
      if (!Array.isArray(v.headings) || v.headings.length > LIMIT.headingsCount) return null;
      for (const h of v.headings) {
        if (typeof h !== 'string' || h.length > LIMIT.headingLength) return null;
      }
      headings = [...v.headings];
    }

    // 5. para ({ exact, prefix, suffix } | null)
    let para = null;
    if (v.para !== undefined && v.para !== null) {
      if (typeof v.para !== 'object' || Array.isArray(v.para)) return null;
      if (typeof v.para.exact !== 'string' || v.para.exact.length > LIMIT.exact) return null;

      let prefix = '';
      if (v.para.prefix !== undefined && v.para.prefix !== null) {
        if (typeof v.para.prefix !== 'string' || v.para.prefix.length > LIMIT.prefix) return null;
        prefix = v.para.prefix;
      }

      let suffix = '';
      if (v.para.suffix !== undefined && v.para.suffix !== null) {
        if (typeof v.para.suffix !== 'string' || v.para.suffix.length > LIMIT.suffix) return null;
        suffix = v.para.suffix;
      }

      para = {
        exact: v.para.exact,
        prefix,
        suffix,
      };
    }

    // 6. pos (number, 유한수)
    let pos = 0;
    if (v.pos !== undefined && v.pos !== null) {
      if (typeof v.pos !== 'number' || !Number.isFinite(v.pos)) return null;
      pos = v.pos;
    }

    // 7. selection (<=1000자 | null)
    let selection = null;
    if (v.selection !== undefined && v.selection !== null) {
      if (typeof v.selection !== 'string' || v.selection.length > LIMIT.selection) return null;
      selection = v.selection;
    }

    // 8. quote ({ exact(1~1000 또는 table 시 1~4000), prefix(<=64), suffix(<=64), translation, code, table, source, tutor } | null)
    let quote = null;
    if (v.quote !== undefined && v.quote !== null) {
      if (typeof v.quote !== 'object' || Array.isArray(v.quote)) return null;

      const hasTable = v.quote.table !== undefined && v.quote.table !== null;
      const maxQuoteExact = hasTable ? LIMIT.quoteExactTable : LIMIT.quoteExact;

      if (typeof v.quote.exact !== 'string' || v.quote.exact.length < 1 || v.quote.exact.length > maxQuoteExact) {
        return null;
      }

      let prefix = '';
      if (v.quote.prefix !== undefined && v.quote.prefix !== null) {
        if (typeof v.quote.prefix !== 'string' || v.quote.prefix.length > LIMIT.prefix) return null;
        prefix = v.quote.prefix;
      }

      let suffix = '';
      if (v.quote.suffix !== undefined && v.quote.suffix !== null) {
        if (typeof v.quote.suffix !== 'string' || v.quote.suffix.length > LIMIT.suffix) return null;
        suffix = v.quote.suffix;
      }

      quote = {
        exact: v.quote.exact,
        prefix,
        suffix,
      };

      if (v.quote.translation !== undefined && v.quote.translation !== null) {
        if (typeof v.quote.translation !== 'string' || v.quote.translation.length > LIMIT.quoteTranslation) {
          return null;
        }
        quote.translation = v.quote.translation;
      }

      if (v.quote.code !== undefined && v.quote.code !== null) {
        if (typeof v.quote.code !== 'object' || Array.isArray(v.quote.code)) return null;
        if (typeof v.quote.code.lang !== 'string' || v.quote.code.lang.length > 20 || !/^[a-z0-9+#-]*$/.test(v.quote.code.lang)) {
          return null;
        }
        if (typeof v.quote.code.block !== 'boolean') {
          return null;
        }
        quote.code = {
          lang: v.quote.code.lang,
          block: v.quote.code.block,
        };
      }

      if (hasTable) {
        const tbl = v.quote.table;
        if (!tbl || typeof tbl !== 'object' || Array.isArray(tbl)) return null;

        let head = null;
        if (tbl.head !== null && tbl.head !== undefined) {
          if (!Array.isArray(tbl.head) || tbl.head.length < 1 || tbl.head.length > 8) return null;
          for (const h of tbl.head) {
            if (typeof h !== 'string' || h.length > 300) return null;
          }
          head = [...tbl.head];
        }

        if (!Array.isArray(tbl.rows) || tbl.rows.length < 1 || tbl.rows.length > 30) return null;
        const rows = [];
        for (const r of tbl.rows) {
          if (!Array.isArray(r) || r.length < 1 || r.length > 8) return null;
          const rowCells = [];
          for (const cell of r) {
            if (typeof cell !== 'string' || cell.length > 300) return null;
            rowCells.push(cell);
          }
          rows.push(rowCells);
        }

        quote.table = {
          head,
          rows,
        };
      }

      if (v.quote.source !== undefined && v.quote.source !== null) {
        if (v.quote.source !== 'tutor') return null;
        const t = v.quote.tutor;
        if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
        if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return null;
        if (typeof t.time !== 'string' || !/^\d{2}:\d{2}$/.test(t.time)) return null;
        if (typeof t.title !== 'string' || t.title.length < 1 || t.title.length > LIMIT.tutorTitle) return null;
        quote.source = 'tutor';
        quote.tutor = {
          date: t.date,
          time: t.time,
          title: t.title,
        };
      } else if (v.quote.tutor !== undefined && v.quote.tutor !== null) {
        return null;
      }
    }

    // 9. task (TASK_RE 만족 | null)
    let task = null;
    if (v.task !== undefined && v.task !== null) {
      if (typeof v.task !== 'string' || !TASK_RE.test(v.task)) return null;
      task = v.task;
    }

    // 10. mark ('question'|'insight'|null) — 없으면 표시 없음
    let mark = null;
    if (v.mark !== undefined && v.mark !== null) {
      if (!isMark(v.mark)) return null;
      mark = v.mark;
    }

    // 11. tags (문자열 배열 ≤5개, 각 1~20자, 공백·# 없음) — 없으면 빈 배열
    const tags = parseTags(v.tags);
    if (tags === null) return null;

    return {
      op: 'save',
      text: v.text,
      url,
      title,
      headings,
      para,
      pos,
      selection,
      quote,
      task,
      mark,
      tags,
    };
  }

  if (v.op === 'edit') {
    if (typeof v.id !== 'string' || !MEMO_ID_RE.test(v.id)) return null;
    if (typeof v.text !== 'string' || v.text.length < 1 || v.text.length > LIMIT.text) return null;

    let dropQuote = false;
    if (v.dropQuote !== undefined && v.dropQuote !== null) {
      if (v.dropQuote !== true) return null;
      dropQuote = true;
    }

    // mark 가 없으면(undefined) 기존 값을 두고, null 이면 지운다
    const markGiven = v.mark !== undefined;
    let mark = null;
    if (markGiven && v.mark !== null) {
      if (!isMark(v.mark)) return null;
      mark = v.mark;
    }

    // tags 가 없으면 기존 값을 둔다
    const tagsGiven = v.tags !== undefined && v.tags !== null;
    const tags = tagsGiven ? parseTags(v.tags) : [];
    if (tags === null) return null;

    return {
      op: 'edit',
      id: v.id,
      text: v.text,
      ...(markGiven ? { mark } : {}),
      ...(tagsGiven ? { tags } : {}),
      ...(dropQuote ? { dropQuote: true } : {}),
    };
  }

  if (v.op === 'remove') {
    if (typeof v.id !== 'string' || !MEMO_ID_RE.test(v.id)) return null;
    return {
      op: 'remove',
      id: v.id,
    };
  }

  return null;
}

// 메모 점 객체 포맷팅
function formatMemo(node) {
  if (!node) return null;
  const d = node.data || {};
  return {
    id: node.id,
    text: d.text ?? '',
    url: d.url ?? node.key ?? '',
    title: d.title ?? '',
    headings: Array.isArray(d.headings) ? [...d.headings] : [],
    para: d.para
      ? {
          exact: d.para.exact ?? '',
          prefix: d.para.prefix ?? '',
          suffix: d.para.suffix ?? '',
        }
      : null,
    pos: d.pos ?? 0,
    selection: d.selection ?? null,
    quote: d.quote
      ? {
          exact: d.quote.exact ?? '',
          prefix: d.quote.prefix ?? '',
          suffix: d.quote.suffix ?? '',
          ...(typeof d.quote.translation === 'string'
            ? { translation: d.quote.translation }
            : {}),
          ...(d.quote.code && typeof d.quote.code === 'object'
            ? {
                code: {
                  lang: d.quote.code.lang ?? '',
                  block: Boolean(d.quote.code.block),
                },
              }
            : {}),
          ...(d.quote.table && typeof d.quote.table === 'object'
            ? {
                table: {
                  head: Array.isArray(d.quote.table.head)
                    ? [...d.quote.table.head]
                    : null,
                  rows: Array.isArray(d.quote.table.rows)
                    ? d.quote.table.rows.map((r) => (Array.isArray(r) ? [...r] : []))
                    : [],
                },
              }
            : {}),
          ...(d.quote.source === 'tutor'
            ? {
                source: 'tutor',
                tutor: {
                  date: d.quote.tutor?.date ?? '',
                  time: d.quote.tutor?.time ?? '',
                  title: d.quote.tutor?.title ?? '',
                },
              }
            : {}),
        }
      : null,
    task: d.task ?? null,
    mark: isMark(d.mark) ? d.mark : null,
    tags: Array.isArray(d.tags) ? [...d.tags] : [],
    ts: node.ts ?? 0,
  };
}

// 메모 저장소 생성
export function createMemos({ db, now = Date.now }) {
  if (!db) {
    throw new Error('db is required for createMemos');
  }

  // 전체 메모 목록 (최근 것 먼저)
  function list() {
    const nodes = db.byKind('memo');
    const items = nodes.map(formatMemo);
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }

  // 특정 url 메모 목록 (최근 것 먼저)
  function forUrl(rawUrl) {
    const norm = normalizeUrl(rawUrl);
    if (!norm) return [];
    const nodes = db.byKind('memo');
    const items = nodes
      .filter((n) => n.key === norm || n.data?.url === norm)
      .map(formatMemo);
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }

  // 작업 적용: save | edit | remove
  function apply(op) {
    if (!op || typeof op !== 'object') return null;
    const nowTs = typeof now === 'function' ? now() : now;

    if (op.op === 'save') {
      // 저장 경계에서 한 번 더 정규화한다(#해시·utm 이 붙은 주소도 같은 페이지로 묶이게)
      const url = normalizeUrl(op.url);
      if (!url) return null;
      const id = 'm_' + randomBytes(6).toString('hex');
      const data = {
        id,
        text: op.text,
        url,
        title: op.title,
        headings: op.headings,
        para: op.para,
        pos: op.pos,
        selection: op.selection,
        quote: op.quote ?? null,
        task: op.task,
        mark: op.mark ?? null,
        tags: Array.isArray(op.tags) ? [...op.tags] : [],
        ts: nowTs,
      };

      db.put({
        id,
        kind: 'memo',
        key: url,
        data,
        ts: nowTs,
      });

      // task 가 있으면 in_task 선 생성
      if (op.task) {
        const taskId = `task:${op.task}`;
        if (!db.get(taskId)) {
          db.put({
            id: taskId,
            kind: 'task',
            key: op.task,
            data: { id: op.task },
            ts: nowTs,
          });
        }
        db.link(id, taskId, 'in_task', nowTs);
      }

      return formatMemo(db.get(id));
    }

    if (op.op === 'edit') {
      const existing = db.get(op.id);
      if (!existing || existing.kind !== 'memo') return null;

      const data = {
        ...(existing.data || {}),
        text: op.text,
      };

      if (op.dropQuote === true) {
        delete data.quote;
      }

      // 표시는 null 이면 지우고, tags 는 보낼 때만 다시 쓴다
      if (op.mark !== undefined) {
        if (op.mark === null) delete data.mark;
        else data.mark = op.mark;
      }
      if (op.tags !== undefined) {
        data.tags = [...op.tags];
      }

      // ts 는 유지한다
      db.put({
        id: existing.id,
        kind: 'memo',
        key: existing.key,
        data,
        ts: existing.ts,
      });

      return formatMemo(db.get(existing.id));
    }

    if (op.op === 'remove') {
      const existing = db.get(op.id);
      if (!existing || existing.kind !== 'memo') return null;

      // 점과 선 모두 삭제
      db.del(op.id);
      return { ok: true };
    }

    return null;
  }

  return {
    list,
    forUrl,
    apply,
  };
}
