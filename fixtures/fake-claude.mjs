// 진짜 claude 대신 쓰는 가짜 자식 프로세스. stream-json 한 줄 입력마다 result 이벤트 한 줄을 돌려준다.
// 프롬프트 내용으로 동작을 고른다: HANG(무응답) DIE(종료) ERR(is_error) SLOW(지연) PID ENV 그 밖엔 echo.
import { createInterface } from 'node:readline';

const out = (ev) => process.stdout.write(JSON.stringify(ev) + '\n');
const result = (text) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: text,
  usage: { input_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, output_tokens: 11 },
});

out({ type: 'system', subtype: 'init' });

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  const c = msg.message.content;
  if (c.includes('HANG')) return;
  if (c.includes('DIE')) process.exit(1);
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'noise' }] } });
  if (c.includes('ERR')) return out({ ...result('boom'), subtype: 'error_during_execution', is_error: true });
  const reply = () => {
    let text = `echo:${c}`;
    if (c.includes('PID')) text = String(process.pid);
    if (c.includes('ENV')) text = JSON.stringify(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_SCOPES', 'KEEP_ME'].map((k) => k in process.env));
    // 한 줄을 두 번에 나눠 보내 줄 버퍼링을 시험한다
    const s = JSON.stringify(result(text)) + '\n';
    const mid = Math.floor(s.length / 2);
    process.stdout.write(s.slice(0, mid));
    setTimeout(() => process.stdout.write(s.slice(mid)), 10);
  };
  if (c.includes('SLOW')) setTimeout(reply, 100);
  else reply();
});
