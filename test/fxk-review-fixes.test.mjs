// test/fxk-review-fixes.test.mjs
// 과제 FX-K 복습 고리 수정 시험:
// 1. 과제 4: 옛 항목 나눠 넣기 (오래된 순·10개씩 날짜·한 번만·재시작 뒤 그대로)
// 2. 과제 3: 복습 끝(done) 단어의 주석 줄이기
//    - done 뒤 찾아봄 없음 → .20
//    - done 뒤 history 있음 → 평소 값 (0.95)
//    - done 전 history만 있음 → .20
//    - study.lookups는 done 판정에 쓰지 않음
// 3. 과제 5: op review 응답에 counts와 review 결과 실어 보내기
// 4. 소스 검사: 1(포커스 안쪽일 때만·readgloss:words 시 상태 유지), 2(뒷면 Space 무동작·know 자동 포커스 없음), 6(50개 소진 후 counts.due > 0이면 loadReview)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWords, phraseId } from '../bridge/words.mjs';
import { probability } from '../bridge/wstat.mjs';
import { createBridge } from '../bridge/server.mjs';
import { openDb } from '../bridge/db.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';

function createClock(startDateStr = '2026-10-16T12:00:00') {
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

async function startServer({ now = Date.now, useDb = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-fxk-'));
  const bridge = createBridge({
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    studyFile: join(dir, 'study-log.jsonl'),
    wordsFile: join(dir, 'words.json'),
    mydictFile: join(dir, 'mydict.json'),
    scrapsFile: join(dir, 'scraps.json'),
    ...(useDb && { dbFile: join(dir, 'readgloss.db') }),
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

// -------------------------------------------------------------
// [과제 4] 옛 항목 나눠 넣기 시험
// -------------------------------------------------------------
test('과제 4: words.mjs 시작 시 review 없는 항목을 ts 오래된 순으로 하루 10개씩 배치 (단어·구 함께, 한 번만, 재시작 후 유지)', () => {
  const clock = createClock('2026-10-16T12:00:00');
  const db = openDb(':memory:');

  // DB에 review가 없는 옛 항목들을 직접 심어둔다 (단어 15개, 구 10개 총 25개)
  // ts는 1000부터 1000씩 증가하도록 섞어서 저장
  const wordsToInsert = [
    { lemma: 'w01', ts: 1000 },
    { lemma: 'w03', ts: 3000 },
    { lemma: 'w05', ts: 5000 },
    { lemma: 'w07', ts: 7000 },
    { lemma: 'w09', ts: 9000 },
    { lemma: 'w11', ts: 11000 },
    { lemma: 'w13', ts: 13000 },
    { lemma: 'w15', ts: 15000 },
    { lemma: 'w17', ts: 17000 },
    { lemma: 'w19', ts: 19000 },
    { lemma: 'w21', ts: 21000 },
    { lemma: 'w23', ts: 23000 },
    { lemma: 'w25', ts: 25000 },
    { lemma: 'w02', ts: 2000 },
    { lemma: 'w04', ts: 4000 },
  ];
  for (const w of wordsToInsert) {
    db.put({
      id: `word:${w.lemma}`,
      kind: 'word',
      key: w.lemma,
      data: {
        saved: { word: w.lemma, gloss: 'g', sentence: '', url: '', ts: w.ts }, // review 없음
      },
      ts: w.ts,
    });
  }

  const phrasesToInsert = [
    { text: 'phrase 06', ts: 6000 },
    { text: 'phrase 08', ts: 8000 },
    { text: 'phrase 10', ts: 10000 },
    { text: 'phrase 12', ts: 12000 },
    { text: 'phrase 14', ts: 14000 },
    { text: 'phrase 16', ts: 16000 },
    { text: 'phrase 18', ts: 18000 },
    { text: 'phrase 20', ts: 20000 },
    { text: 'phrase 22', ts: 22000 },
    { text: 'phrase 24', ts: 24000 },
  ];
  for (const p of phrasesToInsert) {
    const pid = phraseId(p.text);
    db.put({
      id: pid,
      kind: 'phrase',
      key: p.text,
      data: { text: p.text, translation: 't', ts: p.ts }, // review 없음
      ts: p.ts,
    });
  }

  // createWords 시작!
  const w1 = createWords({ db, now: clock.now });
  const all1 = w1.all();

  // 총 25개 항목이 ts 오름차순(1000, 2000, ... 25000)으로 10개씩 배치되었는지 확인
  // 0~9번째 (ts 1000~10000): 오늘 2026-10-16 (+0일)
  // 10~19번째 (ts 11000~20000): 2026-10-17 (+1일)
  // 20~24번째 (ts 21000~25000): 2026-10-18 (+2일)
  const items = [];
  for (const [k, v] of Object.entries(all1.saved)) {
    items.push({ type: 'word', key: k, ts: v.ts, review: v.review });
  }
  for (const [k, v] of Object.entries(all1.phrases)) {
    items.push({ type: 'phrase', key: k, ts: v.ts, review: v.review });
  }
  assert.equal(items.length, 25);
  items.sort((a, b) => a.ts - b.ts);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    assert.ok(it.review, `항목 ${it.key}에 review가 있어야 함`);
    assert.equal(it.review.box, 1);
    assert.equal(it.review.last, 0);
    assert.equal(it.review.done, false);
    assert.equal(it.review.count, 0);

    const expectedDayOffset = Math.floor(i / 10);
    const expectedDue = expectedDayOffset === 0 ? '2026-10-16' : expectedDayOffset === 1 ? '2026-10-17' : '2026-10-18';
    assert.equal(it.review.due, expectedDue, `인덱스 ${i} (ts ${it.ts}) due 날짜 불일치`);
  }

  // 재시작 뒤에도 그대로 유지되는지 확인 (한 번만 수행되어 값이 덮어써지지 않음)
  clock.advanceDays(5); // 5일 지남 (2026-10-21)
  const w2 = createWords({ db, now: clock.now });
  const all2 = w2.all();
  for (let i = 0; i < items.length; i++) {
    const original = items[i];
    const reloaded = original.type === 'word' ? all2.saved[original.key].review : all2.phrases[original.key].review;
    assert.equal(reloaded.due, original.review.due, `재시작 후 ${original.key}의 due가 바뀌지 않아야 함`);
  }

  db.close();
});

// -------------------------------------------------------------
// [과제 3] 복습 끝(done) 단어의 주석 줄이기 시험
// -------------------------------------------------------------
test('과제 3: probability 순수 함수 - lookedAfterDone 불리언과 study.lookups 분리', () => {
  // done이 아닐 때는 일반 규칙
  assert.equal(probability({ level: 'B2', saved: true, done: false, lookups: 0 }), 0.95);

  // done이고 lookedAfterDone이 false이면 min(p, .20)
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: false, lookups: 0 }), 0.20);

  // study.lookups(숫자)가 있어도 lookedAfterDone이 false이면 done 판정은 0.20이어야 함 (study.lookups는 done 판정에 쓰지 않음)
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: false, lookups: 5 }), 0.20);

  // 복습 끝난 뒤 다시 찾아본 경우(lookedAfterDone: true)에는 찾아봄 규칙이 이겨서 평소 값(0.95) 유지
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: true, lookups: 0 }), 0.95);
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: true, lookups: 2 }), 0.95);
});

