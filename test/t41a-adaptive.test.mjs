// test/t41a-adaptive.test.mjs
// T41a 적응형 주석 시험: 순수 함수(baseP, threshold, probability, adjustOffset),
// createWstat(record 날짜 중복·30개, get, last7, offset), annotate의 scoreOf 거름,
// 서버 /annotate-stats 및 하루 한 번 자동 조절.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseP, threshold, probability, adjustOffset, createWstat } from '../bridge/wstat.mjs';
import { createAnnotate, loadWordLevels } from '../bridge/annotate.mjs';
import { openDb } from '../bridge/db.mjs';
import { createStudy } from '../bridge/study.mjs';
import { createBridge } from '../bridge/server.mjs';
import { dateOf } from '../scripts/export-day.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';

// 가짜 시계 헬퍼 (로컬 정오 기준)
function createClock(startDateStr = '2026-10-15T12:00:00') {
  let current = new Date(startDateStr).getTime();
  return {
    now: () => current,
    advanceDays(n) {
      current += n * 86_400_000;
    },
    set(ts) {
      current = ts;
    },
  };
}

// 1. baseP와 threshold 순수 함수
test('baseP·threshold: 등급별 기본 확률과 기준선, B2 기본에서 현재 결과와 같음', () => {
  // baseP 기본값 검증
  assert.equal(baseP('A1'), 0.02);
  assert.equal(baseP('A2'), 0.05);
  assert.equal(baseP('B1'), 0.15);
  assert.equal(baseP('B2'), 0.35);
  assert.equal(baseP('C1'), 0.60);
  assert.equal(baseP('C2'), 0.75);
  assert.equal(baseP(null), 0.72);
  assert.equal(baseP(undefined), 0.72);

  // threshold 기본값 검증
  assert.equal(threshold('A2'), 0.04);
  assert.equal(threshold('B1'), 0.10);
  assert.equal(threshold('B2'), 0.30);
  assert.equal(threshold('C1'), 0.50);
  assert.equal(threshold('C2'), 0.70);

  // offset 반영
  assert.equal(threshold('B2', 0.03), 0.33);
  assert.equal(threshold('B2', -0.06), 0.24);

  // B2 기본(threshold B2 = 0.30, offset 0)에서:
  // B1은 안 붙고(< 0.30), B2·C1·C2·null은 붙음(>= 0.30)
  const thB2 = threshold('B2', 0);
  assert.ok(baseP('B1') < thB2); // 0.15 < 0.30
  assert.ok(baseP('B2') >= thB2); // 0.35 >= 0.30
  assert.ok(baseP('C1') >= thB2); // 0.60 >= 0.30
  assert.ok(baseP('C2') >= thB2); // 0.75 >= 0.30
  assert.ok(baseP(null) >= thB2); // 0.72 >= 0.30
});

// 2. probability 순수 함수 경우별 시험
test('probability: saved, lookups 1·3번, 감소 s=3·5, seen 있으면 감소 없음, 찾은 단어 감소 없음', () => {
  // 1) saved: level A1(0.02)이어도 max(p, 0.95)로 0.95
  assert.equal(probability({ level: 'A1', saved: true }), 0.95);
  // level C2(0.75)도 saved면 0.95
  assert.equal(probability({ level: 'C2', saved: true }), 0.95);

  // 2) lookups 1번: 0.90 + 0.02 * 0 = 0.90
  assert.equal(probability({ level: 'A1', lookups: 1 }), 0.90);
  // lookups 3번: 0.90 + 0.02 * 2 = 0.94
  assert.equal(probability({ level: 'A1', lookups: 3 }), 0.94);
  // lookups 상한 0.99
  assert.equal(probability({ level: 'A1', lookups: 10 }), 0.99);

  // 3) 감소: shownDays 길이 s >= 3이고 seen 0이면 * 0.7^(s-2)
  // s = 3: 0.35 * 0.7^1 = 0.245
  const pS3 = probability({
    level: 'B2',
    stat: { shownDays: ['2026-10-10', '2026-10-11', '2026-10-12'], seen: 0 },
  });
  assert.equal(Math.round(pS3 * 1e4) / 1e4, 0.245);

  // s = 5: 0.35 * 0.7^3 = 0.35 * 0.343 = 0.12005
  const pS5 = probability({
    level: 'B2',
    stat: { shownDays: ['d1', 'd2', 'd3', 'd4', 'd5'], seen: 0 },
  });
  assert.equal(Math.round(pS5 * 1e5) / 1e5, 0.12005);

  // s < 3 이면 감소 없음 (s = 2)
  const pS2 = probability({
    level: 'B2',
    stat: { shownDays: ['d1', 'd2'], seen: 0 },
  });
  assert.equal(pS2, 0.35);

  // 4) seen 있으면 감소 없음: seen = 1 이면 s = 3 이어도 0.35 유지
  const pSeen = probability({
    level: 'B2',
    stat: { shownDays: ['d1', 'd2', 'd3'], seen: 1 },
  });
  assert.equal(pSeen, 0.35);

  // 5) 찾은 단어는 감소 없음: lookups 1번이면 stat 감소 조건이어도 0.90 유지
  const pLookupStat = probability({
    level: 'B2',
    lookups: 1,
    stat: { shownDays: ['d1', 'd2', 'd3', 'd4', 'd5'], seen: 0 },
  });
  assert.equal(pLookupStat, 0.90);

  // saved 단어도 감소 없음: saved = true 면 stat 감소 조건이어도 0.95 유지
  const pSavedStat = probability({
    level: 'B2',
    saved: true,
    stat: { shownDays: ['d1', 'd2', 'd3', 'd4', 'd5'], seen: 0 },
  });
  assert.equal(pSavedStat, 0.95);
});

