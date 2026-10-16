import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. 순수 함수 모듈 로드
await import('../extension/selection-core.js');
await import('../extension/memo-core.js');

const { codeQuoteKind, guessCodeLang } = globalThis.readglossMemo;

// 2. 다리 모듈 로드
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';

// 3. export-notes 모듈 로드
import { renderMemo } from '../scripts/export-notes.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t49-test-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dbFile, dir };
}

test('codeQuoteKind: 줄바꿈 없고 120자 이하 -> inline, 아니면 block', () => {
  // 120자 경계
  assert.equal(codeQuoteKind('a'.repeat(120)), 'inline');
  assert.equal(codeQuoteKind('a'.repeat(121)), 'block');
  assert.equal(codeQuoteKind('a'.repeat(119)), 'inline');
  assert.equal(codeQuoteKind(''), 'inline');

  // 줄바꿈 포함 시 길이 상관없이 block
  assert.equal(codeQuoteKind('a\nb'), 'block');
  assert.equal(codeQuoteKind('short\n'), 'block');
  assert.equal(codeQuoteKind('\n'), 'block');
  assert.equal(codeQuoteKind('a\rb'), 'block');
  assert.equal(codeQuoteKind('a'.repeat(120) + '\n'), 'block');

  // 비문자열 입력
  assert.equal(codeQuoteKind(null), 'inline');
  assert.equal(codeQuoteKind(undefined), 'inline');
});

test('guessCodeLang: pre·code 클래스들로부터 지원 언어 이름 짐작, 없으면 빈 문자열', () => {
  // language-xxx 및 lang-xxx 접두사
  assert.equal(guessCodeLang(['language-python']), 'python');
  assert.equal(guessCodeLang(['lang-javascript']), 'javascript');
  assert.equal(guessCodeLang(['language-typescript']), 'typescript');
  assert.equal(guessCodeLang(['lang-bash']), 'bash');
  assert.equal(guessCodeLang(['language-json']), 'json');
  assert.equal(guessCodeLang(['language-html']), 'html');
  assert.equal(guessCodeLang(['language-css']), 'css');
  assert.equal(guessCodeLang(['lang-sql']), 'sql');
  assert.equal(guessCodeLang(['language-c']), 'c');
  assert.equal(guessCodeLang(['language-cpp']), 'cpp');
  assert.equal(guessCodeLang(['language-java']), 'java');
  assert.equal(guessCodeLang(['language-go']), 'go');
  assert.equal(guessCodeLang(['language-rust']), 'rust');
  assert.equal(guessCodeLang(['language-powershell']), 'powershell');
  assert.equal(guessCodeLang(['lang-yaml']), 'yaml');
  assert.equal(guessCodeLang(['language-http']), 'http');
  assert.equal(guessCodeLang(['language-plaintext']), 'plaintext');

  // 별칭 매핑
  assert.equal(guessCodeLang(['language-js']), 'javascript');
  assert.equal(guessCodeLang(['lang-ts']), 'typescript');
  assert.equal(guessCodeLang(['language-py']), 'python');
  assert.equal(guessCodeLang(['lang-sh']), 'bash');
  assert.equal(guessCodeLang(['language-yml']), 'yaml');

  // hljs 패턴
  assert.equal(guessCodeLang(['hljs', 'bash']), 'bash');
  assert.equal(guessCodeLang(['hljs python']), 'python');
  assert.equal(guessCodeLang(['hljs', 'language-javascript']), 'javascript');

  // 조상·자식 요소 클래스 여러 개 합친 경우
  assert.equal(guessCodeLang(['code-snippet', 'language-rust', 'line-numbers']), 'rust');

  // 지원 목록 밖이거나 언어 정보 없음
  assert.equal(guessCodeLang(['language-ruby']), '');
  assert.equal(guessCodeLang(['lang-swift']), '');
  assert.equal(guessCodeLang(['highlight', 'code']), '');
  assert.equal(guessCodeLang([]), '');
  assert.equal(guessCodeLang(null), '');
});

