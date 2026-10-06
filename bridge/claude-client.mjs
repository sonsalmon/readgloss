import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export class AiError extends Error {
  name = 'AiError';
}
export class AiTimeoutError extends AiError {
  name = 'AiTimeoutError';
  message = 'claude timeout';
}

// 측정한 조합 그대로. 바꾸지 말 것(--bare 는 구독 로그인을 안 쓰고, 생각 끄기가 빠지면 첫 요청이 수십 초 걸린다).
export function claudeArgs(systemPrompt) {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'haiku',
    '--tools', '',
    '--setting-sources', '',
    '--settings', '{"alwaysThinkingEnabled":false}',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--system-prompt', systemPrompt,
  ];
}

// 다리가 Claude Code 안의 셸에서 떠도 중첩 실행으로 막히지 않게, ANTHROPIC_API_KEY 는 구독 대신 API 과금으로 새지 않게 지운다.
const DROP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY'];
function childEnv() {
  const env = { ...process.env };
  for (const k of DROP_ENV) delete env[k];
  return env;
}

// 상주 claude 프로세스 하나에 요청을 한 번에 하나씩 보낸다. 처음 ask 때 띄운다.
// ponytail: 20건마다 재시작·10분 유휴 종료는 T5. 지금은 죽거나 시간 초과일 때만 다시 띄운다.
export function createClaudeClient({ systemPrompt, command = 'claude', args = claudeArgs(systemPrompt), cwd, timeoutMs = 30_000 }) {
  let proc = null; // { child, pending: {resolve, reject, timer} | null }
  let queue = Promise.resolve();

  function settle(p, err, value) {
    const pending = p.pending;
    if (!pending) return;
    p.pending = null;
    clearTimeout(pending.timer);
    if (err) pending.reject(err);
    else pending.resolve(value);
  }

  function kill(p) {
    if (proc === p) proc = null; // 다음 요청 때 새로 띄운다
    p.child.kill('SIGKILL');
  }

  function start() {
    mkdirSync(cwd, { recursive: true });
    const child = spawn(command, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const p = { child, pending: null };
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev?.type !== 'result') continue;
        if (ev.is_error || ev.subtype !== 'success' || typeof ev.result !== 'string') settle(p, new AiError(`claude result: ${ev.subtype}`));
        else settle(p, null, { text: ev.result, usage: ev.usage ?? {} });
      }
    });
    child.stderr.resume(); // 비워 두지 않으면 파이프가 차서 멈출 수 있다. 내용은 쓰지 않는다.
    child.stdin.on('error', () => {}); // 죽은 자식에 쓰기: exit 핸들러가 요청을 실패 처리한다
    child.on('error', (e) => {
      if (proc === p) proc = null;
      settle(p, new AiError(`claude spawn failed: ${e.code ?? e.message}`));
    });
    child.on('exit', () => {
      if (proc === p) proc = null;
      settle(p, new AiError('claude exited'));
    });
    return p;
  }

  function send(prompt) {
    return new Promise((resolve, reject) => {
      const p = proc ?? (proc = start());
      const timer = setTimeout(() => {
        settle(p, new AiTimeoutError());
        kill(p);
      }, timeoutMs);
      p.pending = { resolve, reject, timer };
      p.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
    });
  }

  return {
    // prompt 문자열 -> { text, usage }
    ask(prompt) {
      const run = queue.then(() => send(prompt));
      queue = run.catch(() => {});
      return run;
    },
    close() {
      if (proc) kill(proc);
    },
  };
}
