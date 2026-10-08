import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingDays, exportPending } from '../scripts/export-pending.mjs';
import { markDay } from '../scripts/export-mark.mjs';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'readgloss-pending-test-'));
}

test('처음 값으로 10-07·10-08 포함, 기록 없는 날 제외', () => {
  const dir = createTempDir();
  try {
    // 10-05 (10-06 이전), 10-07, 10-08에 해당하는 타임스탬프 (로컬 시간 기준)
    const t1005 = new Date('2026-10-05T12:00:00').getTime();
    const t1007 = new Date('2026-10-07T12:00:00').getTime();
    const t1008 = new Date('2026-10-08T15:00:00').getTime();

    // words.json: saved 에 10-07
    writeFileSync(
      join(dir, 'words.json'),
      JSON.stringify({
        v: 1,
        saved: {
          exploit: { word: 'exploit', gloss: '착취하다', ts: t1007 },
        },
        phrases: {},
      })
    );

    // scraps.json: scraps 에 10-05(이전), 10-08
    writeFileSync(
      join(dir, 'scraps.json'),
      JSON.stringify({
        v: 1,
        scraps: {
          s1: { id: 's1', url: 'https://example.com/old', quote: { exact: 'old' }, ts: t1005 },
          s2: { id: 's2', url: 'https://example.com/new', quote: { exact: 'new' }, ts: t1008 },
        },
      })
    );

    // export-state.json 없음 -> 기본 lastDay '2026-10-06'
    const days = pendingDays(dir, '2026-10-08');
    assert.deepEqual(days, ['2026-10-07', '2026-10-08']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mark 2026-10-07 뒤엔 10-08만', () => {
  const dir = createTempDir();
  try {
    const t1007 = new Date('2026-10-07T12:00:00').getTime();
    const t1008 = new Date('2026-10-08T15:00:00').getTime();

    writeFileSync(
      join(dir, 'words.json'),
      JSON.stringify({
        saved: { w1: { ts: t1007 } },
        phrases: {},
      })
    );
    writeFileSync(
      join(dir, 'scraps.json'),
      JSON.stringify({
        scraps: { s1: { ts: t1008 } },
      })
    );

    // markDay 실행
    markDay('2026-10-07', dir);

    // export-state.json 검증
    const state = JSON.parse(readFileSync(join(dir, 'export-state.json'), 'utf8'));
    assert.equal(state.lastDay, '2026-10-07');

    const days = pendingDays(dir, '2026-10-08');
    assert.deepEqual(days, ['2026-10-08']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export-pending CLI 출력 포맷: exportDay 결과 및 스크랩 요약 줄', () => {
  const dir = createTempDir();
  try {
    const t1007 = new Date('2026-10-07T12:00:00').getTime();

    writeFileSync(
      join(dir, 'words.json'),
      JSON.stringify({
        saved: { exploit: { word: 'exploit', gloss: '악용하다', ts: t1007 } },
        phrases: {},
      })
    );
    writeFileSync(
      join(dir, 'scraps.json'),
      JSON.stringify({
        scraps: {
          s1: { id: 's1', task: 'S1-04', url: 'https://a.com/1', quote: { exact: 'e1' }, ts: t1007 },
          s2: { id: 's2', task: 'S1-04', url: 'https://a.com/2', quote: { exact: 'e2' }, ts: t1007 },
          s3: { id: 's3', task: null, url: 'https://a.com/3', quote: { exact: 'e3' }, ts: t1007 },
        },
      })
    );

    const out = exportPending(dir, '2026-10-07');
    assert.match(out, /### 2026-10-07/);
    assert.match(out, /## 영어 표현 \(readgloss\)/);
    assert.match(out, /스크랩 2개 → scraps\/S1-04\.md/);
    assert.match(out, /스크랩 1개 → scraps\/inbox\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mark 잘못된 날짜 형식은 거부', () => {
  const dir = createTempDir();
  try {
    assert.throws(() => markDay('invalid-date', dir), /날짜 형식/);
    assert.throws(() => markDay('2026-1-1', dir), /날짜 형식/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
