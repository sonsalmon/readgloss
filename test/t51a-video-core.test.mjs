// 과제 T51a(변경 기록 27-1·27-2): 영상 자막 코어(video-core.js) 순수 함수 시험.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;

const ID = 'dQw4w9WgXcQ';
const URL_EN = `https://www.youtube.com/api/timedtext?v=${ID}&ei=x&caps=asr&opi=1&xoaf=5&hl=ko&lang=en&fmt=json3&pot=abc`;
const URL_ASR = `${URL_EN}&kind=asr`;

test('params: 자막 주소에서 v·lang·tlang·kind·fmt', () => {
  assert.deepEqual(V.params(`${URL_ASR}&tlang=ko`), { v: ID, lang: 'en', tlang: 'ko', kind: 'asr', fmt: 'json3' });
  assert.deepEqual(V.params('/api/timedtext?v=abc&lang=EN-GB'), { v: 'abc', lang: 'en-gb', tlang: '', kind: '', fmt: '' });
  assert.deepEqual(V.params(null), { v: '', lang: '', tlang: '', kind: '', fmt: '' });
});

test('decodeEntities: 이름·숫자·16진 엔티티, 모르는 것은 그대로', () => {
  assert.equal(V.decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot; it&#39;s &#x2019; &nbsp;x &bogus;'), 'Tom & Jerry <3 "hi" it\'s ’  x &bogus;');
});

test('json3 사람이 쓴 자막: 이벤트 = 줄, 줄바꿈은 공백, 빈 이벤트는 버림, 같은 시각은 합침', () => {
  const body = JSON.stringify({
    wireMagic: 'pb3',
    events: [
      { tStartMs: 0, dDurationMs: 100000, id: 1, wpWinPosId: 1 }, // 창 정의(글 없음)
      { tStartMs: 1200, dDurationMs: 2000, segs: [{ utf8: 'Hello there,' }, { utf8: '\nGeneral Kenobi.' }] },
      { tStartMs: 3400, dDurationMs: 1500, segs: [{ utf8: '\n' }] },
      { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Top line' }] },
      { tStartMs: 5000, dDurationMs: 1500, segs: [{ utf8: 'second window' }] },
    ],
  });
  const tr = V.parseTrack(body, URL_EN);
  assert.equal(tr.kind, 'manual');
  assert.equal(tr.videoId, ID);
  assert.equal(tr.lang, 'en');
  assert.deepEqual(tr.cues, [
    { start: 1.2, end: 3.2, text: 'Hello there, General Kenobi.' },
    { start: 5, end: 6.5, text: 'Top line second window' },
  ]);
});

// 자동 생성 자막: 낱말마다 tOffsetMs, 줄바꿈(aAppend) 이벤트가 끼어 있다
function asrBody(words) {
  // words: [[text, ms]] — 2낱말씩 한 이벤트로 묶어 유튜브와 비슷하게
  const events = [{ tStartMs: 0, dDurationMs: 999999, id: 1, wpWinPosId: 1, wsWinStyleId: 1 }];
  for (let i = 0; i < words.length; i += 2) {
    const t0 = words[i][1];
    const segs = words.slice(i, i + 2).map(([w, ms], k) => ({ utf8: k ? ` ${w}` : w, ...(ms - t0 ? { tOffsetMs: ms - t0 } : {}), acAsrConf: 0 }));
    events.push({ tStartMs: t0, dDurationMs: 3000, wWinId: 1, segs });
    events.push({ tStartMs: t0 + 10, dDurationMs: 2000, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] });
  }
  return JSON.stringify({ wireMagic: 'pb3', events });
}

test('json3 자동 생성: 쉼(1초 넘게)·문장 부호에서 줄을 나누고 끝 = 다음 줄 시작', () => {
  const body = asrBody([
    ['so', 1000], ['today', 1300], ['we', 1600], ['talk', 1900], ['about', 2200], ['buffers.', 2500],
    ['They', 2800], ['overflow', 3100], ['easily', 3400],
    ['next', 5000], ['part', 5300],
  ]);
  const tr = V.parseTrack(body, URL_ASR);
  assert.equal(tr.kind, 'asr');
  assert.deepEqual(tr.cues.map((c) => c.text), ['so today we talk about buffers.', 'They overflow easily', 'next part']);
  assert.equal(tr.cues[0].start, 1);
  assert.equal(tr.cues[0].end, 2.8, '다음 줄이 1초 안에 오면 끝 = 다음 줄 시작');
  assert.equal(tr.cues[1].end, 4.4, '1초 넘게 비면 마지막 낱말 + 1초');
  assert.equal(tr.cues[2].end, 6.3);
});

test('json3 자동 생성: kind=asr 이 없어도 낱말 시각이 있으면 자동 생성으로 본다', () => {
  const body = asrBody([['hello', 0], ['world', 300]]);
  assert.equal(V.parseTrack(body, URL_EN).kind, 'asr');
});

test('groupWords: 12낱말·5.5초가 차면 새 줄, 쉼표 뒤는 8낱말부터', () => {
  const twelve = Array.from({ length: 14 }, (_, i) => ({ text: `w${String.fromCharCode(97 + i)}`, start: i * 0.3 }));
  const lines = V.groupWords(twelve);
  assert.equal(lines[0].text.split(' ').length, 12);
  assert.equal(lines[1].text.split(' ').length, 2);

  const slow = Array.from({ length: 8 }, (_, i) => ({ text: `w${String.fromCharCode(97 + i)}`, start: i * 0.9 }));
  assert.deepEqual(V.groupWords(slow).map((l) => l.text.split(' ').length), [7, 1], '0.9×7 = 6.3초 > 5.5초에서 끊김');

  const comma = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight,', 'nine', 'ten'].map((text, i) => ({ text, start: i * 0.3 }));
  assert.deepEqual(V.groupWords(comma).map((l) => l.text), ['one two three four five six seven eight,', 'nine ten']);
  const shortComma = ['well,', 'I', 'think', 'so'].map((text, i) => ({ text, start: i * 0.3 }));
  assert.equal(V.groupWords(shortComma).length, 1, '8낱말 전이면 쉼표에서 안 끊는다');
});

test('srv3 XML: 사람이 쓴 줄과 자동 생성(<s>) 둘 다', () => {
  const manual = '<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1000" d="2000">It&#39;s <b>fine</b><br/>really</p><p t="4000" d="1000">Next &amp; last</p></body></timedtext>';
  const a = V.parseTrack(manual, URL_EN);
  assert.equal(a.kind, 'manual');
  assert.deepEqual(a.cues, [{ start: 1, end: 3, text: "It's fine really" }, { start: 4, end: 5, text: 'Next & last' }]);

  const asr = '<timedtext format="3"><body><w t="0" id="1"/><p t="500" d="3000" w="1"><s ac="0">hey</s><s t="300" ac="0"> there</s></p><p t="2000" d="10" a="1" w="1">\n</p><p t="2100" d="3000" w="1"><s ac="0">friend</s></p></body></timedtext>';
  const b = V.parseTrack(asr, URL_EN);
  assert.equal(b.kind, 'asr');
  assert.deepEqual(b.cues.map((c) => c.text), ['hey there', 'friend']);
});

test('srv1 XML: 두 번 이스케이프된 글과 <font> 를 푼다', () => {
  const body = '<?xml version="1.0"?><transcript><text start="0.5" dur="1.5">I&amp;#39;m &amp;lt;font color=&quot;#E5E5E5&quot;&amp;gt;here&amp;lt;/font&amp;gt;</text><text start="2.25" dur="1">ok</text></transcript>';
  const tr = V.parseTrack(body, URL_EN);
  assert.deepEqual(tr.cues, [{ start: 0.5, end: 2, text: "I'm here" }, { start: 2.25, end: 3.25, text: 'ok' }]);
});

test('WebVTT: 시각 줄 아래 글, 태그는 걷는다', () => {
  const body = 'WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:02.500 align:start\n<c>Hello</c> <00:00:01.500>world\n\n00:03.000 --> 00:04.000\nAgain\n';
  assert.deepEqual(V.parseTrack(body, URL_EN).cues, [{ start: 1, end: 2.5, text: 'Hello world' }, { start: 3, end: 4, text: 'Again' }]);
});

test('parseTrack: 못 읽거나 비면 null, 영상 id 가 이상하면 videoId null, 자동 번역(tlang)은 줄 단위', () => {
  assert.equal(V.parseTrack('', URL_EN), null);
  assert.equal(V.parseTrack('{not json', URL_EN), null);
  assert.equal(V.parseTrack(JSON.stringify({ events: [] }), URL_EN), null);
  assert.equal(V.parseTrack('<html>error</html>', URL_EN), null);
  const one = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hi there' }] }] });
  assert.equal(V.parseTrack(one, '/api/timedtext?v=short&lang=en').videoId, null);
  const ko = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '안녕', tOffsetMs: 0 }] }, { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '친구' }] }] });
  const tr = V.parseTrack(ko, `${URL_ASR}&tlang=ko`);
  assert.equal(tr.kind, 'manual');
  assert.deepEqual(tr.cues.map((c) => c.text), ['안녕', '친구']);
});

