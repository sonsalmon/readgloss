import test from 'node:test';
import assert from 'node:assert/strict';

// vendor approx-string-match.js 와 scrap-core.js 는 classic script. import 후 globalThis 에서 꺼낸다.
await import('../extension/vendor/approx-string-match.js');
await import('../extension/selection-core.js'); // scrap-core 의 normalizeUrl 은 여기 것을 쓴다
await import('../extension/scrap-core.js');
const { quoteOf, findQuote, MAX_ERRORS_RATIO } = globalThis.readglossScrap;

test('상수: MAX_ERRORS_RATIO는 0.1', () => {
  assert.equal(MAX_ERRORS_RATIO, 0.1);
});

test('quoteOf: 앞뒤 최대 32자 추출 및 경계 처리', () => {
  const text = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const q = quoteOf(text, 10, 20);
  assert.equal(q.exact, 'abcdefghij');
  assert.equal(q.prefix, '0123456789'); // 앞 10자 (32자 미만)
  assert.equal(q.suffix, 'klmnopqrstuvwxyzABCDEFGHIJKLMNOP'); // 뒤 32자
  assert.equal(q.suffix.length, 32);

  // 경계: 시작 0, 끝 전체
  const qAll = quoteOf(text, 0, text.length);
  assert.equal(qAll.exact, text);
  assert.equal(qAll.prefix, '');
  assert.equal(qAll.suffix, '');
});

test('정확 일치', () => {
  const fullText = 'The quick brown fox jumps over the lazy dog. Web security requires careful attention to detail.';
  const start = 45;
  const end = 95; // 'Web security requires careful attention to detail.'
  const q = quoteOf(fullText, start, end);
  assert.equal(q.exact, 'Web security requires careful attention to detail.');
  assert.equal(q.prefix, 'wn fox jumps over the lazy dog. ');
  assert.equal(q.suffix, '');

  const match = findQuote(fullText, q);
  assert.deepEqual(match, { start, end });
});

test('같은 문장 두 번 → prefix/suffix 맞는 쪽', () => {
  const sentence = 'Access control is essential for web applications.';
  const fullText = `Section 1: Introduction. ${sentence} Read more below.\n` +
    `Section 2: Deep dive. ${sentence} Ensure proper checks.\n`;

  // 두 번째 인스턴스를 가리키는 quote
  const secondStart = fullText.indexOf(sentence, fullText.indexOf(sentence) + 1);
  const secondEnd = secondStart + sentence.length;
  const q2 = quoteOf(fullText, secondStart, secondEnd);

  const match2 = findQuote(fullText, q2);
  assert.deepEqual(match2, { start: secondStart, end: secondEnd });

  // 첫 번째 인스턴스를 가리키는 quote
  const firstStart = fullText.indexOf(sentence);
  const firstEnd = firstStart + sentence.length;
  const q1 = quoteOf(fullText, firstStart, firstEnd);

  const match1 = findQuote(fullText, q1);
  assert.deepEqual(match1, { start: firstStart, end: firstEnd });
});

test('단어 하나 끼어들어도 근사 일치', () => {
  // 원래 인용문 (76자, maxErrors = floor(76 * 0.1) = 7)
  const origText = 'Authentication verifies identity while authorization controls system access.';
  const q = {
    exact: origText,
    prefix: 'Security note: ',
    suffix: ' Keep this in mind.',
  };

  // 본문에는 'vital ' (6글자 삽입, 6 errors <= 7 maxErrors) 단어가 끼어듦
  const fullText = 'Security note: Authentication verifies identity while authorization controls vital system access. Keep this in mind.';
  const match = findQuote(fullText, q);
  assert.ok(match, '근사 매치 결과가 있어야 함');
  assert.equal(fullText.slice(match.start, match.end), 'Authentication verifies identity while authorization controls vital system access.');
});

test('절반이 바뀌면 null(엉뚱한 곳 안 칠함)', () => {
  const origText = 'Authentication verifies identity while authorization controls system access.';
  const q = {
    exact: origText,
    prefix: 'Security note: ',
    suffix: ' Keep this in mind.',
  };

  // 절반 이상이 바뀐 본문 (오류율 >> 10%)
  const fullText = 'Security note: Authentication checks user credentials but cryptography protects raw database storage. Keep this in mind.';
  const match = findQuote(fullText, q);
  assert.equal(match, null);
});

