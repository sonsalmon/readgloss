import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeClient, claudeArgs, AiTimeoutError, AiError } from '../bridge/claude-client.mjs';

// 이 파일의 테스트는 진짜 claude 를 부르지 않는다. 가짜 자식 프로세스(fixtures/fake-claude.mjs)만 쓴다.
const FAKE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
const make = (opts = {}) =>
  createClaudeClient({
    command: process.execPath,
    args: [FAKE],
    cwd: join(mkdtempSync(join(tmpdir(), 'rg-cc-')), 'nested', 'cwd'),
    ...opts,
  });

test('실행 인자는 측정한 조합 그대로다', () => {
  assert.deepEqual(claudeArgs('SYS'), [
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
    '--system-prompt', 'SYS',
  ]);
  assert.ok(!claudeArgs('SYS').includes('--bare'));
});

test('result 이벤트에서 결과와 usage 를 읽는다(중간 이벤트·줄 끊김 무시)', async () => {
  const c = make();
  try {
    const r = await c.ask('hello');
    assert.equal(r.text, 'echo:hello');
    assert.deepEqual(r.usage, { input_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, output_tokens: 11 });
  } finally {
    c.close();
  }
});

test('상주 프로세스 하나를 재사용한다', async () => {
  const c = make();
  try {
    const a = (await c.ask('PID')).text;
    const b = (await c.ask('PID')).text;
    assert.equal(a, b);
  } finally {
    c.close();
  }
});

test('요청은 직렬로 처리된다(동시에 던져도 순서 유지)', async () => {
  const c = make();
  try {
    const order = [];
    const p = ['SLOW1', 'fast2', 'fast3'].map((q) => c.ask(q).then((r) => order.push(r.text)));
    await Promise.all(p);
    assert.deepEqual(order, ['echo:SLOW1', 'echo:fast2', 'echo:fast3']);
  } finally {
    c.close();
  }
});

test('시간 초과: AiTimeoutError, 프로세스를 죽이고 다음 요청 때 새로 띄운다', async () => {
  const c = make({ timeoutMs: 300 });
  try {
    const before = (await c.ask('PID')).text;
    await assert.rejects(c.ask('HANG'), AiTimeoutError);
    const after = (await c.ask('PID')).text;
    assert.notEqual(before, after);
    assert.throws(() => process.kill(Number(before), 0)); // 죽은 프로세스
  } finally {
    c.close();
  }
});

test('프로세스가 죽으면 그 요청은 에러, 다음 요청 때 다시 띄운다', async () => {
  const c = make();
  try {
    const before = (await c.ask('PID')).text;
    await assert.rejects(c.ask('DIE'), AiError);
    const after = (await c.ask('PID')).text;
    assert.notEqual(before, after);
  } finally {
    c.close();
  }
});

test('앞 요청이 실패해도 큐는 계속 돈다', async () => {
  const c = make({ timeoutMs: 300 });
  try {
    const bad = c.ask('HANG');
    const good = c.ask('after');
    await assert.rejects(bad, AiTimeoutError);
    assert.equal((await good).text, 'echo:after');
  } finally {
    c.close();
  }
});

test('result 가 is_error 면 AiError', async () => {
  const c = make();
  try {
    await assert.rejects(c.ask('ERR'), AiError);
    assert.equal((await c.ask('ok')).text, 'echo:ok');
  } finally {
    c.close();
  }
});

test('실행 파일이 없으면 AiError', async () => {
  const c = make({ command: '/nonexistent/claude-binary' });
  await assert.rejects(c.ask('x'), AiError);
  c.close();
});

test('자식 env 에서 중첩 실행 표지와 API 키를 지운다', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDE_CODE_SSE_PORT: '1', ANTHROPIC_API_KEY: 'k' });
  const c = make();
  try {
    assert.deepEqual(JSON.parse((await c.ask('ENV')).text), [false, false, false, false]);
  } finally {
    c.close();
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY']) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
});

test('close 뒤 자식 프로세스가 남지 않는다', async () => {
  const c = make();
  const pid = Number((await c.ask('PID')).text);
  c.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.throws(() => process.kill(pid, 0));
});