test('langOf·pickTracks: 영어는 사람이 쓴 것 > 자동 생성, 같으면 나중 것. 한국어는 따로', () => {
  const cues = [{ start: 0, end: 1, text: 'hello world' }];
  const asrOld = { lang: 'en', tlang: '', kind: 'asr', cues, ts: 1 };
  const manualOld = { lang: 'en-gb', tlang: '', kind: 'manual', cues, ts: 2 };
  const manualNew = { lang: 'en', tlang: '', kind: 'manual', cues, ts: 3 };
  const ko = { lang: 'en', tlang: 'ko', kind: 'manual', cues: [{ start: 0, end: 1, text: '안녕' }], ts: 4 };
  const ja = { lang: 'ja', tlang: '', kind: 'manual', cues, ts: 5 };
  assert.deepEqual(V.pickTracks([asrOld, manualOld, ko, ja]), { main: manualOld, ko });
  assert.equal(V.pickTracks([asrOld, manualOld, manualNew]).main, manualNew);
  assert.equal(V.pickTracks([asrOld]).main, asrOld);
  assert.deepEqual(V.pickTracks([ja]), { main: null, ko: null });
  assert.equal(V.langOf({ lang: '', cues }), 'en', '언어 표시가 없으면 글자로 짐작');
  assert.equal(V.langOf({ lang: '', cues: [{ text: '한국어 자막입니다' }] }), 'ko');
});

