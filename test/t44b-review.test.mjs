// test/t44b-review.test.mjs
// 과제 T44b 복습 상태(다리) 시험:
// 1. applyReview 상자 이동·날짜(월말 넘김)·done·again, isDue
// 2. 불러오기 보존 (DB와 JSON 둘 다 — 다리를 새로 만들어 다시 읽어도 review 보존)
// 3. 다시 저장해도 유지 (처음 저장이면 initialReview, 다시 저장해도 기존 review 유지)
// 4. op review 400 · 404 · 200
// 5. GET /words/review 정렬·50개 제한·counts
// 6. done 단어 주석 확률 .20 (찾아봄 있으면 그대로)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, applyReview, initialReview, INTERVALS, isDue, isValidReview } from '../bridge/review.mjs';
import { createWords, parseWordsOp, phraseId } from '../bridge/words.mjs';
import { probability } from '../bridge/wstat.mjs';
import { createBridge } from '../bridge/server.mjs';
import { openDb } from '../bridge/db.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';

// 가짜 시계 헬퍼 (로컬 정오 기준)
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

// 1. applyReview 순수 함수 시험
test('review 순수 함수: initialReview, applyReview 상자 이동, 월말 날짜 넘김, done, again, isDue', () => {
  const today = '2026-10-16';
  const now = 1760583600000;

  // initialReview
  const init = initialReview(today);
  assert.deepEqual(init, {
    box: 1,
    due: today,
    last: 0,
    done: false,
    count: 0,
  });

  // isDue
  assert.equal(isDue(init, '2026-10-15'), false); // due(10-16) > today(10-15)
  assert.equal(isDue(init, '2026-10-16'), true); // due(10-16) === today(10-16)
  assert.equal(isDue(init, '2026-10-17'), true); // due(10-16) < today(10-17)

  // 상자 1 -> 2 (know: INTERVALS[2] = 2일)
  const r1 = applyReview(init, 'know', today, now);
  assert.deepEqual(r1, {
    box: 2,
    due: '2026-10-18', // 16 + 2일
    last: now,
    done: false,
    count: 1,
  });

  // 상자 2 -> 3 (know: INTERVALS[3] = 4일)
  const r2 = applyReview(r1, 'know', '2026-10-18', now + 1000);
  assert.deepEqual(r2, {
    box: 3,
    due: '2026-10-22', // 18 + 4일
    last: now + 1000,
    done: false,
    count: 2,
  });

  // 상자 3 -> 4 (know: INTERVALS[4] = 8일, 22 + 8 = 30)
  const r3 = applyReview(r2, 'know', '2026-10-22', now + 2000);
  assert.deepEqual(r3, {
    box: 4,
    due: '2026-10-30',
    last: now + 2000,
    done: false,
    count: 3,
  });

  // 상자 4 -> 5 (know: INTERVALS[5] = 16일, 30 + 16 = 11월 15일, 월말 넘김)
  const r4 = applyReview(r3, 'know', '2026-10-30', now + 3000);
  assert.deepEqual(r4, {
    box: 5,
    due: '2026-11-15', // 10월은 31일까지 있음 (30 + 16일 = 11월 15일)
    last: now + 3000,
    done: false,
    count: 4,
  });
  assert.equal(isDue(r4, '2026-11-14'), false);
  assert.equal(isDue(r4, '2026-11-15'), true);

  // 상자 5 -> know: done: true, box 5 유지
  const r5 = applyReview(r4, 'know', '2026-11-15', now + 4000);
  assert.deepEqual(r5, {
    box: 5,
    due: '2026-12-01', // 11-15 + 16일 = 12-01 (11월은 30일까지)
    last: now + 4000,
    done: true,
    count: 5,
  });
  // done이면 isDue는 항상 false
  assert.equal(isDue(r5, '2026-12-01'), false);
  assert.equal(isDue(r5, '2026-12-31'), false);

  // again: 어느 상자에서든 box 1, due 내일(today + 1일), done: false
  const rAgain = applyReview(r5, 'again', '2026-12-01', now + 5000);
  assert.deepEqual(rAgain, {
    box: 1,
    due: '2026-12-02',
    last: now + 5000,
    done: false,
    count: 6,
  });
  assert.equal(isDue(rAgain, '2026-12-02'), true);

  // 연말 넘김 확인: 2026-12-31 + 1일 = 2027-01-01
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  // 2월 말 넘김 확인: 2026-02-28 + 1일 = 2026-03-01
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');

  // isValidReview 유효성 검사 헬퍼
  assert.ok(isValidReview(init));
  assert.ok(isValidReview(r5));
  assert.equal(isValidReview(null), null);
  assert.equal(isValidReview({ box: 0 }), null);
  assert.equal(isValidReview({ box: 6 }), null);
  assert.equal(isValidReview({ box: 1, due: 'invalid-date', done: false, count: 0, last: 0 }), null);
  assert.equal(isValidReview({ box: 1, due: '2026-10-16', done: 'not-bool', count: 0, last: 0 }), null);
  assert.equal(isValidReview({ box: 1, due: '2026-10-16', done: false, count: -1, last: 0 }), null);
});

