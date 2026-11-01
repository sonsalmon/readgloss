// 과제 T53p(변경 기록 28-22): 넷플릭스 어댑터·IMSC 자막·MAIN 월드 hook.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/video-core.js');
const V = globalThis.readglossVideo;

test('parseImsc: tickRate 틱·여러 줄·br 은 공백', () => {
  const xml = [
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">',
    '<body><div>',
    '<p begin="10000000t" end="25000000t">Hello<br/>world</p>',
    '<p begin="3s" dur="1.5s"><span>Next</span> line</p>',
    '</div></body></tt>',
  ].join('');
  assert.deepEqual(V.parseImsc(xml), [
    { start: 1, end: 2.5, text: 'Hello world' },
    { start: 3, end: 4.5, text: 'Next line' },
  ]);
});

test('parseImsc: 기본 tickRate 1천만·단위 없는 값은 틱·시계 시각·빈 문서', () => {
  assert.deepEqual(V.parseImsc(''), []);
  assert.deepEqual(V.parseImsc('<tt><body></body></tt>'), []);
  assert.deepEqual(V.parseImsc('<tt><body><p begin="15000000" end="20000000">A</p></body></tt>'), [
    { start: 1.5, end: 2, text: 'A' },
  ]);
  assert.deepEqual(V.parseImsc('<tt><body><p begin="00:00:05.500" end="00:00:07.000">B</p></body></tt>'), [
    { start: 5.5, end: 7, text: 'B' },
  ]);
});

test('netflixIdOf: /watch/<숫자> 만 영상 id 로 본다', () => {
  assert.equal(V.netflixIdOf('https://www.netflix.com/watch/81234567?trackId=14170286'), '81234567');
  assert.equal(V.netflixIdOf('https://www.netflix.com/watch/81234567/'), '81234567');
  assert.equal(V.netflixIdOf('https://www.netflix.com/title/81234567'), null);
  assert.equal(V.netflixIdOf('https://www.youtube.com/watch?v=abcdefghijk'), null);
  assert.equal(V.netflixIdOf('https://example.com/watch/81234567'), null);
  assert.equal(V.netflixIdOf(null), null);
});

test('adapterFor: 유튜브·넷플릭스·연습 페이지를 가르고 기타는 null', () => {
  assert.equal(V.adapterFor(new URL('https://www.youtube.com/watch?v=abcdefghijk')).name, 'youtube');
  assert.equal(V.adapterFor(new URL('https://m.youtube.com/watch?v=abcdefghijk')).name, 'youtube');
  assert.equal(V.adapterFor(new URL('https://www.netflix.com/watch/81234567')).name, 'netflix');
  assert.equal(V.adapterFor(new URL('http://127.0.0.1:47831/practice')).name, 'practice');
  assert.equal(V.adapterFor(new URL('https://example.com/watch/81234567')), null);
  assert.equal(V.adapterFor(null), null);
  assert.equal(V.adapterFor({ hostname: 'www.netflix.com', pathname: '/watch/81234567' }).name, 'netflix');
});

test('넷플릭스 장면 주소: 숫자 id 는 /watch/<id>?t=<초>', () => {
  assert.equal(V.sceneUrl('81234567', 12.9), 'https://www.netflix.com/watch/81234567?t=12');
  assert.deepEqual(V.parseScene('https://www.netflix.com/watch/81234567?t=12'), { id: '81234567', t: 12 });
  assert.equal(V.sceneUrl('abcdefghijk', 12.9), 'https://www.youtube.com/watch?v=abcdefghijk&t=12s', '유튜브는 그대로');
});

function loadHook(extra = {}) {
  const messages = [];
  const listeners = [];
  const json = { parse: (...args) => JSON.parse(...args) }; // 가짜 window.JSON: 전역 JSON 을 건드리지 않는다
  const win = {
    JSON: json,
    postMessage(msg) { messages.push(msg); },
    addEventListener(type, cb) { if (type === 'message') listeners.push(cb); },
    ...extra,
  };
  const prevWindow = globalThis.window;
  const prevLocation = globalThis.location;
  globalThis.window = win;
  globalThis.location = { origin: 'https://www.netflix.com', href: 'https://www.netflix.com/watch/81234567' };
  const href = new URL('../extension/nf-hook.js', import.meta.url);
  href.searchParams.set('test', String(Math.random()));
  return import(href.href).then(() => ({
    win,
    messages,
    listeners,
    restore() {
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
      if (prevLocation === undefined) delete globalThis.location;
      else globalThis.location = prevLocation;
    },
  }));
}

