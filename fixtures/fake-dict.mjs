// native/macdict 대신 쓰는 가짜 도우미. 한 줄 단어 입력마다 JSON 한 줄을 돌려준다.
// hang: 무응답, die: 종료, 그 밖엔 fixtures/dict-plain.json 에 있으면 found, 없으면 found:false.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync(new URL('./dict-plain.json', import.meta.url), 'utf8'));
createInterface({ input: process.stdin }).on('line', (w) => {
  if (w === 'hang') return;
  if (w === 'die') process.exit(1);
  const entries = fx[w];
  process.stdout.write(JSON.stringify(entries ? { found: true, entries } : { found: false }) + '\n');
});
