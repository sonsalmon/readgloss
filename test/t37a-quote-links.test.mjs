import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textFragmentUrl, renderNoteDocs } from '../scripts/export-notes.mjs';
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';
import { createTutorQuote } from '../bridge/tutor-quote.mjs';
import { createBridge } from '../bridge/server.mjs';

// ============================================================================
// 1. textFragmentUrl 순수 함수 시험
// ============================================================================
test('textFragmentUrl: 단어 8개 이하면 전체, 단어 8개 초과면 앞 4단어,뒤 4단어', () => {
  const url = 'https://example.com/page';

  // 1. 짧은 문장 (5단어)
  const shortText = 'This is a short quote.';
  assert.equal(
    textFragmentUrl(url, shortText),
    'https://example.com/page#:~:text=This%20is%20a%20short%20quote.',
  );

  // 2. 정확히 8단어
  const eightWords = 'one two three four five six seven eight';
  assert.equal(
    textFragmentUrl(url, eightWords),
    'https://example.com/page#:~:text=one%20two%20three%20four%20five%20six%20seven%20eight',
  );

  // 3. 긴 문장 (10단어 -> 앞 4단어, 뒤 4단어)
  const tenWords = 'one two three four five six seven eight nine ten';
  assert.equal(
    textFragmentUrl(url, tenWords),
    'https://example.com/page#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten',
  );

  // 4. 공백이 여러 개인 경우 하나로 줄임
  const multiSpaces = '  one   two \n three   four  five  six  seven  eight  nine  ten  ';
  assert.equal(
    textFragmentUrl(url, multiSpaces),
    'https://example.com/page#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten',
  );
});

test('textFragmentUrl: 특수문자 -, ,, & 인코딩 및 기존 # 제거', () => {
  const urlWithHash = 'https://example.com/page#existing-section';

  // -, ,, & 특수문자 인코딩: - -> %2D, , -> %2C, & -> %26
  const specialChars = 'safe-guard, test & more';
  // 4단어이므로 전체 인코딩
  // safe-guard -> safe%2Dguard
  // , -> %2C
  // & -> %26
  const res = textFragmentUrl(urlWithHash, specialChars);
  assert.equal(
    res,
    'https://example.com/page#:~:text=safe%2Dguard%2C%20test%20%26%20more',
  );

  // 긴 문장 속 특수문자
  const longSpecial = 'alpha-beta, gamma & delta epsilon zeta eta theta-iota, kappa & lambda';
  // 앞 4단어: "alpha-beta, gamma & delta" -> alpha%2Dbeta%2C%20gamma%20%26%20delta
  // 뒤 4단어: "theta-iota, kappa & lambda" -> theta%2Diota%2C%20kappa%20%26%20lambda
  assert.equal(
    textFragmentUrl('https://example.com/doc', longSpecial),
    'https://example.com/doc#:~:text=alpha%2Dbeta%2C%20gamma%20%26%20delta,theta%2Diota%2C%20kappa%20%26%20lambda',
  );
});

// ============================================================================
// 2. 학습노트 인용 링크, 메모 빈 줄, 튜터 인용 모양 시험
// ============================================================================
test('학습노트 인용 링크, 메모 빈 줄, 튜터 인용 모양 (renderNoteDocs)', () => {
  const data = {
    scraps: {
      scraps: {
        s1: {
          url: 'https://example.com/test-page',
          task: 'S1-01',
          title: 'Test Page',
          headings: ['Heading 1'],
          quote: {
            exact: 'This is a scrap sentence.',
            prefix: '',
            suffix: '',
          },
          ts: 1000,
        },
      },
    },
    memos: [
      // 일반 본문 인용 메모 (text 있음)
      {
        url: 'https://example.com/test-page',
        task: 'S1-01',
        title: 'Test Page',
        headings: ['Heading 1'],
        quote: {
          exact: 'Quoted context line 1\nQuoted context line 2',
          prefix: '',
          suffix: '',
        },
        text: 'My thought on this quote.',
        ts: 2000,
      },
      // 튜터 인용 메모 (quote.source === 'tutor')
      {
        url: 'https://example.com/test-page',
        task: 'S1-01',
        title: 'Test Page',
        headings: ['Heading 1'],
        quote: {
          exact: 'Tutor explanation line 1\nTutor explanation line 2',
          prefix: '',
          suffix: '',
          source: 'tutor',
          tutor: {
            date: '2026-10-15',
            time: '10:32',
            title: 'How does access control work?',
          },
        },
        text: 'Remember this explanation.',
        ts: 3000,
      },
    ],
  };

  const tasks = { 'S1-01': 'Task One' };
  const docs = renderNoteDocs(data, tasks);

  assert.equal(docs.size, 1);
  const content = Array.from(docs.values())[0];

  // 1. 스크랩 인용의 마지막 > 줄 끝에 [↗](url#:~:text=...) 붙음
  const scrapLink = textFragmentUrl('https://example.com/test-page', 'This is a scrap sentence.');
  assert.ok(content.includes(`> This is a scrap sentence. [↗](${scrapLink})`));

  // 2. 메모 본문 인용의 마지막 > 줄 끝에 [↗] 붙고, 인용과 메모 글 사이에 빈 줄 있음
  const memoLink = textFragmentUrl('https://example.com/test-page', 'Quoted context line 1\nQuoted context line 2');
  assert.ok(content.includes(`> Quoted context line 2 [↗](${memoLink})`));
  // 빈 줄 확인: `> Quoted context line 2 [↗](...)\n\nMy thought on this quote.`
  assert.ok(content.includes(`> Quoted context line 2 [↗](${memoLink})\n\nMy thought on this quote.`));

  // 3. 튜터 인용 모양 확인
  // > [!tutor] 튜터 10:32
  // > Tutor explanation line 1
  // > Tutor explanation line 2
  // > [[tutor-logs/2026-10-15#10:32 How does access control work?]]
  //
  // Remember this explanation.
  const expectedTutorBlock = [
    '> [!tutor] 튜터 10:32',
    '> Tutor explanation line 1',
    '> Tutor explanation line 2',
    '> [[tutor-logs/2026-10-15#10:32 How does access control work?]]',
    '',
    'Remember this explanation.',
  ].join('\n');

  assert.ok(content.includes(expectedTutorBlock));
});

