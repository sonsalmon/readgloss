import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// T38: 자동 주석을 겹쳐 그리기로(페이지 DOM을 바꾸지 않음).
await import('../extension/settings-core.js');
await import('../extension/annotate-core.js');

const S = globalThis.readglossSettings;
const A = globalThis.readglossAnnotate;
const { planBlock, labelBox, highlightCss, blockCandidates } = A;

// 가짜 텍스트 노드 객체(planBlock이 참조 동일성과 isConnected, nodeValue를 검사할 수 있도록 함)
class FakeTextNode {
  constructor(nodeValue) {
    this.nodeType = 3;
    this.nodeValue = String(nodeValue);
    this.isConnected = true;
  }
}

function makeJob(...texts) {
  const nodes = texts.map((t) => new FakeTextNode(t));
  const occs = blockCandidates(texts);
  return { nodes, texts, occs };
}

const ITEMS = Object.assign(Object.create(null), {
  payload: { lemma: 'payload', gloss: '수익 하중' },
  exploit: { lemma: 'exploit', gloss: '이용하다' },
  delves: { lemma: 'delve', gloss: '파고들다' },
  delve: { lemma: 'delve', gloss: '파고들다' },
  mitigate: { lemma: 'mitigate', gloss: '완화하다' },
});

const cfg = (patch = {}) => S.merge({}, patch);
const fresh = () => ({ pageSeen: new Set(), skip: new Set() });

// 1. planBlock 고르기 규칙 (annotateBlock 시험들과 동일한 규칙 검증)

test('planBlock: maxPerParagraph 문단당 최대 개수(0 = 제한 없음), existingCount를 고려하여 제한', () => {
  const text = 'Attackers exploit the payload and delves deep, mitigate it.'; // 4개 후보
  const j = makeJob(text);

  const plan0 = planBlock(j, ITEMS, cfg({ maxPerParagraph: 0 }), fresh());
  assert.equal(plan0.length, 4);
  assert.deepEqual(plan0.map((p) => p.lemma), ['exploit', 'payload', 'delve', 'mitigate']);

  const plan2 = planBlock(j, ITEMS, cfg({ maxPerParagraph: 2 }), fresh());
  assert.equal(plan2.length, 2);
  assert.deepEqual(plan2.map((p) => p.lemma), ['exploit', 'payload']);

  const plan3 = planBlock(j, ITEMS, cfg({ maxPerParagraph: 3 }), fresh());
  assert.equal(plan3.length, 3);

  // 이미 2개가 붙어 있는 경우(existingCount = 2)
  const planExisting2Of2 = planBlock(j, ITEMS, cfg({ maxPerParagraph: 2 }), fresh(), 2);
  assert.equal(planExisting2Of2.length, 0);

  const planExisting2Of3 = planBlock(j, ITEMS, cfg({ maxPerParagraph: 3 }), fresh(), 2);
  assert.equal(planExisting2Of3.length, 1);
  assert.equal(planExisting2Of3[0].lemma, 'exploit');
});

test('planBlock: repeat 3종(page = 페이지당 원형 1회, paragraph = 문단당 원형 1회, always = 매번)', () => {
  const j1 = makeJob('Attackers exploit the flaw, then exploit more.');
  const j2 = makeJob('Defenders exploit it too.');

  // page: 페이지에서 원형당 한 번
  const statePage = fresh();
  const planPage1 = planBlock(j1, ITEMS, cfg({ repeat: 'page', maxPerParagraph: 0 }), statePage);
  assert.equal(planPage1.length, 1);
  assert.equal(planPage1[0].lemma, 'exploit');
  assert.ok(statePage.pageSeen.has('exploit'));
  const planPage2 = planBlock(j2, ITEMS, cfg({ repeat: 'page', maxPerParagraph: 0 }), statePage);
  assert.equal(planPage2.length, 0);

  // paragraph: 문단 내에서 첫 등장만
  const planPara1 = planBlock(j1, ITEMS, cfg({ repeat: 'paragraph', maxPerParagraph: 0 }), fresh());
  assert.equal(planPara1.length, 1);
  const planPara2 = planBlock(j2, ITEMS, cfg({ repeat: 'paragraph', maxPerParagraph: 0 }), fresh());
  assert.equal(planPara2.length, 1);

  // always: 매번 등장
  const planAlways1 = planBlock(j1, ITEMS, cfg({ repeat: 'always', maxPerParagraph: 0 }), fresh());
  assert.equal(planAlways1.length, 2);
  const planAlways2 = planBlock(j2, ITEMS, cfg({ repeat: 'always', maxPerParagraph: 0 }), fresh());
  assert.equal(planAlways2.length, 1);
});

test('planBlock: skip(아는 단어 원형)는 건너뛴다', () => {
  const j = makeJob('Attackers exploit the payload and delves deep.');
  const state = { pageSeen: new Set(), skip: new Set(['payload', 'delve']) };
  const plan = planBlock(j, ITEMS, cfg({ maxPerParagraph: 0 }), state);
  assert.deepEqual(plan.map((p) => p.lemma), ['exploit']);
});

test('planBlock: 여러 노드에 걸친 블록에서 위치(node, start, end)를 올바르게 계산하고 바뀐 노드는 건너뛴다', () => {
  const j = makeJob('Attackers ', ' the payload ', ' and mitigate it');
  // 3번째 노드가 도중에 바뀜
  j.nodes[2].nodeValue = ' and CHANGED it';
  const plan = planBlock(j, ITEMS, cfg({ maxPerParagraph: 0 }), fresh());
  assert.equal(plan.length, 1);
  assert.equal(plan[0].node, j.nodes[1]);
  assert.equal(plan[0].lemma, 'payload');
  assert.equal(plan[0].gloss, '수익 하중');
  assert.equal(plan[0].start, 5); // ' the payload ' 에서 'payload' 시작 위치
  assert.equal(plan[0].end, 12);
  assert.equal(j.nodes[1].nodeValue.slice(plan[0].start, plan[0].end), 'payload');
});

