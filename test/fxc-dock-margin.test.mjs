import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// memo-core.js 로드 (전역 globalThis.readglossMemo)
await import('../extension/memo-core.js');

const memoCore = globalThis.readglossMemo;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const memoPadJsPath = join(__dirname, '../extension/memo-pad.js');
const memoPadSource = readFileSync(memoPadJsPath, 'utf8');

const panelJsPath = join(__dirname, '../extension/panel.js');
const panelSource = readFileSync(panelJsPath, 'utf8');

// ---------------------------------------------------------------------------
// 1. pageMarginFor 순수 함수 테스트 (경우별)
// ---------------------------------------------------------------------------
test('pageMarginFor: open && docked 여부에 따른 본문 마진 판정', () => {
  const { pageMarginFor } = memoCore;
  assert.equal(typeof pageMarginFor, 'function', 'pageMarginFor 함수가 존재해야 합니다.');

  // 1) open && docked 이면 폭(px)
  assert.equal(pageMarginFor({ open: true, docked: true, width: 360, original: '' }), '360px');
  assert.equal(pageMarginFor({ open: true, docked: true, width: 450, original: '0px' }), '450px');
  assert.equal(pageMarginFor({ open: true, docked: true, width: '400px', original: '' }), '400px');
  assert.equal(pageMarginFor({ open: true, docked: true, width: '300', original: '' }), '300px');
  assert.equal(pageMarginFor({ open: true, docked: true, original: '' }), '360px', 'width 생략 시 기본 360px');

  // 2) open 이 아니면 원래 값(original)
  assert.equal(pageMarginFor({ open: false, docked: true, width: 360, original: '' }), '');
  assert.equal(pageMarginFor({ open: false, docked: true, width: 360, original: '20px' }), '20px');

  // 3) docked 가 아니면 원래 값(original)
  assert.equal(pageMarginFor({ open: true, docked: false, width: 360, original: '' }), '');
  assert.equal(pageMarginFor({ open: true, docked: false, width: 360, original: '15px' }), '15px');

  // 4) 둘 다 false 이면 원래 값(original)
  assert.equal(pageMarginFor({ open: false, docked: false, width: 360, original: '' }), '');
  assert.equal(pageMarginFor({ open: false, docked: false, width: 360, original: '10px' }), '10px');

  // 5) 예외 및 기본값 처리
  assert.equal(pageMarginFor(null), '');
  assert.equal(pageMarginFor({}), '');
  assert.equal(pageMarginFor({ open: false, docked: false }), '');
});