// 서버 기동 헬퍼
async function startServer({ now = Date.now, useDb = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-review-'));
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

// 2. 다시 저장해도 유지 & 첫 저장 시 initialReview 생성
test('words: 첫 저장 시 initialReview 자동 생성, 다시 저장해도 review 유지 (단어 및 구)', () => {
  const clock = createClock('2026-10-16T12:00:00');
  const db = openDb(':memory:');
  const words = createWords({ db, now: clock.now });

  // 1) 단어 첫 저장
  words.apply({
    op: 'save',
    lemma: 'apple',
    word: 'apple',
    gloss: '사과',
    sentence: 'I eat an apple.',
  });
  const saved1 = words.all().saved.apple;
  assert.ok(saved1.review);
  assert.equal(saved1.review.box, 1);
  assert.equal(saved1.review.due, '2026-10-16');
  assert.equal(saved1.review.done, false);
  assert.equal(saved1.review.count, 0);

  // 단어 복습 1회 적용 -> box 2, count 1
  words.apply({ op: 'review', lemma: 'apple', result: 'know' });
  const reviewed1 = words.all().saved.apple.review;
  assert.equal(reviewed1.box, 2);
  assert.equal(reviewed1.count, 1);
  assert.equal(reviewed1.due, '2026-10-18');

  // 단어 다시 저장 (메모 추가 등) -> review가 초기화되지 않고 box 2, count 1 유지!
  clock.advanceDays(1);
  words.apply({
    op: 'save',
    lemma: 'apple',
    word: 'apple',
    gloss: '사과 (맛있는)',
    sentence: 'I eat an apple every day.',
  });
  const savedAgain = words.all().saved.apple;
  assert.equal(savedAgain.gloss, '사과 (맛있는)');
  assert.equal(savedAgain.review.box, 2);
  assert.equal(savedAgain.review.count, 1);
  assert.equal(savedAgain.review.due, '2026-10-18');

  // 2) 구 첫 저장
  const pid = phraseId('look forward to');
  words.apply({
    op: 'save-phrase',
    text: 'look forward to',
    translation: '~을 기대하다',
    kind: 'expression',
  });
  const phrase1 = words.all().phrases[pid];
  assert.ok(phrase1.review);
  assert.equal(phrase1.review.box, 1);
  assert.equal(phrase1.review.due, '2026-10-17'); // advanceDays(1) 되었으므로 10-17

  // 구 복습 적용
  words.apply({ op: 'review', id: pid, result: 'know' });
  assert.equal(words.all().phrases[pid].review.box, 2);

  // 구 다시 저장 -> review 유지
  words.apply({
    op: 'save-phrase',
    text: 'look forward to',
    translation: '고대하다',
    kind: 'expression',
  });
  assert.equal(words.all().phrases[pid].translation, '고대하다');
  assert.equal(words.all().phrases[pid].review.box, 2);

  db.close();
});

// 3. 불러오기 보존 (DB와 JSON 둘 다 — 다리를 새로 만들어 다시 읽어도 review가 남음)
test('불러오기 보존: 다리를 새로 만들어 다시 읽어도 review가 보존됨 (DB 및 JSON)', async () => {
  const clock = createClock('2026-10-16T12:00:00');

  // 1) DB 모드 테스트
  {
    const s1 = await startServer({ now: clock.now, useDb: true });
    const pid = phraseId('take care');
    try {
      // 단어 및 구 저장
      await s1.req('POST', '/words', {
        headers: s1.auth,
        body: { op: 'save', lemma: 'delve', word: 'delve', gloss: '탐구하다' },
      });
      await s1.req('POST', '/words', {
        headers: s1.auth,
        body: { op: 'save-phrase', text: 'take care', translation: '잘 지내' },
      });

      // 복습 적용
      await s1.req('POST', '/words', {
        headers: s1.auth,
        body: { op: 'review', lemma: 'delve', result: 'know' },
      });
      await s1.req('POST', '/words', {
        headers: s1.auth,
        body: { op: 'review', id: pid, result: 'again' },
      });
    } finally {
      await s1.bridge.close();
    }

    // 새 다리 인스턴스를 같은 디렉토리(DB)로 띄움
    const bridge2 = createBridge({
      cacheFile: join(s1.dir, 'cache.json'),
      tokenFile: join(s1.dir, 'token'),
      wordsFile: join(s1.dir, 'words.json'),
      dbFile: join(s1.dir, 'readgloss.db'),
      extensionId: EXT,
      now: clock.now,
    });
    try {
      const allWords = bridge2.words.all();
      assert.ok(allWords.saved.delve);
      assert.equal(allWords.saved.delve.review.box, 2);
      assert.equal(allWords.saved.delve.review.count, 1);

      assert.ok(allWords.phrases[pid]);
      assert.equal(allWords.phrases[pid].review.box, 1);
      assert.equal(allWords.phrases[pid].review.count, 1);
    } finally {
      await bridge2.close();
    }
  }

  // 2) JSON 모드 테스트 (dbFile 없음)
  {
    const dir = mkdtempSync(join(tmpdir(), 'rg-words-json-'));
    const wordsFile = join(dir, 'words.json');
    const w1 = createWords({ file: wordsFile, now: clock.now });

    w1.apply({ op: 'save', lemma: 'banana', word: 'banana', gloss: '바나나' });
    w1.apply({ op: 'review', lemma: 'banana', result: 'know' });

    const pid = phraseId('in other words');
    w1.apply({ op: 'save-phrase', text: 'in other words', translation: '다시 말해서' });
    w1.apply({ op: 'review', id: pid, result: 'know' });

    // 새 createWords 인스턴스로 같은 JSON 파일 다시 읽기
    const w2 = createWords({ file: wordsFile, now: clock.now });
    const all = w2.all();
    assert.ok(all.saved.banana);
    assert.equal(all.saved.banana.review.box, 2);
    assert.equal(all.saved.banana.review.count, 1);

    assert.ok(all.phrases[pid]);
    assert.equal(all.phrases[pid].review.box, 2);
    assert.equal(all.phrases[pid].review.count, 1);
  }
});

// 4. op review 400 · 404 · 200
test('서버 POST /words {op: "review"}: 400 형식 오류, 404 대상 없음, 200 성공', async () => {
  const clock = createClock('2026-10-16T12:00:00');
  const s = await startServer({ now: clock.now });
  try {
    // 1) 400 오류들
    // lemma와 id 둘 다 없음
    const rNoTarget = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', result: 'know' },
    });
    assert.equal(rNoTarget.status, 400);

    // lemma와 id 둘 다 있음
    const rBoth = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', lemma: 'apple', id: '1234567890ab', result: 'know' },
    });
    assert.equal(rBoth.status, 400);

    // result가 유효하지 않음
    const rInvalidRes = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', lemma: 'apple', result: 'skip' },
    });
    assert.equal(rInvalidRes.status, 400);

    // lemma 형식 틀림
    const rBadLemma = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', lemma: '123_invalid', result: 'know' },
    });
    assert.equal(rBadLemma.status, 400);

    // id 형식 틀림
    const rBadId = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', id: 'not-hex-12', result: 'know' },
    });
    assert.equal(rBadId.status, 400);

    // 2) 404 대상 없음
    const r404Lemma = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', lemma: 'nonexistent', result: 'know' },
    });
    assert.equal(r404Lemma.status, 404);

    const r404Id = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', id: '000000000000', result: 'know' },
    });
    assert.equal(r404Id.status, 404);

    // 3) 200 정상 적용
    // 단어 저장 후 review know
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'cherry', word: 'cherry', gloss: '체리' },
    });
    const r200Lemma = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', lemma: 'cherry', result: 'know' },
    });
    assert.equal(r200Lemma.status, 200);
    const dataWord = r200Lemma.json();
    assert.equal(dataWord.saved.cherry.review.box, 2);

    // 구 저장 후 review again
    const pid = phraseId('as a result');
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save-phrase', text: 'as a result', translation: '결과적으로' },
    });
    const r200Phrase = await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'review', id: pid, result: 'again' },
    });
    assert.equal(r200Phrase.status, 200);
    const dataPhrase = r200Phrase.json();
    assert.equal(dataPhrase.phrases[pid].review.box, 1);
  } finally {
    await s.bridge.close();
  }
});

