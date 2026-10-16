import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 순수 함수 로직
import '../extension/memo-core.js';
const core = globalThis.readglossMemo;

// 다리 memos 모듈
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';

// -----------------------------------------------------------------------------
// 1. shouldDropQuoteOnBackspace 순수 함수 테스트
// -----------------------------------------------------------------------------
test('shouldDropQuoteOnBackspace: 참인 경우 (빈 값 또는 커서 0 위치)', () => {
  // 1. 빈 값 (value: '') + 인용 있음 -> true
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: false,
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    true,
    '빈 값이고 커서 0 위치면 인용 삭제',
  );

  // 2. 빈 값인데 selStart/selEnd가 null/undefined여도 value가 비어있으면 true
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: false,
      value: '',
      hasQuote: true,
    }),
    true,
    'value가 빈 문자열이면 커서 위치 없어도 인용 삭제',
  );

  // 3. 텍스트가 있지만 커서가 맨 앞 (0 위치, 선택 없음) + 인용 있음 -> true
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: false,
      value: '메모 내용',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    true,
    '텍스트가 있어도 커서가 0이고 선택이 없으면 인용 삭제',
  );

  // 4. mods 객체로 조합키가 모두 false인 경우 -> true
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: { shift: false, alt: false, ctrl: false, meta: false },
      value: '안녕하세요',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    true,
    '조합키 객체 모두 false인 경우 인용 삭제',
  );
});

test('shouldDropQuoteOnBackspace: 거짓인 경우 (키, 조합, 커서, 인용 없음)', () => {
  // 1. Backspace가 아닌 키
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Delete',
      composing: false,
      mods: false,
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    false,
    'Delete 키는 인용을 빼지 않음',
  );
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Enter',
      composing: false,
      mods: false,
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    false,
  );

  // 2. 한글 등 조합 중 (composing: true)
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: true,
      mods: false,
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    false,
    '조합 중에는 인용을 빼지 않음',
  );

  // 3. 조합키가 있는 경우 (shift, alt, ctrl, meta)
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: true,
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    false,
    'mods 불리언 true 거절',
  );
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: { shift: true },
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    false,
    'Shift 조합키 거절',
  );
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: { meta: true },
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: true,
    }),
    false,
    'Meta(⌘) 조합키 거절',
  );

  // 4. 인용이 없는 경우 (hasQuote: false)
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: false,
      value: '',
      selStart: 0,
      selEnd: 0,
      hasQuote: false,
    }),
    false,
    '인용이 없으면 거짓',
  );

  // 5. 텍스트가 있고 커서가 0이 아님 (selStart > 0)
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: false,
      value: '메모 내용',
      selStart: 1,
      selEnd: 1,
      hasQuote: true,
    }),
    false,
    '커서가 1이면 일반 백스페이스 동작을 위해 거짓',
  );

  // 6. 텍스트가 있고 선택 영역이 존재 (selStart !== selEnd)
  assert.equal(
    core.shouldDropQuoteOnBackspace({
      key: 'Backspace',
      composing: false,
      mods: false,
      value: '메모 내용',
      selStart: 0,
      selEnd: 2,
      hasQuote: true,
    }),
    false,
    '0부터 선택 영역이 있으면 선택 삭제 동작을 위해 거짓',
  );
});

