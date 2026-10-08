// export-state.json 의 lastDay 를 지정한 날짜로 갱신한다.
// 사용: node scripts/export-mark.mjs YYYY-MM-DD [--data <폴더(기본 저장소 data/)>]
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // 달마다 날짜 수를 실제로 본다: 2026-02-31 은 3월 3일로 넘어가므로 거절
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function markDay(date, dataDir) {
  if (!isValidDateStr(date)) {
    throw new Error(`올바른 YYYY-MM-DD 날짜 형식이 아닙니다: ${date}`);
  }
  mkdirSync(dataDir, { recursive: true });
  const statePath = join(dataDir, 'export-state.json');
  let state = {};
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      state = parsed;
    }
  } catch {
    state = {};
  }

  state.lastDay = date;
  const tmp = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, statePath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let targetDay = null;
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) {
      dataDir = resolve(args[++i]);
    } else if (!targetDay && DATE_RE.test(args[i])) {
      targetDay = args[i];
    } else {
      console.error('사용: node scripts/export-mark.mjs YYYY-MM-DD [--data <폴더>]');
      process.exit(2);
    }
  }

  if (!targetDay || !isValidDateStr(targetDay)) {
    console.error('오류: 올바른 YYYY-MM-DD 날짜를 지정해야 합니다.');
    process.exit(2);
  }

  markDay(targetDay, dataDir);
  console.log(`export-state.json 의 lastDay 를 ${targetDay} 로 설정했습니다.`);
}