// ---------------------------------------------------------------------------
// 2. 소스 검사: marginRight 대입이 syncPageMargin 안에만 있음
// ---------------------------------------------------------------------------
test('소스 검사: marginRight 대입이 syncPageMargin 안에만 존재함', () => {
  const funcHeader = 'function syncPageMargin';
  const funcStart = memoPadSource.indexOf(funcHeader);
  assert.ok(funcStart !== -1, 'memo-pad.js에 syncPageMargin 함수가 정의되어 있어야 합니다.');

  // 중괄호 깊이 카운팅으로 syncPageMargin 함수의 전체 범위를 정확하게 탐색
  let braceDepth = 0;
  let funcEnd = -1;
  let foundFirstBrace = false;
  for (let i = funcStart; i < memoPadSource.length; i++) {
    const ch = memoPadSource[i];
    if (ch === '{') {
      braceDepth++;
      foundFirstBrace = true;
    } else if (ch === '}') {
      braceDepth--;
      if (foundFirstBrace && braceDepth === 0) {
        funcEnd = i;
        break;
      }
    }
  }
  assert.ok(funcEnd !== -1, 'syncPageMargin 함수의 블록을 정상적으로 찾을 수 있어야 합니다.');

  // memo-pad.js 전체에서 style.marginRight 대입(=) 검색
  const assignRegex = /\.style\.marginRight\s*=/g;
  const allAssignments = [];
  let match;
  while ((match = assignRegex.exec(memoPadSource)) !== null) {
    allAssignments.push(match.index);
  }

  assert.ok(allAssignments.length > 0, 'marginRight 대입문이 최소 1개 이상 존재해야 합니다.');

  for (const pos of allAssignments) {
    assert.ok(
      pos >= funcStart && pos <= funcEnd,
      `marginRight 대입문이 syncPageMargin 외부(위치: ${pos})에서 발견되었습니다.`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. 소스 검사: window readgloss:study-mode 리스너 없음
// ---------------------------------------------------------------------------
test('소스 검사: window readgloss:study-mode 리스너가 memo-pad.js 및 panel.js에 없음', () => {
  const listenerRegex = /addEventListener\s*\(\s*['"]readgloss:study-mode['"]/i;
  assert.ok(
    !listenerRegex.test(memoPadSource),
    'memo-pad.js에 window readgloss:study-mode addEventListener가 없어야 합니다.'
  );
  assert.ok(
    !listenerRegex.test(panelSource),
    'panel.js에 window readgloss:study-mode addEventListener가 없어야 합니다.'
  );
});

// ---------------------------------------------------------------------------
// 4. 소스 검사: panel.js가 readglossMemoPad.setStudyMode를 부름
// ---------------------------------------------------------------------------
test('소스 검사: panel.js가 readglossMemoPad.setStudyMode를 호출함', () => {
  assert.ok(
    panelSource.includes('readglossMemoPad'),
    'panel.js에 readglossMemoPad 참조가 포함되어야 합니다.'
  );
  assert.ok(
    /readglossMemoPad\??\.setStudyMode/.test(panelSource),
    'panel.js에서 readglossMemoPad.setStudyMode를 호출해야 합니다.'
  );
});

// ---------------------------------------------------------------------------
// 5. 소스 검사: 공부 모드에서 saveDockState를 부르지 않음
// ---------------------------------------------------------------------------
test('소스 검사: setStudyMode 내에서 saveDockState 및 undockPad를 호출하지 않음', () => {
  const funcHeader = 'function setStudyMode';
  const funcStart = memoPadSource.indexOf(funcHeader);
  assert.ok(funcStart !== -1, 'memo-pad.js에 setStudyMode 함수가 정의되어 있어야 합니다.');

  let braceDepth = 0;
  let funcEnd = -1;
  let foundFirstBrace = false;
  for (let i = funcStart; i < memoPadSource.length; i++) {
    const ch = memoPadSource[i];
    if (ch === '{') {
      braceDepth++;
      foundFirstBrace = true;
    } else if (ch === '}') {
      braceDepth--;
      if (foundFirstBrace && braceDepth === 0) {
        funcEnd = i;
        break;
      }
    }
  }
  assert.ok(funcEnd !== -1, 'setStudyMode 함수의 블록을 정상적으로 찾을 수 있어야 합니다.');
  const funcBody = memoPadSource.slice(funcStart, funcEnd + 1);

  assert.ok(
    !funcBody.includes('saveDockState'),
    'setStudyMode 안에서 saveDockState를 직접 호출하지 않아야 합니다.'
  );
  assert.ok(
    !funcBody.includes('undockPad'),
    'setStudyMode 안에서 undockPad를 호출하여 간접적으로 saveDockState가 불리지 않아야 합니다.'
  );
});

// ---------------------------------------------------------------------------
// 6. 소스 검사: composition 처리 (한글 조합 중 복귀 방지)
// ---------------------------------------------------------------------------
test('소스 검사: compositionstart, compositionend 이벤트 감지 및 포커스 복귀 제어', () => {
  assert.ok(
    memoPadSource.includes('compositionstart'),
    'memo-pad.js에 compositionstart 이벤트 리스너가 등록되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('compositionend'),
    'memo-pad.js에 compositionend 이벤트 리스너가 등록되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('isComposing'),
    'memo-pad.js에 isComposing 조합 상태 플래그가 있어야 합니다.'
  );
});

// ---------------------------------------------------------------------------
// 7. 소스 검사: iframe 및 shadowRoot 판정 (기본 포커스 뺏음 방지)
// ---------------------------------------------------------------------------
test('소스 검사: getActiveKind가 iframe 및 외부 웹 컴포넌트를 페이지 입력 중으로 판정', () => {
  assert.ok(
    /iframe/i.test(memoPadSource),
    'memo-pad.js의 getActiveKind에 iframe 검사가 포함되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('shadowRoot'),
    'memo-pad.js의 getActiveKind에 shadowRoot 검사가 포함되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('readgloss-concept-card'),
    'memo-pad.js의 isCardOpen 또는 getActiveKind에 readgloss-concept-card가 포함되어야 합니다.'
  );
  assert.ok(
    memoPadSource.includes('readgloss-scrap-bar'),
    'memo-pad.js의 isCardOpen에 readgloss-scrap-bar가 포함되어야 합니다.'
  );
});
