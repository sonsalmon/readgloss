import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// T43: 뜻 글자 높이(liftEm) 설정 및 겹쳐 그리기/미리보기 반영
await import('../extension/settings-core.js');
await import('../extension/annotate-core.js');
await import('../extension/panel.js');

const S = globalThis.readglossSettings;
const A = globalThis.readglossAnnotate;
const C = globalThis.readglossPanelCore;
const { labelBox, cssVars, structuralKey } = A;

// 1. settings-core: 기본값 -0.15, 범위 밖 거름, gapEm 읽기 유지
test('settings-core: liftEm 기본값 -0.15, 범위 밖 거름(-0.5~+0.3), 숫자가 아니면 기본값', () => {
  assert.equal(S.DEFAULTS.annotation.liftEm, -0.15);

  const n = (p) => S.normalize(p);
  // 기본값
  assert.equal(n({}).annotation.liftEm, -0.15);
  assert.equal(n({ annotation: {} }).annotation.liftEm, -0.15);

  // 허용 범위 안 값
  assert.equal(n({ annotation: { liftEm: -0.5 } }).annotation.liftEm, -0.5);
  assert.equal(n({ annotation: { liftEm: 0.3 } }).annotation.liftEm, 0.3);
  assert.equal(n({ annotation: { liftEm: 0 } }).annotation.liftEm, 0);
  assert.equal(n({ annotation: { liftEm: -0.2 } }).annotation.liftEm, -0.2);

  // 범위 밖: 가장 가까운 허용값으로 클램핑
  assert.equal(n({ annotation: { liftEm: -1.0 } }).annotation.liftEm, -0.5);
  assert.equal(n({ annotation: { liftEm: 0.8 } }).annotation.liftEm, 0.3);

  // 숫자가 아니면 기본값
  assert.equal(n({ annotation: { liftEm: 'high' } }).annotation.liftEm, -0.15);
  assert.equal(n({ annotation: { liftEm: null } }).annotation.liftEm, -0.15);
  assert.equal(n({ annotation: { liftEm: NaN } }).annotation.liftEm, -0.15);

  // gapEm 은 읽기만 유지(옛 저장값 호환)
  assert.equal(n({ annotation: { gapEm: 0.2 } }).annotation.gapEm, 0.2);
});

// 2. labelBox liftPx 위치 계산 검증
test('labelBox: liftPx(-0.15em * 20px = -3px -> top이 3px 아래)', () => {
  const rect = { left: 100, top: 200, width: 80, height: 20, right: 180, bottom: 220 };
  const labelW = 40;
  const labelH = 14;

  // liftPx = 0 (기본값): rect.top - labelH - 1 = 200 - 14 - 1 = 185
  const base = labelBox(rect, labelW, labelH);
  assert.deepEqual(base, { left: 120, top: 185 });
  assert.deepEqual(labelBox(rect, labelW, labelH, 0), { left: 120, top: 185 });

  // liftPx = -3px (-0.15em * 20px): top = 200 - 14 - 1 - (-3) = 188 (3px 아래)
  const lowered = labelBox(rect, labelW, labelH, -3);
  assert.deepEqual(lowered, { left: 120, top: 188 });
  assert.equal(lowered.top, base.top + 3);

  // liftPx = +4px (+0.2em * 20px): top = 200 - 14 - 1 - 4 = 181 (4px 위)
  const raised = labelBox(rect, labelW, labelH, 4);
  assert.deepEqual(raised, { left: 120, top: 181 });
  assert.equal(raised.top, base.top - 4);
});

// 3. panel.js RANGES: liftEm 단계 변환, 라벨 '뜻 높이', gapEm 슬라이더 없음
test('panel: RANGES liftEm 단계 변환(-10 -> -0.5, 6 -> 0.3, -3 -> -0.15), gapEm 슬라이더 없음', () => {
  const liftSpec = C.RANGES.find((r) => r.path === 'annotation.liftEm');
  assert.ok(liftSpec, 'RANGES 에 annotation.liftEm 이 있어야 한다');
  assert.equal(liftSpec.min, -10);
  assert.equal(liftSpec.max, 6);
  assert.equal(liftSpec.step, 1);

  // gapEm 슬라이더 없음
  const gapSpec = C.RANGES.find((r) => r.path === 'annotation.gapEm');
  assert.equal(gapSpec, undefined, 'RANGES 에 annotation.gapEm 이 없어야 한다');

  // 단계 변환: to (설정값 -> 슬라이더 위치)
  assert.equal(liftSpec.to(-0.5), -10);
  assert.equal(liftSpec.to(0.3), 6);
  assert.equal(liftSpec.to(-0.15), -3);
  assert.equal(liftSpec.to(0), 0);

  // 단계 변환: from (슬라이더 위치 -> 설정값)
  assert.equal(liftSpec.from(-10), -0.5);
  assert.equal(liftSpec.from(6), 0.3);
  assert.equal(liftSpec.from(-3), -0.15);
  assert.equal(liftSpec.from(0), 0);

  // sliderPatch
  assert.deepEqual(C.sliderPatch(liftSpec, '-3'), { annotation: { liftEm: -0.15 } });
  assert.deepEqual(C.sliderPatch(liftSpec, '-10'), { annotation: { liftEm: -0.5 } });
  assert.deepEqual(C.sliderPatch(liftSpec, '6'), { annotation: { liftEm: 0.3 } });

  // sliderValue
  assert.equal(C.sliderValue(liftSpec, { annotation: { liftEm: -0.15 } }), -3);
  assert.equal(C.sliderValue(liftSpec, { annotation: { liftEm: -0.5 } }), -10);
  assert.equal(C.sliderValue(liftSpec, { annotation: { liftEm: 0.3 } }), 6);

  // resetPatch 에 liftEm 포함
  const reset = C.resetPatch(S.DEFAULTS);
  assert.equal(reset.annotation.liftEm, -0.15);
});