test('memos quote.code 검사: 맞음·틀림·상한', () => {
  const base = {
    op: 'save',
    text: '코드 인용 메모',
    url: 'https://example.com/doc',
    quote: {
      exact: 'console.log("hello");',
      prefix: '',
      suffix: '',
    },
  };

  // 1. 정상: code 없는 일반 인용
  assert.ok(parseMemoOp(base));

  // 2. 정상: code { lang, block }
  const valid1 = parseMemoOp({
    ...base,
    quote: {
      ...base.quote,
      code: { lang: 'javascript', block: true },
    },
  });
  assert.ok(valid1);
  assert.deepEqual(valid1.quote.code, { lang: 'javascript', block: true });

  const valid2 = parseMemoOp({
    ...base,
    quote: {
      ...base.quote,
      code: { lang: '', block: false },
    },
  });
  assert.ok(valid2);
  assert.deepEqual(valid2.quote.code, { lang: '', block: false });

  // lang에 허용되는 문자: 0~20자 /^[a-z0-9+#-]*$/
  assert.ok(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: 'c++', block: true } },
  }));
  assert.ok(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: 'c#', block: true } },
  }));

  // 3. 오류: lang 규칙 위반 (대문자, 한글, 특수문자, 20자 초과)
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: 'Python', block: true } },
  }), null);
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: '파이썬', block: true } },
  }), null);
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: '자동', block: true } },
  }), null);
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: 'a'.repeat(21), block: true } },
  }), null);

  // 4. 오류: block이 boolean이 아님
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: 'python', block: 'true' } },
  }), null);
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: { lang: 'python', block: 1 } },
  }), null);

  // 5. 오류: code가 객체가 아님
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: 'python' },
  }), null);
  assert.equal(parseMemoOp({
    ...base,
    quote: { ...base.quote, code: [] },
  }), null);

  // 6. 상한 검사: quote.exact > 1000자면 거절
  assert.equal(parseMemoOp({
    ...base,
    quote: {
      exact: 'x'.repeat(1001),
      code: { lang: 'python', block: true },
    },
  }), null);
  assert.ok(parseMemoOp({
    ...base,
    quote: {
      exact: 'x'.repeat(1000),
      code: { lang: 'python', block: true },
    },
  }));
});

test('memos quote.code: DB 저장 및 재시작 뒤 유지', () => {
  const { db, dbFile } = createTempDb();
  const memos1 = createMemos({ db, now: () => 1000 });

  const saved = memos1.apply({
    op: 'save',
    text: '메모 내용',
    url: 'https://example.com/test',
    quote: {
      exact: 'def hello():\n    return 1',
      prefix: '',
      suffix: '',
      code: { lang: 'python', block: true },
    },
  });

  assert.ok(saved);
  assert.deepEqual(saved.quote.code, { lang: 'python', block: true });

  // DB 닫고 다시 열기 (재시작 시뮬레이션)
  db.close();
  const db2 = openDb(dbFile);
  const memos2 = createMemos({ db: db2 });

  const list = memos2.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].quote.code, { lang: 'python', block: true });

  const forUrl = memos2.forUrl('https://example.com/test');
  assert.equal(forUrl.length, 1);
  assert.deepEqual(forUrl[0].quote.code, { lang: 'python', block: true });

  db2.close();
});

test('shortcutAction: c·C·ㅊ·KeyC -> code 액션 반환 및 조합키/상황 제어', () => {
  const { shortcutAction } = globalThis.readglossMemo;
  const validCtx = { hasSelection: true, pageField: false, inOurUi: false };

  // 1. 단축키 C 변형들 정상 반환
  assert.equal(shortcutAction({ key: 'c' }, validCtx), 'code');
  assert.equal(shortcutAction({ key: 'C' }, validCtx), 'code');
  assert.equal(shortcutAction({ key: 'ㅊ' }, validCtx), 'code');
  assert.equal(shortcutAction({ code: 'KeyC' }, validCtx), 'code');

  // 2. 조합키(shift, alt, ctrl, meta) 누른 경우 null
  assert.equal(shortcutAction({ key: 'c', shiftKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: 'c', altKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: 'c', ctrlKey: true }, validCtx), null);
  assert.equal(shortcutAction({ key: 'c', metaKey: true }, validCtx), null);

  // 3. 한글 IME 조합 중(isComposing)인 경우 null
  assert.equal(shortcutAction({ key: 'c', isComposing: true }, validCtx), null);

  // 4. 선택 영역 없음 / 페이지 입력칸 / 우리 UI 안인 경우 null
  assert.equal(shortcutAction({ key: 'c' }, { ...validCtx, hasSelection: false }), null);
  assert.equal(shortcutAction({ key: 'c' }, { ...validCtx, pageField: true }), null);
  assert.equal(shortcutAction({ key: 'c' }, { ...validCtx, inOurUi: true }), null);
});

test('export-notes 메모 인용 코드 모양 (인라인, 블록, 백틱 든 인라인, 메모 글 없음)', () => {
  // 1. 인라인 코드 (백틱 없음)
  const memoInline = {
    quote: {
      exact: 'npm test',
      code: { lang: 'bash', block: false },
    },
    text: '단위 시험 돌리기',
  };
  const rendered1 = renderMemo(memoInline);
  assert.equal(rendered1, '`npm test`\n\n단위 시험 돌리기');

  // 2. 인라인 코드 (백틱 포함 -> 이중 백틱)
  const memoBacktick = {
    quote: {
      exact: 'echo `date`',
      code: { lang: 'bash', block: false },
    },
    text: '명령 치환 메모',
  };
  const rendered2 = renderMemo(memoBacktick);
  assert.equal(rendered2, '`` echo `date` ``\n\n명령 치환 메모'); // 백틱으로 끝나면 안쪽 공백(N2)

  // 3. 코드 블록
  const memoBlock = {
    quote: {
      exact: 'function add(a, b) {\n  return a + b;\n}',
      code: { lang: 'javascript', block: true },
    },
    text: '덧셈 함수',
  };
  const rendered3 = renderMemo(memoBlock);
  assert.equal(rendered3, '```javascript\nfunction add(a, b) {\n  return a + b;\n}\n```\n\n덧셈 함수');

  // 4. 언어 없는 코드 블록 (lang이 빈 문자열 또는 '자동')
  const memoNoLang = {
    quote: {
      exact: 'plain code line',
      code: { lang: '', block: true },
    },
    text: '일반 코드',
  };
  const rendered4 = renderMemo(memoNoLang);
  assert.equal(rendered4, '```\nplain code line\n```\n\n일반 코드');

  // 5. 메모 글이 없는 경우 (빈 줄 없이 코드만 렌더링)
  const memoOnlyCode = {
    quote: {
      exact: 'git status',
      code: { lang: 'bash', block: false },
    },
    text: '',
  };
  const rendered5 = renderMemo(memoOnlyCode);
  assert.equal(rendered5, '`git status`');
});