// ============================================================================
// 3. memos quote source 검사 시험
// ============================================================================
test('memos quote source 검사: 맞음 · 틀림 · 옛 모양', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-memos-t37-'));
  const db = openDb(join(dir, 'test.db'));
  const memos = createMemos({ db, now: () => 10000 });

  const baseOp = {
    op: 'save',
    text: '메모 본문',
    url: 'https://example.com/article',
    title: 'Article',
    headings: ['Sec 1'],
    para: null,
    pos: 0,
    selection: null,
    task: null,
  };

  // 1. 맞음: source === 'tutor' 및 규격에 맞는 tutor 객체
  const validTutor = {
    ...baseOp,
    quote: {
      exact: '튜터 답변 내용',
      prefix: '',
      suffix: '',
      source: 'tutor',
      tutor: {
        date: '2026-10-15',
        time: '14:05',
        title: '튜터 질문 제목',
      },
    },
  };
  const parsedValid = parseMemoOp(validTutor);
  assert.ok(parsedValid);
  assert.equal(parsedValid.quote.source, 'tutor');
  assert.deepEqual(parsedValid.quote.tutor, {
    date: '2026-10-15',
    time: '14:05',
    title: '튜터 질문 제목',
  });

  const saved = memos.apply(parsedValid);
  assert.ok(saved);
  assert.equal(saved.quote.source, 'tutor');
  assert.deepEqual(saved.quote.tutor, {
    date: '2026-10-15',
    time: '14:05',
    title: '튜터 질문 제목',
  });

  // 조회 시에도 유지됨 확인
  const found = memos.list().find((m) => m.id === saved.id);
  assert.equal(found.quote.source, 'tutor');
  assert.deepEqual(found.quote.tutor, {
    date: '2026-10-15',
    time: '14:05',
    title: '튜터 질문 제목',
  });

  // 2. 틀림: 400 (null) 반환
  // 2-1. source 가 'tutor' 가 아닌 다른 값
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', source: 'other', tutor: { date: '2026-10-15', time: '14:05', title: '제목' } },
    }),
    null,
  );

  // 2-2. source 가 'tutor' 인데 tutor 필드 없음
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', source: 'tutor' },
    }),
    null,
  );

  // 2-3. tutor.date 형식 오류 (YYYY-MM-DD 아님)
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', source: 'tutor', tutor: { date: '2026/10/15', time: '14:05', title: '제목' } },
    }),
    null,
  );

  // 2-4. tutor.time 형식 오류 (HH:MM 아님)
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', source: 'tutor', tutor: { date: '2026-10-15', time: '14:5', title: '제목' } },
    }),
    null,
  );

  // 2-5. tutor.title 길이 오류 (0자 또는 120자 초과)
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', source: 'tutor', tutor: { date: '2026-10-15', time: '14:05', title: '' } },
    }),
    null,
  );
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', source: 'tutor', tutor: { date: '2026-10-15', time: '14:05', title: 'a'.repeat(121) } },
    }),
    null,
  );

  // 2-6. source 가 없는데 tutor 필드가 있음
  assert.equal(
    parseMemoOp({
      ...baseOp,
      quote: { exact: 'abc', tutor: { date: '2026-10-15', time: '14:05', title: '제목' } },
    }),
    null,
  );

  // 3. 옛 모양 (source/tutor 없는 일반 인용)
  const legacyOp = {
    ...baseOp,
    quote: {
      exact: '옛날 인용 내용',
      prefix: '앞',
      suffix: '뒤',
    },
  };
  const parsedLegacy = parseMemoOp(legacyOp);
  assert.ok(parsedLegacy);
  assert.equal(parsedLegacy.quote.source, undefined);
  assert.equal(parsedLegacy.quote.tutor, undefined);

  const savedLegacy = memos.apply(parsedLegacy);
  assert.equal(savedLegacy.quote.source, undefined);
  assert.equal(savedLegacy.quote.tutor, undefined);

  db.close();
});

