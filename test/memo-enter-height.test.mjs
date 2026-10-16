import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../extension/memo-pad.js', import.meta.url), 'utf8');

test('메모장 Enter: autoResize 는 이벤트가 끝난 뒤 e.target 을 다시 읽지 않는다(host 높이가 auto 로 망가지던 버그)', () => {
  assert.ok(!/setTimeout\(\(\) => autoResize\(e\.target\)/.test(src));
  assert.match(src, /const ta = e\.target;\s*\n\s*if \(ta\?\.classList\?\.contains\('sec-textarea'\)\) setTimeout\(\(\) => autoResize\(ta\), 0\);/);
});

test('autoResize 는 TEXTAREA 가 아니면 아무것도 바꾸지 않는다', () => {
  assert.match(src, /function autoResize\(ta\) \{\n\s*if \(!ta \|\| ta\.localName !== 'textarea'\) return;/);
});

test('글을 고른 채 Tab: shouldTabQuote 판정과 handleMemoOpen 연결', async () => {
  globalThis.window = globalThis;
  await import('../extension/memo-core.js');
  const { shouldTabQuote } = globalThis.readglossMemo;
  const base = { key: 'Tab', shift: false, alt: false, ctrl: false, meta: false, composing: false, hasSelection: true, pageField: false, inOurUi: false };
  assert.equal(shouldTabQuote(base), true);
  assert.equal(shouldTabQuote({ ...base, hasSelection: false }), false, '고른 글 없으면 원래 Tab');
  assert.equal(shouldTabQuote({ ...base, shift: true }), false, 'Shift+Tab 은 그대로');
  assert.equal(shouldTabQuote({ ...base, pageField: true }), false, '입력칸 안 Tab 은 그대로');
  assert.equal(shouldTabQuote({ ...base, inOurUi: true }), false, '우리 화면 안 Tab 은 그대로');
  assert.equal(shouldTabQuote({ ...base, composing: true }), false);
  assert.match(src, /if \(!ok\) return;\s*\n\s*e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);\s*\n\s*handleMemoOpen\(\{ scrap: true \}\);/);
});
