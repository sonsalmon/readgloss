// 과제 T51b·T51c·T51e·T51f 연결 시험: manifest, background(video-open·video-pending·words clip), content.js 전체 화면, 설정, 패널 표, 자막 층 소스.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
const ID = 'dQw4w9WgXcQ';

test('manifest: 유튜브만 MAIN world·document_start 로 yt-hook.js, 본 목록 끝에 영상 파일 셋', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.deepEqual(m.content_scripts[1], { matches: ['https://www.youtube.com/*'], js: ['yt-hook.js'], run_at: 'document_start', world: 'MAIN', all_frames: false });
  const js = m.content_scripts[0].js;
  assert.deepEqual(js.slice(-3), ['video-core.js', 'video-subs.js', 'panel-video.js']);
  assert.ok(js.indexOf('selection-core.js') < js.indexOf('video-subs.js'), '자막 층은 selection-core(isTypingPath·expressionRows) 뒤');
  assert.ok(js.indexOf('saved-marks-core.js') < js.indexOf('video-subs.js'));
  assert.deepEqual(m.permissions, ['storage'], '새 권한 없음(tabs.create 는 권한이 필요 없다)');
});

// background.js 를 가짜 chrome 으로 돌린다
function background({ fetchLog = [] } = {}) {
  const listeners = [];
  const store = {};
  const tabs = [];
  const area = {
    get: async (k) => (k in store ? { [k]: store[k] } : {}),
    set: async (o) => Object.assign(store, o),
    remove: async (k) => { delete store[k]; },
  };
  const chrome = {
    runtime: { id: 'me', onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: area, session: area },
    action: { onClicked: { addListener() {} } },
    tabs: { create: async (o) => (tabs.push(o), { id: 1 }), update() {}, sendMessage: async () => {}, onRemoved: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    windows: { onRemoved: { addListener() {} } },
  };
  const fetch = async (url, init = {}) => {
    fetchLog.push({ url, init });
    if (url.endsWith('/pair')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const ctx = vm.createContext({ chrome, fetch, Response, URL, JSON, Date, Promise, console });
  vm.runInContext(read('background.js'), ctx);
  // vm 안에서 만든 객체는 프로토타입이 달라 deepEqual 이 어긋나서 JSON 으로 옮겨 받는다
  const send = (msg) => new Promise((done) => {
    const resolve = (v) => done(v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    let async = false;
    for (const fn of listeners) if (fn(msg, { id: 'me', tab: { id: 7 } }, resolve) === true) async = true;
    if (!async) setTimeout(() => resolve(undefined), 20);
  });
  return { send, store, tabs, fetchLog };
}

test('background video-open: 유튜브 영상 주소만, 구간이 있으면 pendingClip 을 남기고 새 탭', async () => {
  const b = background();
  const url = `https://www.youtube.com/watch?v=${ID}&t=83s`;
  assert.deepEqual(await b.send({ type: 'video-open', url, clip: { id: ID, start: 83.46, end: 86.2 } }), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(b.tabs)), [{ url, active: true }]);
  assert.equal(b.store.pendingClip.id, ID);
  assert.deepEqual([b.store.pendingClip.start, b.store.pendingClip.end], [83.46, 86.2]);

  for (const bad of [
    { url: 'https://evil.example/watch?v=dQw4w9WgXcQ' },
    { url: 'javascript:alert(1)' },
    { url: 'https://www.youtube.com/watch?v=short' },
    { url, clip: { id: 'otherVideo1', start: 1, end: 2 } },
    { url, clip: { id: ID, start: 5, end: 2 } },
    { url, clip: { id: ID, start: 0, end: 61 } },
  ]) assert.deepEqual(await b.send({ type: 'video-open', ...bad }), { error: 'invalid-video' }, JSON.stringify(bad));
  assert.equal(b.tabs.length, 1, '틀리면 탭을 열지 않는다');
});

test('background video-pending: 같은 영상이면 꺼내 주고 지운다, 다른 영상이면 남긴다, 2분 지나면 버린다', async () => {
  const b = background();
  b.store.pendingClip = { id: ID, start: 1, end: 3, ts: Date.now() };
  assert.deepEqual(await b.send({ type: 'video-pending', id: 'otherVideo1' }), { pending: null });
  assert.ok(b.store.pendingClip, '다른 영상 탭이 물어도 남겨 둔다');
  assert.deepEqual(await b.send({ type: 'video-pending', id: ID }), { pending: { id: ID, start: 1, end: 3 } });
  assert.equal(b.store.pendingClip, undefined);
  b.store.pendingClip = { id: ID, start: 1, end: 3, ts: Date.now() - 121_000 };
  assert.deepEqual(await b.send({ type: 'video-pending', id: ID }), { pending: null });
  assert.equal(b.store.pendingClip, undefined);
});

test('background words 중계: save-phrase 의 clip 을 다리로 넘긴다', async () => {
  const fetchLog = [];
  const b = background({ fetchLog });
  await b.send({ type: 'words', op: 'save-phrase', text: 'So it begins', translation: '', kind: 'sentence', url: `https://www.youtube.com/watch?v=${ID}&t=83s`, clip: { start: 83.46, end: 86.2 } });
  const post = fetchLog.find((f) => f.url.endsWith('/words'));
  assert.deepEqual(JSON.parse(post.init.body).clip, { start: 83.46, end: 86.2 });
});

test('content.js: 카드·확인 메시지는 전체 화면 요소 안에(mountRoot), 닫힐 때 readgloss:card-closed, 자막 층 더블클릭 무시', () => {
  const src = read('content.js');
  assert.match(src, /function mountRoot\(\)/);
  assert.equal((src.match(/mountRoot\(\)\.append\(/g) ?? []).length, 2, '카드와 확인 메시지 둘 다');
  assert.doesNotMatch(src, /document\.documentElement\.append\(/, '문서 맨 위에 바로 붙이는 곳이 남지 않았다');
  assert.match(src, /fs\.localName !== 'video'/, '영상 요소 자체가 전체 화면이면 문서에');
  assert.match(src, /new CustomEvent\('readgloss:card-closed'\)/);
  assert.match(src, /isOpen: \(\) => Boolean\(host\)/);
  assert.match(src, /n\.localName === 'readgloss-subs'/);
  assert.match(src, /'fullscreenchange', \(\) => host && close\(\)/);
  assert.match(src, /const sx = current\.fs \? 0 : scrollX/, '전체 화면 안에서는 화면 좌표');
});

test('설정: video 기본값·범위, reviewMode', async () => {
  await import('../extension/settings-core.js');
  const S = globalThis.readglossSettings;
  assert.deepEqual(S.DEFAULTS.video, { subs: true, ko: true, hard: true, hoverPause: true, autoCC: true, fontPct: 100, hide: 'off', pauseEach: false });
  assert.equal(S.DEFAULTS.reviewMode, 'flip');
  const n = S.normalize({ video: { fontPct: 999, hide: 'nope', ko: 'yes', pauseEach: true }, reviewMode: 'choice' });
  assert.equal(n.video.fontPct, 160);
  assert.equal(n.video.hide, 'off');
  assert.equal(n.video.ko, true);
  assert.equal(n.video.pauseEach, true);
  assert.equal(n.reviewMode, 'choice');
  assert.equal(S.normalize({ reviewMode: 'quiz' }).reviewMode, 'flip');
  assert.equal(S.merge(S.normalize({}), { video: { hide: 'all' } }).video.subs, true, '한 칸만 바꿔도 나머지는 그대로');
});

test('패널 표: 영상 자막 켜기 6개·자막 크기·가리기, 자막 층을 눌러도 패널은 안 닫힌다', async () => {
  await import('../extension/settings-core.js');
  await import('../extension/panel.js');
  const C = globalThis.readglossPanelCore;
  for (const p of ['video.subs', 'video.ko', 'video.hard', 'video.hoverPause', 'video.autoCC', 'video.pauseEach']) assert.ok(C.TOGGLES.some((t) => t.path === p), p);
  assert.deepEqual(C.RANGES.find((r) => r.path === 'video.fontPct'), { path: 'video.fontPct', min: 60, max: 160, step: 10 });
  assert.deepEqual(C.CHOICES.find((c) => c.path === 'video.hide').options.map(([v]) => v), ['off', 'hard', 'all']);
  assert.equal(C.isCardPath([{ localName: 'readgloss-subs' }]), true);
  const src = read('panel.js');
  assert.match(src, /text: '영상 자막'/);
});

test('video-subs.js 소스: 글은 textContent 로만, 플레이어 클릭 막기, 광고·CC·유튜브 자막 숨김, 사전 카드·풀이·번역·주석 요청', () => {
  const src = read('video-subs.js');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(src, /!\/\(\^\|\\\.\)youtube\\\.com\$\/\.test\(location\.hostname\)/, '유튜브에서만');
  assert.match(src, /\['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'\]/);
  assert.match(src, /ad-showing/);
  assert.match(src, /\.ytp-subtitles-button/);
  assert.match(src, /getAttribute\('aria-pressed'\) !== 'false'/, 'CC 모양이 바뀌면 켜진 것으로');
  assert.match(src, /data-readgloss-subs/);
  assert.match(src, /\.ytp-caption-window-container \{ display: none !important; \}/);
  assert.match(src, /new CustomEvent\('readgloss:lookup'/);
  assert.match(src, /source: \{ url: V\.sceneUrl\(S\.id, cue\.start\), title \}/, '단어장에 장면 주소가 남는다');
  assert.match(src, /type: 'translate-context'/);
  assert.match(src, /type: 'mt', text/);
  assert.match(src, /type: 'annotate', words, level: settings\.level/);
  assert.match(src, /type: 'video-pending', id/);
  assert.match(src, /V\.keyAction\(e\)/);
  assert.match(src, /Sel\.isTypingPath\(path, e\.isComposing\)/);
  assert.match(src, /source: SOURCE, type: 'replay'/);
});

test('panel-video.js: 유튜브에서만 [영상] 탭(맨 앞), 대본·어려운 단어·한국어 모두', () => {
  const src = read('panel-video.js');
  assert.match(src, /youtube\\\.com\$\/\.test\(location\.hostname\)/);
  assert.match(src, /push\(\{ id: 'video', title: '영상', order: 5, render \}\)/);
  assert.match(src, /annotateAll\(\)/);
  assert.match(src, /setKoAll\(/);
  assert.match(src, /V\.previewWords\(/);
  assert.doesNotMatch(src, /innerHTML/);
});

test('BUG-002: 패널 탭 이름은 한 줄, 넘치면 탭 줄을 옆으로 넘긴다(유튜브에서 탭 6개)', () => {
  const src = read('panel.js');
  assert.match(src, /\.tabs \{[^}]*overflow-x: auto/);
  assert.match(src, /\.tab \{[^}]*flex: none; white-space: nowrap/);
});

test('BUG-001·004: 장면 구간은 자막이 없어도 끝에서 멈추고, 두 줄 묶음이 Tab 으로 포커스를 받는다', () => {
  const src = read('video-subs.js');
  const tick = src.slice(src.indexOf('function tick('), src.indexOf('function holdOn('));
  assert.ok(tick.indexOf('if (S.clip)') < tick.indexOf('if (!S.cues.length)'), '구간 확인이 줄 확인보다 먼저');
  assert.match(src, /lines\.tabIndex = 0;/);
  assert.match(src, /box\.append\(lines, bar, note, msg\)/, 'Tab 차례: 두 줄 → 막대 → 풀이');
  assert.match(src, /\.note \{ order: -2; \} \.bar \{ order: -1; \}/, '화면 차례는 그대로(풀이 → 막대 → 두 줄)');
});
