import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiError, AiTimeoutError, createClaudeClient } from './claude-client.mjs';
import { createCache } from './cache.mjs';
import { extensionIdFromKey } from './ext-id.mjs';
import { AiParseError } from './parse.mjs';
import { SYSTEM_PROMPT, WORD_RE, buildPrompt, createLookup } from './lookup.mjs';
import { DictUnavailableError, createDict } from './dict.mjs';
import { ANNOTATE_LEVELS, DEFAULT_LEVEL, createAnnotate, lemmaOf, shortGloss } from './annotate.mjs';
import { createWords, parseWordsOp } from './words.mjs';
import { createGlossary } from './glossary.mjs';
import { MAX_TEXT, buildTranslatePrompt, createTranslate, normalizeText } from './translate.mjs';

const PORT = 47831;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]); // DNS 리바인딩 차단
const MAX_BODY = 16 * 1024;
const MAX_SENTENCE = 1000;
const MAX_ANNOTATE_WORDS = 300;

function loadOrCreateToken(file) {
  try {
    const t = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(t)) {
      chmodSync(file, 0o600);
      return t;
    }
  } catch {
    // 없거나 못 읽음: 새로 만든다
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const t = randomBytes(32).toString('hex');
  writeFileSync(file, t, { mode: 0o600 });
  chmodSync(file, 0o600); // mode 는 새 파일에만 적용되므로 한 번 더
  return t;
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c); // 넘치면 버리면서 끝까지 읽는다(응답을 먼저 보내려면 소켓을 닫지 말아야 한다)
    });
    req.on('end', () => {
      if (size > MAX_BODY) return resolve({ status: 413 });
      try {
        resolve({ value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ status: 400 });
      }
    });
    req.on('error', () => resolve({ status: 400 }));
  });
}

// AI 호출 실패를 응답 코드로: 시간 초과 504, AI·파싱 실패 502, 그 밖은 500(내부 내용은 응답에 싣지 않는다)
function sendAiError(res, e, cors) {
  if (e instanceof AiTimeoutError) send(res, 504, { error: 'timeout' }, cors);
  else if (e instanceof AiError || e instanceof AiParseError) send(res, 502, { error: 'ai-failed' }, cors);
  else send(res, 500, { error: 'internal' }, cors);
}

