// 과제 T53z(변경 기록 28-7·28-18): 검증에서 나온 작은 문제 — Enter 반복·가린 낱말, 두 줄 낭독,
// 키보드 낱말 이동 멈춤, 쓰지 않는 reveal, 설정 안내, 말풍선 묻기 포커스·600자·실패 문구.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
const panelVideo = readFileSync(new URL('../extension/panel-video.js', import.meta.url), 'utf8');

test('두 줄 Enter: 가린 낱말은 줄 보기, 반복 키·진행 중 저장은 한 번만', () => {
  assert.match(src, /else if \(sp\.classList\.contains\('hid'\)\) pickWord\(sp\);/);
  assert.match(src, /else if \(!e\.repeat\) toggleWordAt\(ui\.wcur\);/);
  assert.match(src, /let wordSaving = false;/);
  assert.match(src, /async function toggleWordAt\(k\) \{\s*\n\s*if \(wordSaving\) return;/);
  assert.match(src, /wordSaving = true;[\s\S]*?finally \{\s*wordSaving = false;/);
});

test('두 줄 aria-label: 키보드 저장 모드가 켜졌을 때만 낱말 키(Enter·↓·Esc)를 읽는다', () => {
  assert.match(src, /const LINES_LABEL = 'readgloss 자막 — A 이전 줄 · S 이 줄 처음 · D 다음 줄 · R 문장 반복 · Q 구간 반복 · Z 느리게 · Shift 줄 저장 · W 키보드 저장 모드';/);
  assert.doesNotMatch(src.split('\n').find((line) => line.includes('const LINES_LABEL =')), /Enter 저장|↓ 자세히|Esc 재생/);
  assert.match(src, /const LINES_LABEL_FOCUS = `\$\{LINES_LABEL\} · ←→ 낱말 · Enter 저장 · ↓ 자세히 · Esc 재생`;/);
  assert.match(src, /lines\.setAttribute\('aria-label', LINES_LABEL\);/);
  assert.match(src, /ui\.lines\.setAttribute\('aria-label', v\.focusMode \? LINES_LABEL_FOCUS : LINES_LABEL\);/);
});

test('키보드 낱말 자리 이동은 hoverPause 설정과 따로 영상을 멈춘다', () => {
  assert.match(src, /function moveCursor\(k\) \{\s*\n\s*holdOn\('keys'\);/);
  assert.doesNotMatch(src, /if \(vs\(\)\.hoverPause\) holdOn\('keys'\)/);
  assert.match(src, /holdOff\('keys'\)/);
});

test('쓰지 않는 reveal 동작 분기는 없다', () => {
  assert.doesNotMatch(src, /act === 'reveal'/);
  assert.doesNotMatch(src, /if \(act === 'reveal'\)/);
});

test('설정 탭 줄마다 멈춤 안내에서 없앤 P 키 문구를 지운다', () => {
  assert.doesNotMatch(panel, /P 키로도 바꿔요/);
  assert.match(panel, /toggle\('video\.pauseEach', 'A 앞 줄 · S 이 줄 다시 · D 다음 줄\.'\)/);
});

test('말풍선을 다시 그려도 묻기 입력칸의 값·포커스·커서를 유지한다', () => {
  assert.match(src, /const qFocused = Boolean\(beforeQ && root\.activeElement === beforeQ\);/);
  assert.match(src, /const qStart = beforeQ\?\.selectionStart \?\? null;/);
  assert.match(src, /afterQ\.value = tip\.askText;/);
  assert.match(src, /if \(qFocused\) \{[\s\S]*?afterQ\.focus\(\{ preventScroll: true \}\);[\s\S]*?afterQ\.setSelectionRange\(qStart, qEnd\);/);
});

test('묻기는 selection 을 600자로 자르고 실패는 답 문구로 보여 준다', () => {
  assert.match(src, /const ASK_SELECTION_MAX = 600;/);
  assert.match(src, /const askSelection = \(text\) => String\(text \?\? ''\)\.slice\(0, ASK_SELECTION_MAX\);/);
  assert.match(src, /const askErrText = \(r\) => \(r\?\.error === 'ai-failed' \? ASK_FAIL : errText\(r, '답을 가져오지 못했어요'\)\);/);
  assert.match(src, /const ASK_FAIL = '답을 가져오지 못했어요\. 다시 시도해 주세요';/);
  assert.match(src, /send\(\{ type: 'ask', selection: askSelection\(cue\.text\), question, context: ctx \}\)/);
  assert.match(src, /send\(\{ type: 'ask', selection: askSelection\(cue\.text\), question: q, context: ctx \}\)/);
  assert.match(src, /else tip\.askError = askErrText\(r\);/);
  assert.match(panelVideo, /function errorText\(r, head, aiHead\) \{\s*\n\s*if \(r\?\.error === 'ai-failed' && aiHead\) return aiHead;/);
  assert.match(panelVideo, /errorText\(r, '답을 가져오지 못했어요', '답을 가져오지 못했어요\. 다시 시도해 주세요'\)/);
});
