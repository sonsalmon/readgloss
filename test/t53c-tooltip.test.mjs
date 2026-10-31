// 과제 T53c(변경 기록 28-6): 마우스 말풍선 모델·외부 사전 다섯 곳·마우스 멈춤 기본값.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/text.js');
await import('../extension/video-core.js');
await import('../extension/selection-core.js');
await import('../extension/settings-core.js');
const V = globalThis.readglossVideo;
const Sel = globalThis.readglossSelection;
const S = globalThis.readglossSettings;

test('tooltipModel: 어려운 단어(S.hard)가 있으면 그 원형·뜻을 쓴다', () => {
  assert.deepEqual(
    V.tooltipModel({ word: 'Running', hard: { lemma: 'run', gloss: '달리다' }, dict: null, saved: false }),
    { lemma: 'run', gloss: '달리다', state: 'found', saved: false },
  );
});

test('tooltipModel: S.hard 가 없으면 사전 응답의 원형·뜻을 쓴다', () => {
  assert.deepEqual(
    V.tooltipModel({ word: 'running', dict: { found: true, lemma: 'run', gloss: '달리다' } }),
    { lemma: 'run', gloss: '달리다', state: 'found', saved: false },
  );
  // 사전이 gloss 를 따로 안 주면 첫 뜻(entries[0].senses[0].text)을 쓴다
  assert.equal(V.tooltipModel({ word: 'running', dict: { found: true, lemma: 'run', entries: [{ senses: [{ text: '달리기' }] }] } }).gloss, '달리기');
});

test('tooltipModel: 둘 다 없거나 사전에 없으면 missing, 단어는 소문자로 남는다', () => {
  assert.deepEqual(V.tooltipModel({ word: 'Zebra' }), { lemma: 'zebra', gloss: '', state: 'missing', saved: false });
  assert.deepEqual(
    V.tooltipModel({ word: 'zebra', dict: { found: false } }),
    { lemma: 'zebra', gloss: '', state: 'missing', saved: false },
  );
});

test('tooltipModel: 저장됨은 그대로 넘긴다(★/☆ 단추 판단)', () => {
  const hard = { lemma: 'run', gloss: '달리다' };
  assert.equal(V.tooltipModel({ word: 'running', hard, saved: true }).saved, true);
  assert.equal(V.tooltipModel({ word: 'running', hard, saved: 'yes' }).saved, false, '참·거짓만 받는다');
});

test('dictLinks: 다섯 곳 순서(YouGlish·네이버·Oxford·Cambridge·Urban)와 주소', () => {
  const links = Sel.dictLinks('state of the art');
  assert.deepEqual(links.map((l) => l.id), ['youglish', 'naver', 'oxford', 'cambridge', 'urban']);
  const q = encodeURIComponent('state of the art');
  assert.equal(links[4].label, 'Urban');
  assert.equal(links[4].url, `https://www.urbandictionary.com/define.php?term=${q}`);
});

test('dictLinks: Urban 주소도 encodeURIComponent 로 인코딩한다', () => {
  const q = encodeURIComponent(`rock & roll? "yes"`);
  const urban = Sel.dictLinks(`rock & roll? "yes"`).find((l) => l.id === 'urban');
  assert.equal(urban.url, `https://www.urbandictionary.com/define.php?term=${q}`);
  assert.ok(urban.url.includes('%26') && urban.url.includes('%3F') && urban.url.includes('%22'));
});

test('설정: video.hoverPause 기본값은 false(마우스를 올려도 영상은 멈추지 않는다)', () => {
  assert.equal(S.DEFAULTS.video.hoverPause, false);
  assert.equal(S.normalize({}).video.hoverPause, false);
  assert.equal(S.normalize({ video: {} }).video.hoverPause, false);
  assert.equal(S.normalize({ video: { hoverPause: true } }).video.hoverPause, true, '켜면 지금처럼 멈춘다');
});

test('자막 층: 말풍선은 shadow 안에서 0.25초 뒤 열리고 0.2초 뒤 닫힌다', () => {
  const src = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.match(src, /const TIP_HOVER_MS = 250;/);
  assert.match(src, /const TIP_CLOSE_MS = 200;/);
  assert.match(src, /const tipEl = el\('div', 'tip'\);/);
  assert.match(src, /shadow\.append\(style, box, sr\)/);
  assert.match(src, /const act = V\.tooltipModel|V\.tooltipModel\(\{ word: tip\.word/);
  assert.match(src, /type: 'words', op: 'unsave', lemma/);
  assert.match(src, /type: 'words', op: 'save', lemma, word, gloss: m\.gloss, sentence: cue\.text, url: V\.sceneUrl\(S\.id, cue\.start\)/);
  assert.match(src, /lookupWord\(word, i, rect\)/);
  assert.match(src, /S\.dictMemo = new Map\(\); \/\/ 영상이 바뀌면/);
});
