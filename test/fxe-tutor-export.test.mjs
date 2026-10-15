import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTutorQuote, stripMarkdownForQuote } from '../bridge/tutor-quote.mjs';
import { textFragmentUrl, renderNoteDocs } from '../scripts/export-notes.mjs';

// ============================================================================
// 1. 폴더 mtime 옛날·파일 mtime 지금 -> 찾음
// ============================================================================
test('1. 폴더 mtime 옛날(3일 전) · messages.jsonl 파일 mtime 지금 -> 찾음', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'fxe-tutor-1-'));
  const now = new Date('2026-10-15T15:00:00+09:00').getTime();

  const sDir = join(baseDir, '2026-10-12_old-session');
  mkdirSync(sDir, { recursive: true });

  const sLines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T14:00:00+09:00').getTime(),
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\nCSRF 토큰 검증 방식은?',
    }),
    JSON.stringify({
      role: 'assistant',
      content: 'CSRF 토큰은 사용자의 세션과 연계된 난수를 폼이나 요청 헤더에 포함하여 검증합니다.',
    }),
  ];
  const jsonlPath = join(sDir, 'messages.jsonl');
  writeFileSync(jsonlPath, sLines.join('\n'));

  // 폴더 mtime은 3일 전으로 변경
  const threeDaysAgoSec = (now - 3 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(sDir, threeDaysAgoSec, threeDaysAgoSec);

  // messages.jsonl 파일의 mtime은 현재 시각으로 설정
  const nowSec = now / 1000;
  utimesSync(jsonlPath, nowSec, nowSec);

  const tq = createTutorQuote({ sessionsDir: baseDir, now });
  const result = tq.find('CSRF 토큰은 사용자의 세션과 연계된 난수를');

  assert.equal(result.found, true);
  assert.equal(result.date, '2026-10-15');
  assert.equal(result.time, '14:00');
  assert.equal(result.title, 'CSRF 토큰 검증 방식은?');
});

// ============================================================================
// 2. 마크다운(**굵게**, 백틱, 링크, 줄머리 등) 원문을 표시 없는 글로 찾음
// ============================================================================
test('2. 마크다운(**굵게**, 백틱, 링크, 줄머리 등) 원문을 표시 없는 일반 텍스트로 찾음', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'fxe-tutor-2-'));
  const now = new Date('2026-10-15T15:00:00+09:00').getTime();

  const sDir = join(baseDir, '2026-10-15_session');
  mkdirSync(sDir, { recursive: true });

  const rawAnswer = [
    '# 취약점 완화 기법',
    '> 다음 방식을 권장합니다.',
    '- **SOP**(Same-Origin Policy)는 다른 출처의 리소스 접근을 제한합니다.',
    '1. `Content-Security-Policy` 헤더를 설정하세요.',
    '[공식 가이드](https://developer.mozilla.org)를 참조하고, __반드시__ *모든* 엔드포인트에 적용해야 합니다.',
  ].join('\n');

  const sLines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T10:00:00+09:00').getTime(),
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\nSOP와 CSP에 대해 설명해줘.',
    }),
    JSON.stringify({
      role: 'assistant',
      content: rawAnswer,
    }),
  ];
  writeFileSync(join(sDir, 'messages.jsonl'), sLines.join('\n'));

  const tq = createTutorQuote({ sessionsDir: baseDir, now });

  // 1) 화면에서 복사하여 마크다운 표시(**, `, [], 줄머리 등)가 전혀 없는 텍스트로 검색
  const plainTextQuery1 = 'SOP(Same-Origin Policy)는 다른 출처의 리소스 접근을 제한합니다.';
  const res1 = tq.find(plainTextQuery1);
  assert.equal(res1.found, true);
  assert.equal(res1.date, '2026-10-15');
  assert.equal(res1.time, '10:00');

  // 2) 백틱과 인용/번호 머리가 있던 부분
  const plainTextQuery2 = 'Content-Security-Policy 헤더를 설정하세요. 공식 가이드를 참조하고, 반드시 모든 엔드포인트에 적용해야 합니다.';
  const res2 = tq.find(plainTextQuery2);
  assert.equal(res2.found, true);

  // 3) 검색어에 마크다운이 들어있고 원문에는 없는 경우나 다른 형태도 매칭 확인
  const markdownQuery = '`Content-Security-Policy` 헤더를 **설정하세요**.';
  const res3 = tq.find(markdownQuery);
  assert.equal(res3.found, true);
});

