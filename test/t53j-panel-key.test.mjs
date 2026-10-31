// 과제 T53j(변경 기록 28-13): / 로 패널을 열고 닫으며, 패널 알림으로 영상을 멈추고('panel' 이유) 닫을 때 푼다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;
const panelSrc = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
const subsSrc = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
const block = (src, start, end) => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, `소스에서 ${start} 를 찾는다`);
  return src.slice(at, src.indexOf(end, at));
};

test('Slash 는 패널 키이고 Shift+/ 는 아니다', () => {
  assert.equal(V.KEYS.Slash, 'panel');
  assert.equal(V.keyAction({ code: 'Slash', key: '/' }), 'panel');
  assert.equal(V.keyAction({ code: 'Slash', key: '?', shiftKey: true }), null);
});

test('panel.js: 열 때 open:true, 닫을 때 open:false 를 readgloss:panel { open, tab } 로 알린다', () => {
  assert.match(panelSrc, /function announcePanel\(open\) \{\s*window\.dispatchEvent\(new CustomEvent\('readgloss:panel', \{ detail: \{ open, tab: selected \} \}\)\);\s*\}/);
  const open = block(panelSrc, 'function openPanel(id)', 'function closePanel(');
  assert.ok(open.indexOf('selectTab(id ?? selected);') < open.indexOf('announcePanel(true);'), '탭을 고른 뒤 알린다(detail.tab 에 그 탭이 담긴다)');
  const close = block(panelSrc, 'function closePanel(', 'if (restoreFocus && document.activeElement === host)');
  assert.ok(close.indexOf('announcePanel(false);') > close.indexOf('if (!isOpen) return;'), '열려 있을 때만 닫힘을 알린다');
});

test('panel.js: 닫기 알림(readgloss:close-panel)을 받으면 패널을 닫는다', () => {
  assert.match(panelSrc, /window\.addEventListener\('readgloss:close-panel', \(\) => closePanel\(\)\);/);
});

test('video-subs.js: readgloss:panel 을 받아 열림 상태를 남기고, 재생 중일 때만 holdOn(\'panel\'), 닫으면 holdOff(\'panel\')', () => {
  const listener = block(subsSrc, "window.addEventListener('readgloss:panel'", '// 멈춘 이유');
  assert.match(listener, /S\.panelOpen = e\.detail\?\.open === true;/);
  assert.match(listener, /if \(video && !video\.paused\) holdOn\('panel'\);/);
  assert.match(listener, /else holdOff\('panel'\);/);
});

test('video-subs.js: / 는 닫혀 있으면 [영상] 탭으로 열고, 열려 있으면 닫기 알림을 보낸다', () => {
  const run = block(subsSrc, 'function run(act', '// 구간 반복(28-1)');
  assert.match(run, /if \(act === 'panel'\) \{/);
  assert.match(run, /if \(S\.panelOpen\) window\.dispatchEvent\(new CustomEvent\('readgloss:close-panel'\)\);/);
  assert.match(run, /else window\.dispatchEvent\(new CustomEvent\('readgloss:open-panel', \{ detail: \{ tab: 'video' \} \}\)\);/);
  assert.match(run, /if \(act === 'panel'\) \{[\s\S]*?\n      return;\n    \}/, '패널 키는 다른 동작으로 흘러가지 않는다');
});

test('video-subs.js: 패널이 열려 포커스가 그 안에 있어도 / 로 닫되, 입력칸 안에서는 타이핑을 지킨다', () => {
  const keys = block(subsSrc, "const act = V.keyAction(e);", '  }, true);');
  assert.match(keys, /if \(act === 'panel' && S\.panelOpen\) \{/);
  assert.match(keys, /Sel\.isTypingPath\(e\.composedPath\(\), e\.isComposing\)/);
  assert.ok(keys.indexOf("if (act === 'panel' && S.panelOpen)") < keys.indexOf('if (keyBlocked(e)) return;'), '다른 화면 키 막힘보다 먼저 본다');
  assert.match(keys, /run\(act\);/);
});
