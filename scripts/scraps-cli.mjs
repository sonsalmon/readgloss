// 스크랩 CLI: 다리 서버의 /scraps 엔드포인트를 호출한다.
// 사용: node scripts/scraps-cli.mjs move <id> <할일id|inbox> [--data <폴더(기본 저장소 data/)>]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function moveScrap({ id, task, dataDir, port = process.env.READGLOSS_PORT || 47831 }) {
  if (!id || typeof id !== 'string') {
    throw new Error('스크랩 id 가 필요합니다.');
  }

  const tokenPath = join(dataDir, 'token');
  let token = '';
  try {
    token = readFileSync(tokenPath, 'utf8').trim();
  } catch {
    throw new Error(`다리 토큰 파일을 읽을 수 없습니다: ${tokenPath}`);
  }

  const targetTask = task === 'inbox' || task === null ? null : task;

  const url = `http://127.0.0.1:${port}/scraps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bridge-token': token,
    },
    body: JSON.stringify({
      op: 'move',
      id,
      task: targetTask,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`다리 요청 실패 (HTTP ${res.status}): ${errText}`);
  }

  return await res.json().catch(() => ({}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let op = null;
  let id = null;
  let task = null;
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) {
      dataDir = resolve(args[++i]);
    } else if (!op && args[i] === 'move') {
      op = 'move';
    } else if (op === 'move' && !id) {
      id = args[i];
    } else if (op === 'move' && id && !task) {
      task = args[i];
    } else {
      console.error('사용: node scripts/scraps-cli.mjs move <id> <할일id|inbox> [--data <폴더>]');
      process.exit(2);
    }
  }

  if (op !== 'move' || !id || !task) {
    console.error('사용: node scripts/scraps-cli.mjs move <id> <할일id|inbox> [--data <폴더>]');
    process.exit(2);
  }

  try {
    await moveScrap({ id, task, dataDir });
    console.log(`이동 완료: 스크랩 ${id} → ${task}`);
  } catch (e) {
    console.error(`오류: ${e.message}`);
    process.exit(1);
  }
}
