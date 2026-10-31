// 과제 T53k(변경 기록 28-14): 1분 라운드 순수 함수 rounds 와 화면 연결 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

const cue = (start, end, text = `line ${start}`) => ({ start, end, text });
const count = (start, seconds) => cue(start, start + seconds);

test('rounds: 빈 대본은 빈 목록', () => {
  assert.deepEqual(V.rounds([]), []);
  assert.deepEqual(V.rounds(), []);
  assert.deepEqual(V.rounds(null), []);
});

test('rounds: 기본값 50·60·75 — target 에 가장 가까운 줄 끝, max 를 넘기기 전에 끊기', () => {
  // 20초 줄 넷: 누적 40(모자람) → 60(target 과 같음)에서 끊고, 80은 max 를 넘으므로 쓰지 않는다.
  const twenty = [0, 20, 40, 60].map((s) => count(s, 20));
  assert.deepEqual(V.rounds(twenty), [
    { start: 0, end: 60, from: 0, to: 2 },
    { start: 60, end: 80, from: 3, to: 3 },
  ]);
  assert.equal(V.ROUND_MIN, 50);
  assert.equal(V.ROUND_TARGET, 60);
  assert.equal(V.ROUND_MAX, 75);
  assert.equal(V.MAX_ROUND, 75);
  assert.equal(V.MAX_CLIP, 60, '일반 장면 상한은 60초 그대로');
});

test('rounds: 경계 50·75 — 50은 min 경계로 받고, 75는 max 경계로 받는다', () => {
  // 25초 줄: 50(차이 10)과 75(차이 15) 중 50을 고른다.
  const twentyFive = [0, 25, 50, 75].map((s) => count(s, 25));
  assert.deepEqual(V.rounds(twentyFive), [
    { start: 0, end: 50, from: 0, to: 1 },
    { start: 50, end: 100, from: 2, to: 3 },
  ]);
  // 38+37=75는 max 와 같은 길이라 받는다.
  const seventyFive = [cue(0, 38), cue(38, 75), cue(75, 80)];
  assert.deepEqual(V.rounds(seventyFive), [
    { start: 0, end: 75, from: 0, to: 1 },
    { start: 75, end: 80, from: 2, to: 2 },
  ]);
  // 40+40=80은 max 를 넘으므로 앞 줄 끝(40)에서 끊는다(50보다 짧아도).
  const forty = [0, 40, 80].map((s) => count(s, 40));
  assert.deepEqual(V.rounds(forty), [
    { start: 0, end: 40, from: 0, to: 0 },
    { start: 40, end: 80, from: 1, to: 1 },
    { start: 80, end: 120, from: 2, to: 2 },
  ]);
});

test('rounds: 한 줄이 max 보다 길면 그 줄 하나가 한 라운드(줄을 자르지 않는다)', () => {
  const long = [cue(0, 90), cue(90, 100)];
  assert.deepEqual(V.rounds(long), [
    { start: 0, end: 90, from: 0, to: 0 },
    { start: 90, end: 100, from: 1, to: 1 },
  ]);
});

test('rounds: 어떤 줄도 자르지 않고, 모든 줄을 정확히 한 번씩 덮는다', () => {
  const cues = [7, 11, 17, 23, 29, 37, 43, 51, 59].map((s, i) => cue(s, s + [3, 8, 6, 12, 9, 4, 15, 7, 10][i]));
  const list = V.rounds(cues);
  assert.ok(list.length > 0);
  assert.equal(list[0].from, 0, '첫 라운드는 첫 줄부터');
  assert.equal(list[list.length - 1].to, cues.length - 1, '마지막 라운드는 마지막 줄까지');
  let next = 0;
  for (const r of list) {
    assert.equal(r.from, next, '줄 번호가 빠지거나 겹치지 않는다');
    assert.equal(r.start, cues[r.from].start, '라운드 시작 = 그 줄 시작');
    assert.equal(r.end, cues[r.to].end, '라운드 끝 = 그 줄 끝');
    assert.ok(r.end > r.start);
    assert.ok(r.end - r.start <= V.ROUND_MAX || r.from === r.to, 'max 를 넘는 것은 한 줄짜리뿐');
    next = r.to + 1;
  }
  assert.equal(next, cues.length);
});

test('rounds: 옵션을 바꾸면 그 값으로 나눈다', () => {
  const cues = [0, 10, 20, 30, 40].map((s) => count(s, 10));
  assert.deepEqual(V.rounds(cues, { min: 10, target: 20, max: 25 }), [
    { start: 0, end: 20, from: 0, to: 1 },
    { start: 20, end: 40, from: 2, to: 3 },
    { start: 40, end: 50, from: 4, to: 4 },
  ]);
});

test('연결: 자막 층이 rounds()·playRound(i) 를 내놓고 75초 상한으로 재생한다', () => {
  const subs = read('video-subs.js');
  assert.match(subs, /const roundList = \(\) => V\.rounds\(S\.cues\)/);
  assert.match(subs, /rounds: \(\) => roundList\(\)/);
  assert.match(subs, /playRound: \(i\) => playRound\(i\)/);
  assert.match(subs, /playClip\(r\.start, r\.end, V\.MAX_ROUND\)/, '라운드는 75초 상한');
  assert.match(subs, /라운드 \$\{r\.index \+ 1\} 끝 · 어려운 단어 \$\{roundHardWords\(r\)\.length\}/, '상태 줄 안내');
  assert.match(subs, /다음 라운드 재생/, '[다음] 단추');

  const panel = read('panel-video.js');
  assert.match(panel, /1분 라운드/);
  assert.match(panel, /ui\(\)\?\.rounds\?\.\(\)/);
  assert.match(panel, /ui\(\)\?\.playRound\?\.\(roundShown\)/);
  assert.match(panel, /다음 라운드/);
  assert.match(panel, /라운드 \$\{state\.index \+ 1\} 끝/);
  assert.match(panel, /v-live/, '지금 재생 위치가 든 라운드를 강조');
});
