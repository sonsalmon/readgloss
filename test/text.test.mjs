import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionIdFromKey } from '../bridge/ext-id.mjs';
import { readFileSync } from 'node:fs';

// extension/text.js 는 import/export 없는 classic script(content script 로 그대로 로드). 전역에 등록된 걸 쓴다.
await import('../extension/text.js');
const { isEnglishWord, cleanSelection, extractSentence, positionBubble, BLOCKED_SELECTOR } = globalThis.readgloss;

test('isEnglishWord: 영어 단어만 true', () => {
  for (const w of ['payload', 'Exploit', "don't", 'e-mail', 'it’s', 'TCP']) assert.ok(isEnglishWord(w), w);
  for (const w of ['취약점', '123', 'x86', 'CVE-2024', 'a', '', ' ', 'two words', 'TCP/IP', 'été', '--', 'a'.repeat(65)]) {
    assert.ok(!isEnglishWord(w), w);
  }
});

test('cleanSelection: 앞뒤 공백·문장부호를 벗기고 시작 위치를 돌려준다', () => {
  assert.deepEqual(cleanSelection('payload'), { word: 'payload', start: 0 });
  assert.deepEqual(cleanSelection('payload '), { word: 'payload', start: 0 });
  assert.deepEqual(cleanSelection('  "payload",'), { word: 'payload', start: 3 });
  assert.deepEqual(cleanSelection('(e-mail)'), { word: 'e-mail', start: 1 });
});

test('cleanSelection: 영어 단어가 아니면 null', () => {
  for (const s of ['취약점', '2024', '2fa', 'x86', 'foo bar', '', '   ', '...', 'a', 'CVE-2024-1', '한글word']) {
    assert.equal(cleanSelection(s), null, s);
  }
});

const text = 'The attacker sends a payload. Then the server mitigates it, e.g. by sanitizing input. Done!';
const at = (w) => [text.indexOf(w), w.length];

test('extractSentence: 단어가 든 문장 하나를 뽑는다', () => {
  assert.equal(extractSentence(text, ...at('payload')), 'The attacker sends a payload.');
  assert.equal(extractSentence(text, ...at('Then')), 'Then the server mitigates it, e.g. by sanitizing input.');
  assert.equal(extractSentence(text, ...at('Done')), 'Done!');
  assert.equal(extractSentence(text, ...at('The')), 'The attacker sends a payload.');
});

test('extractSentence: e.g. 같은 약어와 버전 숫자에서 끊지 않는다', () => {
  assert.equal(extractSentence(text, ...at('sanitizing')), 'Then the server mitigates it, e.g. by sanitizing input.');
  const v = 'Upgrade to version 2.4.1 now. It is fixed.';
  assert.equal(extractSentence(v, v.indexOf('version'), 7), 'Upgrade to version 2.4.1 now.');
});

test('extractSentence: 닫는 따옴표·줄바꿈·여러 공백은 정리한다', () => {
  const t = 'He said "stop."  Then\n  left   quickly.';
  assert.equal(extractSentence(t, t.indexOf('left'), 4), 'Then left quickly.');
  assert.equal(extractSentence(t, t.indexOf('stop'), 4), 'He said "stop."');
});

test('extractSentence: 끝 부호가 없으면 전체, 범위 밖 offset 도 죽지 않는다', () => {
  assert.equal(extractSentence('no terminator here', 3, 2), 'no terminator here');
  assert.equal(extractSentence('Hi there.', 999, 2), 'Hi there.');
  assert.equal(extractSentence('', 0, 0), '');
});

test('extractSentence: 너무 긴 문장은 단어 주변 300자로 줄인다', () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ') + ' end.';
  const off = long.indexOf('word100');
  const s = extractSentence(long, off, 7);
  assert.ok(s.length <= 300);
  assert.ok(s.includes('word100'));
});

test('positionBubble: 기본은 단어 아래, 공간이 없으면 위, 가로는 화면 안으로', () => {
  const vp = { width: 800, height: 600, scrollX: 0, scrollY: 0 };
  const size = { width: 200, height: 60 };
  assert.deepEqual(positionBubble({ rect: { left: 100, top: 100, bottom: 120 }, viewport: vp, size }), { left: 100, top: 126 });
  // 아래 공간이 모자라면 위로
  assert.deepEqual(positionBubble({ rect: { left: 100, top: 560, bottom: 580 }, viewport: vp, size }), { left: 100, top: 494 });
  // 오른쪽 끝이면 왼쪽으로 밀어 넣는다
  assert.equal(positionBubble({ rect: { left: 790, top: 100, bottom: 120 }, viewport: vp, size }).left, 592);
  // 왼쪽 음수도 보정
  assert.equal(positionBubble({ rect: { left: -50, top: 100, bottom: 120 }, viewport: vp, size }).left, 8);
  // 스크롤은 페이지 좌표로 더한다
  assert.deepEqual(
    positionBubble({ rect: { left: 100, top: 100, bottom: 120 }, viewport: { ...vp, scrollX: 10, scrollY: 1000 }, size }),
    { left: 110, top: 1126 },
  );
});

test('BLOCKED_SELECTOR: pre, code, input, textarea, contenteditable', () => {
  for (const s of ['pre', 'code', 'input', 'textarea', '[contenteditable]']) assert.ok(BLOCKED_SELECTOR.includes(s), s);
});

test('manifest 의 key 로 계산한 확장 ID 가 형식에 맞는다', () => {
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.match(extensionIdFromKey(m.key), /^[a-p]{32}$/);
});

test('manifest: MV3, 필요한 권한만, content script 순서(text.js 먼저)', () => {
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.name, 'readgloss');
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['http://127.0.0.1:47831/*']);
  assert.equal(m.background.service_worker, 'background.js');
  assert.deepEqual(m.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
  assert.equal(m.content_scripts[0].all_frames, false);
  assert.deepEqual(m.content_scripts[0].js.slice(0, 2), ['text.js', 'content.js']); // 뒤에 붙는 스크립트는 각자 시험한다
});