// ============================================================================
// 3. 문자열 시각 줄이 있어도 건너뛰고 다음 세션에서 찾음
// ============================================================================
test('3. 시각이 숫자가 아닌(문자열 등) 줄이나 오류가 있어도 건너뛰고 다음 세션/턴에서 찾음', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'fxe-tutor-3-'));
  const now = new Date('2026-10-15T15:00:00+09:00').getTime();

  // 1) 오류 세션: 시각이 문자열, 깨진 JSON 등
  const sErrDir = join(baseDir, '2026-10-15_session-err');
  mkdirSync(sErrDir, { recursive: true });
  const sErrLines = [
    '{ broken json line ...',
    JSON.stringify({
      role: 'user',
      timestamp: '2026-10-15 10:00:00', // 숫자가 아닌 문자열 시각
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\n오류 세션 질문입니다.',
    }),
    JSON.stringify({
      role: 'assistant',
      content: '오류가 있는 세션의 첫 답변입니다.',
    }),
    JSON.stringify({
      role: 'user',
      timestamp: null, // null 시각
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\n둘째 질문입니다.',
    }),
  ];
  writeFileSync(join(sErrDir, 'messages.jsonl'), sErrLines.join('\n'));

  // 2) 정상 세션: 유효한 튜터 대화
  const sOkDir = join(baseDir, '2026-10-15_session-ok');
  mkdirSync(sOkDir, { recursive: true });
  const sOkLines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T11:30:00+09:00').getTime(),
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\n정상 세션 질문입니다.',
    }),
    JSON.stringify({
      role: 'assistant',
      content: '정상 세션에서 제공하는 명확하고 유효한 튜터 답변입니다.',
    }),
  ];
  writeFileSync(join(sOkDir, 'messages.jsonl'), sOkLines.join('\n'));

  const tq = createTutorQuote({ sessionsDir: baseDir, now });
  const res = tq.find('정상 세션에서 제공하는 명확하고 유효한 튜터 답변입니다.');

  assert.equal(res.found, true);
  assert.equal(res.date, '2026-10-15');
  assert.equal(res.time, '11:30');
  assert.equal(res.title, '정상 세션 질문입니다.');
});

// ============================================================================
// 4. 링크 title 정리, 괄호 인코딩
// ============================================================================
test('4-1. export-notes 튜터 링크 title에서 [, ], |, #, ^ 특수문자 공백 치환 및 연속 공백 정리', () => {
  const data = {
    memos: [
      {
        url: 'https://example.com/test',
        task: 'S1-01',
        title: 'Test',
        headings: ['Sec 1'],
        quote: {
          exact: '튜터 설명 내용입니다.',
          source: 'tutor',
          tutor: {
            date: '2026-10-15',
            time: '13:45',
            title: '[긴급] 취약점 #1 | XSS & CSRF ^핵심정리',
          },
        },
        text: '메모 내용',
        ts: 1000,
      },
    ],
  };

  const docs = renderNoteDocs(data, { 'S1-01': 'Task 1' });
  const content = Array.from(docs.values())[0];

  // [, ], |, #, ^ 문자가 제거/공백으로 치환되고 공백이 하나로 줄어든 링크 확인
  // "[긴급] 취약점 #1 | XSS & CSRF ^핵심정리" -> "긴급 취약점 1 XSS & CSRF 핵심정리"
  assert.ok(
    content.includes('> [[tutor-logs/2026-10-15#13:45 긴급 취약점 1 XSS & CSRF 핵심정리]]'),
    `링크가 올바르게 정리되지 않음: ${content}`,
  );
  assert.ok(!content.includes('[[[')); // 중첩 대괄호 방지
  assert.ok(!content.includes('|'));
  assert.ok(!content.includes('^'));
});

test('4-2. textFragmentUrl에서 괄호 (, ) 인코딩 (%28, %29)', () => {
  const url = 'https://example.com/page';

  // 1) 8단어 이하 문장 속 괄호
  const text1 = 'call function(param) now';
  const res1 = textFragmentUrl(url, text1);
  assert.equal(res1, 'https://example.com/page#:~:text=call%20function%28param%29%20now');
  assert.ok(!res1.includes('('));
  assert.ok(!res1.includes(')'));

  // 2) 8단어 초과(9단어) 문장 속 괄호 (앞 4단어 및 뒤 4단어)
  const text2 = 'init(a) step two three four five six seven finish(z)';
  const res2 = textFragmentUrl(url, text2);
  assert.equal(
    res2,
    'https://example.com/page#:~:text=init%28a%29%20step%20two%20three,five%20six%20seven%20finish%28z%29',
  );
  assert.ok(!res2.includes('('));
  assert.ok(!res2.includes(')'));
});

// ============================================================================
// 5. 소스 검사
// ============================================================================
test('5. 소스 검사: bridge/server.mjs scraps guess records와 tutor-quote messages.jsonl mtime 검사', () => {
  // 5-1. bridge/server.mjs 검사
  const serverCode = readFileSync(join(process.cwd(), 'bridge', 'server.mjs'), 'utf8');
  // seen.url 에 firstTask를 붙이는 코드가 없어야 함
  assert.ok(
    !serverCode.includes('records.push({ url: c.seen.url, task: c.firstTask'),
    'server.mjs에 c.seen.url을 records에 넣는 코드가 남아있습니다.',
  );
  assert.match(serverCode, /if \(c\.firstTask && c\.firstUrl\)\s*\{?\s*records\.push\(\{ url: c\.firstUrl, task: c\.firstTask, ts: c\.ts \}\)/,
    'server.mjs에 firstUrl + firstTask 만 기록으로 쓰는 코드가 있어야 합니다(들여쓰기 무관).');

  // 5-2. bridge/tutor-quote.mjs 검사
  const tutorQuoteCode = readFileSync(join(process.cwd(), 'bridge', 'tutor-quote.mjs'), 'utf8');
  // messages.jsonl 파일의 mtime을 확인하는 코드가 있어야 함
  assert.ok(
    tutorQuoteCode.includes('messages.jsonl') && tutorQuoteCode.includes('mtimeMs'),
    'tutor-quote.mjs에 messages.jsonl 파일의 mtime을 확인하는 로직이 필요합니다.',
  );
  // 폴더 자체의 mtime(statSync(dirPath))만으로 판정하는 코드가 없어야 함
  assert.ok(
    !/statSync\(\s*dirPath\s*\)\.mtimeMs/i.test(tutorQuoteCode),
    'tutor-quote.mjs에 세션 폴더 mtime을 비교하는 코드가 남아있습니다.',
  );
});