test('nf-hook: JSON.parse 결과·예외는 그대로 두고 imsc1.1 주소·언어를 모아 보낸다', async () => {
  const h = await loadHook();
  try {
    const payload = {
      result: {
        timedtexttracks: [
          { bcp47: 'en', ttDownloadables: { 'imsc1.1': { urls: [{ url: 'https://www.netflix.com/api/caption/en.imsc' }] } } },
          { language: 'ko', ttDownloadables: { 'imsc1.1': { urls: [{ url: 'https://www.netflix.com/api/caption/ko.imsc' }] } } },
          { bcp47: 'en', ttDownloadables: {} },
        ],
      },
    };
    const text = JSON.stringify(payload);
    const out = h.win.JSON.parse(text);
    assert.deepEqual(out, payload, '원래 결과 그대로');
    assert.deepEqual(h.messages, [{
      source: 'readgloss-nf',
      type: 'tracks',
      tracks: [
        { url: 'https://www.netflix.com/api/caption/en.imsc', lang: 'en' },
        { url: 'https://www.netflix.com/api/caption/ko.imsc', lang: 'ko' },
      ],
    }]);

    assert.throws(() => h.win.JSON.parse('{"broken":'), SyntaxError, '깨진 JSON 예외도 그대로');

    // replay: 늦게 뜬 content script 에 최근 트랙을 다시 보낸다
    h.listeners[0]({ source: h.win, data: { source: 'readgloss-nf', type: 'replay' } });
    assert.deepEqual(h.messages[h.messages.length - 1], h.messages[0]);
  } finally {
    h.restore();
  }
});

test('nf-hook: 2026-11 재생 응답(result.textTracks[].downloadables)에서도 imsc1.1 주소를 모은다', async () => {
  const h = await loadHook();
  try {
    const cdn = 'https://ipv4-c005-x.1.oca.nflxvideo.net/?o=1&v=326';
    const payload = {
      result: {
        audioTracks: [{ trackType: 'PRIMARY' }],
        textTracks: [
          { type: 'timedtext', language: 'en', downloadables: { 'imsc1.1': { urls: [{ url: `${cdn}&en` }] }, 'nflx-cmisc': {} } },
          { type: 'timedtext', language: 'ko', downloadables: { 'imsc1.1': { urls: [{ url: `${cdn}&ko` }] } } },
          { type: 'timedtext', language: 'ja', downloadables: { 'nflx-cmisc': { urls: [{ url: `${cdn}&ja` }] } } },
        ],
      },
    };
    const out = h.win.JSON.parse(JSON.stringify(payload));
    assert.deepEqual(out, payload, '원래 결과 그대로');
    assert.deepEqual(h.messages, [{ source: 'readgloss-nf', type: 'tracks', tracks: [{ url: `${cdn}&en`, lang: 'en' }, { url: `${cdn}&ko`, lang: 'ko' }] }]);
    h.win.JSON.parse(JSON.stringify({ textTracks: [{ language: 'en', downloadables: { 'imsc1.1': { urls: [{ url: `${cdn}&other` }] } } }] }));
    assert.equal(h.messages.length, 1, 'audioTracks 없는 다른 textTracks 는 재생 응답이 아니라 무시');
    h.win.JSON.parse(JSON.stringify({ result: { movieId: 80004162, audioTracks: [], textTracks: [{ language: 'en', downloadables: { 'imsc1.1': { urls: [{ url: `${cdn}&ep2` }] } } }] } }));
    assert.deepEqual(h.messages[1].tracks, [{ url: `${cdn}&ep2`, lang: 'en', movieId: '80004162' }], '화 번호(movieId)를 같이 싣는다');
  } finally {
    h.restore();
  }
});

test('nf-hook: 플레이어 API 로 seek(ms)·play·pause·time 을 처리한다', async () => {
  const calls = [];
  const api = {
    getAllPlayerSessionIds: () => ['preview-session', 'watch-session'],
    getVideoPlayerBySessionId: (id) => ({
      seek: (ms) => calls.push(['seek', id, ms]),
      play: () => calls.push(['play', id]),
      pause: () => calls.push(['pause', id]),
      getCurrentTime: () => 12345,
    }),
  };
  const netflix = { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: api }) } } } };
  const h = await loadHook({ netflix });
  try {
    const send = (data) => h.listeners[0]({ source: h.win, data: { source: 'readgloss-nf', ...data } });
    send({ type: 'seek', ms: 1234.6 });
    send({ type: 'play' });
    send({ type: 'pause' });
    send({ type: 'time' });
    assert.deepEqual(calls, [
      ['seek', 'watch-session', 1235],
      ['play', 'watch-session'],
      ['pause', 'watch-session'],
    ]);
    assert.deepEqual(h.messages[h.messages.length - 1], { source: 'readgloss-nf', type: 'time', ms: 12345 });
  } finally {
    h.restore();
  }
});

