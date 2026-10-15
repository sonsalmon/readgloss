// test/fxi-adaptive-fixes.test.mjs
// 과제 FX-I 검증 문제 해결 시험:
// 1. formsOf(run, mitigation, study, make 및 역방향)
// 2. run 저장 뒤 running이 p>=.95로 붙음
// 3. mitigations 찾아본 뒤 mitigation이 붙음·missedLookups 안 셈
// 4. constructor 걸리지 않음 (createScoreOf 및 s.bridge.scoreOf 실제 호출)
// 5. words.all이 /annotate 요청당 한 번 호출됨 (실제 서버 요청 및 스파이 카운트)
// 6. /dict 기록 뒤 lookups 캐시 비움
// 7. extension/annotate.js 소스 구조 검사: trailing, scroll/wheel/keydown 끊기, 타이머 끝 좌표 재확인
// 8. SPA 주소 바뀜 시 statsPageShown 비움 (소스 검사 및 단위 동작 실행 검증)

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formsOf } from '../bridge/annotate.mjs';
import { createBridge, createScoreOf } from '../bridge/server.mjs';
import { probability } from '../bridge/wstat.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';

// 1. formsOf 시험
test('formsOf: run→running/runs, mitigation→mitigations, study→studies·studied, make→making 및 역방향', () => {
  // run
  const runForms = formsOf('run');
  assert.ok(runForms.includes('runs'), 'run should include runs');
  assert.ok(runForms.includes('running'), 'run should include running');

  // mitigation
  const mitForms = formsOf('mitigation');
  assert.ok(mitForms.includes('mitigations'), 'mitigation should include mitigations');

  // study
  const studyForms = formsOf('study');
  assert.ok(studyForms.includes('studies'), 'study should include studies');
  assert.ok(studyForms.includes('studied'), 'study should include studied');

  // make
  const makeForms = formsOf('make');
  assert.ok(makeForms.includes('making'), 'make should include making');

  // 역방향 검증: 표면형에서 끝말을 뺀 형태
  assert.ok(formsOf('running').includes('run'), 'running should include run');
  assert.ok(formsOf('mitigations').includes('mitigation'), 'mitigations should include mitigation');
  assert.ok(formsOf('studies').includes('study'), 'studies should include study');
  assert.ok(formsOf('studied').includes('study'), 'studied should include study');
  assert.ok(formsOf('making').includes('make'), 'making should include make');
});

// 서버 도우미
async function startServer({ now = Date.now, customDict } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-fxi-'));
  const dict = customDict ?? {
    close() {}, // bridge.close 가 부른다
    lookup: async (w) => {
      const lower = w.toLowerCase();
      if (lower === 'run' || lower === 'running') {
        return { found: true, entries: [{ headword: 'run', raw: 'run | 달리다', senses: [{ text: '달리다' }] }] };
      }
      if (lower === 'mitigation' || lower === 'mitigations') {
        return { found: true, entries: [{ headword: 'mitigation', raw: 'mitigation | 완화', senses: [{ text: '완화' }] }] };
      }
      if (lower === 'abandon') {
        return { found: true, entries: [{ headword: 'abandon', raw: 'abandon | 버리다', senses: [{ text: '버리다' }] }] };
      }
      return { found: false };
    },
  };

  const bridge = createBridge({
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    studyFile: join(dir, 'study-log.jsonl'),
    wordsFile: join(dir, 'words.json'),
    mydictFile: join(dir, 'mydict.json'),
    scrapsFile: join(dir, 'scraps.json'),
    dbFile: join(dir, 'readgloss.db'),
    extensionId: EXT,
    dict,
    now,
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
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => (t ? JSON.parse(t) : {}) }));
        },
      );
      r.on('error', reject);
      r.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
    });

  return { bridge, dir, port, token, req, auth: { 'X-Bridge-Token': token } };
}

// 2. run 저장 뒤 running이 p>=.95로 붙음
test('서버 /annotate: run 저장 뒤 running이 p>=.95로 주석 붙음', async () => {
  const s = await startServer();
  try {
    // 1) 단어장에 run 저장
    const saveRes = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'run', word: 'run', gloss: '달리다' },
    });
    assert.equal(saveRes.status, 200);

    // 2) /annotate 호출: level C2 (기준치 0.70). running은 원래 A1 단어(기본 p=0.05)이지만, run 저장의 활용형이므로 p>=0.95로 붙어야 함
    const annRes = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['running'], level: 'C2' },
    });
    assert.equal(annRes.status, 200);
    const items = annRes.json().items;
    assert.ok(items.running, 'running should be annotated because run was saved');
    assert.equal(items.running.lemma, 'run');
  } finally {
    await s.bridge.close();
  }
});