// -----------------------------------------------------------------------------
// 2. bridge/memos.mjs edit dropQuote 테스트
// -----------------------------------------------------------------------------
test('parseMemoOp: op edit의 dropQuote 파싱 (맞음·형식 틀림)', () => {
  const validId = 'm_0123456789ab';

  // 1. dropQuote: true (맞음)
  const opWithDrop = parseMemoOp({
    op: 'edit',
    id: validId,
    text: '수정된 텍스트',
    dropQuote: true,
  });
  assert.ok(opWithDrop);
  assert.equal(opWithDrop.op, 'edit');
  assert.equal(opWithDrop.id, validId);
  assert.equal(opWithDrop.text, '수정된 텍스트');
  assert.equal(opWithDrop.dropQuote, true);

  // 2. dropQuote 없음 (맞음)
  const opWithoutDrop = parseMemoOp({
    op: 'edit',
    id: validId,
    text: '수정된 텍스트',
  });
  assert.ok(opWithoutDrop);
  assert.equal(opWithoutDrop.dropQuote, undefined);

  // 3. 형식 틀림 (dropQuote는 true만 허용) -> null
  assert.equal(
    parseMemoOp({ op: 'edit', id: validId, text: '글', dropQuote: false }),
    null,
    'dropQuote: false는 거절',
  );
  assert.equal(
    parseMemoOp({ op: 'edit', id: validId, text: '글', dropQuote: 'true' }),
    null,
    'dropQuote 문자열 거절',
  );
  assert.equal(
    parseMemoOp({ op: 'edit', id: validId, text: '글', dropQuote: 1 }),
    null,
    'dropQuote 숫자 거절',
  );
  assert.equal(
    parseMemoOp({ op: 'edit', id: validId, text: '글', dropQuote: {} }),
    null,
    'dropQuote 객체 거절',
  );
});

test('createMemos: edit dropQuote 적용 및 저장 뒤 다시 읽어도 quote 없음', () => {
  const db = openDb(':memory:');
  const memos = createMemos({ db, now: () => 1000 });

  // 1. 메모 생성 (인용 포함)
  const saved = memos.apply({
    op: 'save',
    text: '메모 본문',
    url: 'https://example.com/test',
    quote: {
      exact: '인용된 문장',
      prefix: '앞 ',
      suffix: ' 뒤',
    },
  });

  assert.ok(saved);
  assert.ok(saved.id);
  assert.ok(saved.quote);
  assert.equal(saved.quote.exact, '인용된 문장');

  // db 원시 데이터 확인
  const nodeBefore = db.get(saved.id);
  assert.ok(nodeBefore.data.quote);
  assert.equal(nodeBefore.data.quote.exact, '인용된 문장');

  // 2. edit with dropQuote: true 적용
  const edited = memos.apply({
    op: 'edit',
    id: saved.id,
    text: '수정된 본문',
    dropQuote: true,
  });

  assert.ok(edited);
  assert.equal(edited.id, saved.id);
  assert.equal(edited.text, '수정된 본문');
  assert.equal(edited.quote, null, '반환 객체에서 quote는 null이어야 함');

  // 3. 저장 뒤 db 원시 데이터 확인 (quote 칸 삭제 확인)
  const nodeAfter = db.get(saved.id);
  assert.equal(nodeAfter.data.quote, undefined, 'db data 객체에서 quote 필드가 삭제되어 있어야 함');

  // 4. 저장 뒤 다시 읽어도(list(), forUrl()) quote 없음
  const listItems = memos.list();
  const foundInList = listItems.find((m) => m.id === saved.id);
  assert.ok(foundInList);
  assert.equal(foundInList.quote, null, 'list()로 다시 읽어도 quote는 null');

  const urlItems = memos.forUrl('https://example.com/test');
  const foundInUrl = urlItems.find((m) => m.id === saved.id);
  assert.ok(foundInUrl);
  assert.equal(foundInUrl.quote, null, 'forUrl()로 다시 읽어도 quote는 null');

  // 5. dropQuote가 없는 edit은 기존 quote를 유지
  const saved2 = memos.apply({
    op: 'save',
    text: '둘째 메모',
    url: 'https://example.com/test2',
    quote: { exact: '둘째 인용' },
  });
  assert.ok(saved2.quote);

  const edited2 = memos.apply({
    op: 'edit',
    id: saved2.id,
    text: '둘째 메모 수정',
  });
  assert.ok(edited2.quote, 'dropQuote가 없으면 인용이 유지됨');
  assert.equal(edited2.quote.exact, '둘째 인용');

  db.close();
});

