// 다리를 임시 폴더·임시 포트로 띄우는 시험 도구(T14b 시험들이 쓴다). 진짜 claude·진짜 사전·진짜 맥 번역은 부르지 않는다: ask·사전·맥 번역은 가짜다.
// 반환: { bridge, dir, asked(ask 호출 기록), clock, req, get, post, auth, close }
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import { createDict } from '../bridge/dict.mjs';
import { createMt } from '../bridge/mt.mjs';

export const EXT = 'abcdefghijklmnopabcdefghijklmnop';
export const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';
const FAKE_DICT = new URL('./fake-dict.mjs', import.meta.url).pathname;
const FAKE_MT = new URL('./fake-mt.mjs', import.meta.url).pathname;

export async function start({ dir = mkdtempSync(join(tmpdir(), 'rg-t14b-')), start: t0 = Date.now() } = {}) {
  const asked = { lookup: [], translate: [], context: [] };
  const clock = { t: t0, now: () => clock.t };
  const dict = createDict({ bin: process.execPath, args: [FAKE_DICT], timeoutMs: 10_000 });
  const mt = createMt({ bin: process.execPath, args: [FAKE_MT], timeoutMs: 5000, firstTimeoutMs: 10_000 });
  const bridge = createBridge({
    ask: async (a) => (asked.lookup.push(a), '{"gloss":"뜻"}'),
    askTranslate: async (text, terms) => (asked.translate.push({ text, terms }), '{"translation":"번역"}'),
    askContext: async (prompt) => (asked.context.push(prompt), '{"translation":"문맥 번역","note":"설명"}'),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    dict,
    mt,
    now: clock.now,
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  const req = (method, path, { headers = auth, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }));
      });
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });
  return { bridge, dir, asked, clock, req, auth, get: (path, o) => req('GET', path, o), post: (path, body, o) => req('POST', path, { ...o, body }), close: () => bridge.close() };
}
