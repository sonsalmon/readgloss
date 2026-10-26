// 과제 T51a(변경 기록 27-1): yt-hook.js — 플레이어의 XHR·fetch 자막 응답을 엿들어 postMessage 로 넘기는지, 페이지 응답은 그대로인지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../extension/yt-hook.js', import.meta.url), 'utf8');
const TT = 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&fmt=json3&pot=zz';

// 가짜 페이지: window·location·XHR·fetch. posted 에 postMessage 를 모은다.
function page() {
  const posted = [];
  const listeners = [];
  const opened = [];
  class FakeXHR {
    constructor() {
      this.responseType = '';
      this.status = 0;
      this.responseText = '';
      this.response = null;
      this.responseURL = '';
      this.handlers = {};
    }
    open(method, url, async) {
      opened.push([method, url, async]);
      this.url = url;
    }
    send() {
      this.sent = true;
    }
    addEventListener(type, fn) {
      (this.handlers[type] ||= []).push(fn);
    }
    finish({ status = 200, text = '', response, responseType = '', responseURL } = {}) {
      this.status = status;
      this.responseType = responseType;
      this.responseText = text;
      this.response = response ?? text;
      this.responseURL = responseURL ?? this.url;
      for (const fn of this.handlers.load ?? []) fn.call(this);
    }
  }
  const ctx = {
    URL,
    TextDecoder,
    Response,
    Symbol,
    location: { href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', origin: 'https://www.youtube.com' },
    XMLHttpRequest: FakeXHR,
    fetch: async (input) => new Response(String(input).includes('timedtext') ? '{"events":[]}' : 'other', { status: 200 }),
    postMessage: (msg, origin) => posted.push({ msg, origin }),
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const win = vm.runInContext('window', ctx); // 맥락 안의 window(바깥 ctx 와 다른 객체)
  const send = (data) => listeners.forEach((fn) => fn({ source: win, data }));
  return { ctx, posted, send, opened };
}

test('XHR: 자막 주소 응답(200)을 그대로 넘긴다, 다른 주소·실패 응답은 안 넘긴다', () => {
  const { ctx, posted, opened } = page();
  const x = new ctx.XMLHttpRequest();
  x.open('GET', TT, true);
  x.send();
  x.finish({ text: '{"events":[1]}', responseURL: `${TT}&redirected=1` });
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ msg: { source: 'readgloss-yt', type: 'timedtext', url: `${TT}&redirected=1`, body: '{"events":[1]}' }, origin: 'https://www.youtube.com' }]);
  assert.deepEqual([...opened[0]], ['GET', TT, true], '원래 open 에 인자가 그대로 간다');
  assert.equal(x.sent, true);

  const other = new ctx.XMLHttpRequest();
  other.open('GET', 'https://www.youtube.com/youtubei/v1/player');
  other.send();
  other.finish({ text: 'x' });
  const failed = new ctx.XMLHttpRequest();
  failed.open('GET', TT);
  failed.send();
  failed.finish({ status: 403, text: 'no' });
  const relative = new ctx.XMLHttpRequest();
  relative.open('GET', '/api/timedtext?v=dQw4w9WgXcQ&lang=en');
  relative.send();
  relative.finish({ text: 'rel' });
  assert.equal(posted.length, 2, '다른 주소·403 은 빠지고 상대 주소 자막은 들어간다');
  assert.equal(posted[1].msg.body, 'rel');
});

test('XHR: responseType json·arraybuffer 도 글로 넘긴다', () => {
  const { ctx, posted } = page();
  const a = new ctx.XMLHttpRequest();
  a.open('GET', TT);
  a.send();
  a.finish({ responseType: 'json', response: { events: [] } });
  const b = new ctx.XMLHttpRequest();
  b.open('GET', TT);
  b.send();
  b.finish({ responseType: 'arraybuffer', response: new TextEncoder().encode('WEBVTT').buffer });
  assert.deepEqual(posted.map((p) => p.msg.body), ['{"events":[]}', 'WEBVTT']);
});

test('fetch: 자막 응답을 넘기고 페이지는 본문을 그대로 읽는다', async () => {
  const { ctx, posted } = page();
  const res = await ctx.fetch(TT);
  assert.equal(await res.text(), '{"events":[]}', '페이지가 읽을 본문이 그대로');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].msg.url, TT);
  const other = await ctx.fetch('https://www.youtube.com/generate_204');
  assert.equal(await other.text(), 'other');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posted.length, 1, '다른 주소는 안 넘긴다');
});

test('replay: 들고 있던 최근 8개를 다시 보낸다, 4MB 넘는 응답은 버린다', () => {
  const { ctx, posted, send } = page();
  for (let i = 0; i < 10; i++) {
    const x = new ctx.XMLHttpRequest();
    x.open('GET', `${TT}&n=${i}`);
    x.send();
    x.finish({ text: `b${i}` });
  }
  const big = new ctx.XMLHttpRequest();
  big.open('GET', TT);
  big.send();
  big.finish({ text: 'x'.repeat(4_000_001) });
  assert.equal(posted.length, 10);
  posted.length = 0;
  send({ source: 'readgloss-yt', type: 'replay' });
  assert.deepEqual(posted.map((p) => p.msg.body), ['b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']);
  posted.length = 0;
  send({ source: 'someone-else', type: 'replay' });
  send({ source: 'readgloss-yt', type: 'timedtext' });
  assert.equal(posted.length, 0, '다른 출처·다른 종류는 무시');
});

test('두 번 주입돼도 한 번만 감싼다', () => {
  const { ctx, posted } = page();
  vm.runInContext(SRC, ctx);
  const x = new ctx.XMLHttpRequest();
  x.open('GET', TT);
  x.send();
  x.finish({ text: 'once' });
  assert.equal(posted.length, 1);
});
