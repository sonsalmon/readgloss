// 할 일 짐작: roadmap.json 과 NOTES.md 를 읽어 현재 페이지에 맞는 할 일을 짐작한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dateOf } from '../scripts/export-day.mjs';
import { TASK_FIND_RE, TASK_RE, normalizeUrl } from './scraps.mjs';

const COMMON_HOSTS = new Set([
  'github.com',
  'www.youtube.com',
  'notebooklm.google.com',
  'www.yes24.com',
  'nostarch.com',
  'claude.ai',
]);

function parseRoadmapNodes(raw) {
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : Array.isArray(data?.nodes) ? data.nodes : [];
  return list.map((n) => ({
    id: String(n.id ?? ''),
    card_title: String(n.card_title ?? n.title ?? ''),
    urls: Array.isArray(n.resources)
      ? n.resources.map((r) => (typeof r === 'string' ? r : r?.url)).filter((u) => typeof u === 'string')
      : [],
  }));
}

function parseSkillsJson(raw, today) {
  const data = JSON.parse(raw);
  const list = Array.isArray(data?.nodes) ? data.nodes : [];
  const nodes = list.map((n) => ({
    id: String(n.id ?? ''),
    card_title: String(n.name ?? n.card_title ?? n.title ?? ''),
    urls: Array.isArray(n.sources)
      ? n.sources.map((s) => (typeof s === 'string' ? s : s?.url)).filter((u) => typeof u === 'string')
      : [],
  }));

  let thisWeek = [];
  const weeks = Array.isArray(data?.weeks) ? data.weeks : [];
  for (const w of weeks) {
    if (typeof w?.dates === 'string') {
      const [start, end] = w.dates.split('~');
      if (start && end && today >= start.trim() && today <= end.trim()) {
        if (Array.isArray(w.node_ids)) {
          thisWeek = [...w.node_ids];
        }
        break;
      }
    }
  }

  return { nodes, thisWeek };
}

// 없는 파일은 조용히 넘기고, 있는데 못 읽은 파일만 한 줄 남긴다.
function warnIfBroken(path, e) {
  if (e?.code !== 'ENOENT') console.error(`[task-guess] ${path} 읽기 실패: ${e.message}`);
}

// 학습 폴더 읽기: skills.json, roadmap.json, archive/roadmap.json 및 NOTES.md.
// roadmapOk:false 면 guessTask 가 인박스로 보낸다. NOTES 만 실패하면 next:null 로 계속 짐작한다.
export function loadLearning(dir, now = Date.now) {
  let nodes = [];
  let next = null;
  let roadmapOk = false;
  let thisWeek = [];
  const tasks = {};

  const today = dateOf(typeof now === 'function' ? now() : now);

  const skillsPath = join(dir, 'curriculum', 'skills.json');
  const roadmapPath = join(dir, 'curriculum', 'roadmap.json');
  const archivePath = join(dir, 'curriculum', 'archive', 'roadmap.json');

  // 1. skills.json 시도
  try {
    const raw = readFileSync(skillsPath, 'utf8');
    const parsed = parseSkillsJson(raw, today);
    nodes = parsed.nodes;
    thisWeek = parsed.thisWeek;
    roadmapOk = true;

    for (const n of nodes) {
      if (n.id) tasks[n.id] = n.card_title;
    }

    // skills.json 이 있으면 archive roadmap 도 읽어서 제목 표를 합친다 (옛 id 제목도 나오게)
    try {
      const archiveRaw = readFileSync(archivePath, 'utf8');
      const archiveNodes = parseRoadmapNodes(archiveRaw);
      const existingIds = new Set(nodes.map((n) => n.id));
      for (const an of archiveNodes) {
        if (an.id && !tasks[an.id]) {
          tasks[an.id] = an.card_title;
        }
        // server.mjs 에서 learning.nodes.find 로 옛 id 제목을 찾을 수 있도록 urls: [] 로 덧붙인다
        if (an.id && !existingIds.has(an.id)) {
          nodes.push({ id: an.id, card_title: an.card_title, urls: [] });
        }
      }
    } catch (e) {
      // archive roadmap 이 없거나 실패해도 skills.json 만으로 계속
      warnIfBroken(archivePath, e);
    }
  } catch (e) {
    // 2. skills.json 이 없거나 실패하면 roadmap.json 시도 (있는데 깨졌으면 한 줄 남긴다)
    warnIfBroken(skillsPath, e);
    try {
      const raw = readFileSync(roadmapPath, 'utf8');
      nodes = parseRoadmapNodes(raw);
      roadmapOk = true;
      for (const n of nodes) {
        if (n.id) tasks[n.id] = n.card_title;
      }
    } catch (roadmapErr) {
      // 3. 그것도 없으면 archive/roadmap.json 시도 (fallback)
      try {
        const raw = readFileSync(archivePath, 'utf8');
        nodes = parseRoadmapNodes(raw);
        roadmapOk = true;
        for (const n of nodes) {
          if (n.id) tasks[n.id] = n.card_title;
        }
      } catch {
        roadmapOk = false;
        nodes = [];
        console.error(`[task-guess] roadmap.json 읽기 실패 (${roadmapPath}): ${roadmapErr.message}`);
      }
    }
  }

  try {
    const notesPath = join(dir, 'NOTES.md');
    const text = readFileSync(notesPath, 'utf8');
    // ## 다음 한 걸음 절만 찾고 그 안의 첫 할 일 id 추출
    const mSection = text.match(/(?:^|\n)##\s*다음\s*한\s*걸음[^\n]*\n([\s\S]*?)(?=(?:\n##\s|\n#\s|$))/);
    if (mSection) {
      const mTask = mSection[1].match(TASK_FIND_RE);
      if (mTask) next = mTask[0];
    }
  } catch (e) {
    console.error(`[task-guess] NOTES.md 읽기 실패 (${join(dir, 'NOTES.md')}): ${e.message}`);
  }

  return { nodes, next, roadmapOk, thisWeek, tasks };
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

// 할 일 짐작 규칙 (설계서 10-3, 25절)
export function guessTask({
  url,
  nodes = [],
  next = null,
  thisWeek = [],
  lastToday = null,
  todayTasks = [],
  roadmapOk = true,
}) {
  // roadmap 을 못 읽었으면 짐작하지 않고 인박스
  if (!roadmapOk) {
    return { task: null, ask: false, candidates: [], matches: [] };
  }
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

  const thisWeekSet = new Set(Array.isArray(thisWeek) ? thisWeek : []);

  if (matches.length > 0) {
    ask = false;
    // ① 오늘 마지막 할 일이 맞는 할 일 안에 있으면 그것
    if (lastToday && matches.includes(lastToday)) {
      task = lastToday;
    }
    // ② thisWeek 안의 맞는 할 일 중 경로가 가장 길게 겹치는 것
    else if (matchedNodes.some((m) => thisWeekSet.has(m.id))) {
      const bestThisWeek = matchedNodes.find((m) => thisWeekSet.has(m.id));
      task = bestThisWeek.id;
    }
    // ③ (옛 방식) 다음 한 걸음 노드
    else if (next && matches.includes(next)) {
      task = next;
    }
    // ④ 맞는 할 일 중 첫째
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
