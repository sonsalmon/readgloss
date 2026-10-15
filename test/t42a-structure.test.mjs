// test/t42a-structure.test.mjs
// T42a: 문장 구조 풀이(전치사+관계사) 다리 기능·캐시·통계·서버 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';
import {
  buildStructurePrompt,
  parseStructure,
  patternOf,
  createStructure,
} from '../bridge/structure.mjs';
import { AiParseError } from '../bridge/parse.mjs';
import { createCache } from '../bridge/cache.mjs';
import { openDb } from '../bridge/db.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';

test('buildStructurePrompt: 과제 설명 포함 및 마지막 줄에 입력 JSON 배치', () => {
  const p = buildStructurePrompt({
    sentence: 'This is the condition for which we tested.',
    phrase: 'for which',
    title: 'Test Title',
  });

  // 한국어 과제 설명 확인
  assert.match(p, /영어 문장의 뼈대/);
  assert.match(p, /원문 조각으로 나누고/);
  assert.match(p, /for which/);
  assert.match(p, /자연스러운 한국어로 번역/);
  assert.match(p, /skeleton/);

  // 마지막 줄 JSON 확인
  const lines = p.trim().split('\n');
  const lastLine = lines[lines.length - 1];
  const input = JSON.parse(lastLine);
  assert.deepEqual(input, {
    sentence: 'This is the condition for which we tested.',
    phrase: 'for which',
    title: 'Test Title',
  });

  // title 생략 시 payload 에 title 없음 확인
  const pNoTitle = buildStructurePrompt({
    sentence: ' This is   a sentence. \n',
    phrase: ' in which ',
  });
  const lastLineNoTitle = pNoTitle.trim().split('\n').pop();
  const inputNoTitle = JSON.parse(lastLineNoTitle);
  assert.deepEqual(inputNoTitle, {
    sentence: 'This is a sentence.',
    phrase: 'in which',
  });
  assert.equal('title' in inputNoTitle, false);
});

test('parseStructure: 정상 JSON 파싱, 마크다운 펜스 및 앞뒤 잡담 허용', () => {
  const sample = {
    skeleton: [
      { role: '주어', text: 'The condition' },
      { role: '동사', text: 'holds' },
    ],
    phrase: 'for which = 그 조건이 성립하는 대상',
    ko: '그 조건이 성립한다.',
  };

  // 일반 JSON
  assert.deepEqual(parseStructure(JSON.stringify(sample)), sample);

  // 마크다운 코드 펜스
  assert.deepEqual(parseStructure(`\`\`\`json\n${JSON.stringify(sample)}\n\`\`\``), sample);

  // 앞뒤 잡담
  assert.deepEqual(parseStructure(`여기 분석 결과입니다:\n${JSON.stringify(sample)}\n참고하세요.`), sample);
});

test('parseStructure: skeleton 거름(역할 5종·text<=300자만, 최대 8개)', () => {
  const input = {
    skeleton: [
      { role: '주어', text: 'Subj' },
      { role: '동사', text: 'Verb' },
      { role: '목적어', text: 'Obj' },
      { role: '보어', text: 'Comp' },
      { role: '수식', text: 'Mod' },
      { role: '부사', text: 'BadRole' }, // 유효하지 않은 역할
      { role: '동사', text: '' }, // 빈 문자열
      { role: '동사', text: 'x'.repeat(301) }, // 300자 초과
      { role: '동사', text: 123 }, // 문자열 아님
      { role: '수식', text: 'Mod 2' },
      { role: '수식', text: 'Mod 3' },
      { role: '수식', text: 'Mod 4' },
      { role: '수식', text: 'Mod 5' }, // 9번째 유효 항목 (최대 8개 제한에 걸림)
    ],
    phrase: 'for which = 풀이',
    ko: '번역문',
  };

  const parsed = parseStructure(JSON.stringify(input));
  assert.equal(parsed.skeleton.length, 8);
  assert.deepEqual(parsed.skeleton, [
    { role: '주어', text: 'Subj' },
    { role: '동사', text: 'Verb' },
    { role: '목적어', text: 'Obj' },
    { role: '보어', text: 'Comp' },
    { role: '수식', text: 'Mod' },
    { role: '수식', text: 'Mod 2' },
    { role: '수식', text: 'Mod 3' },
    { role: '수식', text: 'Mod 4' },
  ]);
});

