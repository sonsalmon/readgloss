// bridge/concepts.mjs
// 내 개념 저장소: SQLite db(nodes, edges)를 이용한 개념 점·선 관리.
import { createHash, randomBytes } from 'node:crypto';
import { TASK_RE, SCRAP_ID_RE } from './scraps.mjs';

export const CONCEPT_ID_RE = /^c_[0-9a-f]{12}$/;
export const LIMIT = {
  name: 80,
  alias: 80,
  aliasesCount: 5,
  definition: 500,
  relatedCount: 10,
  relatedName: 80,
};

// 개념 key: 이름을 소문자로 바꾸고 공백을 하나로 줄인 값 (유일)
export function conceptKey(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// 개념 id: c_ + key의 sha1 앞 12자
export function conceptId(name) {
  const k = conceptKey(name);
  if (!k) return '';
  return 'c_' + createHash('sha1').update(k).digest('hex').slice(0, 12);
}

// 요청 본문 파싱 및 유효성 검사: 길이 상한을 넘으면 null 반환
export function parseConceptOp(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;

  if (v.op === 'save') {
    let id = null;
    if (v.id !== undefined && v.id !== null) {
      if (typeof v.id !== 'string' || !CONCEPT_ID_RE.test(v.id)) return null;
      id = v.id;
    }

    if (typeof v.name !== 'string') return null;
    const cleanName = v.name.trim().replace(/\s+/g, ' ');
    if (cleanName.length < 1 || v.name.length > LIMIT.name || cleanName.length > LIMIT.name) return null;

    let aliases = [];
    if (v.aliases !== undefined && v.aliases !== null) {
      if (!Array.isArray(v.aliases) || v.aliases.length > LIMIT.aliasesCount) return null;
      for (const a of v.aliases) {
        if (typeof a !== 'string') return null;
        const cleanA = a.trim().replace(/\s+/g, ' ');
        if (cleanA.length < 1 || a.length > LIMIT.alias || cleanA.length > LIMIT.alias) return null;
        aliases.push(cleanA);
      }
    }

    if (typeof v.definition !== 'string' || v.definition.length < 1 || v.definition.length > LIMIT.definition) {
      return null;
    }
    const definition = v.definition;

    let related = [];
    if (v.related !== undefined && v.related !== null) {
      if (!Array.isArray(v.related) || v.related.length > LIMIT.relatedCount) return null;
      for (const r of v.related) {
        if (typeof r !== 'string') return null;
        const cleanR = r.trim().replace(/\s+/g, ' ');
        if (cleanR.length < 1 || r.length > LIMIT.relatedName || cleanR.length > LIMIT.relatedName) return null;
        related.push(cleanR);
      }
    }

    let task = null;
    if (v.task !== undefined && v.task !== null) {
      if (typeof v.task !== 'string' || !TASK_RE.test(v.task)) return null;
      task = v.task;
    }

    let scrapId = null;
    if (v.scrapId !== undefined && v.scrapId !== null) {
      if (typeof v.scrapId !== 'string' || !SCRAP_ID_RE.test(v.scrapId)) return null;
      scrapId = v.scrapId;
    }

    return {
      op: 'save',
      id,
      name: cleanName,
      aliases,
      definition,
      related,
      task,
      scrapId,
    };
  }

  if (v.op === 'remove') {
    if (typeof v.id !== 'string' || !CONCEPT_ID_RE.test(v.id)) return null;
    return { op: 'remove', id: v.id };
  }

  if (v.op === 'link') {
    if (typeof v.id !== 'string' || !CONCEPT_ID_RE.test(v.id)) return null;
    if (typeof v.scrapId !== 'string' || !SCRAP_ID_RE.test(v.scrapId)) return null;
    return { op: 'link', id: v.id, scrapId: v.scrapId };
  }

  return null;
}

// 개념 저장소 생성
export function createConcepts({ db, now = Date.now, learning }) {
  if (!db) {
    throw new Error('db is required for createConcepts');
  }

  const getLearningNodes = () => {
    if (typeof learning === 'function') {
      const l = learning();
      return Array.isArray(l?.nodes) ? l.nodes : [];
    }
    return Array.isArray(learning?.nodes) ? learning.nodes : [];
  };

  // 노드 포맷팅 헬퍼
  function formatConcept(node, lNodes = getLearningNodes()) {
    if (!node) return null;
    const d = node.data || {};

    // related: 나가는 related 선을 따라 관련 개념 조회
    const relatedEdges = db.out(node.id, 'related');
    const related = [];
    for (const e of relatedEdges) {
      const target = db.get(e.dst);
      if (target && target.kind === 'concept') {
        related.push({ id: target.id, name: target.data?.name || target.key });
      }
    }
    related.sort((a, b) => a.name.localeCompare(b.name));

    // appears: from_scrap 선을 따라 스크랩 및 할 일 제목 조회
    const fromScrapEdges = db.out(node.id, 'from_scrap');
    const appears = [];
    for (const e of fromScrapEdges) {
      const scrapNode = db.get(e.dst);
      if (scrapNode && scrapNode.kind === 'scrap' && scrapNode.data) {
        const s = scrapNode.data;
        let taskTitle = null;
        if (s.task) {
          const found = lNodes.find((n) => n.id === s.task);
          taskTitle = found ? found.card_title : s.task;
        }
        appears.push({
          scrapId: s.id,
          task: s.task ?? null,
          taskTitle,
          url: s.url ?? '',
          title: s.title ?? '',
          exact: s.quote?.exact ?? '',
          ts: s.ts ?? 0,
        });
      }
    }
    appears.sort((a, b) => a.ts - b.ts);

    return {
      id: node.id,
      name: d.name || '',
      aliases: Array.isArray(d.aliases) ? [...d.aliases] : [],
      definition: d.definition || '',
      related,
      appears,
      firstTask: d.firstTask ?? null,
      firstUrl: d.firstUrl ?? null,
      firstTitle: d.firstTitle ?? null,
      ts: node.ts,
    };
  }

  // 전체 개념 목록 반환
  function list() {
    const lNodes = getLearningNodes();
    const nodes = db.byKind('concept');
    const result = nodes.map((n) => formatConcept(n, lNodes));
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  // 페이지 표시용 용어 목록: 이름과 별칭 전부, 글자 수 긴 것 먼저
  function terms() {
    const nodes = db.byKind('concept');
    const items = [];
    for (const n of nodes) {
      const d = n.data || {};
      if (d.name) {
        items.push({ id: n.id, term: d.name });
      }
      if (Array.isArray(d.aliases)) {
        for (const a of d.aliases) {
          if (a) items.push({ id: n.id, term: a });
        }
      }
    }

    items.sort((a, b) => {
      if (b.term.length !== a.term.length) {
        return b.term.length - a.term.length;
      }
      return a.term.localeCompare(b.term);
    });

    return items;
  }

  // 작업 적용: save | remove | link
  function apply(op) {
    if (!op || typeof op !== 'object') return null;
    const nowTs = typeof now === 'function' ? now() : now;

    if (op.op === 'save') {
      const key = conceptKey(op.name);
      if (!key) return null;

      const existingByKey = db.byKey('concept', key);
      let targetId = op.id || null;

      if (op.id) {
        // 수정 모드: 없는 id면 null
        const existingById = db.get(op.id);
        if (!existingById || existingById.kind !== 'concept') {
          return null;
        }
        // 이름을 바꿔서 다른 기존 개념의 key와 충돌하는 경우
        if (existingByKey && existingByKey.id !== op.id) {
          return { error: 'exists', id: existingByKey.id };
        }
        targetId = op.id;
      } else {
        // 신규 모드: 이미 같은 key의 개념이 존재하면 409
        if (existingByKey) {
          return { error: 'exists', id: existingByKey.id };
        }
        targetId = 'c_' + randomBytes(6).toString('hex');
      }

      const existingNode = db.get(targetId);
      let firstTask = existingNode?.data?.firstTask ?? (op.task || null);
      let firstUrl = existingNode?.data?.firstUrl ?? null;
      let firstTitle = existingNode?.data?.firstTitle ?? null;

      let scrapNode = null;
      if (op.scrapId) {
        scrapNode = db.get(op.scrapId);
      }

      // 처음 만들 때만: scrapId가 있으면 url, title, task 채움
      if (!existingNode && scrapNode && scrapNode.kind === 'scrap') {
        firstUrl = scrapNode.data?.url ?? null;
        firstTitle = scrapNode.data?.title ?? null;
        if (!firstTask && scrapNode.data?.task) {
          firstTask = scrapNode.data.task;
        }
      }

      const data = {
        name: op.name,
        aliases: op.aliases || [],
        definition: op.definition,
        firstTask,
        firstUrl,
        firstTitle,
      };

      db.put({
        id: targetId,
        kind: 'concept',
        key,
        data,
        ts: nowTs,
      });

      // 1. in_task 선: task가 지정된 경우
      const effectiveTask = op.task || (existingNode ? null : firstTask);
      if (effectiveTask) {
        const taskId = `task:${effectiveTask}`;
        if (!db.get(taskId)) {
          db.put({ id: taskId, kind: 'task', key: effectiveTask, data: { id: effectiveTask }, ts: nowTs });
        }
        db.link(targetId, taskId, 'in_task', nowTs);
      }

      // 2. from_scrap 선
      if (op.scrapId) {
        db.link(targetId, op.scrapId, 'from_scrap', nowTs);
      }

      // 3. related 선: 옛 related 선 지우고 새 관련 개념 양방향 연결
      const oldRelated = db.out(targetId, 'related');
      for (const e of oldRelated) {
        db.unlink(targetId, e.dst, 'related');
        db.unlink(e.dst, targetId, 'related');
      }

      if (Array.isArray(op.related)) {
        for (const relName of op.related) {
          const relKey = conceptKey(relName);
          if (!relKey) continue;
          const targetConcept = db.byKey('concept', relKey);
          if (targetConcept && targetConcept.id !== targetId) {
            db.link(targetId, targetConcept.id, 'related', nowTs);
            db.link(targetConcept.id, targetId, 'related', nowTs);
          }
        }
      }

      return formatConcept(db.get(targetId));
    }

    if (op.op === 'remove') {
      const existing = db.get(op.id);
      if (!existing || existing.kind !== 'concept') return null;
      db.del(op.id);
      return { ok: true };
    }

    if (op.op === 'link') {
      const existing = db.get(op.id);
      if (!existing || existing.kind !== 'concept') return null;
      const scrapNode = db.get(op.scrapId);
      if (!scrapNode || scrapNode.kind !== 'scrap') return null;

      db.link(op.id, op.scrapId, 'from_scrap', nowTs);
      if (scrapNode.data?.task) {
        const taskId = `task:${scrapNode.data.task}`;
        if (!db.get(taskId)) {
          db.put({ id: taskId, kind: 'task', key: scrapNode.data.task, data: { id: scrapNode.data.task }, ts: nowTs });
        }
        db.link(op.id, taskId, 'in_task', nowTs);
      }

      return formatConcept(db.get(op.id));
    }

    return null;
  }

  return {
    list,
    terms,
    apply,
  };
}
