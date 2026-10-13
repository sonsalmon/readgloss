// bridge/memos.mjs
// 메모 저장소: SQLite db(nodes, edges)를 이용한 memo 점·선 관리.
import { randomBytes } from 'node:crypto';
import { TASK_RE, normalizeUrl } from './scraps.mjs';

export const MEMO_ID_RE = /^m_[0-9a-f]{12}$/;

export const LIMIT = {
  text: 2000,
  headingsCount: 3,
  headingLength: 200,
  exact: 300,
  prefix: 64,
  suffix: 64,
  selection: 1000,
  title: 300,
  url: 2000,
};

// 요청 본문 파싱 및 상한 검사
export function parseMemoOp(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;

  if (v.op === 'save') {
    // 1. text (1~2000자 필수)
    if (typeof v.text !== 'string' || v.text.length < 1 || v.text.length > LIMIT.text) {
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

    // 8. task (TASK_RE 만족 | null)
    let task = null;
    if (v.task !== undefined && v.task !== null) {
      if (typeof v.task !== 'string' || !TASK_RE.test(v.task)) return null;
      task = v.task;
    }

    return {
      op: 'save',
      text: v.text,
      url,
      title,
      headings,
      para,
      pos,
      selection,
      task,
    };
  }

  if (v.op === 'edit') {
    if (typeof v.id !== 'string' || !MEMO_ID_RE.test(v.id)) return null;
    if (typeof v.text !== 'string' || v.text.length < 1 || v.text.length > LIMIT.text) return null;
    return {
      op: 'edit',
      id: v.id,
      text: v.text,
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
    task: d.task ?? null,
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
        task: op.task,
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