// ============================================================================
// 4. tutor-quote find 시험
// ============================================================================
test('tutor-quote find: 찾음 / 못 찾음 / 튜터 세션 아님 / 2일 넘은 폴더', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'rg-tutor-sessions-'));
  const now = new Date('2026-10-15T15:00:00+09:00').getTime(); // 서울 기준 15:00 (6:00 UTC)

  // 1. 정상 튜터 세션 폴더 (오늘)
  const s1Dir = join(baseDir, '2026-10-15_session1');
  mkdirSync(s1Dir, { recursive: true });
  const s1Lines = [
    JSON.stringify({ role: 'user-message-metadata', attachments: [{ type: 'tab', name: 'Web Security', url: 'https://portswigger.net' }] }),
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T10:30:00+09:00').getTime(),
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\n접근 제어 취약점과 권한 상승의 차이를 알려줘.',
    }),
    JSON.stringify({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '접근 제어 취약점은 권한 없는 사용자가 자원에 접근하는 문제입니다. 수직적 권한 상승과 수평적 권한 상승으로 나뉩니다.',
        },
      ],
    }),
  ];
  writeFileSync(join(s1Dir, 'messages.jsonl'), s1Lines.join('\n'));

  // 2. 튜터 세션이 아닌 폴더 (일반 대화)
  const s2Dir = join(baseDir, '2026-10-15_session2');
  mkdirSync(s2Dir, { recursive: true });
  const s2Lines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T11:00:00+09:00').getTime(),
      content: '오늘 서울 날씨 어때?',
    }),
    JSON.stringify({
      role: 'assistant',
      content: '오늘 서울 날씨는 맑고 쾌청합니다.',
    }),
  ];
  writeFileSync(join(s2Dir, 'messages.jsonl'), s2Lines.join('\n'));

  // 3. 2일 넘은 세션 폴더 (3일 전)
  const s3Dir = join(baseDir, '2026-10-12_session3');
  mkdirSync(s3Dir, { recursive: true });
  const s3Lines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-12T10:00:00+09:00').getTime(),
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\n오래된 튜터 질문입니다.',
    }),
    JSON.stringify({
      role: 'assistant',
      content: '이 답변은 3일 전 오래된 튜터 답변입니다.',
    }),
  ];
  writeFileSync(join(s3Dir, 'messages.jsonl'), s3Lines.join('\n'));
  // mtime을 3일 전으로 강제 변경
  const threeDaysAgoSec = (now - 3 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(s3Dir, threeDaysAgoSec, threeDaysAgoSec);

  const tq = createTutorQuote({ sessionsDir: baseDir, now });

  // 케이스 1: 정상 찾음 (부분 일치 및 공백 정리)
  const found = tq.find('  접근  제어 취약점은 권한 없는 사용자가   자원에 접근하는   문제입니다.  ');
  assert.equal(found.found, true);
  assert.equal(found.date, '2026-10-15');
  assert.equal(found.time, '10:30');
  assert.equal(found.title, '접근 제어 취약점과 권한 상승의 차이를 알려줘.');

  // 케이스 2: 못 찾음 (없는 글)
  const notFound = tq.find('이 문장은 대화 기록 어디에도 없는 완전히 새로운 글입니다.');
  assert.equal(notFound.found, false);

  // 케이스 3: 튜터 세션 아님 (일반 대화에 있는 글이지만 튜터 세션이 아니므로 못 찾음)
  const nonTutor = tq.find('오늘 서울 날씨는 맑고 쾌청합니다.');
  assert.equal(nonTutor.found, false);

  // 케이스 4: 2일 넘은 세션 폴더 (튜터 답변이지만 2일이 지나 못 찾음)
  const expired = tq.find('이 답변은 3일 전 오래된 튜터 답변입니다.');
  assert.equal(expired.found, false);

  // 케이스 5: 제목이 80자 초과 시 80자 + '…' 처리 확인
  const s4Dir = join(baseDir, '2026-10-15_session4');
  mkdirSync(s4Dir, { recursive: true });
  const longQ = 'A'.repeat(90);
  const s4Lines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T12:00:00+09:00').getTime(),
      content: `[$Tutor Here](skills/user/tutor-here/SKILL.md)\n${longQ}`,
    }),
    JSON.stringify({
      role: 'assistant',
      content: '답변: 긴 질문에 대한 상세한 답변 내용입니다.',
    }),
  ];
  writeFileSync(join(s4Dir, 'messages.jsonl'), s4Lines.join('\n'));

  const foundLong = tq.find('긴 질문에 대한 상세한 답변 내용입니다.');
  assert.equal(foundLong.found, true);
  assert.equal(foundLong.title, 'A'.repeat(80) + '…');
});

