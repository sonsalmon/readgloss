import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, migrateJson } from '../bridge/db.mjs';

function createFixtureData(dir) {
  const words = {
    saved: {
      mitigation: { word: 'mitigations', gloss: '완화', sentence: 'Apply mitigations.', url: 'https://a.test/p', memo: '중요', ts: 1000 },
      payload: { word: 'payload', gloss: '공격 코드', sentence: 'Send payload.', url: 'https://b.test/p', ts: 2000 },
    },
    known: {
      hello: { ts: 3000 },
      world: { ts: 4000 },
    },
    history: [
      { lemma: 'explore', word: 'explore', gloss: '탐색하다', sentence: "Let's explore.", url: 'https://c.test/p', ts: 5000 },
    ],
    phrases: {
      '0123456789ab': { text: 'buffer overflow', translation: '버퍼 오버플로', kind: 'expression', ts: 6000 },
    },
  };
  const mydict = {
    entries: {
      pca: { ko: '주성분 분석', exp: '차원 축소', note: '수학', url: 'https://d.test/p', title: '머신러닝', ts: 7000 },
    },
  };
  const scraps = {
    v: 1,
    scraps: {
      abcdef012345: {
        id: 'abcdef012345',
        task: 'S1-04',
        url: 'https://portswigger.net/web-security/access-control',
        title: 'Access Control',
        headings: ['Overview'],
        quote: { exact: 'Broken access control.', prefix: 'See ', suffix: ' here.' },
        pos: 100,
        translation: '접근 통제 취약점.',
        memo: '확인 필요',
        ts: 8000,
      },
    },
  };

  writeFileSync(join(dir, 'words.json'), JSON.stringify(words));
  writeFileSync(join(dir, 'mydict.json'), JSON.stringify(mydict));
  writeFileSync(join(dir, 'scraps.json'), JSON.stringify(scraps));
  return { words, mydict, scraps };
}

test('옛 JSON 3개를 옮기면 개수가 같다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-db-test-count-'));
  createFixtureData(dir);
  const dbFile = join(dir, 'readgloss.db');
  const db = openDb(dbFile);

  const res = migrateJson({ db, dataDir: dir });
  assert.equal(res.ok, true);
  assert.deepEqual(res.counts, {
    saved: 2,
    known: 2,
    history: 1,
    phrases: 1,
    mydict: 1,
    scraps: 1,
  });

  const wordNodes = db.byKind('word');
  assert.equal(wordNodes.length, 5); // mitigation, payload, hello, world, explore

  const phraseNodes = db.byKind('phrase');
  assert.equal(phraseNodes.length, 1);
  assert.equal(phraseNodes[0].id, '0123456789ab');

  const mydictNodes = db.byKind('mydict');
  assert.equal(mydictNodes.length, 1);
  assert.equal(mydictNodes[0].id, 'mydict:pca');

  const scrapNodes = db.byKind('scrap');
  assert.equal(scrapNodes.length, 1);
  assert.equal(scrapNodes[0].id, 'abcdef012345');

  const taskNodes = db.byKind('task');
  assert.equal(taskNodes.length, 1);
  assert.equal(taskNodes[0].id, 'task:S1-04');

  const scrapEdges = db.out('abcdef012345', 'in_task');
  assert.equal(scrapEdges.length, 1);
  assert.equal(scrapEdges[0].dst, 'task:S1-04');

  db.close();
});

test('옮긴 뒤 JSON은 .migrated-<ts>로 남는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-db-test-migrated-'));
  createFixtureData(dir);
  const dbFile = join(dir, 'readgloss.db');
  const db = openDb(dbFile);
  const fixedTime = 1770000000000;

  const res = migrateJson({ db, dataDir: dir, now: () => fixedTime });
  assert.equal(res.ok, true);

  assert.equal(existsSync(join(dir, 'words.json')), false);
  assert.equal(existsSync(join(dir, 'mydict.json')), false);
  assert.equal(existsSync(join(dir, 'scraps.json')), false);

  assert.equal(existsSync(join(dir, `words.json.migrated-${fixedTime}`)), true);
  assert.equal(existsSync(join(dir, `mydict.json.migrated-${fixedTime}`)), true);
  assert.equal(existsSync(join(dir, `scraps.json.migrated-${fixedTime}`)), true);

  db.close();
});

