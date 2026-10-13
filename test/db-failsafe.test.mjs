// test/db-failsafe.test.mjs
// db 읽기 실패 시 안전장치 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { loadData } from '../scripts/data-source.mjs';
import { createBridge } from '../bridge/server.mjs';

function createTempDir(prefix = 'readgloss-failsafe-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('db가 깨졌으면 loadData는 던진다', () => {
  const dir = createTempDir();
  try {
    const dbFile = join(dir, 'readgloss.db');
    writeFileSync(dbFile, '깨진 sqlite 데이터입니다');

    assert.throws(
      () => loadData(dir),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes(dbFile), `오류 메시지에 db 파일 경로가 포함되어야 합니다: ${err.message}`);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('db 파일이 없으면 JSON에서 읽는다', () => {
  const dir = createTempDir();
  try {
    writeFileSync(
      join(dir, 'words.json'),
      JSON.stringify({ saved: { apple: { gloss: '사과' } }, known: {}, history: [], phrases: {} }),
    );
    const data = loadData(dir);
    assert.equal(data.words.saved.apple?.gloss, '사과');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('db 파일이 있고 열리고 meta에 migrated_at이 없으면 JSON에서 읽는다', () => {
  const dir = createTempDir();
  try {
    // SQLite db를 정상 생성하지만 migrated_at은 없음
    const db = new DatabaseSync(join(dir, 'readgloss.db'));
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
    db.close();

    writeFileSync(
      join(dir, 'words.json'),
      JSON.stringify({ saved: { banana: { gloss: '바나나' } }, known: {}, history: [], phrases: {} }),
    );
    const data = loadData(dir);
    assert.equal(data.words.saved.banana?.gloss, '바나나');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('db가 깨졌으면 export-scraps는 아무것도 지우지 않고 종료 코드 1', () => {
  const dataDir = createTempDir('readgloss-data-');
  const outDir = createTempDir('readgloss-out-');
  try {
    // 1. 정상 JSON 데이터로 먼저 내보내기 실행
    writeFileSync(join(dataDir, 'words.json'), JSON.stringify({ saved: {}, known: {}, history: [], phrases: {} }));
    writeFileSync(join(dataDir, 'mydict.json'), JSON.stringify({ entries: {} }));
    writeFileSync(
      join(dataDir, 'scraps.json'),
      JSON.stringify({
        v: 1,
        scraps: {
          s1: {
            id: 's1',
            url: 'https://example.com',
            title: '테스트 문서',
            quote: { exact: '인용문' },
            ts: Date.now(),
          },
        },
      }),
    );

    const scriptPath = resolve('scripts/export-scraps.mjs');
    const initRes = spawnSync(process.execPath, [scriptPath, '--data', dataDir, '--to', outDir], {
      encoding: 'utf8',
    });
    assert.equal(initRes.status, 0, `정상 export-scraps가 실패했습니다: ${initRes.stderr}`);

    const filesBefore = readdirSync(outDir);
    assert(filesBefore.length > 0, '내보낸 문서가 생성되어야 합니다.');

    // 2. db 파일을 깨뜨림
    writeFileSync(join(dataDir, 'readgloss.db'), '깨진 db 데이터');

    // 3. 다시 실행 -> status 1, 파일 유지
    const failRes = spawnSync(process.execPath, [scriptPath, '--data', dataDir, '--to', outDir], {
      encoding: 'utf8',
    });
    assert.equal(failRes.status, 1, `깨진 db일 때 종료 코드가 1이어야 합니다. status: ${failRes.status}`);

    const filesAfter = readdirSync(outDir);
    assert.deepEqual(filesAfter, filesBefore, '깨진 db일 때 기존 문서가 지워지거나 변경되지 않아야 합니다.');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('db가 깨졌으면 export-pending은 종료 코드 1', () => {
  const dataDir = createTempDir('readgloss-pending-');
  try {
    writeFileSync(join(dataDir, 'readgloss.db'), '깨진 db 데이터');

    const scriptPath = resolve('scripts/export-pending.mjs');
    const res = spawnSync(process.execPath, [scriptPath, '--data', dataDir], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 1, `깨진 db일 때 종료 코드가 1이어야 합니다. status: ${res.status}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('깨진 db 파일이 있으면 createBridge는 던진다', () => {
  const dir = createTempDir();
  try {
    const dbFile = join(dir, 'readgloss.db');
    writeFileSync(dbFile, '깨진 sqlite 데이터');

    const dummyDict = { close() {}, lookup: async () => ({ found: false }) };
    const dummyMt = { close() {}, translate: async () => '' };

    assert.throws(
      () =>
        createBridge({
          cacheFile: join(dir, 'cache.json'),
          tokenFile: join(dir, 'token'),
          dbFile,
          extensionId: 'test',
          dict: dummyDict,
          mt: dummyMt,
        }),
      (err) => {
        assert(err instanceof Error);
        const expectedMsg = `readgloss.db 를 열 수 없어요: ${dbFile} — 백업에서 되살리거나 파일을 옮긴 뒤 다시 시작하세요`;
        assert.equal(err.message, expectedMsg);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('db 파일이 없고 열 수 없는 경로면 JSON으로 계속', async () => {
  const dir = createTempDir();
  try {
    // 보통 파일 아래 경로라 폴더를 만들 수 없다 → 열기 불가 (openDb 는 없는 폴더는 만든다)
    writeFileSync(join(dir, 'not-a-dir'), 'x');
    const dbFile = join(dir, 'not-a-dir', 'readgloss.db');
    assert.equal(existsSync(dbFile), false);

    const dummyDict = { close() {}, lookup: async () => ({ found: false }) };
    const dummyMt = { close() {}, translate: async () => '' };

    const bridge = createBridge({
      cacheFile: join(dir, 'cache.json'),
      tokenFile: join(dir, 'token'),
      dbFile,
      extensionId: 'test',
      dict: dummyDict,
      mt: dummyMt,
    });

    assert.ok(bridge, '다리가 생성되어야 합니다');
    assert.equal(bridge.db, null, 'db가 열리지 않아 null이어야 합니다');
    await bridge.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
