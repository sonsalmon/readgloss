// 과제 T53i(변경 기록 28-12): [영상] 탭 안 작은 탭 셋 — 대본 거르기·이 영상 표현 고르기·표현이 든 줄 찾기(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/saved-marks-core.js');
await import('../extension/panel-video.js');
const V = globalThis.readglossVideo;
const P = globalThis.readglossVideoPanel;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

const ID = 'dQw4w9WgXcQ';
const OTHER = 'abcDEF12345';
const review = (box, done, count = 2) => ({ box, due: '2026-11-02', done, count, last: 1 });

test('대본 거르기: 학습 표현 포함(주황·초록 낱말·저장 구)과 저장된 줄을 가른다', () => {
  const data = {
    // 패널은 구간 거르기 없이 S.hard 전부를 칠한다(28-12): p 가 쉬움 구간이어도 주황 글자
    hard: new Map([
      ['privilege', { p: 0.8, gloss: '특권' }],
      ['mild', { p: 0.1, gloss: '온화한' }],
      ['legacy', { gloss: '옛 응답' }],
    ]),
    forms: new Map([['studies', 'study'], ['study', 'study'], ['privilege', 'privilege'], ['mild', 'mild']]),
    done: new Set(['study']), // 복습 끝난 낱말 = 초록
    phrases: {
      p1: { text: 'give up', translation: '포기하다', kind: 'expression' },
      s1: { text: 'They give up.', translation: '그들은 포기한다.', kind: 'sentence' },
    },
    version: '1|1',
  };
  assert.deepEqual(P.panelLineFlags({ text: 'This line is plain.' }, data), { learning: false, saved: false });
  assert.deepEqual(P.panelLineFlags({ text: 'Their privilege is real.' }, data), { learning: true, saved: false }, '어려운 낱말');
  assert.deepEqual(P.panelLineFlags({ text: 'She studies daily.' }, data), { learning: true, saved: false }, '복습 끝 = 초록도 학습 표현');
  assert.deepEqual(P.panelLineFlags({ text: 'They give up.' }, data), { learning: true, saved: true }, '저장한 구·저장한 줄');
  assert.deepEqual(P.panelLineFlags({ text: 'A mild day.' }, data), { learning: true, saved: false }, 'p 가 쉬움 구간이어도 패널은 칠한다');
  assert.deepEqual(P.panelLineFlags({ text: 'A legacy answer.' }, data), { learning: true, saved: false }, 'p 가 없는 어려운 단어도 칠한다');

  assert.equal(P.passesFilter({ learning: false, saved: false }, 'all'), true);
  assert.equal(P.passesFilter({ learning: false, saved: false }, 'learning'), false);
  assert.equal(P.passesFilter({ learning: true, saved: false }, 'learning'), true);
  assert.equal(P.passesFilter({ learning: false, saved: true }, 'saved'), true);
  assert.deepEqual(P.PANEL_FILTERS.map((f) => f.title), ['전체', '학습 표현 포함', '저장됨']);
});