test('alignKo: 영어 줄마다 시각이 가장 많이 겹치는 한국어 줄', () => {
  const main = [{ start: 0, end: 2, text: 'a' }, { start: 2, end: 4, text: 'b' }, { start: 10, end: 11, text: 'c' }];
  const ko = [{ start: 0, end: 1.5, text: '가' }, { start: 1.5, end: 4, text: '나' }];
  assert.deepEqual(V.alignKo(main, ko), ['가', '나', '']);
});

test('activeIndex·isLive: 시작이 이른 마지막 줄, 줄 사이에서는 앞 줄(옅게)', () => {
  const cues = [{ start: 1, end: 2, text: 'a' }, { start: 3, end: 4, text: 'b' }, { start: 3.5, end: 5, text: 'c' }];
  assert.equal(V.activeIndex(cues, 0.5), -1);
  assert.equal(V.activeIndex(cues, 1), 0);
  assert.equal(V.activeIndex(cues, 2.5), 0);
  assert.equal(V.isLive(cues, 0, 2.2), true, '끝 + 0.25초까지는 지금');
  assert.equal(V.isLive(cues, 0, 2.5), false);
  assert.equal(V.activeIndex(cues, 3.6), 2, '겹치면 나중에 시작한 줄');
  assert.equal(V.activeIndex(cues, 99), 2);
  assert.equal(V.activeIndex([], 1), -1);
  assert.equal(V.activeIndex(cues, NaN), -1);
});

