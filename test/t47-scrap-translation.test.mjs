// test/t47-scrap-translation.test.mjs
// 과제 T47: 스크랩 번역 저장, 인용에 번역 싣기, 학습노트 번역 줄 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScraps, parseScrapOp } from '../bridge/scraps.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';
import { openDb } from '../bridge/db.mjs';
import { renderNoteDocs } from '../scripts/export-notes.mjs';

function createTempDir(prefix = 'rg-t47-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

// 1. scraps op:'translation' 검사: 400 · 404 · 200 · 재시작 뒤 남음
test('scraps op:translation 파싱 상한 및 유효성 검사 (400)', () => {
  const validId = '0123456789ab';

  // 정상
  const ok = parseScrapOp({ op: 'translation', id: validId, translation: '접근 통제 번역' });
  assert.ok(ok);
  assert.equal(ok.op, 'translation');
  assert.equal(ok.id, validId);
  assert.equal(ok.translation, '접근 통제 번역');

  // id 형식 틀림 (12자리 16진수가 아님) -> null (400)
  assert.equal(parseScrapOp({ op: 'translation', id: 'invalid-id', translation: '번역' }), null);
  assert.equal(parseScrapOp({ op: 'translation', id: '', translation: '번역' }), null);
  assert.equal(parseScrapOp({ op: 'translation', id: null, translation: '번역' }), null);

  // translation 형식 틀림 (문자열 아님, 0자, 2000자 초과) -> null (400)
  assert.equal(parseScrapOp({ op: 'translation', id: validId, translation: '' }), null);
  assert.equal(parseScrapOp({ op: 'translation', id: validId, translation: 12345 }), null);
  assert.equal(parseScrapOp({ op: 'translation', id: validId, translation: null }), null);
  assert.equal(parseScrapOp({ op: 'translation', id: validId, translation: 'a'.repeat(2001) }), null);

  // 1자 및 2000자 경계값 정상
  assert.ok(parseScrapOp({ op: 'translation', id: validId, translation: 'a' }));
  assert.ok(parseScrapOp({ op: 'translation', id: validId, translation: 'a'.repeat(2000) }));
});

test('scraps op:translation 적용: 없는 id 404, 있는 id 덮어쓰고 파일/DB 재시작 후 보존', () => {
  const dir = createTempDir('scraps-trans-');
  const file = join(dir, 'scraps.json');
  const s = createScraps({ file });

  // 1. 없는 id -> null (404)
  const notFound = s.apply({ op: 'translation', id: '000000000000', translation: '번역' });
  assert.equal(notFound, null);

  // 2. 스크랩 등록 (초기 번역 없음)
  const saveOp = parseScrapOp({
    op: 'save',
    url: 'https://example.com/test',
    title: 'Test',
    headings: ['H1'],
    quote: { exact: 'A security vulnerability.', prefix: '', suffix: '' },
    pos: 0,
    translation: '',
    memo: '',
  });
  const res1 = s.apply(saveOp);
  assert.ok(res1 && res1.length === 1);
  const scrapId = res1[0].id;
  assert.equal(res1[0].translation, '');

  // 3. op translation 적용 -> 덮어쓰기 성공 (200)
  const res2 = s.apply({ op: 'translation', id: scrapId, translation: '보안 취약점입니다.' });
  assert.ok(res2);
  const updated = res2.find((x) => x.id === scrapId);
  assert.ok(updated);
  assert.equal(updated.translation, '보안 취약점입니다.');

  // 4. 파일 재시작 후에도 보존되는지 확인
  const reloaded = createScraps({ file });
  const reloadedScrap = reloaded.all().find((x) => x.id === scrapId);
  assert.ok(reloadedScrap);
  assert.equal(reloadedScrap.translation, '보안 취약점입니다.');

  // 5. DB 모드에서도 translation 저장 및 재시작 보존 확인
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  const sDb = createScraps({ db });
  const resDb1 = sDb.apply(saveOp);
  const dbScrapId = resDb1[0].id;
  sDb.apply({ op: 'translation', id: dbScrapId, translation: 'DB 보안 취약점 번역' });

  const reloadedDbScraps = createScraps({ db });
  const reloadedDbScrap = reloadedDbScraps.all().find((x) => x.id === dbScrapId);
  assert.ok(reloadedDbScrap);
  assert.equal(reloadedDbScrap.translation, 'DB 보안 취약점 번역');
  db.close();
});

// 2. memos quote translation 저장 검사
test('memos quote translation 파싱 상한 검사', () => {
  const base = {
    op: 'save',
    text: '메모 내용',
    url: 'https://example.com/memo',
    quote: {
      exact: 'Important text',
      prefix: 'pre',
      suffix: 'suf',
    },
  };

  // translation 없는 경우 정상
  assert.ok(parseMemoOp(base));

  // translation 정상 (선택 칸, 문자열 <=2000)
  const withTrans = parseMemoOp({
    ...base,
    quote: { ...base.quote, translation: '중요한 텍스트' },
  });
  assert.ok(withTrans);
  assert.equal(withTrans.quote.translation, '중요한 텍스트');

  // translation 상한 초과 (>2000) -> null (400)
  assert.equal(
    parseMemoOp({
      ...base,
      quote: { ...base.quote, translation: 'a'.repeat(2001) },
    }),
    null,
  );

  // translation 문자열 아님 -> null (400)
  assert.equal(
    parseMemoOp({
      ...base,
      quote: { ...base.quote, translation: 12345 },
    }),
    null,
  );
});

test('memos quote translation 저장·조회 및 재시작 후 보존', () => {
  const dir = createTempDir('memos-trans-');
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  const memos = createMemos({ db });

  const saved = memos.apply({
    op: 'save',
    text: '인용에 번역이 들어간 메모',
    url: 'https://example.com/page',
    title: 'Page Title',
    headings: ['Section 1'],
    quote: {
      exact: 'Quote text here.',
      prefix: 'before ',
      suffix: ' after',
      translation: '여기에 인용문 번역.',
    },
  });

  assert.ok(saved);
  assert.ok(saved.quote);
  assert.equal(saved.quote.exact, 'Quote text here.');
  assert.equal(saved.quote.translation, '여기에 인용문 번역.');

  // forUrl 및 list 확인
  const list = memos.list();
  assert.equal(list[0].quote?.translation, '여기에 인용문 번역.');
  const forUrl = memos.forUrl('https://example.com/page');
  assert.equal(forUrl[0].quote?.translation, '여기에 인용문 번역.');

  // db 재시작 후 확인
  const reloaded = createMemos({ db });
  const reloadedList = reloaded.list();
  assert.equal(reloadedList[0].quote?.translation, '여기에 인용문 번역.');
  db.close();
});

// 3. 학습노트 export-notes 번역 줄 검사
test('export-notes: 메모 인용에 translation이 있으면 > 번역: … 줄 생성', () => {
  const data = {
    memos: [
      {
        id: 'm_111111111111',
        url: 'https://example.com/sec',
        title: 'Security Page',
        headings: ['Heading 1'],
        text: '내 메모 생각',
        quote: {
          exact: 'Broken access control allows unauthorized access.',
          prefix: '',
          suffix: '',
          translation: '취약한 접근 통제는 무인가 접근을 허용합니다.',
        },
        ts: 1000,
      },
      {
        id: 'm_222222222222',
        url: 'https://example.com/sec',
        title: 'Security Page',
        headings: ['Heading 1'],
        text: '번역 없는 인용 메모',
        quote: {
          exact: 'No translation quote.',
          prefix: '',
          suffix: '',
        },
        ts: 2000,
      },
    ],
  };

  const docs = renderNoteDocs(data);
  assert.ok(docs.size > 0);
  const content = [...docs.values()][0];

  // 번역이 있는 메모: 인용 줄 바로 다음 > 번역: 줄 포함
  assert.ok(
    content.includes('> Broken access control allows unauthorized access.'),
    '인용 원문 포함',
  );
  assert.ok(
    content.includes('> 번역: 취약한 접근 통제는 무인가 접근을 허용합니다.'),
    '메모 인용 번역 줄 포함',
  );

  // 번역이 없는 메모는 번역 줄 없음
  assert.ok(content.includes('> No translation quote.'));
  assert.ok(!content.includes('> 번역: undefined'));
});

// 4. 소스 코드 검사: 카드 [번역]·[문맥 번역]·op translation, attachQuote translation, memo-pad 저장 translation
test('소스 검사: scrap.js, selection.js, memo-pad.js, export-notes.mjs 구현 검사', () => {
  const scrapSrc = readFileSync('extension/scrap.js', 'utf8');
  const selectionSrc = readFileSync('extension/selection.js', 'utf8');
  const memoPadSrc = readFileSync('extension/memo-pad.js', 'utf8');
  const exportNotesSrc = readFileSync('scripts/export-notes.mjs', 'utf8');

  // scrap.js: 카드 [번역] (type:'mt'), [문맥 번역] (type:'translate-context'), op:'translation'
  assert.ok(scrapSrc.includes("'mt'"), 'scrap.js에 맥 번역 type:mt 포함');
  assert.ok(scrapSrc.includes("'translate-context'"), 'scrap.js에 문맥 번역 type:translate-context 포함');
  assert.ok(scrapSrc.includes("'translation'"), 'scrap.js에 op:translation 저장 포함');

  // selection.js: attachQuote에 translation 싣기, save-phrase에 translation 싣기
  assert.ok(selectionSrc.includes('attachQuote'), 'selection.js에 attachQuote 호출 존재');
  assert.ok(selectionSrc.includes('translation'), 'selection.js에 translation 싣기 존재');

  // memo-pad.js: attachQuote quote에 translation 유지/포함, 저장 시 memos quote에 translation 포함
  assert.ok(memoPadSrc.includes('translation'), 'memo-pad.js에 translation 처리 포함');
  assert.ok(memoPadSrc.includes('attachQuote'), 'memo-pad.js에 attachQuote 존재');

  // export-notes.mjs: renderMemo에 translation 처리
  assert.ok(exportNotesSrc.includes('> 번역:'), 'export-notes.mjs에 > 번역: 렌더링 포함');
});
