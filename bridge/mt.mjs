// 맥 번역 도우미(native/mt)와 주고받는다. 영어 글 -> 한국어, 기기 안에서 번역하고 AI(구독)는 안 쓴다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class MtUnavailableError extends Error {} // 도우미 파일이 없거나 영어->한국어 언어팩이 없음
export class MtError extends Error {}

export const MAX_CACHE = 2000;
const DEFAULT_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'mt');
const FIRST_TIMEOUT_MS = 20_000; // 새로 띄운 도우미의 첫 호출은 번역 모델을 적재하느라 오래 걸린다(약 5초)
const TIMEOUT_MS = 10_000;

// dict.mjs 와 같은 방식: 상주 도우미를 처음 요청 때 띄우고 한 줄씩 직렬로 주고받는다. 죽거나 시간이 지나면 정리하고 다음 요청 때 다시 띄운다.
// ponytail: dict.mjs 와 프로세스 관리가 겹친다(2곳). 세 번째가 생기면 공용 모듈로 뽑는다.
export function createMt({ bin = DEFAULT_BIN, args = [], firstTimeoutMs = FIRST_TIMEOUT_MS, timeoutMs = TIMEOUT_MS, cacheMax = MAX_CACHE } = {}) {
  let child = null;
  let warm = false; // 지금 도우미가 한 번이라도 답했나
  let pending = null; // { resolve, reject, timer }
  let buf = '';
  let chain = Promise.resolve();
  const cache = new Map(); // 원문 -> 번역(넘치면 가장 오래된 것부터 버린다)

  const settle = (err, value) => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    if (err) p.reject(err);
    else p.resolve(value);
  };

  function ensure() {
    if (child) return child;
    if (!existsSync(bin)) throw new MtUnavailableError(bin);
    const c = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    buf = '';
    warm = false;
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => {
      if (child !== c) return; // 버린 도우미의 늦은 출력
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0 || !pending) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      warm = true;
      try {
        const r = JSON.parse(line);
        if (typeof r?.translation === 'string' && r.translation) settle(null, r.translation);
        else settle(r?.error === 'not-installed' ? new MtUnavailableError('not-installed') : new MtError(String(r?.error ?? 'bad-response')));
      } catch {
        settle(new MtError('bad-json'));
      }
    });
    c.stdin.on('error', () => {}); // 죽은 자식에게 쓰다 나는 EPIPE 는 exit 쪽에서 처리한다
    c.on('error', () => {
      if (child !== c) return;
      child = null;
      settle(new MtUnavailableError(bin));
    });
    c.on('exit', () => {
      if (child !== c) return;
      child = null;
      settle(new MtError('helper-exited'));
    });
    child = c;
    return c;
  }

  function ask(text) {
    return new Promise((resolve, reject) => {
      let c;
      try {
        c = ensure();
      } catch (e) {
        return reject(e);
      }
      const timer = setTimeout(() => {
        settle(new MtError('timeout'));
        c.kill(); // 응답이 밀린 도우미는 버린다(다음 요청이 새로 띄운다)
        if (child === c) child = null;
      }, warm ? timeoutMs : firstTimeoutMs);
      pending = { resolve, reject, timer };
      c.stdin.write(`${JSON.stringify({ text })}\n`);
    });
  }

  return {
    // text(정규화한 영어 글) -> 한국어 번역 문자열. 오류는 MtUnavailableError·MtError.
    async translate(text) {
      const hit = cache.get(text);
      if (hit !== undefined) return hit;
      const run = chain.then(() => ask(text));
      chain = run.catch(() => {});
      const translation = await run;
      cache.set(text, translation);
      if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
      return translation;
    },
    close() {
      child?.kill();
      child = null;
    },
  };
}
