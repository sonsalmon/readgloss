// 과제 T53m(변경 기록 28-19): 여러 유형 모두 맞혀야 복습 완료 + 마지막 학습 배지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, applyReview, availableModes, isValidReview, REVIEW_MODE_IDS } from '../bridge/review.mjs';
import { createWords, parseWordsOp } from '../bridge/words.mjs';

await import('../extension/panel-words.js');
const W = globalThis.readglossWords;

const TODAY = '2026-10-16';
const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();

// 시험마다 새 단어장(JSON 파일)을 만든다. now 는 고정 시계.
function makeWords() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t53m-'));
  const file = join(dir, 'words.json');
  const words = createWords({ file, now: () => NOW });
  return { words, file };
}

test('availableModes: 뒤집기·듣기는 늘, 고르기는 확장이 보낸 modes, 빈칸은 문장/base 가 있을 때', () => {
  assert.deepEqual(REVIEW_MODE_IDS, ['flip', 'choice', 'listen', 'type']);
  assert.deepEqual(availableModes(null), ['flip', 'listen']);
  assert.deepEqual(availableModes({ type: 'word' }), ['flip', 'listen']);
  assert.deepEqual(availableModes({ type: 'word', sentence: 'I eat an apple.' }), ['flip', 'listen', 'type']);
  assert.deepEqual(availableModes({ type: 'word', sentence: 'I eat an apple.', modes: ['flip', 'choice'] }), ['flip', 'choice', 'listen', 'type']);
  assert.deepEqual(availableModes({ type: 'phrase', base: 'eat A alive' }), ['flip', 'listen', 'type']);
  assert.deepEqual(availableModes({ type: 'phrase', text: 'eat it alive' }), ['flip', 'listen'], 'base 가 없으면 빈칸 없음');
  assert.deepEqual(availableModes({ type: 'word', sentence: '   ' }), ['flip', 'listen'], '빈 문장은 빈칸 없음');
});

test('applyReview: passed 누적, 상자 5 에서 유형이 남으면 done 아님·다음 날', () => {
  const modes = ['flip', 'listen', 'type'];
  let rev = { box: 5, due: TODAY, last: 1, done: false, count: 4, passed: ['flip'] };

  const first = applyReview(rev, 'know', TODAY, NOW, { mode: 'listen', modes });
  assert.equal(first.box, 5);
  assert.equal(first.done, false, 'type 이 남았다');
  assert.equal(first.due, addDays(TODAY, 1), '남은 유형은 다음 날');
  assert.deepEqual(first.passed, ['flip', 'listen']);
  assert.equal(first.count, 5);
  assert.equal(first.last, NOW);

  const second = applyReview(first, 'know', addDays(TODAY, 1), NOW + 1000, { mode: 'type', modes });
  assert.equal(second.box, 5);
  assert.equal(second.done, true, '모든 유형을 맞혔다');
  assert.equal(second.due, addDays(addDays(TODAY, 1), 16));
  assert.deepEqual(second.passed, ['flip', 'listen', 'type']);
});

test('applyReview: 4번째 인자 객체 모양도 받는다(28-19 서명)', () => {
  const rev = { box: 5, due: TODAY, last: 1, done: false, count: 4, passed: ['flip'] };
  const got = applyReview(rev, 'know', TODAY, { mode: 'listen', modes: ['flip', 'listen'] });
  assert.equal(got.done, true);
  assert.deepEqual(got.passed, ['flip', 'listen']);
});

test('applyReview: mode 가 없으면 옛 동작 그대로(상자 5 know = done, passed 없음)', () => {
  const rev = { box: 5, due: TODAY, last: 1, done: false, count: 4 };
  const got = applyReview(rev, 'know', TODAY, NOW);
  assert.deepEqual(got, {
    box: 5,
    due: addDays(TODAY, 16),
    last: NOW,
    done: true,
    count: 5,
  });
  assert.equal('passed' in got, false);
});

test('applyReview: hold 는 상자·날짜·기록 그대로', () => {
  const rev = { box: 3, due: '2026-10-20', last: 123, done: false, count: 2, passed: ['flip'] };
  const got = applyReview(rev, 'hold', TODAY, NOW, { mode: 'listen', modes: ['flip', 'listen'] });
  assert.deepEqual(got, rev);
  assert.notEqual(got, rev, '복사본을 돌려준다');
});

test('applyReview: again 은 상자 1·내일로 되돌리고 passed 도 비운다', () => {
  const rev = { box: 5, due: TODAY, last: 1, done: false, count: 4, passed: ['flip', 'listen'] };
  const got = applyReview(rev, 'again', TODAY, NOW, { mode: 'flip', modes: ['flip', 'listen'] });
  assert.equal(got.box, 1);
  assert.equal(got.done, false);
  assert.equal(got.due, addDays(TODAY, 1));
  assert.deepEqual(got.passed, []);
});