test('nf-hook: 같은 트랙은 한 번만 모으고 reviver 를 그대로 넘긴다', async () => {
  const h = await loadHook();
  try {
    const payload = { result: { timedtexttracks: [{ bcp47: 'en-US', ttDownloadables: { 'imsc1.1': { urls: [{ url: 'https://www.netflix.com/api/caption/en.imsc' }] } } }] } };
    const text = JSON.stringify(payload);
    const out = h.win.JSON.parse(text, (key, value) => (key === 'bcp47' ? 'en-GB' : value));
    assert.deepEqual(out, { result: { timedtexttracks: [{ bcp47: 'en-GB', ttDownloadables: { 'imsc1.1': { urls: [{ url: 'https://www.netflix.com/api/caption/en.imsc' }] } } }] } });
    h.win.JSON.parse(text, (key, value) => (key === 'bcp47' ? 'en-GB' : value));
    assert.equal(h.messages.length, 1, '같은 주소·언어는 다시 보내지 않는다');
  } finally {
    h.restore();
  }
});

test('video-subs 소스: 넷플릭스 자막 트랙은 영어·한국어만 받는다', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.ok(code.includes("if (!url || (lang !== 'en' && lang !== 'ko')) continue;"));
});

test('nfTrackUrlOk: 같은 출처·nflxvideo.net CDN(https)만 받고 다른 호스트·http 는 버린다', () => {
  const base = 'https://www.netflix.com/watch/81234567';
  assert.equal(V.nfTrackUrlOk('/sub/en.xml', base), true);
  assert.equal(V.nfTrackUrlOk('https://www.netflix.com/sub/en.xml', base), true);
  assert.equal(V.nfTrackUrlOk('https://ipv4-c001-icn001.1.oca.nflxvideo.net/?o=1', base), true);
  assert.equal(V.nfTrackUrlOk('https://evil.example/sub.xml', base), false);
  assert.equal(V.nfTrackUrlOk('https://nflxvideo.net.evil.example/x', base), false);
  assert.equal(V.nfTrackUrlOk('https://evilnflxvideo.net/x', base), false);
  assert.equal(V.nfTrackUrlOk('http://a.nflxvideo.net/x', base), false);
  assert.equal(V.nfTrackUrlOk('javascript:alert(1)', base), false);
});

test('소스: nfAddTracks 가 nfTrackUrlOk 를 쓰고, [영상] 탭은 adapterFor 로 등록한다', async () => {
  const { readFileSync } = await import('node:fs');
  const rd = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
  assert.match(rd('video-subs.js'), /V\.nfTrackUrlOk\(url, location\.href\)/);
  assert.match(rd('panel-video.js'), /V\.adapterFor\?\.\(location\)/);
  assert.doesNotMatch(rd('panel-video.js'), /youtube\\\.com\$\/\.test\(location\.hostname\)/);
  assert.match(rd('panel-words.js'), /연습 페이지에서 파일을 다시 골라 주세요/);
});

test('video-subs 소스: 넷플릭스 자막은 실린 화 번호(movieId)로 붙이고, 없을 때만 지금 주소의 화로 본다', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
  assert.match(code, /String\(track\?\.movieId \?\? ''\)\) \? String\(track\.movieId\) : V\.netflixIdOf\(location\.href\)/);
});

test('nf-hook: 강제 자막은 빼고, CC 는 cc 표시를 붙인다', async () => {
  const h = await loadHook();
  try {
    const u = (x) => ({ 'imsc1.1': { urls: [{ url: `https://a.1.oca.nflxvideo.net/?${x}` }] } });
    h.win.JSON.parse(JSON.stringify({ result: { movieId: 1, audioTracks: [], textTracks: [
      { language: 'en', rawTrackType: 'subtitles', isForcedNarrative: true, downloadables: u('forced') },
      { language: 'en', rawTrackType: 'closedcaptions', trackType: 'ASSISTIVE', downloadables: u('cc') },
      { language: 'en', rawTrackType: 'subtitles', trackType: 'PRIMARY', downloadables: u('sub') },
    ] } }));
    assert.deepEqual(h.messages[0].tracks.map((t) => [t.url.split('?')[1], t.cc === true]), [['cc', true], ['sub', false]]);
  } finally {
    h.restore();
  }
});

test('pickTracks: 같은 언어면 일반 자막(manual)을 CC 보다 먼저 고른다', async () => {
  await import('../extension/video-core.js');
  const V = globalThis.readglossVideo;
  const cc = { lang: 'en', kind: 'cc', cues: [{ start: 0, end: 1, text: 'HI.' }], ts: 9 };
  const sub = { lang: 'en', kind: 'manual', cues: [{ start: 0, end: 1, text: 'Hi.' }], ts: 1 };
  assert.equal(V.pickTracks([cc, sub]).main, sub);
  assert.equal(V.pickTracks([cc]).main, cc, 'CC 밖에 없으면 CC');
  const kcc = { lang: 'ko', kind: 'cc', cues: [{ start: 0, end: 1, text: '[웃음]' }], ts: 9 };
  const ksub = { lang: 'ko', kind: 'manual', cues: [{ start: 0, end: 1, text: '안녕' }], ts: 1 };
  assert.equal(V.pickTracks([kcc, ksub]).ko, ksub, '한국어도 일반 자막 먼저');
});
