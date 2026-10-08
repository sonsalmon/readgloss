import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isValidDateStr, markDay } from '../scripts/export-mark.mjs';

// T25 fix E: 없는 날짜는 거절한다
test('isValidDateStr: 없는 날짜(2026-02-31)는 거절, 윤년은 허용', () => {
  assert.equal(isValidDateStr('2026-02-31'), false);
  assert.equal(isValidDateStr('2026-02-29'), false);
  assert.equal(isValidDateStr('2026-04-31'), false);
  assert.equal(isValidDateStr('2024-02-29'), true);
  assert.equal(isValidDateStr('2026-10-08'), true);
});

test('markDay: 없는 날짜는 throw 하고 export-state.json 을 쓰지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readgloss-mark-test-'));
  try {
    assert.throws(() => markDay('2026-02-31', dir));
    assert.equal(existsSync(join(dir, 'export-state.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