test('parseStructure: 깨진 출력은 AiParseError', () => {
  // 1. JSON 아님
  assert.throws(() => parseStructure('죄송합니다. 분석할 수 없습니다.'), AiParseError);
  assert.throws(() => parseStructure(''), AiParseError);

  // 2. skeleton 깨짐
  assert.throws(() => parseStructure('{"skeleton":"not an array","phrase":"p","ko":"k"}'), AiParseError);
  assert.throws(() => parseStructure('{"skeleton":[],"phrase":"p","ko":"k"}'), AiParseError); // 유효 항목 0개
  assert.throws(() => parseStructure('{"skeleton":[{"role":"알수없음","text":"x"}],"phrase":"p","ko":"k"}'), AiParseError);

  // 3. phrase 깨짐
  assert.throws(() => parseStructure('{"skeleton":[{"role":"주어","text":"S"}],"phrase":"","ko":"k"}'), AiParseError);
  assert.throws(() => parseStructure('{"skeleton":[{"role":"주어","text":"S"}],"phrase":123,"ko":"k"}'), AiParseError);
  assert.throws(() => parseStructure(`{"skeleton":[{"role":"주어","text":"S"}],"phrase":"${'a'.repeat(201)}","ko":"k"}`), AiParseError);

  // 4. ko 깨짐
  assert.throws(() => parseStructure('{"skeleton":[{"role":"주어","text":"S"}],"phrase":"p","ko":""}'), AiParseError);
  assert.throws(() => parseStructure('{"skeleton":[{"role":"주어","text":"S"}],"phrase":"p","ko":null}'), AiParseError);
  assert.throws(() => parseStructure(`{"skeleton":[{"role":"주어","text":"S"}],"phrase":"p","ko":"${'a'.repeat(601)}"}`), AiParseError);
});

test('patternOf: 7가지 패턴 정확히 분류', () => {
  // prep+which
  assert.equal(patternOf('for which'), 'prep+which');
  assert.equal(patternOf('IN WHICH'), 'prep+which');
  assert.equal(patternOf('  through   which  '), 'prep+which');
  assert.equal(patternOf('against which'), 'prep+which');
  assert.equal(patternOf('upon which'), 'prep+which');
  assert.equal(patternOf('towards which'), 'prep+which');

  // prep+whom
  assert.equal(patternOf('to whom'), 'prep+whom');
  assert.equal(patternOf('WITH WHOM'), 'prep+whom');

  // prep+whose
  assert.equal(patternOf('in whose'), 'prep+whose');
  assert.equal(patternOf('of whose'), 'prep+whose');

  // extent-to-which
  assert.equal(patternOf('extent to which'), 'extent-to-which');
  assert.equal(patternOf('the extent to which'), 'extent-to-which');
  assert.equal(patternOf('THE EXTENT TO WHICH'), 'extent-to-which');

  // degree-to-which
  assert.equal(patternOf('degree to which'), 'degree-to-which');
  assert.equal(patternOf('the degree to which'), 'degree-to-which');

  // way-in-which
  assert.equal(patternOf('way in which'), 'way-in-which');
  assert.equal(patternOf('the way in which'), 'way-in-which');

  // other
  assert.equal(patternOf('which'), 'other');
  assert.equal(patternOf('that which'), 'other');
  assert.equal(patternOf('for what'), 'other');
  assert.equal(patternOf('unknown phrase'), 'other');
  assert.equal(patternOf(''), 'other');
});

