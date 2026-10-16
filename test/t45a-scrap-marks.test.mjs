import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/scrap-core.js');

const core = globalThis.readglossScrap;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('scrapHitAt: 단일 사각형 안·밖 판정', () => {
  const rectsById = new Map([
    ['scrap-1', [{ left: 10, top: 20, right: 110, bottom: 60 }]],
  ]);

  // 안
  assert.equal(core.scrapHitAt(rectsById, 50, 40), 'scrap-1');
  // 경계
  assert.equal(core.scrapHitAt(rectsById, 10, 20), 'scrap-1');
  assert.equal(core.scrapHitAt(rectsById, 110, 60), 'scrap-1');

  // 밖
  assert.equal(core.scrapHitAt(rectsById, 9, 40), null);
  assert.equal(core.scrapHitAt(rectsById, 111, 40), null);
  assert.equal(core.scrapHitAt(rectsById, 50, 19), null);
  assert.equal(core.scrapHitAt(rectsById, 50, 61), null);

  // 빈 데이터 또는 잘못된 좌표
  assert.equal(core.scrapHitAt(new Map(), 50, 40), null);
  assert.equal(core.scrapHitAt(null, 50, 40), null);
  assert.equal(core.scrapHitAt(rectsById, null, 40), null);
});

test('scrapHitAt: 여러 사각형(줄바꿈) 판정', () => {
  const rectsById = new Map([
    [
      'scrap-multiline',
      [
        { left: 100, top: 10, right: 300, bottom: 30 }, // 첫 줄
        { left: 20, top: 35, right: 280, bottom: 55 },  // 둘째 줄
        { left: 20, top: 60, right: 150, bottom: 80 },  // 셋째 줄
      ],
    ],
  ]);

  // 첫 줄 안
  assert.equal(core.scrapHitAt(rectsById, 150, 20), 'scrap-multiline');
  // 둘째 줄 안
  assert.equal(core.scrapHitAt(rectsById, 50, 45), 'scrap-multiline');
  // 셋째 줄 안
  assert.equal(core.scrapHitAt(rectsById, 100, 70), 'scrap-multiline');

  // 줄 사이 빈 공간
  assert.equal(core.scrapHitAt(rectsById, 50, 32), null);
  // 첫 줄 왼쪽 빈 공간
  assert.equal(core.scrapHitAt(rectsById, 50, 20), null);
});

test('scrapHitAt: 겹침 판정 및 Map/객체 지원', () => {
  // scrap-a와 scrap-b가 일부 영역(x: 40~60, y: 40~60)에서 겹침
  const rectsById = new Map([
    ['scrap-a', [{ left: 10, top: 10, right: 60, bottom: 60 }]],
    ['scrap-b', [{ left: 40, top: 40, right: 100, bottom: 100 }]],
  ]);

  // a 전용 영역
  assert.equal(core.scrapHitAt(rectsById, 20, 20), 'scrap-a');
  // b 전용 영역
  assert.equal(core.scrapHitAt(rectsById, 80, 80), 'scrap-b');
  // 겹침 영역: 순서상 먼저 등록된 scrap-a 반환
  assert.equal(core.scrapHitAt(rectsById, 50, 50), 'scrap-a');

  // 일반 객체 형태로 넘겼을 때도 동일하게 지원
  const plainObj = {
    'scrap-x': [{ left: 0, top: 0, right: 50, bottom: 50 }],
  };
  assert.equal(core.scrapHitAt(plainObj, 25, 25), 'scrap-x');
  assert.equal(core.scrapHitAt(plainObj, 60, 60), null);
});

test('소스 검사: scrap.js rgba 색 변경 및 글자색(color) 미정의', () => {
  const src = read('scrap.js');

  // 23-1 스크랩 rgba(250, 204, 21, .28), 깜빡임 rgba(250, 204, 21, .55)
  assert.match(
    src,
    /background-color:\s*rgba\(\s*250\s*,\s*204\s*,\s*21\s*,\s*\.?28\s*\)/,
    '스크랩 형광펜 배경색 rgba(250, 204, 21, .28) 확인',
  );
  assert.match(
    src,
    /background-color:\s*rgba\(\s*250\s*,\s*204\s*,\s*21\s*,\s*\.?55\s*\)/,
    '스크랩 깜빡임 배경색 rgba(250, 204, 21, .55) 확인',
  );

  // ensureStyle 내부에서 글자색(color)을 정하지 않음
  const styleMatch = src.match(/function\s+ensureStyle\s*\(\)\s*\{([\s\S]*?)\}/);
  assert.ok(styleMatch, 'ensureStyle 함수 존재');
  assert.doesNotMatch(styleMatch[1], /color\s*:/, 'ensureStyle 내부에 color 스타일이 없어야 함');
});

test('소스 검사: scrap.js readgloss-scrap-card 및 attachQuote 계약 호출', () => {
  const src = read('scrap.js');

  // shadow host 이름 readgloss-scrap-card (closed)
  assert.match(src, /readgloss-scrap-card/, 'readgloss-scrap-card 호스트 태그 사용');
  assert.match(src, /attachShadow\(\s*\{\s*mode:\s*['"]closed['"]\s*\}\s*\)/, 'closed shadow DOM 모드 사용');

  // 계약: globalThis.readglossMemoPad?.attachQuote({exact, prefix, suffix}, range.startContainer)
  assert.match(src, /readglossMemoPad\?\.attachQuote/, 'globalThis.readglossMemoPad?.attachQuote 호출');
  assert.match(src, /exact/, 'quote 객체에 exact 포함');
  assert.match(src, /startContainer/, 'anchorNode로 range.startContainer 전달');
});

test('소스 검사: scrap.js Tab 처리 조건, alt 링크, Esc 표시 및 밖 클릭 닫기', () => {
  const src = read('scrap.js');

  // Tab 처리 조건: Shift 및 조합키 없음, 입력칸 아님, preventDefault
  assert.match(src, /e\.key\s*===\s*['"]Tab['"]/, 'Tab 키 확인');
  assert.match(src, /shiftKey/, 'shiftKey 검사');
  assert.match(src, /preventDefault/, 'Tab 처리 시 preventDefault 호출');

  // 링크 안이면 alt 클릭일 때만 허용
  assert.match(src, /a\[href\]/, 'a[href] 링크 확인');
  assert.match(src, /altKey/, 'altKey 조합 확인');

  // Esc 표시: e.readglossCardClosed 검사 및 세우기
  assert.match(src, /readglossCardClosed/, 'e.readglossCardClosed 확인 및 설정');

  // 밖 클릭으로 닫힘
  assert.match(src, /mousedown/, 'mousedown 리스너 확인');
});