test('tokenize: 낱말·사이 조각을 나누고, 이어 붙이면 원문 그대로', () => {
  const text = "I don't know—it's a well-known x86 bug, OK? [Music]";
  const toks = V.tokenize(text);
  assert.equal(toks.map((t) => t.t).join(''), text);
  assert.deepEqual(toks.filter((t) => t.w).map((t) => t.t), ["don't", 'know', "it's", 'well-known', 'bug', 'OK', 'Music']);
  assert.equal(toks.find((t) => t.t === 'OK').lower, 'ok');
  assert.equal(V.tokenize('it’s').find((t) => t.w).lower, "it's", '굽은 따옴표는 곧은 것으로');
});

test('maskFlags·nextHide: 끔 → 어려운 단어 → 문장 → 끔', () => {
  const toks = V.tokenize('the exploit works');
  assert.deepEqual(V.maskFlags(toks, 'off', () => true), [false, false, false, false, false]);
  assert.deepEqual(V.maskFlags(toks, 'hard', (w) => w === 'exploit'), [false, false, true, false, false]);
  assert.deepEqual(V.maskFlags(toks, 'all'), [true, false, true, false, true]);
  assert.equal(V.nextHide('off'), 'hard');
  assert.equal(V.nextHide('hard'), 'all');
  assert.equal(V.nextHide('all'), 'off');
  assert.equal(V.nextHide('weird'), 'off');
});

test('keyAction: A·S·D·R·Q·Z·W·L·/ 자리(e.code), 조합키·누르고 있기·한글 조합 중은 아님', () => {
  const k = (code, extra = {}) => V.keyAction({ code, key: 'x', ...extra });
  assert.equal(k('KeyA'), 'prev');
  assert.equal(k('KeyS'), 'repeat');
  assert.equal(k('KeyD'), 'next');
  assert.equal(k('KeyR'), 'repeatLine');
  assert.equal(k('KeyQ'), 'loop');
  assert.equal(k('KeyZ'), 'slow');
  assert.equal(k('KeyW'), 'focusMode');
  assert.equal(k('KeyL'), 'drill');
  assert.equal(k('Slash'), 'panel');
  assert.equal(k('KeyA', { key: 'ㅁ' }), 'prev', '한글 자판이어도 같은 자리');
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) assert.equal(k('KeyS', extra), null, JSON.stringify(extra));
  for (const code of ['KeyK', 'KeyJ', 'KeyC', 'KeyF', 'KeyT', 'KeyM', 'KeyI', 'KeyO', 'KeyH', 'KeyP', 'Space']) assert.equal(k(code), null, `유튜브 키·없앤 키 ${code}`);
  assert.equal(V.keyAction(null), null);
});

test('shouldPauseEach: 줄 끝 0.08초 앞부터 0.5초 뒤까지, 한 줄에 한 번', () => {
  const cues = [{ start: 0, end: 2, text: 'a' }];
  const base = { on: true, cur: 0, pausedFor: -1, cues };
  assert.equal(V.shouldPauseEach({ ...base, t: 1.5 }), false);
  assert.equal(V.shouldPauseEach({ ...base, t: 1.95 }), true);
  assert.equal(V.shouldPauseEach({ ...base, t: 2.4 }), true);
  assert.equal(V.shouldPauseEach({ ...base, t: 2.6 }), false, '훨씬 지나간 뒤(건너뜀)는 아님');
  assert.equal(V.shouldPauseEach({ ...base, t: 1.95, pausedFor: 0 }), false);
  assert.equal(V.shouldPauseEach({ ...base, t: 1.95, on: false }), false);
  assert.equal(V.shouldPauseEach({ ...base, t: 1.95, cur: -1 }), false);
});