// ask({word, sentence}) / askTranslate(문단, 용어 지정 목록) -> AI 원문. 테스트는 가짜를, 실제 실행은 claude 클라이언트를 넘긴다. dict 는 맥 사전 도우미.
export function createBridge({ ask, askTranslate, cacheFile, translationsFile = join(dirname(cacheFile), 'translations.json'), wordsFile = join(dirname(cacheFile), 'words.json'), tokenFile, extensionId, dict = createDict() }) {
  const token = loadOrCreateToken(tokenFile);
  const tokenBuf = Buffer.from(token);
  const lookup = createLookup({ cache: createCache(cacheFile), ask });
  const translate = createTranslate({ cache: createCache(translationsFile), ask: askTranslate });
  const words = createWords({ file: wordsFile });
  const glossary = createGlossary();
  const annotate = createAnnotate({ dict, isKnown: words.isKnown, glossary });
  const mine = `chrome-extension://${extensionId}`;

  const tokenOk = (h) => {
    if (typeof h !== 'string') return false;
    const b = Buffer.from(h);
    return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf);
  };

  async function handleLookup(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const { word, sentence = '', force } = value ?? {};
    if (typeof word !== 'string' || !WORD_RE.test(word) || typeof sentence !== 'string' || sentence.length > MAX_SENTENCE) {
      return send(res, 400, { error: 'bad-request' }, cors);
    }
    try {
      send(res, 200, await lookup({ word, sentence, force: force === true }), cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  async function handleTranslate(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const { text, force } = value ?? {};
    const norm = normalizeText(text);
    if (!norm) return send(res, 400, { error: 'bad-request' }, cors);
    if (norm.length > MAX_TEXT) return send(res, 413, { error: 'too-large' }, cors);
    const active = glossary.domains(value);
    try {
      send(res, 200, await translate({ text: norm, force: force === true, domainsKey: glossary.keyOf(active), terms: glossary.termsIn(norm, active) }), cors);
    } catch (e) {
      sendAiError(res, e, cors);
    }
  }

  async function handleDict(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const word = value?.word;
    if (typeof word !== 'string' || !WORD_RE.test(word)) return send(res, 400, { error: 'bad-request' }, cors);
    try {
      // 원형(lemma)은 /annotate 와 같은 함수로 다리가 정한다. 카드 버튼과 단어장은 이 값만 쓴다. gloss 는 단어장에 남길 짧은 뜻.
      const r = await dict.lookup(word);
      const lower = word.toLowerCase();
      const e = r.found ? r.entries[0] : null;
      const lemma = e ? lemmaOf(e, lower) : lower;
      // 분야 용어집(요청의 domains 힌트로 켜진 것)에 이 원형이 있으면 카드 맨 위 "용어:" 줄용으로 붙인다. 사전에 없는 단어도 용어집은 답한다.
      const active = glossary.domains(value);
      const t = glossary.find(lemma, active) ?? glossary.find(lower, active);
      send(res, 200, { ...r, lemma, ...(e ? { gloss: shortGloss(e.senses?.[0]?.text) } : {}), ...(t ? { term: { ko: t.ko, domain: t.domain } } : {}) }, cors);
    } catch (e) {
      if (e instanceof DictUnavailableError) send(res, 503, { error: 'dict-unavailable' }, cors);
      else send(res, 502, { error: 'dict-failed' }, cors);
    }
  }

  // 어려운 단어 주석: 단어 목록 -> { items: { 단어: { lemma, level, gloss } } }. 맥 사전만 쓰고 AI 는 안 부른다.
  async function handleAnnotate(req, res, cors) {
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const { words, level = DEFAULT_LEVEL } = value ?? {};
    if (!Array.isArray(words) || words.some((w) => typeof w !== 'string') || !ANNOTATE_LEVELS.includes(level)) return send(res, 400, { error: 'bad-request' }, cors);
    if (words.length > MAX_ANNOTATE_WORDS) return send(res, 413, { error: 'too-large' }, cors);
    try {
      send(res, 200, { items: await annotate(words.map((w) => w.toLowerCase()).filter((w) => WORD_RE.test(w)), level, glossary.domains(value)) }, cors);
    } catch (e) {
      if (e instanceof DictUnavailableError) send(res, 503, { error: 'dict-unavailable' }, cors);
      else send(res, 502, { error: 'dict-failed' }, cors);
    }
  }

  // 내 단어: GET -> { known, saved, history }, POST { op, lemma, ... } -> 바뀐 같은 모양의 상태
  async function handleWords(req, res, cors) {
    if (req.method === 'GET') return send(res, 200, words.all(), cors);
    const { value, status } = await readJson(req);
    if (status) return send(res, status, { error: status === 413 ? 'too-large' : 'bad-request' }, cors);
    const op = parseWordsOp(value);
    if (!op) return send(res, 400, { error: 'bad-request' }, cors);
    send(res, 200, words.apply(op), cors);
  }

  async function handle(req, res) {
    // 1. Host 가 고정값이 아니면 거절. 2. Origin 이 있는데 내 확장이 아니면 거절(토큰 유무와 무관).
    if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'forbidden' });
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== mine) return send(res, 403, { error: 'forbidden' });
    const cors = origin === mine ? { 'Access-Control-Allow-Origin': mine, Vary: 'Origin' } : {};
    const path = (req.url ?? '').split('?')[0];

    if (req.method === 'OPTIONS') {
      if (origin !== mine) return send(res, 403, { error: 'forbidden' });
      return send(res, 204, undefined, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Bridge-Token, Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }
    if (path === '/pair') {
      if (origin !== mine) return send(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return send(res, 200, { token }, cors);
    }
    if (!tokenOk(req.headers['x-bridge-token'])) return send(res, 401, { error: 'unauthorized' }, cors);
    if (path === '/ping') {
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return send(res, 200, { ok: true }, cors);
    }
    if (path === '/lookup') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleLookup(req, res, cors);
    }
    if (path === '/dict') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleDict(req, res, cors);
    }
    if (path === '/annotate') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleAnnotate(req, res, cors);
    }
    if (path === '/words') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleWords(req, res, cors);
    }
    if (path === '/translate') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, cors);
      return handleTranslate(req, res, cors);
    }
    return send(res, 404, { error: 'not-found' }, cors);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });

  return {
    // 127.0.0.1 에만 바인딩한다. port 0 이면 임시 포트(테스트용). 실제 포트를 돌려준다.
    listen: (port = PORT) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        dict.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// node bridge/server.mjs 로 직접 실행했을 때만
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = join(root, 'data');
  const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
  const extensionId = extensionIdFromKey(manifest.key);
  const client = createClaudeClient({ systemPrompt: SYSTEM_PROMPT, cwd: join(dataDir, 'claude-cwd') });
  const bridge = createBridge({
    ask: async (a) => (await client.ask(buildPrompt(a))).text,
    askTranslate: async (text, terms) => (await client.ask(buildTranslatePrompt(text, terms), { timeoutMs: 60_000 })).text,
    cacheFile: join(dataDir, 'cache.json'),
    tokenFile: join(dataDir, 'token'),
    extensionId,
  });
  const stop = () => {
    client.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', () => client.close());
  bridge.listen().then(
    (port) => console.log(`readgloss 다리: http://127.0.0.1:${port} (확장 ID ${extensionId})`),
    (e) => {
      console.error(e.code === 'EADDRINUSE' ? `포트 ${PORT} 가 이미 쓰이고 있어요. 다리가 이미 떠 있는지 확인해 주세요.` : e.message);
      process.exit(1);
    },
  );
}