test('소스 정적 검사: 고정폭 글꼴, 블록 스타일, 언어 고르기 및 포커스, 상자 keydown Enter/Tab, change 처리, 단축키 처리', () => {
  const padCode = readFileSync(join(fileURLToPath(import.meta.url), '../../extension/memo-pad.js'), 'utf8');

  // 1. 고정폭 글꼴 CSS 설정
  assert.match(
    padCode,
    /\.sec-quote\.code-quote[\s\S]*?font-family:\s*ui-monospace,\s*SFMono-Regular,\s*Menlo,\s*monospace/
  );
  assert.match(
    padCode,
    /\.sec-memo-quote-line\.code-quote[\s\S]*?font-family:\s*ui-monospace,\s*SFMono-Regular,\s*Menlo,\s*monospace/
  );

  // 2. 블록 코드 가로 스크롤 및 줄바꿈 유지
  assert.match(
    padCode,
    /\.sec-quote\.code-block[\s\S]*?white-space:\s*pre[\s\S]*?overflow-x:\s*auto/
  );
  assert.match(
    padCode,
    /\.sec-memo-quote-line\.code-block[\s\S]*?white-space:\s*pre[\s\S]*?overflow-x:\s*auto/
  );

  // 3. 언어 고르기 select 생성 및 블록 인용 시 자동 포커스
  assert.match(
    padCode,
    /document\.createElement\(['"]select['"]\)[\s\S]*?className\s*=\s*['"]sec-quote-lang-select['"]/
  );
  assert.match(
    padCode,
    /function focusCodeLangSelect\(sectionKey\)[\s\S]*?\.sec-quote-lang-select[\s\S]*?selEl\.focus\(\)/
  );
  assert.match(
    padCode,
    /attachQuote\(codeQuote,\s*startNode,\s*\{\s*focusCodeLang:\s*isBlock\s*\}\)/
  );

  // 4. 클릭(change 이벤트)으로 골라도 쓰는 칸(.sec-textarea)으로 포커스
  assert.match(
    padCode,
    /langSelect\.addEventListener\(['"]change['"][\s\S]*?qData\.code\.lang\s*=[\s\S]*?saveDrafts\(\)[\s\S]*?sec\.querySelector\(['"]\.sec-textarea['"]\)[\s\S]*?focus\(\)/
  );

  // 5. 상자 keydown 규칙(한 곳에서): select에서 Enter/Tab 누르면 쓰는 칸으로 포커스
  assert.match(
    padCode,
    /box\.addEventListener\(['"]keydown['"][\s\S]*?e\.target\?\.classList\?\.contains\(['"]sec-quote-lang-select['"]\)[\s\S]*?e\.key === ['"]Enter['"][\s\S]*?e\.key === ['"]Tab['"][\s\S]*?e\.preventDefault\(\)[\s\S]*?sec\?\.querySelector\(['"]\.sec-textarea['"]\)[\s\S]*?ta\.focus\(\)/
  );

  // 6. 단축키 C (shortcutAction 'code') 분기: preventDefault, stopPropagation, 카드 닫기, 스크랩 안 함, 빈 줄 정리, 1000자 초과 검사
  assert.match(
    padCode,
    /action === ['"]code['"][\s\S]*?e\.preventDefault\(\)[\s\S]*?e\.stopPropagation\(\)[\s\S]*?readglossSelectionUi\?\.close\?\.\(\)[\s\S]*?readglossDictCardUi\?\.close\?\.\(\)[\s\S]*?trimBlankLines\(rawText\)[\s\S]*?>\s*1000[\s\S]*?인용하기엔 너무 길어요/
  );

  // 7. performSave 시 다리로 quote.code 전달
  assert.match(
    padCode,
    /currentQuote\.code\s*\?[\s\S]*?lang:\s*\(currentQuote\.code\.lang[\s\S]*?block:\s*Boolean\(currentQuote\.code\.block\)/
  );
});