// 4. panel.js 소스 검사: 라벨 '뜻 높이', FMT 값 표시, gapEm 슬라이더 없음
test('panel 소스 검사: 라벨 "뜻 높이", FMT 포맷(-0.15em), gapEm 슬라이더 없음', () => {
  const src = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');

  // 라벨 '뜻 높이'
  assert.match(src, /'annotation\.liftEm':\s*'뜻 높이'/, 'LABEL 에 annotation.liftEm: 뜻 높이 가 있어야 한다');

  // FMT 값 표시 ${em}em (예: -0.15em)
  assert.match(src, /'annotation\.liftEm':\s*\(n\)\s*=>\s*`\$\{\(n\s*\*\s*5\)\s*\/\s*100\}em`/, 'FMT 에 annotation.liftEm 이 있어야 한다');

  // renderSettings 에서 gapEm 슬라이더 대신 liftEm 슬라이더 사용
  assert.doesNotMatch(src, /slider\(['"]annotation\.gapEm['"]\)/, 'renderSettings 에서 slider("annotation.gapEm") 가 없어야 한다');
  assert.match(src, /slider\(['"]annotation\.liftEm['"]\)/, 'renderSettings 에서 slider("annotation.liftEm") 가 있어야 한다');
});

// 5. cssVars 및 ANNOT_CSS 검증
test('cssVars & ANNOT_CSS: --rg-ann-lift CSS 변수 및 rt 상대 위치 이동', () => {
  // cssVars 에 --rg-ann-lift 반영
  const varsDefault = cssVars(S.normalize({}));
  assert.equal(varsDefault['--rg-ann-lift'], '-0.15em');

  const varsCustom = cssVars(S.normalize({ annotation: { liftEm: 0.2 } }));
  assert.equal(varsCustom['--rg-ann-lift'], '0.2em');

  const varsNegative = cssVars(S.normalize({ annotation: { liftEm: -0.5 } }));
  assert.equal(varsNegative['--rg-ann-lift'], '-0.5em');

  // ANNOT_CSS 에 rt[data-readgloss="gloss"] 위치 이동 확인
  const css = globalThis.readglossAnnotStyle?.css || '';
  assert.match(
    css,
    /rt\[data-readgloss="gloss"\]\s*\{[^}]*position:\s*relative;[^}]*top:\s*calc\(-1\s*\*\s*var\(--rg-ann-lift,\s*0em\)\);/,
    'rt 에 position: relative; top: calc(-1 * var(--rg-ann-lift, 0em)) 가 있어야 한다',
  );
});

// 6. structuralKey 에는 liftEm 을 넣지 않는다 (변경 시 재처리 없이 위치만 재계산)
test('structuralKey: liftEm 변경은 structuralKey 에 영향을 주지 않는다', () => {
  const s1 = S.normalize({ annotation: { liftEm: -0.15 } });
  const s2 = S.normalize({ annotation: { liftEm: 0.2 } });
  const s3 = S.normalize({ annotation: { liftEm: -0.5 } });

  assert.equal(structuralKey(s1), structuralKey(s2));
  assert.equal(structuralKey(s2), structuralKey(s3));
});

// 7. annotate.js 소스 검사: parentFs 캐시 및 labelBox(..., liftPx) 호출
test('annotate.js 소스 검사: entry.parentFs 캐시 및 labelBox liftPx 전달', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // entry.parentFs 캐시
  assert.match(src, /entry\.parentFs\s*=\s*parentFs/, 'applyEntryStyle 에서 entry.parentFs 를 저장해야 한다');

  // updatePositions 에서 liftPx 를 계산하여 labelBox 에 전달
  assert.match(src, /labelBox\([^)]*liftPx/, 'updatePositions 에서 labelBox 에 liftPx 인자를 전달해야 한다');
});