test('parseWordsOp: review 에 mode·modes·hold 를 더하고 틀린 값은 거절', () => {
  assert.deepEqual(parseWordsOp({ op: 'review', lemma: 'apple', result: 'hold', mode: 'type', modes: ['flip', 'type', 'type'] }), {
    op: 'review',
    lemma: 'apple',
    result: 'hold',
    mode: 'type',
    modes: ['flip', 'type'],
  });
  assert.deepEqual(parseWordsOp({ op: 'review', id: '0123456789ab', result: 'know' }), { op: 'review', id: '0123456789ab', result: 'know' });
  assert.equal(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode: 'quiz' }), null);
  assert.equal(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', modes: 'flip' }), null);
  assert.equal(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', modes: ['flip', 'quiz'] }), null);
  assert.equal(parseWordsOp({ op: 'review', lemma: 'apple', result: 'skip' }), null);
});

test('다리 단어장: passed 가 저장·다시 읽기에 남고, 남은 유형이면 상자 5 에 머문다', () => {
  const { words, file } = makeWords();
  const modes = ['flip', 'listen'];

  words.apply(parseWordsOp({ op: 'save', lemma: 'apple', word: 'apple', gloss: '사과', sentence: 'I eat an apple.' }));
  for (let i = 0; i < 4; i++) {
    words.apply(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode: 'flip', modes }));
  }
  let rev = words.all().saved.apple.review;
  assert.equal(rev.box, 5);
  assert.equal(rev.done, false, '아직 상자 5 에서 복습 중');
  assert.deepEqual(rev.passed, ['flip']);

  // 5번째 know 는 아직 listen 이 남아 done 이 아니다.
  words.apply(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode: 'flip', modes }));
  rev = words.all().saved.apple.review;
  assert.equal(rev.box, 5);
  assert.equal(rev.done, false);
  assert.equal(rev.due, addDays(TODAY, 1));
  assert.deepEqual(rev.passed, ['flip']);

  // 파일에서 다시 읽어도 passed 가 살아 있다.
  const reloaded = createWords({ file, now: () => NOW });
  assert.deepEqual(reloaded.all().saved.apple.review.passed, ['flip']);

  reloaded.apply(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode: 'listen', modes }));
  rev = reloaded.all().saved.apple.review;
  assert.equal(rev.done, true, '모든 유형을 맞히면 끝');
  assert.equal(rev.due, addDays(TODAY, 16));
  assert.deepEqual(rev.passed, ['flip', 'listen']);
});

test('다리 단어장: hold 는 저장 뒤에도 상태 그대로, mode 없는 옛 호출은 바로 done', () => {
  const { words } = makeWords();
  words.apply(parseWordsOp({ op: 'save', lemma: 'cherry', word: 'cherry', gloss: '체리' }));
  words.apply(parseWordsOp({ op: 'review', lemma: 'cherry', result: 'know' }));
  const before = words.all().saved.cherry.review;
  words.apply(parseWordsOp({ op: 'review', lemma: 'cherry', result: 'hold', mode: 'flip', modes: ['flip', 'listen'] }));
  assert.deepEqual(words.all().saved.cherry.review, before);

  words.apply(parseWordsOp({ op: 'save', lemma: 'banana', word: 'banana', gloss: '바나나' }));
  for (let i = 0; i < 5; i++) words.apply(parseWordsOp({ op: 'review', lemma: 'banana', result: 'know' }));
  const old = words.all().saved.banana.review;
  assert.equal(old.done, true);
  assert.equal('passed' in old, false);
});

test('isValidReview: passed 를 보존하고, 모르는 유형이 들면 거절', () => {
  const ok = isValidReview({ box: 5, due: TODAY, done: false, count: 4, last: 1, passed: ['flip', 'listen'] });
  assert.deepEqual(ok.passed, ['flip', 'listen']);
  assert.equal(isValidReview({ box: 5, due: TODAY, done: false, count: 4, last: 1, passed: ['quiz'] }), null);
  assert.equal(isValidReview({ box: 5, due: TODAY, done: false, count: 4, last: 1, passed: 'flip' }), null);
});

test('마지막 학습 배지: 오늘·N일 전·기록 없음', () => {
  const today = new Date(2026, 9, 31, 23, 0, 0).getTime();
  assert.equal(W.reviewAgeLabel(new Date(2026, 9, 31, 1, 0, 0).getTime(), today), '오늘');
  assert.equal(W.reviewAgeLabel(new Date(2026, 9, 29, 12, 0, 0).getTime(), today), '2일 전 학습');
  assert.equal(W.reviewAgeLabel(0, today), '');
  assert.equal(W.reviewAgeLabel(undefined, today), '');
});

test('cardMode: 상자 5 에서 고른 유형을 이미 맞혔으면 남은 첫 유형', () => {
  const modes = ['flip', 'choice', 'listen'];
  assert.equal(W.cardMode({ chosen: 'flip', modes, passed: ['flip'], box: 5 }), 'choice');
  assert.equal(W.cardMode({ chosen: 'choice', modes, passed: ['flip', 'choice'], box: 5 }), 'listen');
  assert.equal(W.cardMode({ chosen: 'flip', modes, passed: [], box: 5 }), 'flip', '아직 안 맞힌 유형이면 고른 그대로');
});