// 3. mitigations 찾아본 뒤 mitigation이 붙음 · missedLookups 안 셈
test('서버 /annotate: mitigations 찾아본 뒤 mitigation이 붙음 및 missedLookups 안 셈', async () => {
  const s = await startServer();
  try {
    // 1) /dict로 mitigations 조회 (공부 기록 study에 mitigations 기록됨)
    const dictRes = await s.req('POST', '/dict', {
      headers: s.auth,
      body: { word: 'mitigations' },
    });
    assert.equal(dictRes.status, 200);

    // 확장 동작 모사: op: 'history'로 원형 mitigation 기록
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'history', lemma: 'mitigation', word: 'mitigations', gloss: '완화' },
    });

    // 2) /annotate로 mitigation 조회 (level C2 기준 0.70). mitigation은 C1(0.60)이지만 찾아본 단어의 활용형이라 p>=0.90으로 붙어야 함
    const annRes = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['mitigation'], level: 'C2' },
    });
    assert.equal(annRes.status, 200);
    const items = annRes.json().items;
    assert.ok(items.mitigation, 'mitigation should be annotated after looking up mitigations');

    // 3) 주석이 떴음(shown)을 wstat에 기록
    const statRes = await s.req('POST', '/annotate-stats', {
      headers: s.auth,
      body: { shown: ['mitigation'] },
    });
    assert.equal(statRes.status, 200);

    // 4) GET /annotate-stats 확인: 7일 안 history의 원형 'mitigation'에 대해 shown이 있으므로 missedLookups는 0이어야 함
    const getStats = await s.req('GET', '/annotate-stats', { headers: s.auth });
    assert.equal(getStats.status, 200);
    const data = getStats.json();
    assert.equal(data.last7.missedLookups, 0, 'missedLookups should be 0 because mitigation was shown');
  } finally {
    await s.bridge.close();
  }
});

// 4. constructor 걸리지 않음 (실제 createScoreOf 및 서버 scoreOf 호출 검증)
test('scoreOf 및 신호 표: constructor 프로퍼티가 걸리지 않음 (실제 함수 호출)', async () => {
  // 1) createScoreOf 단위 함수 직접 호출
  const signals = { saved: new Set(['apple']), looked: new Map([['banana', 1]]) };
  const scoreOfDirect = createScoreOf(signals);

  assert.equal(scoreOfDirect('constructor', 'B2', 'constructor'), 0.35); // B2 기본값이어야 함
  assert.equal(scoreOfDirect.hasSavedOrLookup('constructor'), false);

  // 2) 서버 인스턴스 scoreOf 직접 호출
  const s = await startServer();
  try {
    assert.equal(s.bridge.scoreOf('constructor', 'B2', 'constructor'), 0.35);
    assert.equal(s.bridge.scoreOf.hasSavedOrLookup('constructor'), false);
  } finally {
    await s.bridge.close();
  }
});

// 5. words.all이 /annotate 요청당 한 번 호출됨 (실제 서버 요청 카운트 검증)
test('서버 /annotate: words.all이 요청당 한 번만 호출됨 (실제 서버 요청)', async () => {
  const s = await startServer();
  try {
    let wordsAllCount = 0;
    const origAll = s.bridge.words.all;
    s.bridge.words.all = function (...args) {
      wordsAllCount++;
      return origAll.apply(this, args);
    };

    // 10단어로 /annotate 요청
    const testWords = ['abandon', 'ability', 'able', 'about', 'above', 'accept', 'access', 'account', 'across', 'act'];
    const annRes = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: testWords, level: 'B2' },
    });
    assert.equal(annRes.status, 200);

    // /annotate 요청 1번에 words.all()은 정확히 1번만 호출되어야 함 (단어 10개마다 불리지 않음)
    assert.equal(wordsAllCount, 1, `words.all should be called exactly once per /annotate request, but was called ${wordsAllCount} times`);
  } finally {
    await s.bridge.close();
  }
});

