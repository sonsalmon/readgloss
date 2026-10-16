import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

test('메모장 Enter: autoResize 는 이벤트가 끝난 뒤 e.target 을 다시 읽지 않는다(host 높이가 auto 로 망가지던 버그)', () => {
  assert.ok(!/setTimeout\(\(\) => autoResize\(e\.target\)/.test(src));
  assert.match(src, /const ta = e\.target;\s*\n\s*if \(ta\?\.classList\?\.contains\('sec-textarea'\)\) setTimeout\(\(\) => autoResize\(ta\), 0\);/);
});

test('autoResize 는 TEXTAREA 가 아니면 아무것도 바꾸지 않는다', () => {
  assert.match(src, /function autoResize\(ta\) \{\n\s*if \(!ta \|\| ta\.tagName !== 'TEXTAREA'\) return;/);
});