test('과제 3: 서버 신호 표(buildSignals)와 scoreOf - done 단어의 review.last 기준 판정', async () => {
  const clock = createClock('2026-10-16T12:00:00');
  const s = await startServer({ now: clock.now });
  try {
    // 1) 단어 저장 (B2 수준 단어)
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'mitigate', word: 'mitigate', gloss: '완화하다' },
    });

    // 2) 복습 5회 know로 done: true 만들기
    for (let i = 0; i < 5; i++) {
      clock.advanceDays(1);
      await s.req('POST', '/words', {
        headers: s.auth,
        body: { op: 'review', lemma: 'mitigate', result: 'know' },
      });
    }
    const wordItem = s.bridge.words.all().saved.mitigate;
    assert.equal(wordItem.review.done, true);
    const doneLastTs = wordItem.review.last;
    assert.ok(doneLastTs > 0);

    // [경우 1] done 뒤 찾아봄 없음 → scoreOf는 .20
    assert.equal(s.bridge.scoreOf('mitigate', 'B2'), 0.20);
    // 표면형/활용형 mitigated도 동일
    assert.equal(s.bridge.scoreOf('mitigate', 'B2', 'mitigated'), 0.20);

    // [경우 2] done 전 history만 있음 (history.ts <= review.last)
    // 과거 시각으로 history 항목 강제 주입
    clock.set(doneLastTs - 10000);
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'history', lemma: 'mitigate' },
    });
    // 시계 복귀
    clock.set(doneLastTs + 1000);
    // 여전히 review.last보다 늦은 찾아봄이 없으므로 .20 유지!
    assert.equal(s.bridge.scoreOf('mitigate', 'B2'), 0.20);

    // [경우 3] done 뒤 history 발생 (history.ts > review.last)
    clock.set(doneLastTs + 50000);
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'history', lemma: 'mitigate' },
    });
    // 복습 끝난 뒤 찾아봄이 발생했으므로 찾아봄 규칙이 이겨서 0.95!
    assert.equal(s.bridge.scoreOf('mitigate', 'B2'), 0.95);
    assert.equal(s.bridge.scoreOf('mitigate', 'B2', 'mitigated'), 0.95);
  } finally {
    await s.bridge.close();
  }
});

