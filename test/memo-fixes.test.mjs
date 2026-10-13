// 메모장 고침 시험(독립 검증 A~E, 작은 것 1~6).
// 순수 함수로 판정할 수 있는 것은 값을 직접 확인하고, DOM이 필요한 것은 scrap-wiring 처럼 소스 검사로 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderScrapDocs } from '../scripts/export-scraps.mjs';

await import('../extension/memo-core.js');
await import('../extension/panel.js');
await import('../extension/selection-core.js');
await import('../extension/scrap-core.js');
const { pickCenterBlock } = globalThis.readglossMemo;
const { isMemoPath } = globalThis.readglossPanelCore;
const { buildTree } = globalThis.readglossScrap;

const extDir = new URL('../extension/', import.meta.url);
const readExt = (f) => readFileSync(new URL(f, extDir), 'utf8');
const memoPad = readExt('memo-pad.js');
const panelScraps = readExt('panel-scraps.js');
const panel = readExt('panel.js');
const scrap = readExt('scrap.js');

// A. Esc로 접은 뒤 ⌥M으로 열면 쓰던 글이 살아 있다. ⌥⇧M은 글을 지우지 않는다.
test('A: 메모장을 열 때 보관한 쓰던 글을 쓰고, 목록(⌥⇧M)을 열어도 쓰던 글을 지우지 않는다', () => {
  assert.match(memoPad, /const text = initialText !== undefined \? initialText : currentDraft;/, '열기는 보관한 글을 쓴다');
  assert.doesNotMatch(memoPad, /openPad\(''\)/, '빈 글로 열지 않는다');
  assert.match(memoPad, /function closePad\(\) \{[\s\S]*?currentDraft = ta\.value;/, '접을 때 쓰던 글을 보관한다');
  assert.match(memoPad, /function openList\(\) \{[\s\S]*?currentDraft = ta\.value;[\s\S]*?text: currentDraft/, '목록을 열 때 쓰던 글을 보관한 채 보인다');
  assert.match(memoPad, /newBtn\.onclick = \(\) => renderPadUI\(root, currentDraft\)/, '[새 메모]는 쓰던 글을 되돌린다');
});

// B. 메모장 안 클릭·Esc는 열린 패널을 닫지 않는다. 넘김 막대도 메모장 안 Esc를 무시한다.
test('B: 메모장 안 클릭·Esc는 패널을 닫지 않고, 넘김 막대 Esc도 메모장 안이면 무시한다', () => {
  assert.equal(isMemoPath([{ localName: 'readgloss-memo-pad' }]), true);
  assert.equal(isMemoPath([{ localName: 'div' }, { localName: 'readgloss-memo-pad' }]), true);
  assert.equal(isMemoPath([{ localName: 'div' }]), false);
  assert.equal(isMemoPath(null), false);
  assert.match(panel, /!C\.isMemoPath\(path\)/, '바깥 클릭 예외');
  assert.match(panel, /!C\.isMemoPath\(e\.composedPath\(\)\)/, 'Esc 예외');
  assert.match(scrap, /if \(path\.some\(\(n\) => n\?\.localName === 'readgloss-memo-pad'\)\) return;/, '넘김 막대 Esc 예외');
});

// C. 깜빡임: 전역 CSS 를 가리는 const CSS 선언이 없다.
test('C: 메모장·스크랩북은 const CSS 를 선언하지 않는다(전역 CSS.highlights 를 가리지 않게)', () => {
  assert.doesNotMatch(memoPad, /const CSS\s*=/);
  assert.doesNotMatch(panelScraps, /const CSS\s*=/);
  assert.match(memoPad, /const STYLE_TEXT = `/);
  assert.match(panelScraps, /const STYLE_TEXT = `/);
  for (const f of readdirSync(extDir).filter((n) => n.endsWith('.js'))) {
    const src = readExt(f);
    if (/\bCSS\.(highlights|supports|escape)\b/.test(src)) {
      assert.doesNotMatch(src, /const CSS\s*=/, `${f}: 전역 CSS 를 쓰는 파일에 const CSS 가 있으면 안 된다`);
    }
  }
});

// D. 화면 가운데 문단: 가운데를 덮는 블록, 여백이면 가장 가까운 블록, 블록이 없으면 -1.
test('D: pickCenterBlock 은 가운데를 덮는 블록, 여백이면 가장 가까운 블록, 없으면 -1', () => {
  // 가운데(400)를 덮는 블록
  assert.equal(pickCenterBlock([{ top: 0, bottom: 100 }, { top: 380, bottom: 420 }, { top: 700, bottom: 750 }], 800), 1);
  // 여백: 위 블록(거리 150)이 아래 블록(거리 200)보다 가깝다
  assert.equal(pickCenterBlock([{ top: 100, bottom: 250 }, { top: 600, bottom: 700 }], 800), 0);
  // 여백: 아래 블록이 더 가깝다
  assert.equal(pickCenterBlock([{ top: 0, bottom: 100 }, { top: 600, bottom: 650 }], 800), 1);
  // 화면 밖 블록만 있어도 가장 가까운 것을 고른다
  assert.equal(pickCenterBlock([{ top: -500, bottom: -400 }], 800), 0);
  assert.equal(pickCenterBlock([], 800), -1);
  assert.equal(pickCenterBlock(null, 800), -1);
  assert.equal(pickCenterBlock([{ top: 0, bottom: 10 }], NaN), -1);
  // 소스: 가운데 점 elementFromPoint 를 쓰지 않고, 본문 글 블록 기준 + 블록 끝 제한
  assert.doesNotMatch(memoPad, /elementFromPoint/);
  assert.match(memoPad, /'p, li, blockquote, dd, td, h1, h2, h3, h4, h5, h6'/);
  assert.match(memoPad, /pickCenterBlock\(blocks, vh\)/);
  assert.match(memoPad, /chosenEl\.contains\(item\.node\)/);
});

// E. 다리가 꺼져 있으면 글을 지우지 않고 안내를 보인다.
test('E: 저장 실패면 글을 지우지 않고 다리 꺼짐 안내를 보이며, ⌥M도 성공일 때만 비운다', () => {
  assert.match(memoPad, /if \(res\?\.memo\) \{\s*ta\.value = '';/, '성공일 때만 비운다');
  assert.match(memoPad, /res\?\.error === 'bridge-off' \? BRIDGE_OFF_TEXT : '저장하지 못했어요'/, '실패 문구');
  assert.match(memoPad, /const BRIDGE_OFF_TEXT = '다리가 꺼져 있어요\. 터미널에서 node ~\/dev\/readgloss\/bridge\/server\.mjs 를 실행해 주세요';/);
  assert.match(memoPad, /if \(isOpen && currentMode === 'pad'\) \{\s*performSave\(\);/, '⌥M 은 저장을 거쳐 성공일 때만 글을 비운다');
});

// 작은 것 1~4
test('작은 것 1: 다른 페이지로 간 뒤 문단을 못 찾으면 메모장이 접혀 있어도 확인 메시지를 보인다', () => {
  assert.match(memoPad, /if \(globalThis\.readglossToast\?\.show\) \{\s*globalThis\.readglossToast\.show\(\{ text \}\);/);
  assert.match(memoPad, /showToastNotice\('그 문단을 찾지 못했어요'\)/);
});

test('작은 것 2: ⌥⇧M 직후 목록에 포커스를 줘서 Esc가 바로 먹는다', () => {
  assert.match(memoPad, /box\.tabIndex = -1;\s*setTimeout\(\(\) => box\.focus\(\), 0\);/);
});

test('작은 것 3: 접을 때 입력 200ms 타이머를 지운다', () => {
  assert.match(memoPad, /function closePad\(\) \{\s*clearTimeout\(typingTimer\);/);
});

test('작은 것 4: 둘째 메모부터는 처음 열 때 고른 글을 다시 쓰지 않는다(저장 성공 뒤 고른 글을 비움)', () => {
  assert.match(memoPad, /savedSelection = null;/);
});

// 작은 것 5: 여러 줄 메모가 내보내기 마크다운을 깨지 않는다.
test('작은 것 5: 여러 줄 메모의 둘째 줄부터 들여쓰고, # > - 로 시작하는 줄은 \\ 로 가려 제목·인용·목록이 되지 않는다', () => {
  const memos = [
    { id: 'm1', task: null, url: 'https://ex.test/p', title: 'P', headings: [], text: 'line one\n# line two\n> quoted\n- dash', ts: 1791443403464 },
  ];
  const all = [...renderScrapDocs([], {}, memos).values()].join('\n');
  assert.ok(all.includes('- line one ('), '첫 줄은 목록 항목');
  assert.ok(all.includes('\n  \\# line two'), '# 줄은 들여쓰고 \\ 를 붙인다');
  assert.ok(all.includes('\n  \\> quoted'), '> 줄도 같다');
  assert.ok(all.includes('\n  \\- dash'), '- 줄도 같다');
  assert.ok(!all.split('\n').some((l) => l.startsWith('# line two') || l.startsWith('> quoted') || l.startsWith('- dash')), '제목·인용·목록으로 읽히는 줄이 없다');
});

// 작은 것 6: 메모만 있는 페이지도 스크랩북에 보이고, 짝짓기는 (할 일, 주소)로 한다.
test('작은 것 6: 스크랩북은 메모만 있는 페이지도 묶고, 할 일 없는 메모는 인박스(맨 아래)로 간다', () => {
  assert.match(panelScraps, /\.\.\.\(state\.memos \|\| \[\]\)\.map\(\(m\) => \(\{ task: m\.task \?\? null, url: m\.url, title: m\.title \}\)\)/);
  assert.match(panelScraps, /const pageKey = \(task, url\) => `\$\{task \?\? null\}\|/);
  const tree = buildTree([
    { task: null, url: 'https://ex.test/inbox', title: 'Inbox page' },
    { task: 'S1-04', url: 'https://ex.test/task', title: 'Task page' },
  ], { 'S1-04': 'S1-04 할 일' });
  assert.equal(tree.at(-1).task, null, '인박스가 맨 아래');
});