// 3. adjustOffset 순수 함수 경계 시험
test('adjustOffset: 20-2 규칙, 범위 -.15~+.15, 한 번에 ±.03', () => {
  // 기본 조건 1: 뜬 수 >= 100, 본 비율 < 10% -> +0.03
  assert.equal(adjustOffset({ offset: 0, shown: 100, seen: 5 }), 0.03);
  assert.equal(adjustOffset({ offset: 0.06, shown: 120, seen: 10 }), 0.09);

  // 기본 조건 2: 뜬 수 >= 50, missedLookups >= 5% -> -0.03
  assert.equal(adjustOffset({ offset: 0, shown: 50, seen: 20, missedLookups: 3 }), -0.03);
  assert.equal(adjustOffset({ offset: -0.06, shown: 100, seen: 30, missedLookups: 6 }), -0.09);

  // 상한 클램핑 (+0.15)
  assert.equal(adjustOffset({ offset: 0.14, shown: 100, seen: 5 }), 0.15);
  assert.equal(adjustOffset({ offset: 0.15, shown: 100, seen: 5 }), 0.15);

  // 하한 클램핑 (-0.15)
  assert.equal(adjustOffset({ offset: -0.14, shown: 100, seen: 20, missedLookups: 10 }), -0.15);
  assert.equal(adjustOffset({ offset: -0.15, shown: 100, seen: 20, missedLookups: 10 }), -0.15);

  // 조건 미충족 시 변화 없음
  assert.equal(adjustOffset({ offset: 0.05, shown: 90, seen: 0 }), 0.05); // shown < 100
  assert.equal(adjustOffset({ offset: 0.05, shown: 40, seen: 20, missedLookups: 10 }), 0.05); // shown < 50
  assert.equal(adjustOffset({ offset: 0.05, shown: 100, seen: 15, missedLookups: 2 }), 0.05); // 비율 미달
});

// 4. createWstat: record 날짜 중복·30개 유지, get, last7, offset 저장
test('wstat: record 날짜 중복 없음, 최근 30개 유지, last7 집계, meta offset 저장', () => {
  const db = openDb(':memory:');
  const clock = createClock('2026-10-01T12:00:00');
  const wstat = createWstat({ db, now: clock.now });

  // 같은 날 여러 번 record 호출 -> shownDays에 오늘 날짜는 1개만, shown은 누적
  wstat.record({ shown: ['apple', 'banana'], seen: ['apple'] });
  wstat.record({ shown: ['apple'], seen: [] });

  const a1 = wstat.get('apple');
  assert.equal(a1.shown, 2);
  assert.equal(a1.seen, 1);
  assert.deepEqual(a1.shownDays, ['2026-10-01']);

  // 35일간 매일 record 호출 -> 최근 30개만 유지 확인
  for (let i = 1; i <= 34; i++) {
    clock.advanceDays(1);
    wstat.record({ shown: ['apple'] });
  }
  const a35 = wstat.get('apple');
  assert.equal(a35.shown, 36); // 첫날 2회 + 34회 = 36회
  assert.equal(a35.shownDays.length, 30);
  assert.equal(a35.shownDays[a35.shownDays.length - 1], dateOf(clock.now())); // 마지막 날은 오늘

  // last7 집계 확인: 지난 7일 안 shownDays 개수 합
  const l7 = wstat.last7();
  // apple은 매일 1회씩 들어갔으므로 최근 7일에 7개 있음
  assert.equal(l7.shown, 7);
  // seen은 첫날(34일 전)에만 1회 기록되었으므로 7일 안 seen은 0
  assert.equal(l7.seen, 0);

  // 최근 날짜에 seen 기록 후 last7 확인
  wstat.record({ seen: ['apple'] });
  const l7After = wstat.last7();
  assert.equal(l7After.seen, 2);

  // meta offset 읽기/쓰기
  assert.equal(wstat.getOffset(), 0);
  assert.equal(wstat.getAuto(), true);
  assert.equal(wstat.getOffsetDay(), null);

  wstat.setOffset(0.06);
  assert.equal(wstat.getOffset(), 0.06);

  wstat.setOffsetDay('2026-10-15');
  assert.equal(wstat.getOffsetDay(), '2026-10-15');

  wstat.setAuto(false);
  assert.equal(wstat.getAuto(), false);
  wstat.setAuto(true);
  assert.equal(wstat.getAuto(), true);

  db.close();
});

