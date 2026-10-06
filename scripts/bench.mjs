// 다리의 claude 클라이언트를 직접 써서 호출 지연과 토큰 수를 잰다. 진짜 claude 구독 호출이다(호출 수 = N).
// 사용: node scripts/bench.mjs [N=4]   첫 호출 = 새 프로세스, 나머지 = 같은 상주 프로세스.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeClient } from '../bridge/claude-client.mjs';
import { SYSTEM_PROMPT, buildPrompt } from '../bridge/lookup.mjs';
import { parseGloss } from '../bridge/parse.mjs';

const SAMPLES = [
  ['payload', 'The attacker delivers the payload through a crafted request.'],
  ['mitigate', 'Rate limiting helps mitigate brute-force attacks.'],
  ['sanitize', 'You must sanitize user input before building the query.'],
  ['exploit', 'A public exploit was released a day after the patch.'],
  ['obfuscate', 'The malware tries to obfuscate its strings.'],
  ['primitive', 'The bug gives the attacker a write primitive.'],
];
const n = Math.max(1, Number(process.argv[2]) || 4);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = createClaudeClient({ systemPrompt: SYSTEM_PROMPT, cwd: join(root, 'data', 'claude-cwd') });

const rows = [];
try {
  for (let i = 0; i < n; i++) {
    const [word, sentence] = SAMPLES[i % SAMPLES.length];
    const t0 = performance.now();
    let row;
    try {
      const { text, usage } = await client.ask(buildPrompt({ word, sentence }));
      let gloss;
      try {
        gloss = parseGloss(text);
      } catch {
        gloss = `(파싱 실패) ${text.slice(0, 40)}`;
      }
      row = { i: i + 1, kind: i === 0 ? 'new-process' : 'follow-up', word, sec: (performance.now() - t0) / 1000, usage, gloss };
    } catch (e) {
      row = { i: i + 1, kind: i === 0 ? 'new-process' : 'follow-up', word, sec: (performance.now() - t0) / 1000, error: `${e.name}: ${e.message}` };
    }
    rows.push(row);
    const u = row.usage ?? {};
    console.log(
      `#${row.i} ${row.kind.padEnd(11)} ${row.word.padEnd(10)} ${row.sec.toFixed(2)}s  ` +
        `input=${u.input_tokens} cache_read=${u.cache_read_input_tokens} cache_creation=${u.cache_creation_input_tokens} output=${u.output_tokens}  ` +
        (row.error ? `ERROR ${row.error}` : `-> ${row.gloss}`),
    );
    if (row.error) break; // 호출 수 상한이 있으니 실패하면 멈춘다
  }
} finally {
  client.close();
}

const follow = rows.filter((r) => r.kind === 'follow-up' && !r.error).map((r) => r.sec);
const first = rows[0];
console.log('---');
console.log(`첫 호출(새 프로세스): ${first.sec.toFixed(2)}s (목표 6s 이내: ${first.sec <= 6 ? '통과' : '초과'})`);
if (follow.length) console.log(`이어지는 호출 ${follow.length}회: 평균 ${(follow.reduce((a, b) => a + b, 0) / follow.length).toFixed(2)}s, 최소 ${Math.min(...follow).toFixed(2)}s, 최대 ${Math.max(...follow).toFixed(2)}s`);
process.exit(rows.some((r) => r.error) ? 1 : 0);