// 5. GET /words/review (정렬, 50개 제한, counts)
test('서버 GET /words/review: due 오래된 것 먼저 정렬, 50개 제한, counts({due, done, total})', async () => {
  const clock = createClock('2026-10-16T12:00:00');
  const s = await startServer({ now: clock.now });
  try {
    // 1) 인증 및 메소드 검사
    assert.equal((await s.req('GET', '/words/review')).status, 401);
    assert.equal((await s.req('POST', '/words/review', { headers: s.auth })).status, 405);

    // 빈 상태에서 호출
    const empty = (await s.req('GET', '/words/review', { headers: s.auth })).json();
    assert.deepEqual(empty, {
      due: [],
      counts: { due: 0, done: 0, total: 0 },
    });

    // 2) 단어 및 구 준비:
    // item A: 10월 14일 due (밀림 2일)
    // item B: 10월 15일 due, ts: 1000
    // item C: 10월 15일 due, ts: 2000 (B와 due 같지만 ts 나중)
    // item D: 10월 16일 due (오늘)
    // item E: 10월 17일 due (내일, due 아님)
    // item F: done: true (복습 끝, due 아님)

    // A: 단어
    clock.set(1000);
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'alpha', word: 'alpha', gloss: '알파' }, // 메모는 save 가 아니라 op memo 로 넣는다
    });
    // 수동으로 review의 due를 과거로 설정하기 위해 다리 db에 직접 넣거나 mock
    s.bridge.words.apply({ op: 'review', lemma: 'alpha', result: 'know' });
    // alpha의 review를 2026-10-14로 조정
    const wAlpha = s.bridge.words.all().saved.alpha;
    wAlpha.review.due = '2026-10-14';
    wAlpha.ts = 500;

    // B: 구
    clock.set(1000);
    const pidB = phraseId('phrase beta');
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save-phrase', text: 'phrase beta', translation: '베타', kind: 'expression' },
    });
    const pB = s.bridge.words.all().phrases[pidB];
    pB.review.due = '2026-10-15';
    pB.ts = 1000;

    // C: 단어
    clock.set(2000);
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'gamma', word: 'gamma', gloss: '감마' },
    });
    const wGamma = s.bridge.words.all().saved.gamma;
    wGamma.review.due = '2026-10-15';
    wGamma.ts = 2000;

    // D: 단어 (오늘 10-16)
    clock.set(3000);
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'delta', word: 'delta', gloss: '델타' },
    });
    const wDelta = s.bridge.words.all().saved.delta;
    wDelta.review.due = '2026-10-16';
    wDelta.ts = 3000;

    // E: 단어 (내일 10-17)
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'epsilon', word: 'epsilon', gloss: '입실론' },
    });
    const wEpsilon = s.bridge.words.all().saved.epsilon;
    wEpsilon.review.due = '2026-10-17';

    // F: 단어 (done: true)
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'zeta', word: 'zeta', gloss: '제타' },
    });
    const wZeta = s.bridge.words.all().saved.zeta;
    wZeta.review.done = true;

    // 오늘 날짜 2026-10-16 기준 복습 큐 요청
    clock.set(new Date('2026-10-16T12:00:00').getTime());
    const resQ = await s.req('GET', '/words/review', { headers: s.auth });
    assert.equal(resQ.status, 200);
    const data = resQ.json();

    // counts 검증:
    // total: 6개 (alpha, beta, gamma, delta, epsilon, zeta)
    // done: 1개 (zeta)
    // due: 4개 (alpha 10-14, beta 10-15, gamma 10-15, delta 10-16)
    assert.deepEqual(data.counts, {
      due: 4,
      done: 1,
      total: 6,
    });

    // 정렬 순서 검증:
    // 1등: alpha (due: 10-14)
    // 2등: phrase beta (due: 10-15, ts: 1000)
    // 3등: gamma (due: 10-15, ts: 2000)
    // 4등: delta (due: 10-16, ts: 3000)
    assert.equal(data.due.length, 4);
    assert.deepEqual(data.due[0], {
      type: 'word',
      key: 'alpha',
      word: 'alpha',
      gloss: '알파',
      sentence: '',
    });
    assert.deepEqual(data.due[1], {
      type: 'phrase',
      key: pidB,
      text: 'phrase beta',
      translation: '베타',
      kind: 'expression',
    });
    assert.equal(data.due[2].key, 'gamma');
    assert.equal(data.due[3].key, 'delta');

    // 3) 50개 초과 제한 검증:
    // 60개의 due 단어를 추가로 생성
    for (let i = 0; i < 60; i++) {
      const lemma = `w${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
      s.bridge.words.apply({
        op: 'save',
        lemma,
        word: lemma,
        gloss: 'test',
      });
      // 저장된 단어의 review.due는 기본 10-16 (오늘)
    }

    const res50 = await s.req('GET', '/words/review', { headers: s.auth });
    const data50 = res50.json();
    assert.equal(data50.due.length, 50); // 최대 50개로 제한
    assert.equal(data50.counts.due, 64); // 4 + 60 = 64개 due
    assert.equal(data50.counts.total, 66); // 6 + 60 = 66개 total
  } finally {
    await s.bridge.close();
  }
});

// 6. done 단어 주석 확률 .20 (찾아봄 있으면 그대로)
test('done 단어 주석 확률: done 단어는 min(p, .20), 찾아봄(looked) 있으면 그대로 유지', async () => {
  // 1) probability 단위 시험
  // B2 기본 0.35, saved면 0.95이지만, done=true이고 lookups=0이면 0.20
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookups: 0 }), 0.20);
  // 원래 더 낮은 A1(0.02)은 min(0.02, 0.20)이므로 0.02
  assert.equal(probability({ level: 'A1', saved: false, done: true, lookups: 0 }), 0.02);
  // 찾아봄(lookups 1회)이 있으면 찾아봄 규칙(0.90)이 이김! (done 단어는 lookedAfterDone: true일 때 평소 값)
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: true, lookups: 1 }), 0.95); // 찾아봄이 있으면 done 규칙을 안 써서 평소 값(저장 .95)
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: true, lookups: 3 }), 0.95);
  assert.equal(probability({ level: 'B2', saved: true, done: true, lookedAfterDone: false, lookups: 1 }), 0.20); // lookedAfterDone이 false면 .20

  // 2) 서버 통합 시험 (buildSignals -> scoreOf)
  const clock = createClock('2026-10-16T12:00:00');
  const s = await startServer({ now: clock.now });
  try {
    // 단어 저장
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'save', lemma: 'mitigate', word: 'mitigate', gloss: '완화하다' },
    });

    // 아직 done이 아닐 때: saved 단어이므로 scoreOf는 0.95
    assert.equal(s.bridge.scoreOf('mitigate', 'B2'), 0.95);

    // 복습으로 상자 5까지 know 반복 -> done: true
    for (let i = 0; i < 5; i++) {
      await s.req('POST', '/words', {
        headers: s.auth,
        body: { op: 'review', lemma: 'mitigate', result: 'know' },
      });
    }
    const wordData = s.bridge.words.all().saved.mitigate;
    assert.equal(wordData.review.done, true);

    // signalsCache가 비워지고 다시 생성되어 signals.done에 mitigate 및 그 활용형(mitigated 등)이 들어감
    const signals = s.bridge.buildSignals();
    assert.ok(signals.done.has('mitigate'));
    assert.ok(signals.done.has('mitigated'));

    // done 단어이므로 찾아봄이 없으면 scoreOf는 0.20
    assert.equal(s.bridge.scoreOf('mitigate', 'B2'), 0.20);
    // 활용형 mitigated도 0.20
    assert.equal(s.bridge.scoreOf('mitigate', 'B2', 'mitigated'), 0.20);

    // 이제 찾아봄 발생(복습 끝난 뒤 시각 진행). 실제 맥 사전에 기대지 않도록 /words history 로 남긴다(buildSignals 의 looked 로 들어간다).
    clock.set(clock.now() + 1000);
    await s.req('POST', '/words', {
      headers: s.auth,
      body: { op: 'history', lemma: 'mitigate' },
    });

    // 찾아봄이 있으면 done 규칙을 안 써서 평소 값(저장 .95)으로 돌아온다
    assert.equal(s.bridge.scoreOf('mitigate', 'B2'), 0.95);
  } finally {
    await s.bridge.close();
  }
});
