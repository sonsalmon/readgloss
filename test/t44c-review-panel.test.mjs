import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../extension/panel-words.js';

const W = globalThis.readglossWords;

test('T44c maskWord: 대소문자 무시하고 표면형 단어를 ____로 가린다', () => {
  const sentence = 'Exploit the vulnerability or EXPLOIT it again.';
  const masked = W.maskWord(sentence, 'exploit');
  assert.equal(masked, '____ the vulnerability or ____ it again.');
});

test('T44c maskWord: 낱말 경계를 지킨다 (단어의 일부로 포함된 글자는 가리지 않음)', () => {
  const sentence = 'Exploitation is not an exploit, and pineapple is not an apple.';
  assert.equal(W.maskWord(sentence, 'exploit'), 'Exploitation is not an ____, and pineapple is not an apple.');
  assert.equal(W.maskWord(sentence, 'apple'), 'Exploitation is not an exploit, and pineapple is not an ____.');
});

test('T44c maskWord: 한 문장에 여러 번 나와도 모두 ____로 가린다', () => {
  const sentence = 'A test is a test and another test.';
  assert.equal(W.maskWord(sentence, 'test'), 'A ____ is a ____ and another ____.');
});

test('T44c maskWord: 문장에 해당 단어가 없으면 원본 문장을 그대로 돌려준다', () => {
  const sentence = 'There is no such word in this sentence.';
  assert.equal(W.maskWord(sentence, 'exploit'), sentence);
  assert.equal(W.maskWord('', 'exploit'), '');
  assert.equal(W.maskWord(sentence, ''), sentence);
});

test('T44c nextCardState: front → back (flip), back → 다음 (next / know / again)', () => {
  const initial = { index: 0, side: 'front' };

  // front → back
  const flipped = W.nextCardState(initial, 'flip');
  assert.deepEqual(flipped, { index: 0, side: 'back' });

  // 객체 액션 { type: 'flip' } 도 지원
  assert.deepEqual(W.nextCardState(initial, { type: 'flip' }), { index: 0, side: 'back' });

  // back → 다음 (next)
  const next1 = W.nextCardState(flipped, 'next');
  assert.deepEqual(next1, { index: 1, side: 'front' });

  // know / again 답 액션도 다음 카드로
  const nextKnow = W.nextCardState(flipped, 'know');
  assert.deepEqual(nextKnow, { index: 1, side: 'front' });

  const nextAgain = W.nextCardState(flipped, 'again');
  assert.deepEqual(nextAgain, { index: 1, side: 'front' });

  // { type: 'next' }
  assert.deepEqual(W.nextCardState(flipped, { type: 'next' }), { index: 1, side: 'front' });
});

test('T44c 소스 검사: 서브 탭 맨 앞에 [복습] (SUBS[0])', () => {
  assert.equal(W.SUBS[0].id, 'review');
  assert.equal(W.SUBS[0].title, '복습');
});

test('T44c 소스 검사: panel-words.js 의 review-queue, op review, Space·1·2 키 처리 및 문구 검사', () => {
  const src = readFileSync(new URL('../extension/panel-words.js', import.meta.url), 'utf8');

  // review-queue 요청
  assert.match(src, /review-queue/);

  // op 'review' 전송 (know / again 결과 포함)
  assert.match(src, /op:\s*['"]review['"]/);

  // Space, 1, 2 단축키 처리
  assert.match(src, /['"](?: |Space)['"]/);
  assert.match(src, /['"]1['"]/);
  assert.match(src, /['"]2['"]/);

  // 실패 시 한 줄 알림
  assert.match(src, /저장하지 못했어요/);

  // 복습 완료 문구
  assert.match(src, /오늘 복습 끝/);
  assert.match(src, /복습 끝낸 단어/);
});

test('T44c 소스 검사: background.js 의 review-queue 중계 분기 검사', () => {
  const bgSrc = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

  // review-queue 분기 및 GET /words/review 요청
  assert.match(bgSrc, /['"]review-queue['"]/);
  assert.match(bgSrc, /\/words\/review/);
  // op review 시 result 필드 전달
  assert.match(bgSrc, /\bresult\b/);
});
