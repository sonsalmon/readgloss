import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 1. shouldSendSeen 경우별 시험
test('shouldSendSeen 순수 함수 판정 규칙 검증', async () => {
  await import('../extension/concept.js');
  const conceptPage = globalThis.readglossConceptPage;
  assert.ok(conceptPage, 'readglossConceptPage가 노출되어야 함');
  assert.equal(typeof conceptPage.shouldSendSeen, 'function', 'shouldSendSeen이 함수로 노출되어야 함');
  const { shouldSendSeen } = conceptPage;

  // (a) 새 개념을 만들 때(isNew: true) -> seen 전송 (true)
  assert.equal(shouldSendSeen({ isNew: true }), true);
  assert.equal(shouldSendSeen({ isNew: true, hasRange: false, hasSentence: false }), true);
  assert.equal(shouldSendSeen({ isNew: true, hasRange: true, hasSentence: false }), true);
  assert.equal(shouldSendSeen({ isNew: true, hasRange: false, hasSentence: true }), true);
  assert.equal(shouldSendSeen({ isNew: true, hasRange: true, hasSentence: true }), true);

  // (b) 기존 개념을 고칠 때(isNew: false)
  // 고른 글 범위나 문장이 있는 경우 -> seen 전송 (true)
  assert.equal(shouldSendSeen({ isNew: false, hasRange: true, hasSentence: false }), true);
  assert.equal(shouldSendSeen({ isNew: false, hasRange: false, hasSentence: true }), true);
  assert.equal(shouldSendSeen({ isNew: false, hasRange: true, hasSentence: true }), true);

  // 고른 글 범위도 문장도 없는 경우 (예: "지금 쓰기", 패널에서 고치기) -> seen 미전송 (false, 다리가 옛 값 유지)
  assert.equal(shouldSendSeen({ isNew: false, hasRange: false, hasSentence: false }), false);
  assert.equal(shouldSendSeen({ isNew: false }), false);

  // 기본값 및 인자 없음
  assert.equal(shouldSendSeen({}), false);
  assert.equal(shouldSendSeen(), false);
  assert.equal(shouldSendSeen(null), false);
});

// 2. headingsFor 상한 검사 (201자→200자, 4개→3개)
test('clampHeadings 상한: 소제목 하나 200자(끝 공백 정리), 최대 3개', async () => {
  await import('../extension/selection-core.js');
  const { clampHeadings } = globalThis.readglossSelection;
  const long201 = 'A'.repeat(199) + ' B';
  assert.deepEqual(clampHeadings(['H1', 'H2', 'H3', long201]).map((h) => h.length), [2, 2, 199]);
  assert.deepEqual(clampHeadings(['x'.repeat(250)]), ['x'.repeat(200)]);
  assert.deepEqual(clampHeadings(null), []);
  const selSrc = readFileSync(join(rootDir, 'extension', 'selection.js'), 'utf8');
  assert.match(selSrc, /core\.clampHeadings\(/);
});

// 3. 소스 검사: panel-scraps 내 개념으로가 스크랩 url을 seed에 씀
test('소스 검사: extension/panel-scraps.js가 스크랩 url·title·quote.exact·headings를 seed에 포함', () => {
  const scrapsSrc = readFileSync(join(rootDir, 'extension', 'panel-scraps.js'), 'utf8');

  // openForm 호출 부분에서 url, title, sentence, headings가 item으로부터 전달되는지 검사
  assert.ok(scrapsSrc.includes('url: item.url'), 'openForm seed에 url: item.url이 있어야 함');
  assert.ok(scrapsSrc.includes('title: item.title'), 'openForm seed에 title: item.title이 있어야 함');
  assert.ok(
    scrapsSrc.includes('sentence: item.quote?.exact') || scrapsSrc.includes('sentence: item.quote.exact'),
    'openForm seed에 스크랩 quote.exact가 sentence로 전달되어야 함',
  );
  assert.ok(
    scrapsSrc.includes('headings: item.headings'),
    'openForm seed에 headings: item.headings가 전달되어야 함',
  );
});

// 4. 소스 검사: opacity 목록에 readgloss-panel 없음
test('소스 검사 및 런타임 검사: extension/opacity.js의 HOST_TAGS에 readgloss-panel이 없음', async () => {
  const opacitySrc = readFileSync(join(rootDir, 'extension', 'opacity.js'), 'utf8');

  // 소스 상에 HOST_TAGS 내 'readgloss-panel'이 없어야 함
  assert.ok(!opacitySrc.includes("'readgloss-panel'"), "opacity.js에 'readgloss-panel'이 포함되지 않아야 함");

  // 런타임 모듈 검사
  await import('../extension/opacity.js');
  const opacity = globalThis.readglossOpacity;
  assert.ok(opacity, 'readglossOpacity가 노출되어야 함');
  assert.ok(!opacity.HOST_TAGS.includes('readgloss-panel'), 'HOST_TAGS에 readgloss-panel이 없어야 함');
  assert.ok(!opacity.HOST_SELECTOR.includes('readgloss-panel'), 'HOST_SELECTOR에 readgloss-panel이 없어야 함');
});
