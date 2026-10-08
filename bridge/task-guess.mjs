// 할 일 짐작: roadmap.json 과 NOTES.md 를 읽어 현재 페이지에 맞는 할 일을 짐작한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dateOf } from '../scripts/export-day.mjs';
import { TASK_RE, normalizeUrl } from './scraps.mjs';

const COMMON_HOSTS = new Set([
  'github.com',
  'www.youtube.com',
  'notebooklm.google.com',
  'www.yes24.com',
  'nostarch.com',
  'claude.ai',
]);

// 학습 폴더 읽기: roadmap.json 및 NOTES.md. 파일 없음·깨짐 시 { nodes: [], next: null } + console.error 한 줄.
export function loadLearning(dir) {
  let nodes = [];
  let next = null;
  let hasError = false;
  let errMsg = '';

  try {
    const roadmapPath = join(dir, 'curriculum', 'roadmap.json');
    const raw = readFileSync(roadmapPath, 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : Array.isArray(data?.nodes) ? data.nodes : [];
    nodes = list.map((n) => ({
      id: String(n.id ?? ''),
      card_title: String(n.card_title ?? ''),
      urls: Array.isArray(n.resources)
        ? n.resources.map((r) => (typeof r === 'string' ? r : r?.url)).filter((u) => typeof u === 'string')
        : [],
    }));
  } catch (e) {
    hasError = true;
    errMsg = e.message;
  }

  try {
    const notesPath = join(dir, 'NOTES.md');
    const text = readFileSync(notesPath, 'utf8');
    // ## 다음 한 걸음 절만 찾고 그 안의 첫 S\d-\d\d 추출
    const mSection = text.match(/(?:^|\n)##\s*다음\s*한\s*걸음[^\n]*\n([\s\S]*?)(?=(?:\n##\s|\n#\s|$))/);
    if (mSection) {
      const mTask = mSection[1].match(/S\d-\d{2}/);
      if (mTask) next = mTask[0];
    }
  } catch (e) {
    hasError = true;
    errMsg = errMsg || e.message;
  }

  if (hasError && nodes.length === 0 && !next) {
    console.error(`[task-guess] 학습 자료 읽기 실패 (${dir}): ${errMsg}`);
  }

  return { nodes, next };
}

// 오늘(서울 날짜) 마지막 스크랩의 task. 없거나 인박스면 null.
export function lastTaskToday(scraps, now = Date.now) {
  if (!Array.isArray(scraps) || scraps.length === 0) return null;
  const n = typeof now === 'function' ? now() : now;
  const today = dateOf(n);
  const todayScraps = scraps
    .filter((s) => Number.isFinite(s?.ts) && dateOf(s.ts) === today)
    .sort((a, b) => a.ts - b.ts);
  if (todayScraps.length === 0) return null;
  const last = todayScraps[todayScraps.length - 1];
  return typeof last.task === 'string' && TASK_RE.test(last.task) ? last.task : null;
}

// 할 일 짐작 규칙 (설계서 10-3)
export function guessTask({ url, nodes = [], next = null, lastToday = null, todayTasks = [] }) {
  const normUrl = normalizeUrl(url);
  if (!normUrl) {
    return { task: null, ask: false, candidates: [], matches: [] };
  }

  let targetUrlObj;
  try {
    targetUrlObj = new URL(normUrl);
  } catch {
    return { task: null, ask: false, candidates: [], matches: [] };
  }

  const targetHost = targetUrlObj.host.toLowerCase();
  const targetPath = targetUrlObj.pathname.replace(/\/+$/, '');

  const matchedNodes = [];
  if (!COMMON_HOSTS.has(targetHost)) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      let maxScore = -1;
      for (const resUrl of node.urls ?? []) {
        try {
          const resObj = new URL(resUrl);
          const resHost = resObj.host.toLowerCase();
          if (resHost !== targetHost || COMMON_HOSTS.has(resHost)) continue;

          let score = 0;
          const resPath = resObj.pathname.replace(/\/+$/, '');
          if (resPath) {
            if (targetPath === resPath || targetPath.startsWith(`${resPath}/`)) {
              score = resPath.length;
            }
          }
          if (score > maxScore) maxScore = score;
        } catch {
          // 잘못된 URL 은 건너뛴다
        }
      }
      if (maxScore >= 0) {
        matchedNodes.push({ id: node.id, node, score: maxScore, index: i });
      }
    }
  }

  // 경로 앞부분이 더 길게 겹칠수록 앞, 같으면 지도(roadmap) 순서
  matchedNodes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  const matches = matchedNodes.map((m) => m.id);

  let task = null;
  let ask = false;

  if (matches.length > 0) {
    ask = false;
    // ① 오늘 마지막 할 일이 맞는 할 일 안에 있으면 그것
    if (lastToday && matches.includes(lastToday)) {
      task = lastToday;
    }
    // ② 다음 한 걸음 할 일이 맞는 할 일 안에 있으면 그것
    else if (next && matches.includes(next)) {
      task = next;
    }
    // ③ 맞는 할 일의 첫째
    else {
      task = matches[0];
    }
  } else {
    // ④ 맞는 할 일이 없으면 커리큘럼 밖 페이지 — 오늘 마지막 할 일, 없으면 다음 한 걸음 할 일을 후보로 질문(ask:true)
    if (lastToday) {
      task = lastToday;
      ask = true;
    } else if (next) {
      task = next;
      ask = true;
    } else {
      // ⑤ 후보도 없으면 인박스
      task = null;
      ask = false;
    }
  }

  // candidates: 오늘 쓴 할 일들 + next + 맞는 할 일, 중복 제거, {id, title: card_title}
  const pool = [
    ...(todayTasks.length ? todayTasks : lastToday ? [lastToday] : []),
    next,
    ...matches,
  ].filter(Boolean);

  const seen = new Set();
  const candidates = [];
  for (const id of pool) {
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodes.find((node) => node.id === id);
    candidates.push({ id, title: n ? n.card_title : id });
  }

  return { task, ask, candidates, matches };
}
