// 과제 T53u(변경 기록 28-16): 영상 학습 모드 4종 — 조립 칩 섞기·채점·설정 기본값·화면 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const subs = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');

const WORDS = ['the', 'quick', 'brown', 'fox'];

test('shuffleTiles: 같은 seed 는 언제나 같은 순서', () => {
  assert.deepEqual(V.shuffleTiles(WORDS, 'line-7'), V.shuffleTiles(WORDS, 'line-7'));
  assert.deepEqual(V.shuffleTiles(WORDS, 'line-7'), V.shuffleTiles([...WORDS], 'line-7'), '입력 배열이 달라도 seed 가 같으면 같다');
  assert.deepEqual(V.shuffleTiles(WORDS, 7), V.shuffleTiles(WORDS, 7));
  assert.notDeepEqual(V.shuffleTiles(WORDS, 'line-7'), V.shuffleTiles(WORDS, 'line-8'), 'seed 가 다르면 다른 순서');
});

test('shuffleTiles: 같은 줄은 원래 순서와 다르게 섞고, 항목은 하나도 잃지 않는다', () => {
  for (const seed of ['a', 'b', 'c', 'd', 1, 2, 3, 4, 99]) {
    const out = V.shuffleTiles(WORDS, seed);
    assert.equal(out.length, WORDS.length, `seed ${seed}: 개수`);
    assert.deepEqual([...out].sort(), [...WORDS].sort(), `seed ${seed}: 항목 보존`);
    assert.notDeepEqual(out, WORDS, `seed ${seed}: 원래 순서와 다름`);
    assert.notEqual(out, WORDS, '원래 배열을 고치지 않고 새 배열을 돌려준다');
  }
});

test('shuffleTiles: 한 낱말 줄·빈 줄은 그대로', () => {
  assert.deepEqual(V.shuffleTiles(['hello'], 'x'), ['hello']);
  assert.deepEqual(V.shuffleTiles([], 'x'), []);
  assert.deepEqual(V.shuffleTiles(null, 'x'), []);
  assert.deepEqual(V.shuffleTiles(undefined), []);
  assert.deepEqual(V.shuffleTiles('hello', 'x'), [], '배열이 아니면 빈 배열');
});

test('shuffleTiles: tokenize 조각(낱말·사이 글자)도 같은 항목으로 섞는다', () => {
  const tokens = V.tokenize('The quick brown fox');
  const out = V.shuffleTiles(tokens, 'line-1');
  assert.equal(out.length, tokens.length);
  assert.deepEqual(new Set(out), new Set(tokens), '같은 객체를 그대로 담는다');
});

test('tileCheck: 차례·항목이 모두 같아야 true', () => {
  assert.equal(V.tileCheck([1, 2, 3], [1, 2, 3]), true);
  assert.equal(V.tileCheck([], []), true, '빈 줄끼리');
  assert.equal(V.tileCheck([1, 3, 2], [1, 2, 3]), false, '차례가 다르면 틀림');
  assert.equal(V.tileCheck([1, 2], [1, 2, 3]), false, '덜 놓았으면 틀림');
  assert.equal(V.tileCheck([1, 2, 3], [1, 2]), false, '더 놓았으면 틀림');
  assert.equal(V.tileCheck([1, 2, 3], [1, 2, 4]), false, '값이 다르면 틀림');
  assert.equal(V.tileCheck(null, [1]), false);
  assert.equal(V.tileCheck([1], null), false);
  assert.equal(V.tileCheck(['a', 'b'], ['a', 'b']), true, '글자 항목도 비교한다');
});

test('설정: video.mode 기본 watch, 네 값만 받고 모르는 값은 watch', () => {
  assert.equal(S.DEFAULTS.video.mode, 'watch');
  assert.equal(S.normalize({}).video.mode, 'watch');
  assert.equal(S.normalize({ video: {} }).video.mode, 'watch');
  const f = (video) => S.normalize({ video }).video;
  for (const mode of ['watch', 'understand', 'listen', 'build']) assert.equal(f({ mode }).mode, mode, mode);
  assert.equal(f({ mode: 'nope' }).mode, 'watch');
  assert.equal(f({ mode: true }).mode, 'watch');
  assert.equal(f({ mode: 3 }).mode, 'watch');
});