// -----------------------------------------------------------------------------
// 3. 소스 검사
// -----------------------------------------------------------------------------
test('소스 검사: attachQuote 공개 및 handleMemoOpen과 공통 함수 공유', () => {
  const memoPadSrc = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

  // 1. globalThis.readglossMemoPad.attachQuote 공개 확인
  assert.match(
    memoPadSrc,
    /globalThis\.readglossMemoPad\.attachQuote\s*=\s*attachQuote/,
    'globalThis.readglossMemoPad.attachQuote에 함수 등록',
  );

  // 2. attachQuote 함수 정의 및 소제목 key, quotes[key], saveDrafts, openPad/rebuildSectionsUI
  assert.match(memoPadSrc, /function\s+attachQuote\s*\(/, 'attachQuote 함수 정의');
  assert.match(memoPadSrc, /findHeadingKeyForNode/, 'findHeadingKeyForNode 사용');
  assert.match(memoPadSrc, /saveDrafts\s*\(/, 'saveDrafts 호출');

  // 3. handleMemoOpen에서 공통 함수 attachQuote 호출 확인 (코드 중복 방지)
  assert.match(
    memoPadSrc,
    /function\s+handleMemoOpen\s*\([^)]*\)\s*\{[\s\S]*?attachQuote\s*\(/,
    'handleMemoOpen에서 attachQuote 호출로 코드 공유',
  );
});

test('소스 검사: Backspace로 인용 빼기', () => {
  const memoPadSrc = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

  // shouldDropQuoteOnBackspace 호출 및 처리
  assert.match(
    memoPadSrc,
    /shouldDropQuoteOnBackspace/,
    'textarea keydown에서 shouldDropQuoteOnBackspace 호출',
  );
  assert.match(
    memoPadSrc,
    /delete\s+quotes\[/,
    '그 칸의 인용 삭제 delete quotes[...]',
  );
});

test('소스 검사: 저장한 메모의 인용 ✕ button 및 dropQuote 전송', () => {
  const memoPadSrc = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

  // 1. button 요소 생성 및 ✕ 표시
  assert.match(
    memoPadSrc,
    /createElement\(['"]button['"]\)/,
    '키보드로도 누를 수 있는 button 요소 생성',
  );
  assert.match(memoPadSrc, /sec-memo-quote-del/, 'sec-memo-quote-del 클래스 사용');

  // 2. 글이 빈 메모 알림
  assert.match(
    memoPadSrc,
    /글이 없는 메모는 인용을 뺄 수 없어요/,
    '글이 없는 메모 안내 문구 포함',
  );

  // 3. dropQuote: true 메시지 전송
  assert.match(
    memoPadSrc,
    /type:\s*['"]memos['"][\s\S]*?op:\s*['"]edit['"][\s\S]*?dropQuote:\s*true/,
    'memos op edit 시 dropQuote: true 전송',
  );
});

test('소스 검사: 스크랩 줄 메모 (형광펜 색 막대, 스크랩 글, textarea, op memo, Esc)', () => {
  const memoPadSrc = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

  // 1. 형광펜 색 작은 막대와 "스크랩" 라벨
  assert.match(memoPadSrc, /scrap-badge/, 'scrap-badge 요소');
  assert.match(memoPadSrc, /스크랩/, '스크랩 라벨 텍스트');

  // 2. textarea 열림
  assert.match(memoPadSrc, /scrap-edit-textarea/, '스크랩 편집 textarea 클래스');

  // 3. ⌘Enter -> scraps op memo 전송
  assert.match(
    memoPadSrc,
    /type:\s*['"]scraps['"][\s\S]*?op:\s*['"]memo['"]/,
    'scraps op memo 전송',
  );

  // 4. Esc -> 닫기 및 readglossCardClosed 표시
  assert.match(
    memoPadSrc,
    /readglossCardClosed\s*=\s*true/,
    'Esc 시 readglossCardClosed 표시로 전체 접힘 방지',
  );
});

test('소스 검사: background.js memos 중계 dropQuote 전달', () => {
  const bgSrc = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

  // memos 함수에서 dropQuote 수신 및 body 전달
  assert.match(
    bgSrc,
    /async\s+function\s+memos\s*\([^)]*\)\s*\{[\s\S]*?dropQuote[\s\S]*?body:\s*JSON\.stringify\(\{[\s\S]*?dropQuote[\s\S]*?\}\)/,
    'memos 중계에서 dropQuote 전달',
  );
});