test('db가 이미 있으면 다시 옮기지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-db-test-exists-'));
  createFixtureData(dir);
  const dbFile = join(dir, 'readgloss.db');

  const db1 = openDb(dbFile);
  const res1 = migrateJson({ db: db1, dataDir: dir });
  assert.equal(res1.ok, true);
  db1.close();

  // 새로운 words.json 을 둔다
  const newWords = {
    saved: {
      newlemma: { word: 'newlemma', gloss: '새단어', ts: 9999 },
    },
  };
  writeFileSync(join(dir, 'words.json'), JSON.stringify(newWords));

  // 이미 db 가 있는 상태에서 다시 연다
  const db2 = openDb(dbFile);
  const res2 = migrateJson({ db: db2, dataDir: dir });
  assert.equal(res2.ok, true);
  assert.equal(res2.skipped, true);

  // 새로 둔 words.json 은 이름이 바뀌지 않고 남아있어야 한다
  assert.equal(existsSync(join(dir, 'words.json')), true);
  // db 에도 새 단어가 들어가지 않아야 한다
  assert.equal(db2.byKey('word', 'newlemma'), null);

  db2.close();
});

test('개수가 다르면 db 파일을 지우고 JSON을 그대로 둔다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-db-test-mismatch-'));
  createFixtureData(dir);
  const dbFile = join(dir, 'readgloss.db');
  const db = openDb(dbFile);

  // 삽입 도중 가짜로 한 건을 삭제하는 훅
  const hook = ({ db: d }) => {
    d.raw.exec("DELETE FROM nodes WHERE id = 'word:mitigation'");
  };

  const res = migrateJson({ db, dataDir: dir, hook });
  assert.equal(res.ok, false);

  // db 파일이 지워져야 한다
  assert.equal(existsSync(dbFile), false);

  // JSON 파일들은 그대로 남아있어야 한다
  assert.equal(existsSync(join(dir, 'words.json')), true);
  assert.equal(existsSync(join(dir, 'mydict.json')), true);
  assert.equal(existsSync(join(dir, 'scraps.json')), true);
});

test('옮기는 중 예외가 나면 다음 시작 때 다시 옮긴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-db-test-retry-'));
  createFixtureData(dir);
  const dbFile = join(dir, 'readgloss.db');
  const db1 = openDb(dbFile);

  // 옮기는 도중 예외 발생
  const hook = () => {
    throw new Error('예기치 않은 중단');
  };

  const res1 = migrateJson({ db: db1, dataDir: dir, hook });
  assert.equal(res1.ok, false);

  // db 파일이 삭제되고 JSON 파일은 남아있음
  assert.equal(existsSync(dbFile), false);
  assert.equal(existsSync(join(dir, 'words.json')), true);

  // 다음 시작 때 다시 옮김
  const db2 = openDb(dbFile);
  const res2 = migrateJson({ db: db2, dataDir: dir });
  assert.equal(res2.ok, true);
  assert.equal(existsSync(join(dir, 'words.json')), false);
  assert.notEqual(db2.get('word:mitigation'), null);

  db2.close();
});

test('del은 들어오는 선과 나가는 선을 모두 지운다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-db-test-del-'));
  const db = openDb(join(dir, 'test.db'));

  db.put({ id: 'A', kind: 'concept', key: 'a' });
  db.put({ id: 'B', kind: 'concept', key: 'b' });
  db.put({ id: 'C', kind: 'concept', key: 'c' });

  db.link('A', 'B', 'related', 1000); // B로 들어오는 선
  db.link('B', 'C', 'related', 2000); // B에서 나가는 선
  db.link('A', 'C', 'related', 3000); // B와 무관한 선

  assert.equal(db.out('A').length, 2);
  assert.equal(db.in('B').length, 1);
  assert.equal(db.out('B').length, 1);
  assert.equal(db.in('C').length, 2);

  db.del('B');

  assert.equal(db.get('B'), null);
  assert.equal(db.in('B').length, 0);
  assert.equal(db.out('B').length, 0);

  // A -> C 선만 남아야 함
  const outA = db.out('A');
  assert.equal(outA.length, 1);
  assert.deepEqual(outA[0], { src: 'A', dst: 'C', kind: 'related', ts: 3000 });

  // C로 들어오는 선도 A에서 오는 것만 남아야 함
  const inC = db.in('C');
  assert.equal(inC.length, 1);
  assert.deepEqual(inC[0], { src: 'A', dst: 'C', kind: 'related', ts: 3000 });

  assert.notEqual(db.get('A'), null);
  assert.notEqual(db.get('C'), null);

  db.close();
});