// -------------------------------------------------------------
// [과제 5] op review 응답에 review 결과와 counts 실어 보내기 시험
// -------------------------------------------------------------
test('과제 5: POST /words {op: "review"} 응답 및 apply 반환값에 review와 counts 포함', async () => {
  const clock = createClock('2026-10-16T12:00:00');
  const s = await startServer({ now: clock.now });
  try {
    // 단어 저장
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'exploit', word: 'exploit', gloss: '이용하다' },
    });

    // 구 저장
    const pid = phraseId('in order to');
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save-phrase', text: 'in order to', translation: '~하기 위해' },
    });

    // 1) 단어 op review 호출
    const resWord = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', lemma: 'exploit', result: 'know' },
    });
    assert.equal(resWord.status, 200);
    const dataWord = resWord.json();

    assert.ok(dataWord.review, '응답에 review 객체가 있어야 함');
    assert.equal(dataWord.review.box, 2);
    assert.ok(dataWord.counts, '응답에 counts 객체가 있어야 함');
    assert.equal(typeof dataWord.counts.due, 'number');
    assert.equal(typeof dataWord.counts.done, 'number');
    assert.equal(typeof dataWord.counts.total, 'number');
    assert.equal(dataWord.counts.total, 2);

    // 2) 구 op review 호출
    const resPhrase = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', id: pid, result: 'again' },
    });
    assert.equal(resPhrase.status, 200);
    const dataPhrase = resPhrase.json();

    assert.ok(dataPhrase.review, '구 review 응답에 review 객체가 있어야 함');
    assert.equal(dataPhrase.review.box, 1);
    assert.ok(dataPhrase.counts, '구 review 응답에 counts 객체가 있어야 함');
    assert.equal(typeof dataPhrase.counts.due, 'number');
  } finally {
    await s.bridge.close();
  }
});

// -------------------------------------------------------------
// [과제 1, 2, 6] 소스 코드 정적 검사
// -------------------------------------------------------------
test('과제 1, 2, 6: extension/panel-words.js 소스 코드 검사', () => {
  const code = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');

  // 과제 1:
  // - 다시 그릴 때 hadFocus 조건(포커스가 패널 shadow 안에 있었을 때) 검사 후 자동 포커스
  assert.match(code, /hadFocus/, 'hadFocus 판별 변수가 있어야 함');
  assert.doesNotMatch(code, /requestAnimationFrame\(\(\)\s*=>\s*knowBtn\.focus\(\)\)/, 'knowBtn에 무조건 자동 포커스하는 코드가 없어야 함');

  // - readgloss:words 이벤트 시 보고 있던 카드 상태(key, side) 유지
  assert.match(code, /loadReview\s*\(\s*true\s*\)/, 'readgloss:words 시 상태 유지 옵션으로 loadReview 호출');

  // 과제 2:
  // - 뒷면에서 Space 키가 들어오면 preventDefault만 하고 아무 답도 하지 않음
  assert.match(code, /cardState\.side\s*===\s*['"]back['"][\s\S]*?(?:e\.key\s*===\s*['"] ['"]|e\.code\s*===\s*['"]Space['"])[\s\S]*?preventDefault/, '뒷면 Space 시 preventDefault 처리 필요');

  // 과제 5:
  // - 대체 처리에서 know마다 done+1 하던 코드 삭제
  assert.doesNotMatch(code, /reviewData\.counts\.done\s*=\s*\(reviewData\.counts\.done\s*\?\?\s*0\)\s*\+\s*1/, '대체 처리에서 done을 +1하는 코드가 없어야 함');

  // 과제 6:
  // - 50개 소진 후 counts.due > 0이면 loadReview 다시 호출
  assert.match(code, /counts\.due[\s\S]*?loadReview/, '카드를 다 보고 counts.due가 남았으면 loadReview 호출');
});
