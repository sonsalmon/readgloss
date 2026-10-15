// test/fxd-concept-merge.test.mjs
// 과제 FX-D: 409 exists 시 기존 개념에 합쳐서 다시 저장 (mergeConcept 및 handleSave 흐름 검사)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(rootDir, 'extension', rel), 'utf8');

// concept.js 는 IIFE 라서 node 에서 import 해도 DOM 을 건드리지 않는다. 순수 함수는 globalThis 로 꺼낸다.
await import('../extension/concept.js');
const { mergeConcept } = globalThis.readglossConceptPage;

// ---- 1. mergeConcept 순수 함수 시험 ----

test('mergeConcept: 옛 정의가 비면 새 정의로 설정된다', () => {
  const merged1 = mergeConcept({ definition: '' }, { definition: '새로운 설명입니다.' });
  assert.equal(merged1.definition, '새로운 설명입니다.');
  assert.equal(merged1.tooLong, false);

  const mergedNull = mergeConcept({ definition: null }, { definition: '새로운 설명입니다.' });
  assert.equal(mergedNull.definition, '새로운 설명입니다.');
  assert.equal(mergedNull.tooLong, false);

  const mergedWhitespace = mergeConcept({ definition: '   ' }, { definition: '새로운 설명입니다.' });
  assert.equal(mergedWhitespace.definition, '새로운 설명입니다.');
  assert.equal(mergedWhitespace.tooLong, false);
});

test('mergeConcept: 새 정의가 비면 옛 정의를 유지한다', () => {
  const merged = mergeConcept({ definition: '기존 설명입니다.' }, { definition: '' });
  assert.equal(merged.definition, '기존 설명입니다.');
  assert.equal(merged.tooLong, false);
});

test('mergeConcept: 둘 다 있으면 옛 정의 + 줄바꿈 + 새 정의로 합친다', () => {
  const merged = mergeConcept(
    { definition: '기존 설명입니다.' },
    { definition: '새로 추가된 설명입니다.' }
  );
  assert.equal(merged.definition, '기존 설명입니다.\n새로 추가된 설명입니다.');
  assert.equal(merged.tooLong, false);
});

test('mergeConcept: 같은 줄은 한 번만 들어간다 (줄 단위 중복 제거)', () => {
  const oldDef = '첫 번째 줄\n두 번째 줄';
  const newDef = '두 번째 줄\n세 번째 줄';
  const merged = mergeConcept({ definition: oldDef }, { definition: newDef });
  assert.equal(merged.definition, '첫 번째 줄\n두 번째 줄\n세 번째 줄');

  // 입력 내용 자체의 중복 줄도 한 번만 유지
  const mergedInnerDup = mergeConcept(
    { definition: '첫 번째 줄' },
    { definition: '두 번째 줄\n두 번째 줄\n세 번째 줄' }
  );
  assert.equal(mergedInnerDup.definition, '첫 번째 줄\n두 번째 줄\n세 번째 줄');

  // 완전히 동일한 정의인 경우
  const mergedSame = mergeConcept({ definition: '동일한 내용' }, { definition: '동일한 내용' });
  assert.equal(mergedSame.definition, '동일한 내용');
});

test('mergeConcept: 합쳐서 500자를 넘으면 tooLong: true 를 반환한다', () => {
  const oldLong = 'A'.repeat(300);
  const newLong = 'B'.repeat(201); // 300 + 1(\n) + 201 = 502자
  const mergedOver = mergeConcept({ definition: oldLong }, { definition: newLong });
  assert.equal(mergedOver.tooLong, true);
  assert.equal(mergedOver.definition.length, 502);

  // 정확히 500자일 때는 tooLong: false
  const exact300 = 'A'.repeat(299);
  const exact200 = 'B'.repeat(200); // 299 + 1(\n) + 200 = 500자
  const mergedExact = mergeConcept({ definition: exact300 }, { definition: exact200 });
  assert.equal(mergedExact.tooLong, false);
  assert.equal(mergedExact.definition.length, 500);
});

