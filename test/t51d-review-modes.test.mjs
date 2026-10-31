// 과제 T51d(변경 기록 27-4): 복습 방식 — 고르기 보기 만들기, 듣기 글·목소리 고르기, 브라우저 음성, 장면 단추.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/panel-words.js');
await import('../extension/video-core.js');
const W = globalThis.readglossWords;
const V = globalThis.readglossVideo;

// 고정된 난수(시험용): 주어진 수열을 돈다
const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

const state = {
  saved: {
    exploit: { word: 'exploit', gloss: '악용하다' },
    payload: { word: 'payload', gloss: '페이로드' },
    mitigate: { word: 'mitigate', gloss: '완화하다' },
    abuse: { word: 'abuse', gloss: '악용하다' }, // exploit 과 같은 뜻 — 보기에서 빠진다
    empty: { word: 'empty', gloss: '' },
    bypass: { word: 'bypass', gloss: '우회하다' },
  },
  phrases: {
    aaaaaaaaaaaa: { text: 'So it begins', translation: '이제 시작이다' },
    bbbbbbbbbbbb: { text: 'Hold on', translation: '잠깐만' },
    cccccccccccc: { text: 'No way', translation: '말도 안 돼' },
    dddddddddddd: { text: 'Long one', translation: '가'.repeat(100) },
  },
};

test('REVIEW_MODES: 뒤집기·고르기·듣기·빈칸(28-20)', () => {
  assert.deepEqual(W.REVIEW_MODES.map((m) => [m.id, m.title]), [['flip', '뒤집기'], ['choice', '고르기'], ['listen', '듣기'], ['type', '빈칸']]);
});

test('quizChoices 낱말: 정답 하나 + 다른 낱말 뜻 셋(같은 뜻·빈 뜻·자기 자신 빼고), 섞임', () => {
  const card = { type: 'word', key: 'exploit', gloss: '악용하다' };
  const got = W.quizChoices(card, state, seq(0, 0.5, 0.99, 0.2, 0.7, 0.1));
  assert.equal(got.length, 4);
  assert.equal(got.filter((c) => c.correct).length, 1);
  assert.equal(got.find((c) => c.correct).text, '악용하다');
  const wrong = got.filter((c) => !c.correct).map((c) => c.text).sort();
  assert.deepEqual(wrong, ['완화하다', '우회하다', '페이로드'], '낱말끼리 먼저');
  assert.equal(new Set(got.map((c) => c.text)).size, 4, '같은 글 보기가 없다');
});

test('quizChoices: 같은 종류가 모자라면 다른 종류로 채우고, 그래도 모자라면 null', () => {
  const small = { saved: { exploit: { gloss: '악용하다' }, payload: { gloss: '페이로드' } }, phrases: { aaaaaaaaaaaa: { translation: '이제 시작이다' }, bbbbbbbbbbbb: { translation: '잠깐만' } } };
  const got = W.quizChoices({ type: 'word', key: 'exploit', gloss: '악용하다' }, small, seq(0.3));
  assert.deepEqual(got.filter((c) => !c.correct).map((c) => c.text).sort(), ['이제 시작이다', '잠깐만', '페이로드'].sort());
  const tiny = { saved: { exploit: { gloss: '악용하다' }, payload: { gloss: '페이로드' } }, phrases: {} };
  assert.equal(W.quizChoices({ type: 'word', key: 'exploit', gloss: '악용하다' }, tiny), null);
  assert.equal(W.quizChoices({ type: 'word', key: 'empty', gloss: '' }, state), null, '정답 뜻이 없으면 null');
  assert.equal(W.quizChoices({ type: 'word', key: 'x', gloss: 'y' }, null), null);
});