test('createStructure: 캐시 동작(두 번째는 ask 안 부름, 공백·대소문자 무관) 및 force', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-struct-unit-'));
  const cache = createCache(join(dir, 'c.json'));
  const db = openDb(join(dir, 'test.db'));

  let askCount = 0;
  const mockAsk = async () => {
    askCount++;
    return JSON.stringify({
      skeleton: [{ role: '주어', text: 'Subject' }],
      phrase: 'for which = 풀이',
      ko: `번역 ${askCount}`,
    });
  };

  const structure = createStructure({ cache, ask: mockAsk, db });

  // 첫 번째 호출 -> ask 호출
  const res1 = await structure.explain({
    sentence: 'A sentence for which we have proof.',
    phrase: 'For Which',
  });
  assert.equal(askCount, 1);
  assert.equal(res1.cached, false);
  assert.equal(res1.ko, '번역 1');
  assert.equal(res1.pattern, 'prep+which');
  assert.equal(res1.opened, 1);

  // 두 번째 호출(동일 문장, 문장 공백 정규화 및 phrase 소문자화) -> 캐시 히트 (ask 안 부름)
  const res2 = await structure.explain({
    sentence: '  A   sentence for which we have proof. \n',
    phrase: 'for which',
  });
  assert.equal(askCount, 1);
  assert.equal(res2.cached, true);
  assert.equal(res2.ko, '번역 1');
  assert.equal(res2.opened, 2); // sstat 누적은 계속됨

  // force: true 호출 -> 캐시 무시하고 ask 호출
  const res3 = await structure.explain({
    sentence: 'A sentence for which we have proof.',
    phrase: 'for which',
    force: true,
  });
  assert.equal(askCount, 2);
  assert.equal(res3.cached, false);
  assert.equal(res3.ko, '번역 2');
  assert.equal(res3.opened, 3);

  db.close();
});

test('createStructure: sstat 누적 및 stats 정렬(많은 순)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-struct-stats-'));
  const cache = createCache(join(dir, 'c.json'));
  const db = openDb(join(dir, 'test.db'));

  let nowTs = 1000;
  const now = () => nowTs++;

  const mockAsk = async () =>
    JSON.stringify({
      skeleton: [{ role: '주어', text: 'Subj' }],
      phrase: 'phrase',
      ko: '번역',
    });

  const structure = createStructure({ cache, ask: mockAsk, db, now });

  // prep+which 3회
  await structure.explain({ sentence: 's1', phrase: 'in which' });
  await structure.explain({ sentence: 's2', phrase: 'for which' });
  await structure.explain({ sentence: 's3', phrase: 'to which' });

  // extent-to-which 5회
  for (let i = 0; i < 5; i++) {
    await structure.explain({ sentence: `s_ext_${i}`, phrase: 'the extent to which' });
  }

  // way-in-which 1회
  await structure.explain({ sentence: 's_way', phrase: 'the way in which' });

  // db 점 검증
  const nodeExt = db.get('ss_extent-to-which');
  assert.equal(nodeExt.kind, 'sstat');
  assert.equal(nodeExt.data.opened, 5);

  const nodePrep = db.get('ss_prep+which');
  assert.equal(nodePrep.data.opened, 3);

  // stats() 조회 -> 많은 순 정렬
  const st = structure.stats();
  assert.deepEqual(st.patterns, [
    { pattern: 'extent-to-which', opened: 5 },
    { pattern: 'prep+which', opened: 3 },
    { pattern: 'way-in-which', opened: 1 },
  ]);

  db.close();
});

// --- 서버 HTTP 통합 시험 도우미 ---
async function startServer(askStructure = async () => JSON.stringify({
  skeleton: [{ role: '주어', text: 'Apple' }, { role: '동사', text: 'falls' }],
  phrase: 'for which = 사과가 떨어지는 이유',
  ko: '사과가 떨어진다.',
})) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-struct-srv-'));
  const prompts = [];
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askContext: async () => '{"translation":"번역"}',
    askStructure: async (p) => {
      prompts.push(p);
      return askStructure(p);
    },
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
  });

  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');

  const req = (method, path, { headers = {}, body, raw } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: t,
              json: () => JSON.parse(t),
            }),
          );
        },
      );
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });

  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  return {
    bridge,
    prompts,
    dir,
    auth,
    post: (body, headers = auth) => req('POST', '/explain-structure', { headers, body }),
    getStats: (headers = auth) => req('GET', '/explain-structure/stats', { headers }),
    req,
  };
}