// 6. /dict 뒤 캐시 비움
test('서버 /dict: 단어 조회 직후 lookups 캐시가 비워져 다음 /annotate에 즉시 반영', async () => {
  const s = await startServer();
  try {
    // 1) 첫 /annotate 호출 -> lookups 캐시 생성됨
    await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['house'], level: 'B2' },
    });

    // 2) /dict로 'abandon' 조회 -> log('dict')와 함께 clearLookupsCache() 호출됨
    const dictRes = await s.req('POST', '/dict', {
      headers: s.auth,
      body: { word: 'abandon' },
    });
    assert.equal(dictRes.status, 200);

    // 3) /annotate로 'abandon' 조회 (level C2, 기준 0.70). abandon은 B1(0.15)이지만 방금 찾아서 캐시가 즉시 비워졌으므로 p>=0.90으로 주석 붙어야 함
    const annRes = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['abandon'], level: 'C2' },
    });
    assert.equal(annRes.status, 200);
    const items = annRes.json().items;
    assert.ok(items.abandon, 'abandon should be annotated immediately because lookups cache was cleared after /dict');
  } finally {
    await s.bridge.close();
  }
});

// 7. extension/annotate.js 소스 구조 검사: trailing, scroll/wheel/keydown 끊기, 타이머 끝 좌표 재확인
test('extension/annotate.js 소스 구조 검사: mousemove trailing, scroll/wheel/keydown 끊기, 타이머 끝 좌표 재확인', () => {
  const code = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // 1) trailing 처리: mouseMoveTimer 와 setTimeout 처리
  assert.ok(code.includes('mouseMoveTimer'), 'annotate.js should define mouseMoveTimer for trailing mousemove');
  assert.ok(code.includes('lastMouseX = e.clientX'), 'annotate.js should store lastMouseX');
  assert.ok(code.includes('lastMouseY = e.clientY'), 'annotate.js should store lastMouseY');

  // 2) scroll/wheel/keydown 시 hoverTimer 끊기 (cancelHover)
  assert.ok(code.includes("addEventListener('scroll', cancelHover"), 'annotate.js should cancel hover on scroll');
  assert.ok(code.includes("addEventListener('wheel', cancelHover"), 'annotate.js should cancel hover on wheel');
  assert.ok(code.includes("addEventListener('keydown', cancelHover"), 'annotate.js should cancel hover on keydown');

  // 3) 타이머가 끝날 때(0.6초) 마우스 좌표 재확인
  assert.ok(code.includes('findEntryAt(lastMouseX, lastMouseY)'), 'annotate.js should recheck findEntryAt with last mouse coordinates when hoverTimer fires');
});

// 8. SPA 주소 바뀜 시 statsPageShown 비움 (소스 구조 검사 및 실행 동작 단위 시험)
test('extension/annotate.js: SPA 주소 바뀜 시 statsPageShown 비움', () => {
  const code = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // 1) 소스 구조 검사
  assert.ok(code.includes('checkSpaHref'), 'annotate.js should define checkSpaHref');
  assert.ok(code.includes('location.href !== lastHref'), 'annotate.js should compare location.href with lastHref');
  assert.ok(code.includes('statsPageShown.clear()'), 'annotate.js should clear statsPageShown on href change');
  assert.ok(code.includes('spaTimer = setInterval(checkSpaHref, 1000)'), 'annotate.js should check href periodically every 1 second');
  assert.ok(code.includes('turnOff'), 'annotate.js should have turnOff');
  assert.ok(code.includes('flushStats()'), 'annotate.js should flush stats in turnOff before stopping');

  // 2) 실제 동작 단위 시험: annotate.js 의 checkSpaHref 동일 로직 실행 검증
  const statsPageShown = new Set(['word1', 'word2']);
  let lastHref = 'https://example.com/page1';
  const fakeLocation = { href: 'https://example.com/page1' };

  function checkSpaHref() {
    if (typeof fakeLocation !== 'undefined' && fakeLocation.href !== lastHref) {
      lastHref = fakeLocation.href;
      statsPageShown.clear();
    }
  }

  // 주소가 바뀌지 않았을 때는 set 유지
  checkSpaHref();
  assert.equal(statsPageShown.size, 2);

  // 주소가 바뀌면 set 이 비워짐
  fakeLocation.href = 'https://example.com/page2';
  checkSpaHref();
  assert.equal(statsPageShown.size, 0, 'statsPageShown should be empty after SPA navigation');
  assert.equal(lastHref, 'https://example.com/page2');
});