test('parseScene·sceneUrl·videoIdOf: 유튜브 영상 주소와 시각', () => {
  assert.deepEqual(V.parseScene(`https://www.youtube.com/watch?v=${ID}&t=83s`), { id: ID, t: 83 });
  assert.deepEqual(V.parseScene(`https://youtu.be/${ID}?t=1m5s`), { id: ID, t: 65 });
  assert.deepEqual(V.parseScene(`https://m.youtube.com/watch?v=${ID}&t=1h2m3s`), { id: ID, t: 3723 });
  assert.deepEqual(V.parseScene(`https://www.youtube.com/watch?v=${ID}`), { id: ID, t: 0 });
  assert.deepEqual(V.parseScene(`https://www.youtube.com/watch?v=${ID}&t=12.7`), { id: ID, t: 12 });
  for (const bad of [`https://www.youtube.com/watch?v=short`, `https://example.com/watch?v=${ID}`, `https://www.youtube.com/shorts/${ID}`, `javascript:alert(1)`, '', null, 42]) assert.equal(V.parseScene(bad), null, String(bad));
  assert.equal(V.sceneUrl(ID, 83.9), `https://www.youtube.com/watch?v=${ID}&t=83s`);
  assert.equal(V.sceneUrl(ID, -4), `https://www.youtube.com/watch?v=${ID}&t=0s`);
  assert.equal(V.videoIdOf(`https://www.youtube.com/watch?v=${ID}&list=PL1`), ID);
  assert.equal(V.videoIdOf('https://www.youtube.com/'), null);
});

test('validClip·clipOfCue·clipAt·sceneOf: 장면 구간', () => {
  assert.equal(V.validClip({ start: 1, end: 3 }), true);
  for (const bad of [{ start: 3, end: 1 }, { start: -1, end: 2 }, { start: 0, end: 61 }, { start: 86_399, end: 86_401 }, { start: '1', end: 2 }, null, []]) assert.equal(V.validClip(bad), false, JSON.stringify(bad));
  assert.deepEqual(V.clipOfCue({ start: 1.23456, end: 100 }), { start: 1.23, end: 61.23 }, '60초에서 자른다');

  const cues = [{ start: 10.6, end: 12, text: 'a' }, { start: 12.1, end: 14, text: 'b' }, { start: 20, end: 21, text: 'c' }];
  assert.deepEqual(V.clipAt(cues, 10), { start: 10.6, end: 12 }, '[10, 11) 에서 시작한 줄');
  assert.deepEqual(V.clipAt(cues, 13), { start: 12.1, end: 14 }, '그 시각이 든 줄');
  assert.deepEqual(V.clipAt(cues, 16), { start: 16, end: 22 }, '줄이 없으면 6초');

  assert.deepEqual(V.sceneOf({ url: `https://www.youtube.com/watch?v=${ID}&t=10s` }), { id: ID, t: 10, clip: null, url: `https://www.youtube.com/watch?v=${ID}&t=10s` });
  assert.deepEqual(V.sceneOf({ url: `https://www.youtube.com/watch?v=${ID}&t=10s`, clip: { start: 10.6, end: 12 } }), { id: ID, t: 10, clip: { start: 10.6, end: 12 }, url: `https://www.youtube.com/watch?v=${ID}&t=10s` });
  assert.equal(V.sceneOf({ url: 'https://example.com/' }), null);
  assert.equal(V.sceneOf({}), null);
});