test('서버 /explain-structure: 토큰(401)·Origin(403)·메서드(405)', async () => {
  const s = await startServer();
  try {
    const validBody = { sentence: 'Valid sentence.', phrase: 'in which' };

    // 1. 토큰 누락 -> 401
    assert.equal((await s.post(validBody, { Origin: MINE })).status, 401);
    // 2. 잘못된 토큰 -> 401
    assert.equal((await s.post(validBody, { 'X-Bridge-Token': 'badtoken', Origin: MINE })).status, 401);
    // 3. 잘못된 Origin -> 403
    assert.equal((await s.post(validBody, { ...s.auth, Origin: 'https://evil.example' })).status, 403);
    // 4. 잘못된 메서드 (GET) -> 405
    assert.equal((await s.req('GET', '/explain-structure', { headers: s.auth })).status, 405);
    // 5. stats 경로 잘못된 메서드 (POST) -> 405
    assert.equal((await s.req('POST', '/explain-structure/stats', { headers: s.auth })).status, 405);

    assert.equal(s.prompts.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('서버 /explain-structure: 입력 검증(400)', async () => {
  const s = await startServer();
  try {
    // sentence 오류
    assert.equal((await s.post({ phrase: 'in which' })).status, 400); // 누락
    assert.equal((await s.post({ sentence: '', phrase: 'in which' })).status, 400); // 빈 문자열
    assert.equal((await s.post({ sentence: '   ', phrase: 'in which' })).status, 400); // 공백만
    assert.equal((await s.post({ sentence: 'a'.repeat(601), phrase: 'in which' })).status, 400); // 600자 초과
    assert.equal((await s.post({ sentence: 123, phrase: 'in which' })).status, 400);

    // phrase 오류
    assert.equal((await s.post({ sentence: 'Some sentence.' })).status, 400); // 누락
    assert.equal((await s.post({ sentence: 'Some sentence.', phrase: '' })).status, 400); // 빈 문자열
    assert.equal((await s.post({ sentence: 'Some sentence.', phrase: '   ' })).status, 400); // 공백만
    assert.equal((await s.post({ sentence: 'Some sentence.', phrase: 'p'.repeat(61) })).status, 400); // 60자 초과

    // title 오류
    assert.equal((await s.post({ sentence: 'Some sentence.', phrase: 'in which', title: 't'.repeat(301) })).status, 400);
    assert.equal((await s.post({ sentence: 'Some sentence.', phrase: 'in which', title: 123 })).status, 400);

    // JSON 본문 깨짐
    assert.equal((await s.req('POST', '/explain-structure', { headers: s.auth, raw: '{broken' })).status, 400);

    assert.equal(s.prompts.length, 0);
  } finally {
    await s.bridge.close();
  }
});

test('서버 /explain-structure: 정상 호출(200), 캐시 및 통계 누적 확인', async () => {
  const s = await startServer();
  try {
    const body = {
      sentence: 'This is the framework within which we operate.',
      phrase: 'within which',
      title: 'Operating Framework',
    };

    // 1. 첫 요청 -> AI 호출
    const res1 = await s.post(body);
    assert.equal(res1.status, 200);
    const json1 = res1.json();
    assert.deepEqual(json1.skeleton, [
      { role: '주어', text: 'Apple' },
      { role: '동사', text: 'falls' },
    ]);
    assert.equal(json1.phrase, 'for which = 사과가 떨어지는 이유');
    assert.equal(json1.ko, '사과가 떨어진다.');
    assert.equal(json1.pattern, 'prep+which');
    assert.equal(json1.opened, 1);
    assert.equal(json1.cached, false);
    assert.equal(s.prompts.length, 1);

    // 2. 두 번째 요청 -> 캐시 히트
    const res2 = await s.post(body);
    assert.equal(res2.status, 200);
    const json2 = res2.json();
    assert.equal(json2.cached, true);
    assert.equal(json2.opened, 2);
    assert.equal(s.prompts.length, 1); // AI 추가 호출 없음

    // 3. stats 조회 -> GET /explain-structure/stats
    const resStats = await s.getStats();
    assert.equal(resStats.status, 200);
    assert.deepEqual(resStats.json(), {
      patterns: [{ pattern: 'prep+which', opened: 2 }],
    });
  } finally {
    await s.bridge.close();
  }
});

test('서버 /explain-structure: AI 실패 오류(502)', async () => {
  const s = await startServer(async () => '죄송합니다. 오류가 발생했습니다.');
  try {
    const res = await s.post({
      sentence: 'Some test sentence in which it fails.',
      phrase: 'in which',
    });
    assert.equal(res.status, 502);
    assert.deepEqual(res.json(), { error: 'ai-failed' });
  } finally {
    await s.bridge.close();
  }
});