// ============================================================================
// 5. 서버 /tutor-quote 엔드포인트 시험
// ============================================================================
test('서버 /tutor-quote: 토큰 없으면 401 · 형식 틀리면 400 · 정상 찾음/못찾음', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-srv-tutor-'));
  const sessionsDir = mkdtempSync(join(tmpdir(), 'rg-srv-sessions-'));
  const EXT = 'abcdefghijklmnopabcdefghijklmnop';
  const MINE = `chrome-extension://${EXT}`;
  const HOST = '127.0.0.1:47831';
  const now = new Date('2026-10-15T15:00:00+09:00').getTime();

  // 테스트 튜터 세션 파일 생성
  const sDir = join(sessionsDir, '2026-10-15_test');
  mkdirSync(sDir, { recursive: true });
  const sLines = [
    JSON.stringify({
      role: 'user',
      timestamp: new Date('2026-10-15T10:00:00+09:00').getTime(),
      content: '[$Tutor Here](skills/user/tutor-here/SKILL.md)\nSQL Injection 취약점이란?',
    }),
    JSON.stringify({
      role: 'assistant',
      content: 'SQL 인젝션은 공격자가 악의적인 SQL 구문을 삽입하여 데이터베이스를 조작하는 공격 기법입니다.',
    }),
  ];
  writeFileSync(join(sDir, 'messages.jsonl'), sLines.join('\n'));

  const bridge = createBridge({
    ask: async () => '',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
    tutorSessionsDir: sessionsDir,
    now: () => now,
  });

  const port = await bridge.listen(0);
  const token = (await import('node:fs')).readFileSync(join(dir, 'token'), 'utf8');

  const req = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }));
        },
      );
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });

  try {
    // 1. 토큰 없으면 401
    const noToken = await req('POST', '/tutor-quote', { body: { text: 'SQL 인젝션은 공격자가 악의적인 SQL 구문을' } });
    assert.equal(noToken.status, 401);

    // 2. 다른 Origin 이면 403
    const badOrigin = await req('POST', '/tutor-quote', {
      headers: { 'X-Bridge-Token': token, Origin: 'https://evil.com' },
      body: { text: 'SQL 인젝션은 공격자가 악의적인 SQL 구문을' },
    });
    assert.equal(badOrigin.status, 403);

    // 3. 형식 틀리면 400 (문자열 아님, 15자 미만, 2000자 초과)
    const shortText = await req('POST', '/tutor-quote', {
      headers: { 'X-Bridge-Token': token, Origin: MINE },
      body: { text: '짧은 글' }, // 15자 미만
    });
    assert.equal(shortText.status, 400);

    const notString = await req('POST', '/tutor-quote', {
      headers: { 'X-Bridge-Token': token, Origin: MINE },
      body: { text: 12345 },
    });
    assert.equal(notString.status, 400);

    const tooLong = await req('POST', '/tutor-quote', {
      headers: { 'X-Bridge-Token': token, Origin: MINE },
      body: { text: 'a'.repeat(2001) },
    });
    assert.equal(tooLong.status, 400);

    // 4. 정상 찾음
    const okRes = await req('POST', '/tutor-quote', {
      headers: { 'X-Bridge-Token': token, Origin: MINE },
      body: { text: 'SQL 인젝션은 공격자가 악의적인 SQL 구문을 삽입하여' },
    });
    assert.equal(okRes.status, 200);
    const okJson = okRes.json();
    assert.equal(okJson.found, true);
    assert.equal(okJson.date, '2026-10-15');
    assert.equal(okJson.time, '10:00');
    assert.equal(okJson.title, 'SQL Injection 취약점이란?');

    // 5. 못 찾음
    const missRes = await req('POST', '/tutor-quote', {
      headers: { 'X-Bridge-Token': token, Origin: MINE },
      body: { text: '이 텍스트는 기록에 없는 내용이지만 15자 이상입니다.' },
    });
    assert.equal(missRes.status, 200);
    assert.equal(missRes.json().found, false);
  } finally {
    await bridge.close();
  }
});
