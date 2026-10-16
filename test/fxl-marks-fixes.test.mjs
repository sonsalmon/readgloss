import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/saved-marks-core.js');

const core = globalThis.readglossSavedMarksCore;
const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('formsOf: 역방향 끝말 빼기 없음 (bed·used·news·seed에서 be·us·new·see 제외)', () => {
  const bedForms = core.formsOf('bed');
  assert.ok(!bedForms.includes('be'), 'bed에서 be가 나오지 않아야 한다');

  const usedForms = core.formsOf('used');
  assert.ok(!usedForms.includes('us'), 'used에서 us가 나오지 않아야 한다');

  const newsForms = core.formsOf('news');
  assert.ok(!newsForms.includes('new'), 'news에서 new가 나오지 않아야 한다');

  const seedForms = core.formsOf('seed');
  assert.ok(!seedForms.includes('see'), 'seed에서 see가 나오지 않아야 한다');
});

test('formsOf: 순방향 활용형 생성 (run->running/runs, study->studies/studied)', () => {
  const runForms = core.formsOf('run');
  assert.ok(runForms.includes('running'), 'run에서 running이 포함되어야 한다');
  assert.ok(runForms.includes('runs'), 'run에서 runs가 포함되어야 한다');

  const studyForms = core.formsOf('study');
  assert.ok(studyForms.includes('studies'), 'study에서 studies가 포함되어야 한다');
  assert.ok(studyForms.includes('studied'), 'study에서 studied가 포함되어야 한다');
});

test('소스 검사: scrap.js memoBox.append(memoInput), 메모 칸 열림 중 Tab 인용 안 함, 250ms dblclick 취소, 할 일 제목 및 scraps get', () => {
  const src = read('scrap.js');

  // memoBox.append(memoInput)
  assert.match(src, /memoBox\.append\(\s*memoInput\s*\)/, 'memoBox.append(memoInput)이 있어야 한다');

  // 메모 칸 열려 있는 동안은 Tab 인용 안 함
  assert.match(src, /isMemoBoxOpen/, '메모 칸 열림 상태 변수(isMemoBoxOpen)가 있어야 한다');
  assert.match(src, /if\s*\(\s*isMemoBoxOpen\s*\)\s*return/, '메모 칸 열림 중 Tab 시 attachQuote/closeCard를 건너뛰어야 한다');

  // 250ms dblclick 취소
  assert.match(src, /250/, '250ms 대기 타이머가 있어야 한다');
  assert.match(src, /dblclick/, 'dblclick 리스너가 등록되어 있어야 한다');
  assert.match(src, /clearTimeout/, 'dblclick 시 타이머 취소가 있어야 한다');

  // 할 일 제목 및 scraps get 최신 메모/할 일 갱신
  assert.match(src, /chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*['"]scraps['"]\s*,\s*op:\s*['"]get['"]/, '카드 열 때 scraps op:get으로 최신 메모와 할 일을 조회해야 한다');
  assert.match(src, /tasks/, '할 일 제목 조회를 위한 tasks 객체를 사용해야 한다');
});

test('소스 검사: saved-marks.js 목록 도착 시 retrack 및 응답 전 훑기 방지', () => {
  const src = read('saved-marks.js');

  // formMap 초기값 null 및 onIntersect에서 응답 전 훑기 방지
  assert.match(src, /let\s+formMap\s*=\s*null/, '단어장 응답 전 formMap 초기값은 null이어야 한다');
  assert.match(src, /if\s*\(\s*!formMap\s*\)\s*return/, 'onIntersect에서 formMap이 null이면 건너뛰어야 한다');

  // 목록 도착 시 또는 바뀔 때 retrack
  assert.match(src, /retrack/, '블록 retrack 호출이 있어야 한다');
  assert.match(src, /readgloss:words/, 'readgloss:words 이벤트 리스너가 있어야 한다');
});

test('소스 검사: memo-pad.js isCardOpen 및 getActiveKind에 scrap-card와 struct-card 등록', () => {
  const src = read('memo-pad.js');

  // isCardOpen 목록 검사
  const isCardOpenMatch = src.match(/function\s+isCardOpen\s*\(\)\s*\{[\s\S]*?const\s+cardSelectors\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(isCardOpenMatch, 'isCardOpen 함수와 cardSelectors가 있어야 한다');
  const cardSelectorsText = isCardOpenMatch[1];
  assert.match(cardSelectorsText, /['"]readgloss-scrap-card['"]/, 'isCardOpen cardSelectors에 readgloss-scrap-card가 포함되어야 한다');
  assert.match(cardSelectorsText, /['"]readgloss-struct-card['"]/, 'isCardOpen cardSelectors에 readgloss-struct-card가 포함되어야 한다');

  // getActiveKind otherHostTags 목록 검사
  const getActiveKindMatch = src.match(/function\s+getActiveKind\s*\([\s\S]*?const\s+otherHostTags\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(getActiveKindMatch, 'getActiveKind 함수와 otherHostTags가 있어야 한다');
  const otherHostTagsText = getActiveKindMatch[1];
  assert.match(otherHostTagsText, /['"]readgloss-scrap-card['"]/, 'getActiveKind otherHostTags에 readgloss-scrap-card가 포함되어야 한다');
  assert.match(otherHostTagsText, /['"]readgloss-struct-card['"]/, 'getActiveKind otherHostTags에 readgloss-struct-card가 포함되어야 한다');
});