// 5. annotate가 scoreOf로 거름: zero A1 용어집 단어 안 붙음, 찾아본 B1 단어 붙음
test('annotate: scoreOf로 거름 (zero A1 용어집 단어 안 붙음, 찾아본 B1 단어 붙음)', async () => {
  const levels = new Map([
    ['zero', 'A1'],
    ['abandon', 'B1'],
    ['delve', 'B2'],
  ]);

  const fakeDictTable = {
    zero: [{ headword: 'zero', text: 'zero | 영(0)' }],
    abandon: [{ headword: 'abandon', text: 'abandon | 버리다' }],
    delve: [{ headword: 'delve', text: 'delve | 탐구하다' }],
  };
  const dict = {
    lookup: async (w) => {
      const e = fakeDictTable[w];
      return e ? { found: true, entries: e.map((x) => ({ headword: x.headword, raw: x.text, senses: [{ text: x.text.split(' | ')[1] }] })) } : { found: false };
    },
  };

  // 용어집에 zero 등록
  const glossary = {
    find: (w) => (w === 'zero' ? { key: 'zero', ko: '영(0)', domain: 'math' } : null),
    acronym: () => null,
    domains: () => ['math'],
  };

  const lookupCounts = new Map([['abandon', 2]]); // abandon은 2번 찾아봄

  function scoreOf(lemma, level) {
    const lookups = lookupCounts.get(lemma) ?? 0;
    return probability({ level, lookups });
  }
  function thresholdFor(level) {
    return threshold(level, 0); // B2 -> 0.30
  }

  const annotate = createAnnotate({
    dict,
    levels,
    glossary,
    scoreOf,
    thresholdFor,
  });

  const res = await annotate(['zero', 'abandon', 'delve'], 'B2');

  // zero는 A1이라 p = 0.02 < 0.30 이므로 용어집 단어여도 안 붙음
  assert.equal('zero' in res, false);

  // abandon은 B1이지만 찾아본 횟수가 있어 p = 0.92 >= 0.30 이므로 붙음
  assert.ok('abandon' in res);
  assert.equal(res.abandon.lemma, 'abandon');

  // delve는 B2 기본 p = 0.35 >= 0.30 이므로 붙음
  assert.ok('delve' in res);
});

