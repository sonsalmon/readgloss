// test/db-backed.test.mjs
// JSON판과 db판의 동작 동등성 및 선(edges) 갱신 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrateJson } from '../bridge/db.mjs';
import { createWords } from '../bridge/words.mjs';
import { createMydict } from '../bridge/mydict.mjs';
import { createScraps, scrapId } from '../bridge/scraps.mjs';
import { exportDay } from '../scripts/export-day.mjs';

test('같은 요청을 JSON판과 db판에 보내면 응답이 같다', () => {
  const dirJson = mkdtempSync(join(tmpdir(), 'rg-test-json-'));
  const dirDb = mkdtempSync(join(tmpdir(), 'rg-test-db-'));

  // 1. words (save·unsave·known·unknown·history·save-phrase·unsave-phrase·memo)
  let timeWordsJson = 10000;
  const nowWordsJson = () => (timeWordsJson += 100);
  let timeWordsDb = 10000;
  const nowWordsDb = () => (timeWordsDb += 100);

  const wordsFile = join(dirJson, 'words.json');
  const wordsJson = createWords({ file: wordsFile, now: nowWordsJson });

  const dbFileWords = join(dirDb, 'words.db');
  const dbWords = openDb(dbFileWords);
  const wordsDb = createWords({ db: dbWords, now: nowWordsDb });

  assert.deepEqual(wordsDb.all(), wordsJson.all());

  const wordOps = [
    { op: 'save', lemma: 'mitigate', word: 'mitigated', gloss: '완화하다', sentence: 'Mitigate risk.', url: 'https://test.com/a' },
    { op: 'known', lemma: 'hello' },
    { op: 'history', lemma: 'search', word: 'search', gloss: '검색', sentence: 'Search it.', url: 'https://test.com/b' },
    { op: 'save-phrase', text: 'in the wild', translation: '실제 환경에서', kind: 'expression', sentence: 'Found in the wild.', url: 'https://test.com/c', title: 'Article' },
    { op: 'memo', lemma: 'mitigate', memo: '중요 단어' },
    { op: 'unknown', lemma: 'hello' },
    { op: 'unsave', lemma: 'mitigate' },
  ];

  for (const op of wordOps) {
    const resJson = wordsJson.apply(op);
    const resDb = wordsDb.apply(op);
    assert.deepEqual(resDb, resJson, `words op ${op.op} 응답 불일치`);
    assert.deepEqual(wordsDb.all(), wordsJson.all(), `words op ${op.op} all() 불일치`);
  }

  // phrase memo 및 unsave-phrase 시험
  const phraseAll = wordsJson.all().phrases;
  const phraseIds = Object.keys(phraseAll);
  assert.equal(phraseIds.length, 1);
  const pId = phraseIds[0];

  const phraseMemoOp = { op: 'memo', id: pId, memo: '표현 메모' };
  const memoResJson = wordsJson.apply(phraseMemoOp);
  const memoResDb = wordsDb.apply(phraseMemoOp);
  assert.deepEqual(memoResDb, memoResJson);
  assert.deepEqual(wordsDb.all(), wordsJson.all());

  const unsavePhraseOp = { op: 'unsave-phrase', id: pId };
  const unsaveResJson = wordsJson.apply(unsavePhraseOp);
  const unsaveResDb = wordsDb.apply(unsavePhraseOp);
  assert.deepEqual(unsaveResDb, unsaveResJson);
  assert.deepEqual(wordsDb.all(), wordsJson.all());

  dbWords.close();

  // 2. mydict (set·delete)
  let timeMydictJson = 20000;
  const nowMydictJson = () => (timeMydictJson += 100);
  let timeMydictDb = 20000;
  const nowMydictDb = () => (timeMydictDb += 100);

  const mydictFile = join(dirJson, 'mydict.json');
  const mydictJson = createMydict({ file: mydictFile, now: nowMydictJson });

  const dbFileMydict = join(dirDb, 'mydict.db');
  const dbMydict = openDb(dbFileMydict);
  const mydictDb = createMydict({ db: dbMydict, now: nowMydictDb });

  assert.deepEqual(mydictDb.all(), mydictJson.all());

  const mydictOps = [
    { op: 'set', key: 'pca', ko: '주성분 분석', exp: '차원 축소', note: '수학', url: 'https://test.com/d', title: 'ML' },
    { op: 'set', key: 'rce', ko: '원격 코드 실행', exp: '', note: '', url: '', title: '' },
    { op: 'delete', key: 'pca' },
  ];

  for (const op of mydictOps) {
    const resJson = mydictJson.apply(op);
    const resDb = mydictDb.apply(op);
    assert.deepEqual(resDb, resJson, `mydict op ${op.op} 응답 불일치`);
    assert.deepEqual(mydictDb.all(), mydictJson.all(), `mydict op ${op.op} all() 불일치`);
  }

  assert.deepEqual(mydictDb.get('rce'), mydictJson.get('rce'));
  assert.deepEqual(mydictDb.find('rce'), mydictJson.find('rce'));
  assert.deepEqual(mydictDb.termsIn('rce vulnerability here'), mydictJson.termsIn('rce vulnerability here'));

  dbMydict.close();

  // 3. scraps (save·memo·move·remove)
  let timeScrapsJson = 30000;
  const nowScrapsJson = () => (timeScrapsJson += 100);
  let timeScrapsDb = 30000;
  const nowScrapsDb = () => (timeScrapsDb += 100);

  const scrapsFile = join(dirJson, 'scraps.json');
  const scrapsJson = createScraps({ file: scrapsFile, now: nowScrapsJson });

  const dbFileScraps = join(dirDb, 'scraps.db');
  const dbScraps = openDb(dbFileScraps);
  const scrapsDb = createScraps({ db: dbScraps, now: nowScrapsDb });

  assert.deepEqual(scrapsDb.all(), scrapsJson.all());

  const saveOp = {
    op: 'save',
    task: 'S1-04',
    url: 'https://portswigger.net/web-security/access-control',
    title: 'Access Control',
    headings: ['Overview'],
    quote: { exact: 'Broken access control is common.', prefix: 'Intro: ', suffix: ' End.' },
    pos: 10,
    translation: '접근 통제 취약점',
    memo: '첫 메모',
  };

  const saveResJson = scrapsJson.apply(saveOp);
  const saveResDb = scrapsDb.apply(saveOp);
  assert.deepEqual(saveResDb, saveResJson);
  assert.deepEqual(scrapsDb.all(), scrapsJson.all());

  const sId = scrapId(saveOp.url, saveOp.quote.exact, saveOp.quote.prefix);

  const memoOp = { op: 'memo', id: sId, memo: '수정된 메모' };
  const memoScrapResJson = scrapsJson.apply(memoOp);
  const memoScrapResDb = scrapsDb.apply(memoOp);
  assert.deepEqual(memoScrapResDb, memoScrapResJson);
  assert.deepEqual(scrapsDb.all(), scrapsJson.all());

  const moveOp = { op: 'move', id: sId, task: 'S1-02' };
  const moveResJson = scrapsJson.apply(moveOp);
  const moveResDb = scrapsDb.apply(moveOp);
  assert.deepEqual(moveResDb, moveResJson);
  assert.deepEqual(scrapsDb.all(), scrapsJson.all());

  const removeOp = { op: 'remove', id: sId };
  const removeResJson = scrapsJson.apply(removeOp);
  const removeResDb = scrapsDb.apply(removeOp);
  assert.deepEqual(removeResDb, removeResJson);
  assert.deepEqual(scrapsDb.all(), scrapsJson.all());

  dbScraps.close();
});