test('나의 표현: 주소의 v 가 지금 영상과 같은 낱말·구만, 기본형(base 없으면 원문)·뜻·종류·상자 단계', () => {
  const library = {
    saved: {
      study: { word: 'studies', gloss: '공부하다', url: `https://www.youtube.com/watch?v=${ID}&t=5s`, review: review(2, false) },
      other: { word: 'elsewhere', gloss: '다른 곳', url: `https://www.youtube.com/watch?v=${OTHER}&t=1s`, review: review(1, false) },
      fresh: { word: 'fresh', gloss: '새로운', url: `https://youtu.be/${ID}?t=9` },
    },
    phrases: {
      p1: { text: 'gave it up', base: 'give up', translation: '포기하다', kind: 'expression', url: `https://www.youtube.com/watch?v=${ID}`, review: review(5, true) },
      p2: { text: 'saved line', translation: '저장한 줄', kind: 'sentence', url: `https://www.youtube.com/watch?v=${ID}` },
      p3: { text: 'other phrase', translation: '다른 구', kind: 'expression', url: `https://www.youtube.com/watch?v=${OTHER}` },
      p4: { text: 'no base phrase', translation: '기본형 없음', kind: 'expression', url: `https://www.youtube.com/watch?v=${ID}`, review: review(1, false, 0) },
    },
  };
  const got = P.videoExpressions(library, ID);
  assert.deepEqual(got.map((x) => [x.type, x.title]), [
    ['word', 'fresh'],
    ['phrase', 'give up'],
    ['phrase', 'no base phrase'],
    ['word', 'study'],
  ], '이 영상(같은 v)만, 저장한 문장 줄은 빼고, 구는 base 우선');
  const byTitle = Object.fromEntries(got.map((x) => [x.title, x]));
  assert.equal(byTitle['give up'].text, 'gave it up', '원문을 따로 들고 있다');
  assert.equal(byTitle['give up'].stage, 'done', '끝');
  assert.equal(byTitle.study.stage, 'doing');
  assert.equal(P.stageText(byTitle.study), '복습 중 · 2상자');
  assert.equal(byTitle.fresh.stage, 'new', '한 번도 안 봄');
  assert.equal(P.stageText(byTitle.fresh), '복습 전');
  assert.equal(byTitle['no base phrase'].stage, 'new');
  assert.equal(P.videoExpressions(library, '').length, 0, '영상 id 가 없으면 빈 목록');
});

test('표현이 든 줄 찾기: 낱말은 saved-marks-core 활용형까지, 구는 글자 무시 대조, 이 영상 줄 번호만', () => {
  const cues = [
    { start: 0, text: 'She studies every day.' },
    { start: 4, text: 'They give up quickly.' },
    { start: 8, text: 'Nothing here.' },
    { start: 12, text: 'He studied yesterday.' },
  ];
  assert.deepEqual(P.expressionLines(cues, { type: 'word', key: 'study' }), [0, 3], 'studies·studied 포함');
  assert.deepEqual(P.expressionLines(cues, { type: 'word', key: 'nothing' }), [2]);
  assert.deepEqual(P.expressionLines(cues, { type: 'phrase', text: 'GIVE UP' }), [1], '대소문자 무시');
  assert.deepEqual(P.expressionLines(cues, { type: 'phrase', text: 'give up' }), [1]);
  assert.deepEqual(P.expressionLines(cues, { type: 'phrase', text: 'no match' }), []);
  assert.deepEqual(P.expressionLines([], { type: 'word', key: 'study' }), []);
});

test('연결: 작은 탭 셋, 패널 읽기 함수(칠하기·저장 목록)와 두 줄 문맥 풀이(force)', () => {
  const panel = read('panel-video.js');
  for (const t of ['자막', '나의 표현', '풀이']) assert.ok(panel.includes(`title: '${t}'`), t);
  assert.match(panel, /panelData\(\)/);
  assert.match(panel, /library\(\)/);
  assert.match(panel, /explainAt\(i, force === true\)/);
  assert.match(panel, /다시 만들기/);
  assert.doesNotMatch(panel, /innerHTML/);

  const subs = read('video-subs.js');
  assert.match(subs, /panelData: \(\) => \(\{ hard: S\.hard, forms: S\.savedForms, done: S\.done, phrases: S\.phrases/);
  assert.match(subs, /library: \(\) => \(\{ saved: S\.saved, phrases: S\.phrases/);
  assert.match(subs, /async function explainAt\(i, force = false\)/);
  assert.match(subs, /const near = S\.cues\.slice\(from, Math\.min\(S\.cues\.length, i \+ 3\)\)/, '앞뒤 두 줄 문맥');
  assert.match(subs, /force: true/, '다시 만들기는 다리 캐시를 건너뛴다');
  assert.match(subs, /S\.saved = r\.saved/, '나의 표현은 background words op get 결과에서 고른다');
});
