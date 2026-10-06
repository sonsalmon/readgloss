// native/mt 대신 쓰는 가짜 도우미. stdin 한 줄 JSON {"text"} 마다 JSON 한 줄을 돌려준다.
// HANG 무응답, DIE 종료, NOT-INSTALLED·FAIL 오류 응답, SLOW300 이 들어 있으면 0.3초 뒤 응답, 그 밖엔 "번역<호출 번호>:<원문>".
import { createInterface } from 'node:readline';

let n = 0;
createInterface({ input: process.stdin }).on('line', (line) => {
  const { text } = JSON.parse(line);
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  n++;
  if (text.includes('HANG')) return;
  if (text.includes('DIE')) process.exit(1);
  if (text.includes('NOT-INSTALLED')) return out({ error: 'not-installed' });
  if (text.includes('FAIL')) return out({ error: 'failed' });
  const reply = () => out({ translation: `번역${n}:${text}` });
  if (text.includes('SLOW300')) setTimeout(reply, 300);
  else reply();
});
