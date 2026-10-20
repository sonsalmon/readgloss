// 드라이런(읽기 전용): 스크랩·메모·개념의 지금 할 일과, 고친 짐작 규칙(HTB 모듈 표)으로 다시 계산한 할 일을 비교한다.
// 사용: npm run -s tasks:recheck [-- --data <폴더(기본 저장소 data/)>]
// 출력은 id·종류·페이지 제목·옛→새 할 일뿐(메모 글 없음). 옮기기는 하지 않는다: 승인 뒤 `npm run -s scraps -- move`.
// ponytail: HTB 규칙 하나만 다시 계산한다. 나머지 짐작은 '오늘 마지막 할 일' 같은 그때 상태에 기대 다시 계산할 수 없다.
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htbTaskFor, loadHtbModules, loadLearning } from '../bridge/task-guess.mjs';

export function recheckRows(rows, { modules, nodes }) {
  const changed = [];
  for (const r of rows) {
    const to = htbTaskFor({ url: r.url, title: r.title, modules, nodes });
    if (to && to !== (r.task ?? null)) changed.push({ id: r.id, kind: r.kind, title: r.title, from: r.task ?? null, to });
  }
  return { changed, total: rows.length };
}

function readRows(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const out = [];
    for (const n of db.prepare("SELECT id, kind, data FROM nodes WHERE kind IN ('scrap','memo','concept')").all()) {
      let d;
      try {
        d = JSON.parse(n.data);
      } catch {
        continue;
      }
      if (n.kind === 'concept') out.push({ id: n.id, kind: n.kind, url: d.firstUrl, title: d.firstTitle, task: d.firstTask });
      else out.push({ id: n.id, kind: n.kind, url: d.url, title: d.title, task: d.task });
    }
    return out;
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  if (args[0] === '--data' && args[1]) dataDir = resolve(args[1]);
  const learningDir = process.env.READGLOSS_LEARNING_DIR || join(homedir(), 'dev', 'learning', 'security-career');
  const modules = loadHtbModules();
  if (!modules) {
    console.error('작업실 모듈 표를 읽을 수 없어 다시 계산하지 않았습니다.');
    process.exit(1);
  }
  const { nodes } = loadLearning(learningDir);
  const { changed, total } = recheckRows(readRows(join(dataDir, 'readgloss.db')), { modules, nodes });
  for (const c of changed) console.log(`${c.id}\t${c.kind}\t${c.title}\t${c.from ?? 'inbox'} -> ${c.to}`);
  const tally = {};
  for (const c of changed) tally[`${c.from ?? 'inbox'} -> ${c.to}`] = (tally[`${c.from ?? 'inbox'} -> ${c.to}`] ?? 0) + 1;
  console.log(`\n바뀔 줄 ${changed.length} / 전체 ${total}`);
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`);
}
