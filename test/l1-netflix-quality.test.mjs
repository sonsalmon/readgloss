// 루프 L1: 넷플릭스 자막 품질. 영어 조각을 한국어 줄 단위로 합치고(mergeByKo), CC 영어를 손질한다(cleanCcText).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;
const cue = (start, end, text, extra = {}) => ({ start, end, text, ...extra });

test('mergeByKo: 같은 한국어 줄에 걸린 조각 둘은 한 줄로 합친다', () => {
  const en = [cue(0, 2, 'first thing in the morning. Just'), cue(2, 4, 'what I wanna see')];
  const out = V.mergeByKo(en, [cue(0, 4, '아침에 제일 먼저 보고 싶은 건')]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].start, out[0].end], [0, 4]);
  assert.equal(out[0].text, 'first thing in the morning. Just what I wanna see');
});

test('mergeByKo: 다른 한국어 줄이면 안 합치고, 한국어 없는 줄은 그대로', () => {
  const en = [cue(0, 2, 'a'), cue(2, 4, 'b'), cue(10, 12, 'c')];
  const out = V.mergeByKo(en, [cue(0, 2, '하나'), cue(2, 4, '둘')]);
  assert.deepEqual(out.map((c) => c.text), ['a', 'b', 'c']);
});

test('mergeByKo: 한국어 없는 줄끼리는 합치지 않는다', () => {
  const en = [cue(10, 12, 'x'), cue(12, 14, 'y')];
  assert.equal(V.mergeByKo(en, [cue(0, 2, '하나')]).length, 2);
});

test('mergeByKo: maxDur·maxChars 로 끊고 words 는 잇는다', () => {
  const ko = [cue(0, 30, '긴 한국어')];
  const en = [cue(0, 5, 'aaa', { words: [1] }), cue(5, 10, 'bbb', { words: [2] }), cue(10, 15, 'ccc')];
  const byDur = V.mergeByKo(en, ko, { maxDur: 10 });
  assert.deepEqual(byDur.map((c) => c.text), ['aaa bbb', 'ccc']);
  assert.deepEqual(byDur[0].words, [1, 2]);
  const byChars = V.mergeByKo(en, ko, { maxChars: 7 });
  assert.deepEqual(byChars.map((c) => c.text), ['aaa bbb', 'ccc']);
});

test('mergeByKo: 빈 입력', () => {
  assert.deepEqual(V.mergeByKo([], [cue(0, 1, '가')]), []);
  assert.deepEqual(V.mergeByKo(undefined, undefined), []);
  const en = [cue(0, 1, 'a')];
  assert.deepEqual(V.mergeByKo(en, []), en);
});

test('cleanCcText: 전부 대문자면 문장식으로', () => {
  assert.equal(V.cleanCcText("I'M GOING HOME. WHAT ABOUT YOU?"), "I'm going home. What about you?");
  assert.equal(V.cleanCcText('WE SAY I WILL'), 'We say I will');
});

test('cleanCcText: 소리 표시만 있으면 빈 문자열, 화자 이름표·대시 정리', () => {
  assert.equal(V.cleanCcText('[musical ringtone]'), '');
  assert.equal(V.cleanCcText('-[groans]'), '');
  assert.equal(V.cleanCcText('(sighs) Hello there'), 'Hello there');
  assert.equal(V.cleanCcText('JAKE: Hello there'), 'Hello there');
  assert.equal(V.cleanCcText('MAN 2: Not now.'), 'Not now.');
});

test('cleanCcText: 소문자 섞인 줄은 대소문자 유지', () => {
  assert.equal(V.cleanCcText('Hello, Jake. I NEED help'), 'Hello, Jake. I NEED help');
});

test('video-subs 연결: 넷플릭스에서만 합치고 CC 는 손질한다', () => {
  const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.match(src, /site\.name === 'netflix' && main && ko[^)]*\)\s*\{[^}]*V\.mergeByKo/s);
  assert.match(src, /V\.cleanCcText/);
});
