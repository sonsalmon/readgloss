import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start } from '../fixtures/bridge-harness.mjs';

// T22 수정 배선 시험: 전체 번역 메뉴 판단, 페이지가 못 부르는 전역 API, 실패 3연속 멈춤, 꺼진 페이지 안내,
// 확인 메시지 메모(Enter 판정·Esc 예외·다시 읽기), 드래그 카드는 공부 기록에 안 남김(nolog).
// 순수 로직(bulkStep·pageTranslateMenu·lookupExtras)은 각자 시험 파일이 보고, 여기서는 파일 사이 배선을 소스로 고정한다.
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('T22-1 paragraph.js: window 이벤트 대신 readglossPageTranslate 전역으로 내보내고 상태는 onStatus 로 알린다', () => {
  const src = read('paragraph.js');
  assert.match(src, /globalThis\.readglossPageTranslate\s*=\s*\{/, '전역 API 를 내보낸다');
  assert.match(src, /start: \(\) => startPageTranslate\(\)/);
  assert.match(src, /stop: stopPageTranslate/);
  assert.match(src, /clear: clearPageTranslate/);
  assert.match(src, /state: \(\) => \(\{ \.\.\.bulkState \}\)/);
  assert.match(src, /onStatus\(cb\)/);
  assert.doesNotMatch(src, /addEventListener\('readgloss:pagetranslate'/, '페이지 스크립트가 못 켜게 window 이벤트는 없앤다');
  assert.doesNotMatch(src, /readgloss:pagetranslate-status/, '상태도 window 이벤트로 보내지 않는다');
});

test('T22-1 panel.js: 전체 번역 메뉴는 readglossPageTranslate 를 직접 부르고, 메뉴를 열 때 문구를 다시 계산한다', () => {
  const src = read('panel.js');
  assert.match(src, /const ptApi = \(\) => globalThis\.readglossPageTranslate/);
  assert.match(src, /C\.pageTranslateMenu\(ptState\)/);
  assert.match(src, /C\.pageTranslateAction\(ptState\)/);
  assert.match(src, /applyPtState\(api\.state\?\.\(\) \?\? \{\}\)/);
  assert.match(src, /api\.onStatus\?\.\(applyPtState\)/);
  assert.doesNotMatch(src, /readgloss:pagetranslate'/, 'window 이벤트를 보내지 않는다');
  assert.doesNotMatch(src, /document\.querySelector\('readgloss-translation'\)/, '손으로 번역한 문단이 메뉴 상태를 흔들지 않는다');
  // T39: 메뉴는 openQuickMenu 로 열고(마우스 들어올 때), 열 때 문구를 다시 계산한다
  assert.match(src.slice(src.indexOf('function openQuickMenu')), /^function openQuickMenu\(\) \{[\s\S]*?syncPageTranslate\(\);/);
  assert.match(src, /dock\.addEventListener\('focusin', \(\) => \{\s*syncPageTranslate\(\);/); // 키보드로 열 때도
});

test('T22-3 paragraph.js: clear 는 진행 중이면 먼저 확실히 멈추고 상태 객체를 새로 만들지 않는다', () => {
  const src = read('paragraph.js');
  const clear = src.slice(src.indexOf('function clearPageTranslate'));
  assert.match(clear, /bulkGen\+\+/, '진행 중 결과가 되살아나지 않게 세대를 올린다');
  assert.match(clear, /bulkState\.abort = true/);
  assert.ok(clear.indexOf('bulkState.abort = true') < clear.indexOf('resetBulk()'), '멈춤 표시 뒤에 상태를 비운다');
  assert.equal((src.match(/bulkState = \{/g) ?? []).length, 1, '상태 객체는 선언 한 곳에서만 만든다(루프가 같은 객체를 본다)');
  assert.match(src, /stale: \(\) => gen !== bulkGen/, '늦게 온 옛 결과를 버린다');
});

test('T22-4·5·6 paragraph.js: bulkStep 으로 실패 3연속을 멈추고, loading 문단은 건너뛰며, 꺼짐은 blocked 안내를 낸다', () => {
  const src = read('paragraph.js');
  assert.match(src, /const step = core\.bulkStep\(bulkState, res\)/);
  assert.match(src, /if \(step === 'stop'\) break/);
  assert.match(src, /rq\?\.status === 'loading' && \(rq\.gen == null \|\| rq\.gen === gen\)\) continue/, '손 번역 중(옛 실행 아님)이면 건너뛴다');
  assert.match(src, /function showBlocked\(\)/);
  assert.match(src, /const BLOCKED_MS = 2000/);
  assert.match(src, /blocked: bulkState\.blocked/);
  assert.match(src, /if \(!allowed\(\) \|\| pageOff\) return showBlocked\(\)/);
});

test('T22-7 panel-words.js: 패널 메모 입력칸 Enter 판정도 memoKey 를 쓴다(한글 조합 중 Enter 무시)', () => {
  const src = read('panel-words.js');
  assert.match(src, /if \(W\.memoKey\(e\) === 'save'\)/);
  // 메모 입력칸 Enter 한 곳(memoKey 판정 바로 뒤) + T44c 복습 단축키 4곳 + T51d 복습 방식 키 1곳(계약 10 이 블록 범위를 따로 검사한다)
  assert.equal((src.match(/\.preventDefault\(/g) ?? []).length, 6, 'preventDefault 는 메모 입력칸 Enter 1 + 복습 단축키 5');
  assert.match(src, /if \(W\.memoKey\(e\) === 'save'\) \{\s*e\.preventDefault\(\)/, '메모 입력칸 Enter 의 preventDefault 는 memoKey 판정 안');
});

test('T22-7 content.js: 확인 메시지 메모 저장 성공이 readgloss:words 를 쏘고, Esc·바깥 클릭 예외가 배선됐다', () => {
  const content = read('content.js');
  assert.match(content, /window\.dispatchEvent\(new CustomEvent\('readgloss:words', \{ detail: \{ known: \[\], unknown: \[\] \} \}\)\)/);
  assert.match(content, /readgloss-toast/);
  const sel = read('selection.js');
  assert.match(sel, /e\.composedPath\(\)\.some\(\(n\) => n\.localName === 'readgloss-toast'\) && close\(\)/, '드래그 카드 Esc 가 메모 창을 무시한다');
  const panel = read('panel.js');
  assert.match(panel, /!C\.isToastPath\(path\)/, '바깥 클릭에서 메시지를 예외로 둔다');
  assert.match(panel, /!C\.isToastPath\(e\.composedPath\(\)\) && closePanel\(\)/, 'Esc 에서 메시지를 무시한다');
});

test('T22-8 배선: 드래그 카드는 nolog 로 흘러 서버가 dict 기록을 건너뛴다', () => {
  const sel = read('selection.js');
  assert.match(sel, /drag: true/);
  const content = read('content.js');
  assert.match(content, /current\.nolog === true \? \{ nolog: true \}/);
  assert.match(content, /globalThis\.readglossSelection\.lookupExtras\(d\)/);
  const bg = read('background.js');
  assert.match(bg, /nolog === true \? \{ nolog: true \}/);
  assert.match(bg, /return dict\(\{ word, host, domains, nolog, page \}, true\)/, '재시도에도 nolog 를 넘긴다');
  const server = readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /value\.nolog !== true && \(r\.found \|\| mine \|\| t \|\| acronym\)/);
});

const noon = () => new Date(2026, 9, 6, 12, 0, 0).getTime();

test('T22-8 다리: /dict nolog:true 는 공부 기록을 남기지 않고 응답은 그대로다', async () => {
  const s = await start({ start: noon() });
  try {
    const first = await s.post('/dict', { word: 'payload', nolog: true, page: { url: 'https://a.test/p' } });
    assert.equal(first.status, 200);
    assert.equal(first.json().found, true, 'nolog 라도 사전 답은 그대로 준다');
    assert.equal((await s.get('/study?days=1')).json().days[0].counts.dict, 0, '드래그 카드는 dict 기록 없음');
    await s.post('/dict', { word: 'payload', page: { url: 'https://a.test/p' } });
    assert.equal((await s.get('/study?days=1')).json().days[0].counts.dict, 1, '더블클릭(nolog 없음)은 기록한다');
  } finally {
    await s.close();
  }
});
