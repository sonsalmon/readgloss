// test/concept-refresh.test.mjs
// 개념 저장 직후 패널 개념 탭 즉시 갱신 및 응답 레이스 방지(latestOnly) 검사
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const conceptJsPath = path.join(rootDir, 'extension', 'concept.js');
const panelConceptsJsPath = path.join(rootDir, 'extension', 'panel-concepts.js');

// 1. 소스 검사: extension/concept.js 저장 성공 경로에서 readgloss:concepts-updated 이벤트 발송
test('concept.js 저장 성공 시 readgloss:concepts-updated 이벤트를 detail: { id }와 함께 발송해야 함', () => {
  const content = fs.readFileSync(conceptJsPath, 'utf8');

  // handleSave 함수 존재 확인
  assert.ok(content.includes('handleSave'), 'handleSave 함수가 존재해야 함');

  // readgloss:concepts-updated 커스텀 이벤트 발송 확인
  assert.match(
    content,
    /window\.dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]readgloss:concepts-updated['"]\s*,\s*\{\s*detail:\s*\{\s*id\s*\}\s*\}\s*\)\s*\)/,
    '저장 성공 시 detail: { id }와 함께 readgloss:concepts-updated 이벤트를 dispatch해야 함'
  );

  // 저장 성공 블록(if (res && !res.error)) 내에 위치하는지 검사
  const saveSuccessBlock = content.match(/if\s*\(\s*res\s*&&\s*!res\.error\s*\)\s*\{([\s\S]*?)(?:return|\})/);
  assert.ok(saveSuccessBlock, '저장 성공 처리 블록(if (res && !res.error))이 존재해야 함');
  assert.ok(
    saveSuccessBlock[1].includes('readgloss:concepts-updated'),
    '저장 성공 처리 블록 내에서 readgloss:concepts-updated 이벤트를 발송해야 함'
  );
});

// 2. 소스 검사: extension/panel-concepts.js에서 readgloss:concepts-updated를 수신하여 loadConcepts 호출
test('panel-concepts.js에서 readgloss:concepts-updated 수신 시 탭이 그려졌으면 loadConcepts를 호출해야 함', () => {
  const content = fs.readFileSync(panelConceptsJsPath, 'utf8');

  // readgloss:concepts-updated 이벤트 리스너 등록 확인
  assert.match(
    content,
    /addEventListener\(\s*['"]readgloss:concepts-updated['"]/,
    'readgloss:concepts-updated 이벤트 리스너가 등록되어 있어야 함'
  );

  // 리스너가 loadConcepts를 호출하는지 확인
  assert.match(
    content,
    /addEventListener\(\s*['"]readgloss:concepts-updated['"][\s\S]*?loadConcepts/,
    'readgloss:concepts-updated 리스너에서 loadConcepts를 호출해야 함'
  );

  // 탭이 한 번이라도 그려졌는지 확인하는 플래그(hasRendered 등)가 존재하는지 확인
  assert.match(
    content,
    /hasRendered/,
    '탭이 한 번이라도 그려졌는지 확인하는 플래그(hasRendered)가 있어야 함'
  );
});

// 3. 오래된 응답 버리기 순수 함수 latestOnly 테스트
test('latestOnly() 요청 번호 발급 및 최신 요청 판정 순수 함수 검사', () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    };
  }

  const require = createRequire(import.meta.url);
  const panelModule = require(panelConceptsJsPath);
  const latestOnly = panelModule.latestOnly || globalThis.readglossConceptRefresh?.latestOnly;

  assert.equal(typeof latestOnly, 'function', 'latestOnly 함수가 제공되어야 함');

  const seq = latestOnly();
  assert.equal(typeof seq.next, 'function');
  assert.equal(typeof seq.isLatest, 'function');

  const req1 = seq.next();
  assert.equal(req1, 1);
  assert.equal(seq.isLatest(req1), true, '첫 번째 요청 직후에는 req1이 최신이어야 함');

  const req2 = seq.next();
  assert.equal(req2, 2);
  assert.equal(seq.isLatest(req1), false, '새 요청 req2가 생겼으므로 이전 req1은 최신이 아니어야 함');
  assert.equal(seq.isLatest(req2), true, 'req2가 최신이어야 함');

  const req3 = seq.next();
  assert.equal(req3, 3);
  assert.equal(seq.isLatest(req1), false);
  assert.equal(seq.isLatest(req2), false);
  assert.equal(seq.isLatest(req3), true);
});

test('latestOnly() 두 번째 요청이 와도 마지막 응답만 처리(오래된 응답 버리기) 비동기 시뮬레이션', async () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    };
  }

  const require = createRequire(import.meta.url);
  const panelModule = require(panelConceptsJsPath);
  const latestOnly = panelModule.latestOnly || globalThis.readglossConceptRefresh?.latestOnly;

  const seq = latestOnly();
  let renderedData = null;
  const renderLog = [];

  // 가상의 loadConcepts 비동기 함수 시뮬레이션
  async function simulateLoadConcepts(delayMs, data) {
    const reqId = seq.next();
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 최신 요청 번호가 아니면 오래된 응답이므로 버림
    if (!seq.isLatest(reqId)) {
      renderLog.push({ discarded: true, reqId, data });
      return;
    }

    renderedData = data;
    renderLog.push({ discarded: false, reqId, data });
  }

  // 1번째 요청: 50ms 후 응답 (느림)
  // 2번째 요청: 10ms 후 응답 (빠름)
  const p1 = simulateLoadConcepts(50, '첫 번째 응답 (옛날 것)');
  const p2 = simulateLoadConcepts(10, '두 번째 응답 (최신 것)');

  await Promise.all([p1, p2]);

  // 최종 화면 데이터는 반드시 2번째(최신) 데이터여야 하고, 1번째 데이터는 버려져야 함
  assert.equal(renderedData, '두 번째 응답 (최신 것)');
  assert.equal(renderLog.length, 2);
  assert.deepEqual(renderLog[0], { discarded: false, reqId: 2, data: '두 번째 응답 (최신 것)' });
  assert.deepEqual(renderLog[1], { discarded: true, reqId: 1, data: '첫 번째 응답 (옛날 것)' });
});

test('latestOnly() 순서대로 도착하는 경우에도 마지막 응답이 유지되어야 함', async () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    };
  }

  const require = createRequire(import.meta.url);
  const panelModule = require(panelConceptsJsPath);
  const latestOnly = panelModule.latestOnly || globalThis.readglossConceptRefresh?.latestOnly;

  const seq = latestOnly();
  let renderedData = null;

  async function simulateLoadConcepts(delayMs, data) {
    const reqId = seq.next();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (!seq.isLatest(reqId)) return;
    renderedData = data;
  }

  // 1번째 요청: 10ms
  // 2번째 요청: 30ms (순서대로 완료)
  const p1 = simulateLoadConcepts(10, '1번 데이터');
  await new Promise((r) => setTimeout(r, 5));
  const p2 = simulateLoadConcepts(30, '2번 데이터');

  await Promise.all([p1, p2]);

  assert.equal(renderedData, '2번 데이터');
});