test('mergeConcept: aliases·tags·related 는 합집합이며 상한(별칭 5개, 태그 5개, 관련 10개)에 맞게 자른다', () => {
  // 1. 별칭 (최대 5개)
  const mergedAliases = mergeConcept(
    { aliases: ['AC', '접근 제어'] },
    { aliases: ['접근 제어', 'Access Control', '인가', '권한 관리', '추가 별칭'] }
  );
  assert.deepEqual(mergedAliases.aliases, ['AC', '접근 제어', 'Access Control', '인가', '권한 관리']);
  assert.equal(mergedAliases.aliases.length, 5);

  // 2. 태그 (최대 5개)
  const mergedTags = mergeConcept(
    { tags: ['다시 보기', '보안'] },
    { tags: ['보안', '네트워크', '웹', '클라우드', '초과 태그'] }
  );
  assert.deepEqual(mergedTags.tags, ['다시 보기', '보안', '네트워크', '웹', '클라우드']);
  assert.equal(mergedTags.tags.length, 5);

  // 3. 관련 개념 (최대 10개, 객체 배열 { id, name } 및 문자열 배열 모두 지원)
  const mergedRelated = mergeConcept(
    { related: [{ id: 'c_1', name: '인증' }, { id: 'c_2', name: '인가' }] },
    { related: ['인가', '세션', '쿠키'] }
  );
  assert.deepEqual(mergedRelated.related, ['인증', '인가', '세션', '쿠키']);
});

// ---- 2. 소스 검사: handleSave 409 흐름 ----

test('소스 검사: handleSave 저장 흐름에서 readgloss:open-panel 디스패치가 완전히 제거되어야 한다', () => {
  const src = read('concept.js');
  const handleSaveMatch = src.match(/async function handleSave\(\)[\s\S]*?\n    \}/);
  assert.ok(handleSaveMatch, 'handleSave 함수가 존재해야 한다');
  const handleSaveSrc = handleSaveMatch[0];
  assert.ok(!handleSaveSrc.includes('readgloss:open-panel'), 'handleSave 흐름에 readgloss:open-panel 디스패치가 없어야 한다');
});

test('소스 검사: 409 exists 시 기존 개념 GET 조회, mergeConcept 병합, id 넣어 다시 save', () => {
  const src = read('concept.js');
  const handleSaveMatch = src.match(/async function handleSave\(\)[\s\S]*?\n    \}/);
  const handleSaveSrc = handleSaveMatch[0];

  assert.match(handleSaveSrc, /op:\s*['"]get['"]/, '기존 개념 조회를 위해 GET 을 호출해야 한다');
  assert.match(handleSaveSrc, /mergeConcept\(/, 'mergeConcept 함수를 호출해야 한다');
  assert.match(handleSaveSrc, /id:\s*res\.id/, 'id 를 넣어 다시 save 를 호출해야 한다');
  assert.ok(!handleSaveSrc.includes('seen: seen'), '409 재저장 시 seen 은 보내지 않는다(옛 본 곳 유지)');
});

test('소스 검사: 500자 초과 시 오류 메시지 표시 및 칸 유지, 성공 시 "기존 개념에 더했어요" 메시지', () => {
  const src = read('concept.js');
  const handleSaveMatch = src.match(/async function handleSave\(\)[\s\S]*?\n    \}/);
  const handleSaveSrc = handleSaveMatch[0];

  assert.ok(handleSaveSrc.includes('합치면 500자를 넘어요 — 줄여 주세요'), '500자 초과 시 오류 메시지');
  assert.ok(handleSaveSrc.includes('기존 개념에 더했어요'), '합쳐서 저장 성공 시 확인 메시지');
});

test('소스 검사: mergeConcept 가 globalThis.readglossConceptPage 에 노출된다', () => {
  const src = read('concept.js');
  assert.match(src, /readglossConceptPage\s*=\s*\{[\s\S]*?mergeConcept[\s\S]*?\}/, 'readglossConceptPage 에 mergeConcept 가 노출되어야 한다');
});