test('cardMode: 남은 유형이 없으면 고른 유형, 상자 4 이하는 고른 유형', () => {
  const modes = ['flip', 'choice', 'listen'];
  assert.equal(W.cardMode({ chosen: 'listen', modes, passed: ['flip', 'choice', 'listen'], box: 5 }), 'listen');
  assert.equal(W.cardMode({ chosen: 'flip', modes, passed: ['flip'], box: 4 }), 'flip');
});

test('cardMode: 고른 유형이 이 카드에 없으면 뒤집기(상자 5 는 남은 첫 유형)', () => {
  assert.equal(W.cardMode({ chosen: 'choice', modes: ['flip', 'listen'], passed: [], box: 3 }), 'flip');
  assert.equal(W.cardMode({ chosen: 'choice', modes: ['flip', 'listen'], passed: ['flip'], box: 5 }), 'listen');
  assert.equal(W.cardMode({ chosen: 'choice', modes: ['flip', 'listen'], passed: [], box: 5 }), 'flip');
  assert.equal(W.cardMode({ chosen: 'choice', modes: ['flip', 'listen'], passed: ['flip', 'listen'], box: 5 }), 'flip');
});

test('남은 유형 이름은 한국어', () => {
  assert.deepEqual(W.remainingModes(['flip', 'choice', 'listen'], ['flip']).map((m) => W.MODE_TITLES[m]), ['고르기', '듣기']);
});

test('복습 큐 카드에 box 와 passed 가 실린다(옛 필드는 그대로)', () => {
  const { words } = makeWords();
  words.apply(parseWordsOp({ op: 'save', lemma: 'apple', word: 'apple', gloss: '사과', sentence: 'I eat an apple.' }));
  let card = words.reviewQueue(addDays(TODAY, 1)).due[0];
  assert.equal(card.box, undefined, '낮은 상자는 옛 모양 그대로');
  assert.equal(card.passed, undefined);
  assert.equal(card.gloss, '사과');
  const modes = ['flip', 'listen'];
  for (let i = 0; i < 5; i++) words.apply(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode: 'flip', modes }));
  card = words.reviewQueue(addDays(TODAY, 1)).due[0];
  assert.equal(card.box, 5);
  assert.deepEqual(card.passed, ['flip']);
});

test('재현 흐름: 상자 5 카드를 유형별로 know 하면 모든 유형을 덮은 뒤 done', () => {
  const { words } = makeWords();
  words.apply(parseWordsOp({ op: 'save', lemma: 'apple', word: 'apple', gloss: '사과' }));
  const modes = ['flip', 'listen'];
  for (let i = 0; i < 4; i++) words.apply(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode: 'flip', modes }));
  // 사용자가 늘 '뒤집기'를 골라 둔 화면: 큐 카드의 box·passed 로 보여 줄 방식을 정해 그대로 보낸다.
  let guard = 0;
  let rev = words.all().saved.apple.review;
  while (!rev.done && guard++ < 6) {
    const card = words.reviewQueue('2099-01-01').due[0];
    const mode = W.cardMode({ chosen: 'flip', modes, passed: card.passed, box: card.box });
    words.apply(parseWordsOp({ op: 'review', lemma: 'apple', result: 'know', mode, modes }));
    rev = words.all().saved.apple.review;
  }
  assert.equal(rev.done, true);
  assert.deepEqual([...rev.passed].sort(), ['flip', 'listen']);
  assert.ok(guard <= 3, `유형 수만큼만 돈다: ${guard}`);
});

test('panel-words 소스: 고르기 퀴즈는 진짜 고르기이거나, 고르기를 이 카드에서 못 낼 때만 만든다(상자 5 남은 뒤집기는 뒤집기 화면)', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');
  assert.ok(/choiceFellBack = mode === 'choice' && shown === 'flip' && !reviewModesFor\(card\)\.includes\('choice'\)/.test(code));
  assert.ok(code.includes("if (shown === 'choice' || choiceFellBack)"));
  assert.ok(!code.includes("(mode === 'choice' && shown === 'flip')"), '옛 넓은 조건이 남으면 안 된다');
});

test('panel-words 소스: 단어장이 오기 전에는 복습 결과를 저장하지 않는다(상자 5 고르기 빠짐 방지)', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');
  const at = code.indexOf('async function sendResult(');
  assert.ok(at > 0);
  const head = code.slice(at, at + 500);
  assert.ok(/if \(!state\) \{[\s\S]*?loadWords\(\);\s*return false;/.test(head), 'state 가 없으면 단어장을 부르고 false');
  assert.ok(head.indexOf('if (!state)') < head.indexOf('busy = true'), 'busy 를 켜기 전에 막는다');
});

test('video-subs 소스: 세로 막대는 넘치면 얇은 스크롤 막대를 보인다', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.ok(code.includes('scrollbar-width: thin'));
  assert.ok(!code.includes('.bar::-webkit-scrollbar { display: none; }'));
});