// 6. 서버 시험 헬퍼
async function startServer({ now = Date.now } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-adapt-'));
  const bridge = createBridge({
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    studyFile: join(dir, 'study-log.jsonl'),
    wordsFile: join(dir, 'words.json'),
    mydictFile: join(dir, 'mydict.json'),
    scrapsFile: join(dir, 'scraps.json'),
    dbFile: join(dir, 'readgloss.db'),
    extensionId: EXT,
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

// 6. 서버 401·400·200·reset·auto 시험
test('서버 /annotate-stats: 401 인증, 400 형식 오류, 200 기록, reset, auto 켜고 끔', async () => {
  const s = await startServer();
  try {
    // 1) 토큰 없으면 401
    assert.equal((await s.req('GET', '/annotate-stats')).status, 401);
    assert.equal((await s.req('POST', '/annotate-stats', { body: { shown: ['apple'] } })).status, 401);

    // 2) 400 형식 오류
    assert.equal((await s.req('POST', '/annotate-stats', { headers: s.auth, body: 'not-an-object' })).status, 400);
    assert.equal((await s.req('POST', '/annotate-stats', { headers: s.auth, body: { shown: 'not-array' } })).status, 400);
    assert.equal((await s.req('POST', '/annotate-stats', { headers: s.auth, body: { shown: ['invalid word!'] } })).status, 400);
    assert.equal((await s.req('POST', '/annotate-stats', { headers: s.auth, body: { shown: Array(501).fill('word') } })).status, 400);
    assert.equal((await s.req('POST', '/annotate-stats', { headers: s.auth, body: { op: 'auto', on: 'not-bool' } })).status, 400);
    assert.equal((await s.req('POST', '/annotate-stats', { headers: s.auth, body: { op: 'unknown' } })).status, 400);

    // 3) 정상 200 record
    const rRec = await s.req('POST', '/annotate-stats', {
      headers: s.auth,
      body: { shown: ['delve', 'mitigate'], seen: ['delve'] },
    });
    assert.equal(rRec.status, 200);
    assert.deepEqual(rRec.json(), { ok: true });

    // 4) GET /annotate-stats
    const rGet = await s.req('GET', '/annotate-stats', { headers: s.auth });
    assert.equal(rGet.status, 200);
    const data = rGet.json();
    assert.equal(data.offset, 0);
    assert.equal(data.auto, true);
    assert.equal(data.last7.shown, 2);
    assert.equal(data.last7.seen, 1);

    // 5) auto 켜고 끔
    const rOff = await s.req('POST', '/annotate-stats', { headers: s.auth, body: { op: 'auto', on: false } });
    assert.equal(rOff.status, 200);
    assert.equal((await s.req('GET', '/annotate-stats', { headers: s.auth })).json().auto, false);

    const rOn = await s.req('POST', '/annotate-stats', { headers: s.auth, body: { op: 'auto', on: true } });
    assert.equal(rOn.status, 200);
    assert.equal((await s.req('GET', '/annotate-stats', { headers: s.auth })).json().auto, true);

    // 6) reset
    // 먼저 offset을 wstat에 직접 넣고 reset 확인
    s.bridge.db.raw.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run('annot_offset', '0.06');
    assert.equal((await s.req('GET', '/annotate-stats', { headers: s.auth })).json().offset, 0.06);

    const rReset = await s.req('POST', '/annotate-stats', { headers: s.auth, body: { op: 'reset' } });
    assert.equal(rReset.status, 200);
    assert.equal((await s.req('GET', '/annotate-stats', { headers: s.auth })).json().offset, 0);
  } finally {
    await s.bridge.close();
  }
});

// 7. 하루 한 번만 조절 시험
test('서버 /annotate: 하루 한 번만 자동 조절 (annot_offset_day 기록 후 같은 날 재호출은 유지)', async () => {
  const clock = createClock('2026-10-15T12:00:00');
  const s = await startServer({ now: clock.now });
  try {
    // 7일간의 wstat 및 study 기록 세팅:
    // shown 100건, seen 5건 -> 비율 5% < 10% 이므로 offset +0.03 조건
    const rawShown = [];
    // 원형은 영문자만 받으므로(숫자 불가) aa, ab, … 로 100개
    for (let i = 0; i < 100; i++) rawShown.push(`w${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
    await s.req('POST', '/annotate-stats', {
      headers: s.auth,
      body: { shown: rawShown, seen: ['waa', 'wab', 'wac', 'wad', 'wae'] },
    });

    // 시작 전 offset 0 확인
    assert.equal((await s.req('GET', '/annotate-stats', { headers: s.auth })).json().offset, 0);

    // 첫 /annotate 호출 -> 자동 조절 발동되어 offset +0.03
    const rAnn1 = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['house'], level: 'B2' }, // 쉬운 단어라 사전 도우미 없이도 200
    });
    assert.equal(rAnn1.status, 200);

    const stats1 = (await s.req('GET', '/annotate-stats', { headers: s.auth })).json();
    assert.equal(stats1.offset, 0.03);
    assert.equal(stats1.updated, '2026-10-15');

    // 같은 날 두 번째 /annotate 호출 -> 하루 한 번 규칙에 의해 추가 조절 없음 (+0.03 유지)
    const rAnn2 = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['house'], level: 'B2' }, // 쉬운 단어라 사전 도우미 없이도 200
    });
    assert.equal(rAnn2.status, 200);

    const stats2 = (await s.req('GET', '/annotate-stats', { headers: s.auth })).json();
    assert.equal(stats2.offset, 0.03); // 여전히 0.03

    // 다음 날로 시간 경과 후 다시 호출하면 또 한 번 조절되어 0.06
    clock.advanceDays(1);
    const rAnn3 = await s.req('POST', '/annotate', {
      headers: s.auth,
      body: { words: ['house'], level: 'B2' }, // 쉬운 단어라 사전 도우미 없이도 200
    });
    assert.equal(rAnn3.status, 200);

    const stats3 = (await s.req('GET', '/annotate-stats', { headers: s.auth })).json();
    assert.equal(stats3.offset, 0.06);
    assert.equal(stats3.updated, '2026-10-16');
  } finally {
    await s.bridge.close();
  }
});