test('quizChoices 구: 번역끼리, 80자에서 자른다', () => {
  const card = { type: 'phrase', key: 'aaaaaaaaaaaa', text: 'So it begins', translation: '이제 시작이다' };
  const got = W.quizChoices(card, state, seq(0.1, 0.6, 0.3));
  assert.equal(got.find((c) => c.correct).text, '이제 시작이다');
  const wrong = got.filter((c) => !c.correct).map((c) => c.text);
  assert.ok(wrong.includes('잠깐만') && wrong.includes('말도 안 돼'));
  const long = wrong.find((t) => t.startsWith('가'));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
});

test('listenText: 낱말은 저장 문장(없으면 낱말), 구는 영어 글', () => {
  assert.equal(W.listenText({ type: 'word', key: 'begin', word: 'begins', sentence: 'So it begins' }), 'So it begins');
  assert.equal(W.listenText({ type: 'word', key: 'begin', word: 'begins', sentence: '' }), 'begins');
  assert.equal(W.listenText({ type: 'phrase', key: 'x', text: 'Hold on' }), 'Hold on');
  assert.equal(W.listenText(null), '');
});

test('pickVoice: en-US 의 Samantha·Google 먼저, 없으면 en-US, 없으면 다른 영어, 영어가 없으면 null', () => {
  const v = (name, lang) => ({ name, lang });
  assert.equal(W.pickVoice([v('Yuna', 'ko-KR'), v('Daniel', 'en-GB'), v('Alex', 'en-US'), v('Samantha', 'en-US')]).name, 'Samantha');
  assert.equal(W.pickVoice([v('Daniel', 'en-GB'), v('Alex', 'en-US')]).name, 'Alex');
  assert.equal(W.pickVoice([v('Yuna', 'ko-KR'), v('Daniel', 'en_GB')]).name, 'Daniel');
  assert.equal(W.pickVoice([v('Yuna', 'ko-KR')]), null);
  assert.equal(W.pickVoice(undefined), null);
});

test('speak: 브라우저 음성으로 영어(en-US, 0.95배)를 읽고, 없거나 빈 글이면 false', () => {
  const spoken = [];
  let cancelled = 0;
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.speechSynthesis = { cancel: () => cancelled++, speak: (u) => spoken.push(u), getVoices: () => [{ name: 'Samantha', lang: 'en-US' }] };
  try {
    assert.equal(W.speak('  Hold on  '), true);
    assert.equal(spoken[0].text, 'Hold on');
    assert.equal(spoken[0].lang, 'en-US');
    assert.equal(spoken[0].rate, 0.95);
    assert.equal(spoken[0].voice.name, 'Samantha');
    assert.equal(cancelled, 1, '앞 소리는 끊는다');
    assert.equal(W.speak('   '), false);
  } finally {
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
  }
  assert.equal(W.speak('Hold on'), false, 'API 가 없으면 false');
});

test('장면 단추: 복습 카드(url·clip) → video-core sceneOf, 그 자리 재생 또는 새 탭(video-open)', () => {
  const scene = V.sceneOf({ type: 'phrase', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=83s', clip: { start: 83.46, end: 86.2 } });
  assert.deepEqual(scene.clip, { start: 83.46, end: 86.2 });
  const src = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');
  assert.match(src, /readglossVideoUi\?\.playScene\?\.\(scene\)/, '같은 영상이면 그 자리에서');
  assert.match(src, /type:\s*'video-open'/, '아니면 새 탭');
  assert.match(src, /scene\.t \+ 8/, '낱말 장면은 8초');
  assert.match(src, /e\.code === 'KeyR'/, '듣기 R 다시 듣기');
  assert.match(src, /\/\^\[1-4\]\$\/\.test\(e\.key\)/, '고르기 1~4');
  assert.match(src, /reviewMode: m\.id/, '고른 방식은 설정에 남는다');
  assert.match(src, /보기를 만들 단어가 모자라서 뒤집기로 볼게요/);
  assert.match(src, /getComputedStyle\(root\)\.visibility !== 'hidden'/, '패널이 닫혀 있으면 저절로 소리 내지 않는다');
});