test('lineMessage: 다리 save-phrase 모양(장면 주소 + clip)', () => {
  const msg = V.lineMessage({ cue: { start: 83.456, end: 86.2, text: '  So   it  begins ' }, ko: '이제 시작이다', id: ID, title: 'A talk' });
  assert.deepEqual(msg, { type: 'words', op: 'save-phrase', text: 'So it begins', translation: '이제 시작이다', kind: 'sentence', url: `https://www.youtube.com/watch?v=${ID}&t=83s`, clip: { start: 83.46, end: 86.2 }, title: 'A talk' });
  assert.equal('title' in V.lineMessage({ cue: { start: 0, end: 1, text: 'x y' }, id: ID }), false, '제목이 없으면 칸도 없다');
});

test('contextOf: 앞 3줄·뒤 3줄·제목, 상한 1500·200', () => {
  const cues = 'abcdefgh'.split('').map((c, i) => ({ start: i, end: i + 1, text: c }));
  assert.deepEqual(V.contextOf(cues, 4, 'T'), { before: 'b c d', after: 'f g h', title: 'T' });
  assert.deepEqual(V.contextOf(cues, 0, ''), { before: '', after: 'b c d', title: '' });
  const long = [{ start: 0, end: 1, text: 'x'.repeat(2000) }, { start: 1, end: 2, text: 'now' }];
  const c = V.contextOf(long, 1, 'y'.repeat(300));
  assert.equal(c.before.length, 1500);
  assert.equal(c.title.length, 200);
});

test('annotateBatch: 지금 줄부터 30줄, 물은 낱말은 빼고, 300개까지', () => {
  const cues = [{ text: 'The exploit, the payload.' }, { text: 'Payload again x86' }, { text: 'later words' }].map((c, i) => ({ start: i, end: i + 1, ...c }));
  assert.deepEqual(V.annotateBatch(cues, 0, new Set()).words, ['the', 'exploit', 'payload', 'again', 'later', 'words']);
  assert.deepEqual(V.annotateBatch(cues, 1, new Set(['payload'])).words, ['again', 'later', 'words']);
  assert.deepEqual(V.annotateBatch(cues, 0, new Set(), { maxCues: 1 }).words, ['the', 'exploit', 'payload']);
  const many = [{ start: 0, end: 1, text: Array.from({ length: 400 }, (_, i) => `w${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26) % 26]}`).join(' ') }];
  assert.equal(V.annotateBatch(many, 0, new Set()).words.length, 300);
});

test('previewWords: 처음 나온 순, 원형마다 하나, 횟수', () => {
  const cues = [{ text: 'Exploits and payloads' }, { text: 'one exploit here' }, { text: 'mitigate it' }].map((c, i) => ({ start: i, end: i + 1, ...c }));
  const items = new Map([['exploits', { lemma: 'exploit', gloss: '취약점 공격' }], ['exploit', { lemma: 'exploit', gloss: '취약점 공격' }], ['payloads', { lemma: 'payload', gloss: '페이로드' }], ['mitigate', { lemma: 'mitigate', gloss: '완화하다' }]]);
  assert.deepEqual(V.previewWords(cues, items), [
    { word: 'exploits', lemma: 'exploit', gloss: '취약점 공격', count: 2, first: 0 },
    { word: 'payloads', lemma: 'payload', gloss: '페이로드', count: 1, first: 0 },
    { word: 'mitigate', lemma: 'mitigate', gloss: '완화하다', count: 1, first: 2 },
  ]);
  assert.equal(V.previewWords(cues, items, 1).length, 1);
  assert.deepEqual(V.previewWords(cues, { mitigate: { lemma: 'mitigate', gloss: 'x' } }).map((r) => r.lemma), ['mitigate'], '객체도 받는다');
});