test('planBlock: position과 mark가 둘 다 none이면 빈 배열을 반환한다', () => {
  const j = makeJob('Attackers exploit the payload.');
  const plan = planBlock(j, ITEMS, cfg({ annotation: { position: 'none' }, mark: 'none' }), fresh());
  assert.deepEqual(plan, []);
});

// 2. 위치 계산 순수 함수 labelBox(rect, labelW, labelH) 경계값 및 계산 검증

test('labelBox: 사각형 위 가운데(가로 = 가운데 - labelW/2, 세로 = top - labelH - 1)', () => {
  // 일반적인 크기와 위치
  const rect1 = { left: 100, top: 200, width: 80, height: 20, right: 180, bottom: 220 };
  const box1 = labelBox(rect1, 40, 14);
  assert.deepEqual(box1, { left: 120, top: 185 }); // 가로: 100 + 40 - 20 = 120, 세로: 200 - 14 - 1 = 185

  // width 프로퍼티가 없고 right, left만 있는 경우
  const rect2 = { left: 50, right: 150, top: 100, bottom: 120 };
  const box2 = labelBox(rect2, 60, 10);
  assert.deepEqual(box2, { left: 70, top: 89 }); // 가로: 100 - 30 = 70, 세로: 100 - 10 - 1 = 89

  // 경계값: 좌표가 0이거나 음수인 경우
  const rectZero = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  assert.deepEqual(labelBox(rectZero, 20, 10), { left: -10, top: -11 });

  const rectNegative = { left: -50, top: -30, width: 20, height: 10, right: -30, bottom: -20 };
  assert.deepEqual(labelBox(rectNegative, 10, 8), { left: -45, top: -39 });
});

// 3. mark -> ::highlight CSS 글 함수 highlightCss(settings, dark) 검증

test('highlightCss: mark 설정(color/underline/background/none)과 다크모드에 맞춰 ::highlight(readgloss-ann) CSS 글을 생성', () => {
  // color
  const cssColorLight = highlightCss({ mark: 'color' }, false);
  assert.match(cssColorLight, /::highlight\(readgloss-ann\)\s*\{\s*color:\s*#2f6feb;\s*\}/);

  const cssColorDark = highlightCss({ mark: 'color' }, true);
  assert.match(cssColorDark, /::highlight\(readgloss-ann\)\s*\{\s*color:\s*#6b9bff;\s*\}/);

  // underline
  const cssUnderline = highlightCss({ mark: 'underline' });
  assert.match(cssUnderline, /::highlight\(readgloss-ann\)\s*\{\s*text-decoration:\s*underline dotted;\s*\}/);

  // background
  const cssBgLight = highlightCss({ mark: 'background' }, false);
  assert.match(cssBgLight, /::highlight\(readgloss-ann\)\s*\{\s*background-color:\s*rgba\(47,\s*111,\s*235/);

  const cssBgDark = highlightCss({ mark: 'background' }, true);
  assert.match(cssBgDark, /::highlight\(readgloss-ann\)\s*\{\s*background-color:\s*rgba\(107,\s*155,\s*255/);

  // none
  const cssNone = highlightCss({ mark: 'none' });
  assert.match(cssNone, /::highlight\(readgloss-ann\)\s*\{\s*\}/);
});

// 4. 소스 검사: annotate.js가 replaceWith·createElement('ruby')를 쓰지 않고, 겹침 층 API를 사용

test('소스 검사: annotate.js가 replaceWith·createElement("ruby")를 쓰지 않음, CSS.highlights, readgloss-ann-layer, scroll capture, elementFromPoint 사용', () => {
  const src = readFileSync(new URL('../extension/annotate.js', import.meta.url), 'utf8');

  // DOM을 직접 조작해 ruby로 바꾸지 않는다
  assert.doesNotMatch(src, /\.replaceWith\(/, '페이지 DOM의 글자 노드를 replaceWith로 교체하지 않는다');
  assert.doesNotMatch(src, /createElement\(['"`]ruby['"`]\)/, '페이지 DOM에 ruby 요소를 만들지 않는다');

  // Custom Highlight API
  assert.match(src, /CSS\.highlights/, 'CSS.highlights를 사용한다');
  assert.match(src, /readgloss-ann/, '하이라이트 이름 readgloss-ann을 사용한다');

  // 겹침 층 레이어 호스트
  assert.match(src, /readgloss-ann-layer/, '겹침 층 요소 readgloss-ann-layer를 생성한다');

  // 스크롤 capture
  assert.match(src, /['"`]scroll['"`][^)]*capture:\s*true/, 'scroll 이벤트를 capture: true로 등록한다');

  // elementFromPoint로 가려짐 감지
  assert.match(src, /document\.elementFromPoint/, '단어 가운데 점의 document.elementFromPoint를 호출한다');
});

// 5. position 'right' -> top으로 읽힘

test('settings-core: position "right"는 "top"으로 읽힌다', () => {
  const norm = S.normalize({ annotation: { position: 'right' } });
  assert.equal(norm.annotation.position, 'top', 'normalize 시 right는 top으로 변환된다');

  const merged = S.merge({}, { annotation: { position: 'right' } });
  assert.equal(merged.annotation.position, 'top', 'merge 시 right는 top으로 변환된다');
});