test('export-day 출력이 db에서도 같다', () => {
  const dirJson = mkdtempSync(join(tmpdir(), 'rg-export-day-json-'));
  const dirDb = mkdtempSync(join(tmpdir(), 'rg-export-day-db-'));

  const fixedDate = '2026-10-06';
  const T = (h = 12) => new Date(2026, 9, 6, h, 0, 0).getTime();

  const words = {
    saved: {
      mitigate: { word: 'mitigated', gloss: '완화하다', sentence: 'We mitigated the risk.', url: '', ts: T(10) },
      explore: { word: 'explore', gloss: '탐색하다', sentence: '', url: '', ts: T(11) },
    },
    phrases: {
      aaaaaaaaaaaa: { text: 'in the wild', translation: '실제 환경에서', context: { translation: '실전에서', note: '관용' }, ts: T(12) },
      bbbbbbbbbbbb: { text: 'zero-day', translation: '제로데이', kind: 'expression', ts: T(13) },
    },
  };
  const mydict = {
    entries: {
      pca: { ko: '주성분 분석', exp: 'principal component analysis', ts: T(14) },
    },
  };
  const studyLines = [
    JSON.stringify({ ts: T(10), kind: 'dict', text: 'a' }),
    JSON.stringify({ ts: T(12), kind: 'mt', text: 'b' }),
  ].join('\n') + '\n';

  // JSON 디렉토리 구성
  writeFileSync(join(dirJson, 'words.json'), JSON.stringify(words));
  writeFileSync(join(dirJson, 'mydict.json'), JSON.stringify(mydict));
  writeFileSync(join(dirJson, 'study-log.jsonl'), studyLines);

  // DB 디렉토리 구성: migrateJson을 통해 db 생성
  writeFileSync(join(dirDb, 'words.json'), JSON.stringify(words));
  writeFileSync(join(dirDb, 'mydict.json'), JSON.stringify(mydict));
  writeFileSync(join(dirDb, 'study-log.jsonl'), studyLines);

  const dbFile = join(dirDb, 'readgloss.db');
  const db = openDb(dbFile);
  const migRes = migrateJson({ db, dataDir: dirDb, now: () => T(15) });
  assert.equal(migRes.ok, true);
  db.close();

  const outJson = exportDay(fixedDate, dirJson);
  const outDb = exportDay(fixedDate, dirDb);

  assert.equal(outDb, outJson);
  assert.match(outDb, /mitigate/);
  assert.match(outDb, /zero-day/);
  assert.match(outDb, /pca/);
});

