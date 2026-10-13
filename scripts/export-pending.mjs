// 밀린 날 따라잡기: export-state.json 의 lastDay 다음 날부터 오늘까지의 저장 기록을 내보낸다.
// 사용: node scripts/export-pending.mjs [YYYY-MM-DD(기본 오늘)] [--data <폴더(기본 저장소 data/)>]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateOf, exportDay } from './export-day.mjs';
import { loadData, openReadDb } from './data-source.mjs';

const readJson = (file) => {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

function getLaterConcepts(dataDir, data) {
  let list = [];
  if (Array.isArray(data?.concepts)) {
    list = data.concepts;
  } else {
    try {
      const db = openReadDb(dataDir);
      if (db) {
        try {
          list = db.byKind('concept');
        } finally {
          db.close();
        }
      }
    } catch {
      // db 열기 실패는 무시
    }
  }

  return list.filter((c) => {
    if (!c) return false;
    const def = c.data ? c.data.definition : c.definition;
    return def === '';
  });
}

export function pendingDays(dataDir, today = dateOf(Date.now())) {
  const state = readJson(join(dataDir, 'export-state.json'));
  let lastDay = typeof state.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.lastDay)
    ? state.lastDay
    : '2026-10-06';

  const days = new Set();
  const checkTs = (ts) => {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      const d = dateOf(ts);
      if (d > lastDay && d <= today) {
        days.add(d);
      }
    }
  };

  const data = loadData(dataDir);
  const { words, mydict, scraps: scrapsData, memos = [] } = data;

  // 1. words (saved, phrases)
  if (words.saved && typeof words.saved === 'object') {
    for (const v of Object.values(words.saved)) {
      if (v) checkTs(v.ts);
    }
  }
  if (words.phrases && typeof words.phrases === 'object') {
    for (const v of Object.values(words.phrases)) {
      if (v) checkTs(v.ts);
    }
  }

  // 2. mydict (entries)
  if (mydict.entries && typeof mydict.entries === 'object') {
    for (const v of Object.values(mydict.entries)) {
      if (v) checkTs(v.ts);
    }
  }

  // 3. scraps (scraps)
  if (scrapsData.scraps && typeof scrapsData.scraps === 'object') {
    for (const v of Object.values(scrapsData.scraps)) {
      if (v) checkTs(v.ts);
    }
  }

  // 4. memos
  if (Array.isArray(memos)) {
    for (const m of memos) {
      if (m) checkTs(m.ts);
    }
  }

  // 5. later concepts
  const laterConcepts = getLaterConcepts(dataDir, data);
  for (const c of laterConcepts) {
    if (c) checkTs(c.ts);
  }

  return Array.from(days).sort();
}

export function exportPending(dataDir, today = dateOf(Date.now())) {
  const days = pendingDays(dataDir, today);
  if (days.length === 0) return '';

  const data = loadData(dataDir);
  const { scraps: scrapsData, memos = [] } = data;
  const laterConcepts = getLaterConcepts(dataDir, data);
  const allScraps = scrapsData.scraps && typeof scrapsData.scraps === 'object'
    ? Object.values(scrapsData.scraps).filter((s) => s && Number.isFinite(s.ts))
    : [];
  const allMemos = Array.isArray(memos)
    ? memos.filter((m) => m && Number.isFinite(m.ts))
    : [];

  const sections = [];
  for (const day of days) {
    const dayOut = exportDay(day, dataDir);
    const dayScraps = allScraps.filter((s) => dateOf(s.ts) === day);
    const dayMemos = allMemos.filter((m) => dateOf(m.ts) === day);
    const dayLater = laterConcepts.filter((c) => dateOf(c.ts) === day);

    const lines = [`### ${day}`, '', dayOut.trimEnd()];

    const extraLines = [];
    if (dayScraps.length > 0) {
      const taskCounts = new Map();
      for (const s of dayScraps) {
        const t = s.task ?? null;
        taskCounts.set(t, (taskCounts.get(t) || 0) + 1);
      }

      const namedTasks = [...taskCounts.keys()]
        .filter((k) => k !== null)
        .sort((a, b) => String(a).localeCompare(String(b)));
      const sortedKeys = taskCounts.has(null) ? [...namedTasks, null] : namedTasks;

      for (const k of sortedKeys) {
        const count = taskCounts.get(k);
        const target = k !== null ? `${k}.md` : 'inbox.md';
        extraLines.push(`스크랩 ${count}개 → scraps/${target}`);
      }
    }

    if (dayMemos.length > 0) {
      extraLines.push(`메모 ${dayMemos.length}개`);
    }

    if (dayLater.length > 0) {
      extraLines.push(`나중에 볼 것 ${dayLater.length}개`);
    }

    if (extraLines.length > 0) {
      lines.push('', ...extraLines);
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let today = dateOf(Date.now());
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) {
      dataDir = resolve(args[++i]);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(args[i])) {
      today = args[i];
    } else {
      console.error('사용: node scripts/export-pending.mjs [YYYY-MM-DD] [--data <폴더>]');
      process.exit(2);
    }
  }

  try {
    process.stdout.write(exportPending(dataDir, today));
  } catch (e) {
    console.error(`오류: ${e?.message ?? e}`);
    process.exit(1);
  }
}