test('설정 병합: 모드를 바꿔도 다른 video 값이 남는다', () => {
  const base = S.normalize({ video: { pauseEach: true, slowRate: 0.8 } });
  const listen = S.merge(base, { video: { mode: 'listen' } });
  assert.equal(listen.video.mode, 'listen');
  assert.equal(listen.video.pauseEach, true);
  assert.equal(listen.video.slowRate, 0.8);
  assert.equal(S.merge(listen, { video: { mode: 'watch' } }).video.mode, 'watch');
});

test('막대: [모드] 단추가 늘 막대 맨 위에 있고 이름표는 네 모드로 바뀐다', () => {
  assert.match(subs, /mode: \{ text: '모드', name: '학습 모드', key: '' \}/);
  assert.match(subs, /stackLabels\(btns\.mode, \{ watch: '보기', understand: '이해', listen: '듣기', build: '조립' \}\)/);
  assert.match(subs, /if \(ui\.btns\.mode\) ui\.bar\.prepend\(ui\.btns\.mode\);/);
  assert.match(subs, /if \(act === 'mode'\) return cycleMode\(\);/);
  assert.match(subs, /showLabel\(ui\.modeBtn, v\.mode/);
});

test('듣기: 줄마다 멈춤을 자동으로 켜고 문장 반복과 배타, 모드를 떠나면 원래 값', () => {
  assert.match(subs, /const MODE_AUTO_PAUSE = \(m\) => m === 'listen' \|\| m === 'build';/);
  assert.match(subs, /S\.modePause = \{ pauseEach: vs\(\)\.pauseEach, repeatLine: vs\(\)\.repeatLine \};/);
  assert.match(subs, /patch\.pauseEach = true;/);
  assert.match(subs, /patch\.repeatLine = false;/);
  assert.match(subs, /patch\.pauseEach = snap \? snap\.pauseEach : vs\(\)\.pauseEach;/);
  assert.match(subs, /patch\.repeatLine = snap \? snap\.repeatLine : vs\(\)\.repeatLine;/);
  assert.match(subs, /자막 보기/);
});

test('이해: 한국어 줄 자리의 보기 단추를 누르면 그 줄만 보인다', () => {
  assert.match(subs, /v\.mode === 'understand' && lay\.showKo && S\.koPeek !== i/);
  assert.match(subs, /button\('한국어 줄 보기'/);
  assert.match(subs, /S\.koPeek = i;/);
});

test('조립: 섞은 칩·차례 채점·흔들림·다음 줄·다시 듣기·느리게·키보드 단추', () => {
  assert.match(subs, /V\.shuffleTiles\(answer, `\$\{S\.mainKey\}\|\$\{S\.cur\}\|\$\{cue\.text\}`\)/);
  assert.match(subs, /V\.tileCheck\(nextKeys, b\.keys\.slice\(0, nextKeys\.length\)\)/);
  assert.match(subs, /V\.tileCheck\(b\.placed\.map\(keyOf\), b\.keys\)/);
  assert.match(subs, /keys: answer\.map\(\(k\) => tokens\[k\]\?\.lower \?\? ''\)/, '같은 낱말이 두 번 나와도 글자로 견준다');
  assert.match(subs, /b\.wrongK = k;/);
  assert.match(subs, /classList\.add\('shake'\)/);
  assert.match(subs, /button\('↺ 다시 듣기'/);
  assert.match(subs, /button\('느리게'/);
  assert.match(subs, /run\('repeat'\)/);
  assert.match(subs, /run\('slow'\)/);
  assert.match(subs, /button\('다음 줄'/);
  assert.match(subs, /const tile = button\(word, `\$\{word\} — 들은 순서대로 누르기`/, '칩은 진짜 단추라 Tab·Enter 로 고른다');
  assert.match(subs, /if \(show && mode === 'build' && paused\) ensureBuild\(\);/);
});