test('스크랩 move는 in_task 선을 바꾼다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-scrap-move-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  const scraps = createScraps({ db, now: () => 1000 });

  // 1. task 있는 save -> task:<id> 점과 in_task 선
  const saveOp = {
    op: 'save',
    task: 'S1-04',
    url: 'https://example.com/sec',
    title: 'Security',
    headings: ['Header'],
    quote: { exact: 'Important sentence.', prefix: 'Before ', suffix: ' After' },
    pos: 50,
    translation: '중요 문장',
    memo: '메모',
  };

  scraps.apply(saveOp);
  const sId = scrapId(saveOp.url, saveOp.quote.exact, saveOp.quote.prefix);

  const taskNode1 = db.get('task:S1-04');
  assert.notEqual(taskNode1, null, 'task:S1-04 노드가 생성되어야 함');
  assert.equal(taskNode1.kind, 'task');

  const edges1 = db.out(sId, 'in_task');
  assert.equal(edges1.length, 1);
  assert.equal(edges1[0].src, sId);
  assert.equal(edges1[0].dst, 'task:S1-04');
  assert.equal(edges1[0].kind, 'in_task');

  // 2. move로 다른 task -> 옛 선 없음·새 선 있음
  scraps.apply({ op: 'move', id: sId, task: 'S1-02' });

  const taskNode2 = db.get('task:S1-02');
  assert.notEqual(taskNode2, null, 'task:S1-02 노드가 생성되어야 함');

  const edges2 = db.out(sId, 'in_task');
  assert.equal(edges2.length, 1);
  assert.equal(edges2[0].dst, 'task:S1-02');

  const oldEdges = db.in('task:S1-04', 'in_task');
  assert.equal(oldEdges.length, 0, '옛 선이 지워져야 함');

  // 3. move null -> 선 없음
  scraps.apply({ op: 'move', id: sId, task: null });

  const edges3 = db.out(sId, 'in_task');
  assert.equal(edges3.length, 0, 'task가 null이면 선이 없어야 함');

  db.close();
});