test('koPlan: 지금·다음 4줄·앞 1줄 먼저, all 이면 끝까지 그다음 처음부터', () => {
  const have = new Set();
  const has = (i) => have.has(i);
  assert.equal(V.koPlan(20, 5, has), 5);
  [5, 6, 7, 8, 9].forEach((i) => have.add(i));
  assert.equal(V.koPlan(20, 5, has), 4);
  have.add(4);
  assert.equal(V.koPlan(20, 5, has), -1);
  assert.equal(V.koPlan(20, 5, has, true), 10);
  for (let i = 10; i < 20; i++) have.add(i);
  assert.equal(V.koPlan(20, 5, has, true), 0);
  assert.equal(V.koPlan(3, -1, () => false), 0, '아직 줄 전이면 첫 줄부터');
  assert.equal(V.koPlan(0, 0, () => false, true), -1);
});

test('fontPx·fmtTime·titleOf', () => {
  assert.equal(V.fontPx(720, 100), 26);
  assert.equal(V.fontPx(200, 100), 14, '작은 플레이어도 14px');
  assert.equal(V.fontPx(2000, 160), 44, '44px 위로는 안 간다');
  assert.equal(V.fmtTime(5.9), '0:05');
  assert.equal(V.fmtTime(754), '12:34');
  assert.equal(V.fmtTime(3723), '1:02:03');
  assert.equal(V.titleOf('(3) Buffer overflows explained - YouTube'), 'Buffer overflows explained');
  assert.equal(V.titleOf('YouTube'), 'YouTube');
});

test('tokenize: 악센트 붙은 낱말(café·naïve)은 쪼개지 않고 누를 수 없는 조각으로 둔다(사전은 영어 글자만)', () => {
  const text = 'A café, naïve résumé — au lait';
  const toks = V.tokenize(text);
  assert.equal(toks.map((t) => t.t).join(''), text);
  assert.deepEqual(toks.filter((t) => t.w).map((t) => t.t), ['au', 'lait']);
  assert.ok(toks.some((t) => !t.w && t.t.includes('café')), 'café 는 한 조각 안에 그대로');
});

test('annotateBatch: 글자 합이 maxChars(기본 12000)를 넘기 전에 멈춘다(다리 본문 16KB 상한)', () => {
  const long = (k) => `w${'abcdefghijklmnopqrstuvwxyz'[k % 26]}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(k / 26) % 26]}${'x'.repeat(57)}`;
  const cues = [{ start: 0, end: 1, text: Array.from({ length: 300 }, (_, k) => long(k)).join(' ') }];
  const { words } = V.annotateBatch(cues, 0, new Set());
  assert.ok(words.length < 300 && words.length > 150, String(words.length));
  assert.ok(JSON.stringify({ words }).length < 16 * 1024);
  assert.equal(V.annotateBatch(cues, 0, new Set(), { maxChars: 10 }).words.length, 0);
});

test('코드 검토 7: 60초 넘는 줄의 구간은 소수 오차 없이 60초 안(다리 parseClip 이 거절하지 않게), 아주 짧은 줄은 구간 없이 저장', async () => {
  const { parseClip } = await import('../bridge/words.mjs');
  for (let s = 0; s < 120; s += 0.0137) {
    const clip = V.clipOfCue({ start: s, end: s + 75 });
    assert.equal(V.validClip(clip), true, JSON.stringify(clip));
    assert.deepEqual(parseClip(clip), clip, `다리도 받는다 ${JSON.stringify(clip)}`);
  }
  assert.deepEqual(V.clipOfCue({ start: 0.145, end: 70 }), { start: 0.14, end: 60.14 }, '끝은 반올림한 시작 + 60초');
  assert.equal(V.validClip({ start: 0.14, end: 60.15 }), false, '60.01초는 길다');
  assert.equal(V.validClip({ start: 1.001, end: 1.004 }), false, '1/100초 안의 구간은 없다');
  const tiny = V.lineMessage({ cue: { start: 5.001, end: 5.003, text: 'Hi there' }, id: ID });
  assert.equal('clip' in tiny, false);
});