test('posHint가 가까운 후보를 고른다(문맥 점수 같을 때)', () => {
  const item = 'target quote sentence';
  const fullText = `[item] ${item} (end)\n[item] ${item} (end)\n[item] ${item} (end)\n`;
  const q = {
    exact: item,
    prefix: '[item] ',
    suffix: ' (end)',
  };

  // 3개 후보 위치
  const firstPos = fullText.indexOf(item);
  const secondPos = fullText.indexOf(item, firstPos + 1);
  const thirdPos = fullText.indexOf(item, secondPos + 1);

  // prefix, suffix 문맥 점수가 동일할 때 posHint에 가장 가까운 후보 선택
  const matchSecond = findQuote(fullText, q, secondPos);
  assert.deepEqual(matchSecond, { start: secondPos, end: secondPos + item.length });

  const matchThird = findQuote(fullText, q, thirdPos);
  assert.deepEqual(matchThird, { start: thirdPos, end: thirdPos + item.length });

  const matchFirst = findQuote(fullText, q, firstPos);
  assert.deepEqual(matchFirst, { start: firstPos, end: firstPos + item.length });
});

test('짧은 인용(20자 미만)은 근사 검색 안 함: 정확 일치만', () => {
  // 'queries'(7자) 를 'quaries' 로 바꿔 둠. 근사였다면 maxErrors=0 이라도 찾을 수 있는 자리가 아니므로 정확 일치만 본다.
  const fullText = 'Use safe quaries here.';
  assert.equal(findQuote(fullText, { exact: 'queries', prefix: 'safe ', suffix: ' here.' }), null);
});

test('짧은 인용: 정확 일치는 그대로 찾음', () => {
  const fullText = 'Use safe queries here.';
  assert.deepEqual(findQuote(fullText, { exact: 'queries', prefix: 'safe ', suffix: ' here.' }), { start: 9, end: 16 });
});

test('정확 후보가 있어도 문맥 0이면 근사 후보의 문맥을 본다(바뀐 쪽 선택)', () => {
  const sentence = 'Access control is essential for protecting web applications from unauthorized users.';
  const changed = 'Access control is essential for protecting modern web applications from unauthorized users.';
  // 첫 번째: 정확 일치지만 앞뒤 문맥이 전혀 안 맞음. 두 번째: 저장한 문맥은 맞고 본문 문장에 'modern ' 이 끼어듦.
  const fullText = `Note A:${sentence}! and more.\nNote B: ${changed} (end)\n`;
  const secondStart = fullText.indexOf(changed);
  const q = { exact: sentence, prefix: 'Note B: ', suffix: ' (end)' };
  const match = findQuote(fullText, q);
  assert.deepEqual(match, { start: secondStart, end: secondStart + changed.length });
});

test('정확 일치 문맥이 0이 아니면 근사 검색 결과로 바꾸지 않음', () => {
  const sentence = 'Access control is essential for protecting web applications from unauthorized users.';
  const changed = 'Access control is essential for protecting modern web applications from unauthorized users.';
  const fullText = `Note B: ${sentence} (end)\nNote B: ${changed} (end)\n`;
  const firstStart = fullText.indexOf(sentence);
  const q = { exact: sentence, prefix: 'Note B: ', suffix: ' (end)' };
  assert.deepEqual(findQuote(fullText, q), { start: firstStart, end: firstStart + sentence.length });
});

test('시간 상한: 같은 글자 20번 이상 연속이면 근사 검색 건너뜀 (1초 안에 null)', () => {
  const fullText = ' '.repeat(200000);
  const exact = ' '.repeat(995) + 'hello';
  const t0 = Date.now();
  const r = findQuote(fullText, { exact, prefix: '', suffix: '' });
  const elapsed = Date.now() - t0;
  assert.equal(r, null);
  assert.ok(elapsed < 1000, `1초를 넘김: ${elapsed}ms`);
});

test('시간 상한: 본문 30만자 초과면 근사 검색 안 함', () => {
  const sentence = 'Authentication verifies identity while authorization controls system access.';
  const changed = 'Authentication verifies identity while authorization controls vital system access.';
  const filler = 'x'.repeat(300001 - changed.length);
  const fullText = changed + filler;
  assert.equal(findQuote(fullText, { exact: sentence, prefix: '', suffix: '' }), null);
});
