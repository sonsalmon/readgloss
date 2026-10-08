import test from 'node:test';
import assert from 'node:assert/strict';

// vendor approx-string-match.js 와 scrap-core.js 는 classic script. import 후 globalThis 에서 꺼낸다.
await import('../extension/vendor/approx-string-match.js');
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
