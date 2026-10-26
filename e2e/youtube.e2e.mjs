// 영상 자막 층 끝까지 시험(변경 기록 27): 진짜 크로미엄에 확장을 올리고, 가짜 유튜브 페이지(가로채기)와 진짜 다리(가짜 사전·맥 번역·AI)로 돌린다.
// 유튜브에 접속하지 않는다. npm test 와 따로: node e2e/youtube.e2e.mjs  (playwright 가 있어야 한다. 없으면 건너뛴다.)
// 포트 47831(확장이 부르는 다리 자리)을 쓰니 상시 다리가 떠 있으면 먼저 꺼야 한다. E2E_SHOTS=<폴더> 면 화면을 찍어 둔다.
// 경우 번호(F01-H1 …)는 replica/test-plan.md.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createBridge } from '../bridge/server.mjs';
import { createDict } from '../bridge/dict.mjs';
import { createMt } from '../bridge/mt.mjs';
import { extensionIdFromKey } from '../bridge/ext-id.mjs';
import { phraseId } from '../bridge/words.mjs';

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.log('playwright 가 없어서 건너뜀');
  process.exit(0);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT_DIR = join(ROOT, 'extension');
const ID = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${ID}`;
const manifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'));
const extensionId = extensionIdFromKey(manifest.key);
const SHOTS = process.env.E2E_SHOTS;

// ---- 가짜 유튜브 ----
// 영상 id 가 nocc 로 시작하면 자막 없는 영상(CC 단추가 꺼져 있다)
const LINES = [
  [500, 2000, 'So today we talk about buffer overflows.'],
  [2600, 2000, 'Attackers exploit the bug to deliver a payload.'],
  [4700, 1800, 'Mitigations make that much harder.'],
  [6600, 1900, "Let's delve into privilege escalation."],
  [8600, 1800, 'That is all for now.'],
];
const json3 = JSON.stringify({ wireMagic: 'pb3', events: [{ tStartMs: 0, dDurationMs: 99999, id: 1 }, ...LINES.map(([t, d, s]) => ({ tStartMs: t, dDurationMs: d, segs: [{ utf8: s }] }))] });
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Buffer overflows explained - YouTube</title></head><body style="margin:0;background:#fff">
<div id="movie_player" class="html5-video-player" style="position:relative;width:960px;height:540px;background:#000;overflow:hidden">
  <div class="html5-video-container"><video class="html5-main-video" preload="auto" style="width:100%;height:100%"></video></div>
  <div class="ytp-caption-window-container" id="ytcaps" style="position:absolute;bottom:80px;width:100%;color:#fff;text-align:center">YT CAPTIONS</div>
  <div class="ytp-chrome-bottom" style="position:absolute;bottom:0;left:0;right:0;height:48px"><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div>
</div>
<p id="below">below the player <button id="fs">fullscreen</button></p>
<script>
  const vid = new URLSearchParams(location.search).get('v') || '';
  // 무음 WAV(8kHz·8bit·모노 20초)를 blob 으로 — 가로챈 응답은 범위 요청이 안 돼서 되감기가 안 된다
  (() => {
    const n = 8000 * 20, b = new Uint8Array(44 + n).fill(0x80), d = new DataView(b.buffer);
    const w = (o, t) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    w(0, 'RIFF'); d.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, 8000, true); d.setUint32(28, 8000, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true); w(36, 'data'); d.setUint32(40, n, true);
    document.querySelector('video').src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  })();
  document.getElementById('fs').addEventListener('click', () => document.getElementById('movie_player').requestFullscreen());
  // 유튜브 흉내: 영상을 누르면 재생·멈춤, ←·→ 는 5초 이동(페이지 단축키), ?ad=N 이면 N초 광고
  const v0 = document.querySelector('video');
  document.querySelector('.html5-video-container').addEventListener('click', () => (v0.paused ? v0.play() : v0.pause()));
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') v0.currentTime += 5; else if (e.key === 'ArrowLeft') v0.currentTime -= 5; });
  const ad = Number(new URLSearchParams(location.search).get('ad') || 0);
  if (ad) { const mp = document.getElementById('movie_player'); mp.classList.add('ad-showing'); setTimeout(() => mp.classList.remove('ad-showing'), ad * 1000); }
  const cc = document.querySelector('.ytp-subtitles-button');
  if (vid.startsWith('nocc')) { cc.setAttribute('aria-disabled', 'true'); cc.style.display = 'none'; }
  // 플레이어 흉내: CC 를 켜면 자막을 XHR 로 받는다
  cc.addEventListener('click', () => {
    if (cc.getAttribute('aria-disabled') === 'true') return;
    const on = cc.getAttribute('aria-pressed') !== 'true'; cc.setAttribute('aria-pressed', String(on));
    if (on) { const x = new XMLHttpRequest(); x.open('GET', '/api/timedtext?v=' + vid + '&lang=en&fmt=json3&pot=abc'); x.send(); }
  });
</script></body></html>`;

// ---- 진짜 다리(가짜 사전·맥 번역·AI) ----
const dataDir = mkdtempSync(join(tmpdir(), 'rg-e2e-'));
const asked = { context: [] };
const bridge = createBridge({
  ask: async () => '{"gloss":"뜻"}',
  askTranslate: async () => '{"translation":"번역"}',
  askContext: async (prompt) => (asked.context.push(prompt), JSON.stringify({ translation: '공격자는 그 버그를 악용해 페이로드를 보낸다.', note: '버그를 노려 이득을 얻는다는 뜻', expressions: [{ en: 'deliver a payload', ko: '페이로드를 보내다' }] })),
  cacheFile: join(dataDir, 'cache.json'),
  tokenFile: join(dataDir, 'token'),
  extensionId,
  dict: createDict({ bin: process.execPath, args: [join(ROOT, 'fixtures', 'fake-dict.mjs')], timeoutMs: 10_000 }),
  mt: createMt({ bin: process.execPath, args: [join(ROOT, 'fixtures', 'fake-mt.mjs')], timeoutMs: 5000, firstTimeoutMs: 10_000 }),
  learningDir: join(dataDir, 'learning'),
  tutorSessionsDir: join(dataDir, 'sessions'),
});
await bridge.listen(47831);
let bridgeUp = true;

const userDir = mkdtempSync(join(tmpdir(), 'rg-e2e-profile-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium', // 새 headless(확장 지원)
  headless: true,
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1280, height: 900 },
});
const results = [];
const consoleErrors = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`ok - ${name}`);
  } catch (e) {
    results.push(['FAIL', name]);
    console.log(`FAIL - ${name}\n  ${String(e?.stack || e).split('\n').slice(0, 6).join('\n  ')}`);
  }
};

// 페이지 하나를 다루는 도구들. 닫힌 shadow 안은 CDP(DOM.getDocument pierce)로 찾는다.
async function tools(page) {
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  async function call(nodeId, fn) {
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, returnByValue: true, awaitPromise: true });
    return r.result.value;
  }
  async function shadowNodes(hostName, cls) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const out = [];
    const hasClass = (n) => {
      const a = n.attributes ?? [];
      for (let i = 0; i < a.length; i += 2) if (a[i] === 'class' && a[i + 1].split(/\s+/).includes(cls)) return true;
      return false;
    };
    const walk = (n, inside) => {
      if (inside && n.nodeType === 1 && hasClass(n)) out.push(n.nodeId);
      for (const c of n.children ?? []) walk(c, inside);
      for (const sr of n.shadowRoots ?? []) walk(sr, inside || n.localName === hostName);
      if (n.contentDocument) walk(n.contentDocument, inside);
    };
    walk(root, false);
    return out;
  }
  // 닫힌 shadow root 하나를 통째로 잡고 그 안에서 함수를 돌린다(찾기·누르기를 한 번에 — 그 사이 다시 그려져도 안 어긋난다)
  async function inShadow(hostName, fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        let sr = null;
        const walk = (n) => {
          if (sr) return;
          if (n.localName === hostName && n.shadowRoots?.length) sr = n.shadowRoots[0];
          for (const c of n.children ?? []) walk(c);
        };
        walk(root);
        assert.ok(sr, `${hostName} shadow 없음`);
        return await call(sr.nodeId, fn);
      } catch (e) {
        if (attempt >= 3 || !/No node with given id/.test(String(e?.message))) throw e;
      }
    }
  }
  const subs = (fn) => inShadow('readgloss-subs', fn);
  const panel = (fn) => inShadow('readgloss-ui', fn);
  const card = (fn) => inShadow('readgloss-card', fn);
  // 영어 줄 글(뜻 풍선 .g 는 뺀다)
  const enText = () => subs(`function(){ const e = this.querySelector('.en'); return e && [...e.childNodes].map((n) => (n.nodeType === 3 ? n.data : n.firstChild?.textContent ?? '')).join('') }`).catch(() => null);
  const clickWord = (w) => subs(`function(){ const s = [...this.querySelectorAll('.w')].find((n) => n.firstChild?.textContent === ${JSON.stringify(w)}); if (s) s.click(); return Boolean(s) }`);
  const barButton = (label) => subs(`function(){ const b = [...this.querySelectorAll('.bar button')].find((x) => x.textContent === ${JSON.stringify(label)}); if (b) b.click(); return Boolean(b) }`);
  const until = async (fn, ms = 8000, what = '조건') => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`${what}: 시간 초과`);
      await page.waitForTimeout(100);
    }
  };
  const seek = (t, play = false) => page.evaluate(([t, play]) => { const v = document.querySelector('video'); v.currentTime = t; if (play) v.play(); else v.pause(); }, [t, play]);
  const vtime = () => page.evaluate(() => document.querySelector('video').currentTime);
  const paused = () => page.evaluate(() => document.querySelector('video').paused);
  const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
  // 패널 열기: 밀려 들어오는 전환(.2초)이 끝날 때까지 기다린다(화면 찍기·크기 재기가 중간 모습이 되지 않게)
  const openPanel = async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('readgloss:open-panel')));
    await until(() => panel(`function(){ const p = this.querySelector('.panel'); return p && getComputedStyle(p).transform === 'none' && getComputedStyle(p).visibility === 'visible' }`).catch(() => false), 3000, '패널 열림');
  };
  // 진짜 마우스 클릭(isTrusted): 페이지 스크립트의 .click() 을 무시하는 단추([장면] 등)용. pick 은 shadow 안에서 단추를 고르는 식
  // 자리를 재고 누르는 사이 패널이 다시 그려지면(늦게 온 자료로 줄이 밀림) 엉뚱한 곳을 누르니, 두 번 잰 자리가 같고 그 점에 그 단추가 있을 때 누른다
  const trustedClick = async (inside, pick) => {
    let prev = null;
    for (let k = 0; k < 30; k++) {
      const r = await inside(`function(){ const b = (${pick}).call(this); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const q = b.getBoundingClientRect(); const x = q.left + q.width / 2, y = q.top + q.height / 2; const hit = this.elementFromPoint(x, y); return { x, y, hit: Boolean(hit && (hit === b || b.contains(hit))) } }`);
      if (r?.hit && prev && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1) return void (await page.mouse.click(r.x, r.y));
      prev = r;
      await page.waitForTimeout(150);
    }
    assert.fail('누를 단추가 자리 잡지 않았다');
  };
  const selectTab = (name) => until(() => panel(`function(){ const t = [...this.querySelectorAll('.tab')].find((b) => b.textContent === ${JSON.stringify(name)}); if (t) t.click(); return Boolean(t) }`), 3000, `${name} 탭`);
  const noToast = () => until(async () => (await page.locator('readgloss-toast').count()) === 0, 5000, '확인 메시지가 사라짐(떠 있으면 글자 키가 메모를 연다)');
  return { page, cdp, call, shadowNodes, inShadow, subs, panel, card, enText, clickWord, barButton, until, seek, vtime, paused, shot, openPanel, selectTab, trustedClick, noToast };
}

try {
  await ctx.route('https://www.youtube.com/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/watch') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
    if (u.pathname === '/api/timedtext') return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: json3 });
    return route.fulfill({ status: 204, body: '' });
  });
  if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker', { timeout: 10_000 });

  const page = await ctx.newPage();
  await page.goto(WATCH);
  const T = await tools(page);
  const { subs, panel, card, enText, clickWord, barButton, until, seek, vtime, paused, shot, openPanel, selectTab, trustedClick, noToast } = T;
  const sw = ctx.serviceWorkers()[0];
  const setVideo = (patch) => sw.evaluate(async (patch) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, video: { ...(settings.video ?? {}), ...patch } } });
  }, patch);
  const SCENE_BTN = '원래 영상 장면 듣기';

  await step('F01-H1 CC 가 꺼져 있으면 켜고(자막 켜기 도움), 플레이어가 받은 자막으로 자막 층이 뜬다', async () => {
    await until(() => page.evaluate(() => document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed') === 'true'), 6000, 'CC 켜기');
    await page.evaluate(() => document.querySelector('video').play());
    await until(() => page.evaluate(() => document.documentElement.hasAttribute('data-readgloss-subs')), 6000, '자막 층');
    assert.equal(await page.locator('#movie_player > readgloss-subs').count(), 1, '플레이어 안에 붙는다');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('ytcaps')).display), 'none', '유튜브 자막은 숨긴다');
  });

  await step('F01-H2 지금 줄 영어 + 한국어(맥 번역) 두 줄', async () => {
    await seek(3.0);
    await until(async () => (await enText()) === 'Attackers exploit the bug to deliver a payload.', 4000, '영어 줄');
    const ko = await until(() => subs(`function(){ return this.querySelector('.ko').textContent }`), 4000, '한국어 줄');
    assert.match(ko, /^번역\d+:Attackers exploit the bug to deliver a payload\.$/);
    await page.waitForTimeout(600);
    await shot('1-two-lines');
    const box = await page.locator('#movie_player > readgloss-subs').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
    await page.waitForTimeout(300);
    await shot('2-hover-bar');
    await page.mouse.move(5, 880);
  });

  await step('F01-H3 어려운 단어 칠하기(/annotate, 기본 C1) — payload 에 hard + 뜻 풍선(exploit 은 목록상 쉬운 편)', async () => {
    const hard = await until(() => subs(`function(){ const h = [...this.querySelectorAll('.w.hard')]; return h.length ? h.map((n) => [n.firstChild.textContent, n.querySelector('.g')?.textContent]) : null }`), 6000, 'hard');
    assert.deepEqual(hard, [['payload', '수익 하중']]);
  });

  await step('CR-9 숨은 막대 자리 위에서는 멈추지 않고, 두 줄 위에서 멈춘다(마우스 멈춤)', async () => {
    await page.mouse.move(5, 880);
    // 막대는 마우스가 떠난 뒤 .15초 동안 사라지며 그동안은 보이고 눌린다: 다 숨은 뒤에 잰다
    await until(async () => (await subs(`function(){ return getComputedStyle(this.querySelector('.bar')).visibility }`)) === 'hidden', 2000, '막대 숨음');
    await seek(3.0, true);
    await until(async () => !(await paused()), 3000, '재생');
    const r = await subs(`function(){ const b = this.querySelector('.bar').getBoundingClientRect(); const l = this.querySelector('.lines').getBoundingClientRect(); return { bx: b.left + b.width / 2, by: b.top + 10, lx: l.left + l.width / 2, ly: l.top + l.height / 2 } }`);
    await page.mouse.move(r.bx, r.by);
    await page.waitForTimeout(400);
    assert.equal(await paused(), false, '숨은 막대 자리');
    await page.mouse.move(r.lx, r.ly);
    await until(() => paused(), 2000, '두 줄 위에서 멈춤');
    await page.mouse.move(5, 880);
    await until(async () => !(await paused()), 2000, '벗어나면 다시 재생');
  });

  await step('F01-H4 낱말을 누르면 사전 카드가 뜨고 영상이 멈춘다, 카드를 닫으면 다시 재생', async () => {
    await page.evaluate(() => document.querySelector('video').play());
    await until(async () => !(await paused()), 3000, '재생');
    assert.ok(await clickWord('exploit'));
    assert.equal(await page.locator('readgloss-card').count(), 1, '사전 카드');
    assert.equal(await paused(), true, '카드가 열리면 멈춤');
    await until(async () => /exploit|악용/.test((await card(`function(){ return this.querySelector('.scroll')?.textContent ?? '' }`)) ?? ''), 4000, '사전 뜻');
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('readgloss-card').count()) === 0, 2000, '카드 닫힘');
    await until(async () => !(await paused()), 2000, '다시 재생');
  });

  await step('CR-3 영상 위를 길게 눌러 사전 카드를 닫아도 늘 다시 재생(유튜브는 영상 클릭으로 재생·멈춤을 바꾼다)', async () => {
    await seek(3.0, true);
    await until(async () => !(await paused()), 3000, '재생');
    assert.ok(await clickWord('exploit'));
    await until(() => paused(), 2000, '카드로 멈춤');
    const pb = await page.locator('#movie_player').boundingBox();
    await page.mouse.move(pb.x + 80, pb.y + 60); // 자막 층 밖, 영상 위
    await page.mouse.down();
    await page.waitForTimeout(350); // 카드 닫힘 뒤 기다림(150ms)보다 길게 누른다
    await page.mouse.up();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('readgloss-card').count(), 0, '카드 닫힘');
    assert.equal(await paused(), false, '재생 중(먼저 재생하고 유튜브 클릭이 다시 멈추지 않았다)');
    await page.mouse.move(5, 880);
  });

  await step('F01-H5 카드에서 [단어장]에 넣으면 장면 주소(t=)가 남는다', async () => {
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    assert.ok(await clickWord('payload'));
    await until(() => card(`function(){ const b = this.querySelector('.btn'); return b?.textContent === '☆ 단어장에 추가' && !b.hasAttribute('aria-disabled') }`), 4000, '단어장 단추가 켜짐');
    await card(`function(){ this.querySelector('.btn').click() }`);
    const saved = await until(() => bridge.words.all().saved.payload, 4000, '저장');
    assert.equal(saved.url, `${WATCH}&t=2s`);
    assert.equal(saved.sentence, 'Attackers exploit the bug to deliver a payload.');
  });

  await step('F02-H1 A·S·D 줄 이동, P 줄마다 멈춤', async () => {
    await page.mouse.move(5, 880); // 자막 밖(마우스 멈춤 아님)
    await seek(5.0, true);
    await until(async () => (await enText())?.startsWith('Mitigations'), 3000, '셋째 줄');
    await page.keyboard.press('KeyD');
    await until(async () => (await enText())?.startsWith("Let's delve"), 3000, 'D 다음 줄');
    await page.keyboard.press('KeyA');
    await until(async () => (await enText())?.startsWith('Mitigations'), 3000, 'A 앞 줄');
    const t1 = await vtime();
    assert.ok(t1 >= 4.7 && t1 < 5.5, `A 는 그 줄 시작으로(${t1})`);
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyS');
    await until(() => paused(), 4000, '줄 끝에서 멈춤');
    const t2 = await vtime();
    assert.ok(t2 >= 6.3 && t2 < 6.7, `셋째 줄 끝(6.5) 앞에서 멈춘다(${t2})`);
    await page.keyboard.press('KeyP'); // 끄기
  });

  await step('F02-H2 H 가리기: 어려운 단어 → 문장 전체, 가린 낱말을 누르면 그 줄이 보인다', async () => {
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    const hidden = () => subs(`function(){ return this.querySelectorAll('.w.hid').length }`);
    await page.keyboard.press('KeyH');
    await until(async () => (await hidden()) === 1, 3000, '어려운 단어(payload) 가림');
    await shot('ui-hide-hard');
    await page.keyboard.press('KeyH');
    await until(async () => (await hidden()) === 8, 3000, '문장 전체 가림(낱말 7개 + 한 글자 a)');
    // 보이는 글자가 하나도 없다(뜻 풍선 .g 는 뺀다)
    const leftover = await subs(`function(){ const out = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { if (/[A-Za-z0-9]/.test(c.data) && !c.parentElement.closest('.hid')) out.push(c.data) } else if (!c.classList.contains('g')) walk(c) } }; walk(this.querySelector('.en')); return out }`);
    assert.deepEqual(leftover, [], '문장 전체 가리기에 새는 글자');
    await shot('ui-hide-all');
    await subs(`function(){ this.querySelector('.w.hid').click() }`);
    await until(async () => (await hidden()) === 0, 3000, '눌러서 보기');
    await page.keyboard.press('KeyH'); // 끔으로
  });

  await step('CR-11 페이지 스크립트가 만든 H 키는 무시한다(설정이 바뀌지 않는다)', async () => {
    const hideLabel = () => subs(`function(){ return [...this.querySelectorAll('.bar button')].find((b) => b.textContent.startsWith('가리기'))?.textContent }`);
    await noToast();
    assert.equal(await hideLabel(), '가리기: 끔');
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true })));
    await page.waitForTimeout(400);
    assert.equal(await hideLabel(), '가리기: 끔');
  });

  await step('CR-13 360° 영상(플레이어 ytp-webgl-spherical)에서는 A·S·D 를 유튜브(둘러보기)에 양보한다', async () => {
    await noToast(); // 양보한 키는 페이지로 가니 떠 있는 확인 메시지가 받으면 메모가 열린다
    assert.equal(await page.evaluate(() => document.activeElement?.localName), 'body');
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    await page.evaluate(() => document.getElementById('movie_player').classList.add('ytp-webgl-spherical'));
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(400);
    assert.ok((await enText())?.startsWith('Attackers'), 'D 로 줄이 넘어가지 않는다');
    await page.evaluate(() => document.getElementById('movie_player').classList.remove('ytp-webgl-spherical'));
    await page.keyboard.press('KeyD');
    await until(async () => (await enText())?.startsWith('Mitigations'), 3000, '보통 영상에서는 D 로 다음 줄');
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '되돌림');
  });

  await step('F01-H6 [☆ 저장] = 그 줄을 구·문장으로(장면 주소 + clip), 확인 메시지는 자막 층 위에(두 줄·막대를 가리지 않는다)', async () => {
    assert.ok(await barButton('☆ 저장'));
    const tb = await until(() => page.locator('readgloss-toast').boundingBox(), 3000, '확인 메시지');
    const rects = await subs(`function(){ return ['.en', '.ko', '.bar'].map((s) => { const r = this.querySelector(s).getBoundingClientRect(); return { s, x: r.left, y: r.top, w: r.width, h: r.height } }) }`);
    for (const r of rects) assert.ok(tb.y + tb.height <= r.y || tb.y >= r.y + r.h || tb.x + tb.width <= r.x || tb.x >= r.x + r.w, `확인 메시지가 ${r.s} 를 가린다 ${JSON.stringify({ tb, r })}`);
    await shot('ui-toast-above');
    const p = await until(() => Object.values(bridge.words.all().phrases).find((x) => x.text.startsWith('Attackers')), 4000, '구 저장');
    assert.deepEqual(p.clip, { start: 2.6, end: 4.6 });
    assert.equal(p.url, `${WATCH}&t=2s`);
    assert.match(p.translation, /^번역\d+:Attackers/);
    assert.equal(p.title, 'Buffer overflows explained');
    await until(() => subs(`function(){ return [...this.querySelectorAll('.bar button')].some((b) => b.textContent === '★ 저장됨') }`), 3000, '★');
  });

  await step('F01-H7 [풀이] = 문맥 번역(앞뒤 줄) + 기억할 표현 저장(clip 포함)', async () => {
    assert.ok(await barButton('풀이'));
    await until(async () => (await subs(`function(){ return this.querySelector('.note .tr')?.textContent }`)) === '공격자는 그 버그를 악용해 페이로드를 보낸다.', 4000, '풀이');
    await shot('3-explain');
    const prompt = asked.context.at(-1);
    assert.match(prompt, /"before":"So today we talk about buffer overflows\."/);
    assert.match(prompt, /"after":"Mitigations make that much harder\./);
    assert.match(prompt, /"title":"Buffer overflows explained"/);
    await subs(`function(){ this.querySelector('.note .ex button').click() }`);
    const e = await until(() => Object.values(bridge.words.all().phrases).find((x) => x.text === 'deliver a payload'), 4000, '표현 저장');
    assert.equal(e.kind, 'expression');
    assert.deepEqual(e.clip, { start: 2.6, end: 4.6 });
  });

  await step('F03-H1 패널 [영상] 탭: 대본 줄·지금 줄 강조·줄 누르면 그 장면으로', async () => {
    await openPanel();
    await until(() => panel(`function(){ return this.querySelectorAll('.rgv .v-row .v-txt').length === 5 }`), 5000, '대본 5줄');
    await panel(`function(){ this.querySelectorAll('.rgv .v-row .v-txt')[3].click() }`);
    await until(async () => (await vtime()) >= 6.6 && (await vtime()) < 7.5, 3000, '넷째 줄로');
    await until(() => panel(`function(){ const c = this.querySelectorAll('.rgv .v-row.v-cur'); return c.length === 1 && c[0].querySelector('.v-en').textContent.startsWith("Let's delve") && c[0].getAttribute('aria-current') === 'true' }`), 3000, '지금 줄 강조');
  });

  await step('F03-H2 패널 [영상] 탭: 어려운 단어 미리 보기', async () => {
    await panel(`function(){ this.querySelector('.rgv .v-tools button').click() }`);
    const labels = await until(() => panel(`function(){ const c = [...this.querySelectorAll('.rgv .v-chip')].map((n) => n.textContent); return c.length >= 2 ? c : null }`), 6000, '칩');
    assert.deepEqual(labels, ['payload 수익 하중', 'delve 손으로 더듬다'], '처음 나온 순');
    await page.evaluate(() => document.querySelector('video').pause());
    await shot('4-panel-video');
  });

  await step('UI-5 탭 CSS 가 서로 새지 않는다: 대본 줄 테두리·글 굵기, 머리 상태 글자색, 단추 24px 이상', async () => {
    const v = await panel(`function(){ const r = this.querySelector('.rgv .v-row'); const st = this.querySelector('.head .status'); return { border: getComputedStyle(r).borderTopStyle, weight: getComputedStyle(r.querySelector('.v-en')).fontWeight, status: getComputedStyle(st).color } }`);
    assert.deepEqual(v, { border: 'solid', weight: '400', status: 'rgb(101, 109, 118)' }, '다른 탭(내 단어 li·공부 기록 .txt·.status) 규칙이 새면 바뀐다');
    const sizes = await panel(`function(){ return [...this.querySelectorAll('.rgv button')].map((b) => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label') || b.textContent, Math.round(r.width), Math.round(r.height)] }) }`);
    const small = sizes.filter(([, w, h]) => w < 24 || h < 24);
    assert.deepEqual(small, [], JSON.stringify(sizes.slice(0, 6)));
    const pressed = await panel(`function(){ const b = this.querySelector('.rgv .v-tools button[aria-pressed="true"]'); return b && [getComputedStyle(b).backgroundColor, getComputedStyle(b).borderTopStyle] }`);
    assert.ok(pressed && pressed[0] !== 'rgba(0, 0, 0, 0)' && pressed[1] === 'solid', `눌린 [어려운 단어 보기]는 바탕과 테두리가 있다 ${JSON.stringify(pressed)}`);
  });

  await step('CR-10 유튜브 한국어 자막이 나중에 와도 패널 대본에 한국어 줄이 보인다', async () => {
    const ko = JSON.stringify({ events: LINES.map(([t, d], i) => ({ tStartMs: t, dDurationMs: d, segs: [{ utf8: `한국어 자막 ${i + 1}` }] })) });
    await page.evaluate(([id, body]) => window.postMessage({ source: 'readgloss-yt', type: 'timedtext', url: `https://www.youtube.com/api/timedtext?v=${id}&lang=ko&fmt=json3`, body }, location.origin), [ID, ko]);
    await until(() => panel(`function(){ const k = [...this.querySelectorAll('.rgv .v-ko')].map((n) => n.textContent); return k.length === 5 && k.every((t, i) => t === '한국어 자막 ' + (i + 1)) }`), 4000, '대본 한국어 줄');
  });

  await step('F04-H1 복습: 구 카드에 [▶ 장면] — 같은 영상이면 그 구간을 재생하고 끝에서 멈춘다', async () => {
    await page.evaluate(() => document.querySelector('video').pause());
    await panel(`function(){ [...this.querySelectorAll('.tab')].find((b) => b.textContent === '내 단어').click() }`);
    await panel(`function(){ this.querySelector('.sub').click() }`); // [복습]
    // 구 카드(Attackers…)가 나올 때까지 [뒤집기]→[아직] 으로 넘긴다(낱말 payload 가 먼저일 수 있다)
    let found = false;
    for (let k = 0; k < 6 && !found; k++) {
      const info = await until(() => panel(`function(){ const c = this.querySelector('.rev-card'); return c && { head: c.querySelector('.rev-head')?.textContent ?? '', scene: [...c.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === ${JSON.stringify(SCENE_BTN)}) } }`), 4000, '복습 카드');
      if (info.head.startsWith('Attackers') && info.scene) found = true;
      else {
        await panel(`function(){ [...this.querySelectorAll('.rev-btn')].find((b) => b.textContent.startsWith('뒤집기'))?.click() }`);
        await until(() => panel(`function(){ const b = [...this.querySelectorAll('.rev-btn')].find((x) => x.textContent.startsWith('아직')); if (b) b.click(); return Boolean(b) }`), 3000, '아직');
        await page.waitForTimeout(200);
      }
    }
    assert.ok(found, '장면 단추가 있는 구 카드');
    const clickScene = () => trustedClick(panel, `function(){ return [...this.querySelector('.rev-card').querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(SCENE_BTN)}) }`);
    // 페이지 스크립트의 .click() 은 무시한다(코드 검토 11: 새 탭을 여는 단추)
    await panel(`function(){ [...this.querySelector('.rev-card').querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(SCENE_BTN)}).click() }`);
    await page.waitForTimeout(500);
    assert.equal(await paused(), true, '스크립트 클릭으로는 재생하지 않는다');
    await clickScene();
    await until(async () => !(await paused()), 2000, '재생 시작');
    await until(() => paused(), 5000, '구간 끝에서 멈춤');
    const t = await vtime();
    assert.ok(t >= 4.55 && t < 4.9, `clip 끝(4.6)에서 멈춘다(${t})`);
    await shot('ui-review-scene');

    // CR-5: 장면을 다시 틀고 구간 끝 너머로 옮기면 그 자리에서 멈추지 않는다
    await clickScene();
    await until(async () => !(await paused()), 2000, '다시 재생 시작');
    await seek(7.0, true);
    await page.waitForTimeout(700);
    assert.equal(await paused(), false, 'CR-5 구간 끝(4.6) 너머로 옮기면 그대로 재생');
    await page.evaluate(() => document.querySelector('video').pause());
  });

  await step('F04-H2 복습 고르기: 보기 4개, 고르면 저장하고 맞음·틀림 색', async () => {
    for (const [lemma, gloss] of [['mitigate', '완화하다'], ['privilege', '권한'], ['delve', '파고들다'], ['exploit', '악용하다']]) {
      bridge.words.apply({ op: 'save', lemma, word: lemma, gloss, sentence: '', url: '' });
    }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('readgloss:words', { detail: { known: [], unknown: [] } })));
    await page.waitForTimeout(400);
    await until(() => panel(`function(){ const b = [...this.querySelectorAll('.rev-modes button')].find((x) => x.textContent === '고르기'); if (b) b.click(); return Boolean(b) }`), 3000, '방식 고르기');
    const n = await until(() => panel(`function(){ return this.querySelectorAll('.rev-choices button').length }`), 4000, '보기');
    assert.equal(n, 4);
    const before = JSON.stringify(bridge.words.reviewQueue().counts);
    await panel(`function(){ this.querySelector('.rev-choices button').click() }`);
    await until(() => panel(`function(){ return this.querySelectorAll('.rev-choice.ok').length === 1 }`), 3000, '정답 표시');
    await shot('5-review-choice');
    assert.notEqual(JSON.stringify(bridge.words.reviewQueue().counts), before, '결과가 다리에 저장됐다');
  });

  await step('CR-1·4 고르기 키보드: Enter 로 다음, 한 번 더 Enter 는 새 카드 보기를 고르지 않는다, 2 로 고른다 · 답한 뒤 방식을 바꾸면 다음 카드', async () => {
    await panel(`function(){ [...this.querySelectorAll('.rev-btn')].find((b) => b.textContent.includes('다음')).focus() }`);
    await page.keyboard.press('Enter');
    await until(() => panel(`function(){ return this.querySelectorAll('.rev-choices button:not([disabled])').length === 4 }`), 3000, '다음 카드 보기');
    await until(() => panel(`function(){ return Boolean(this.activeElement?.classList.contains('rev-choices')) }`), 2000, '포커스는 보기 묶음에(첫 보기 아님)');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await panel(`function(){ return this.querySelectorAll('.rev-choice.ok, .rev-choice.bad').length }`), 0, 'Enter 두 번에 보기가 골라지지 않는다');
    await page.keyboard.press('Digit2');
    await until(() => panel(`function(){ return this.querySelectorAll('.rev-choice.ok').length === 1 }`), 3000, '2 로 고름');
    const remain = await panel(`function(){ return this.querySelector('.rev-remain')?.textContent }`);
    await panel(`function(){ [...this.querySelectorAll('.rev-mode')].find((b) => b.textContent === '뒤집기').click() }`);
    const after = await until(() => panel(`function(){ return this.querySelector('.rev-remain')?.textContent ?? 'done' }`), 2000, '방식 바꿈');
    assert.notEqual(after, remain, `답한 카드는 다시 나오지 않는다(${remain} → ${after})`);
  });

  await step('F04-E1 복습: 다른 영상 장면은 새 탭에서 그 구간만 재생하고, 그 영상에 자막이 없어도 끝에서 멈춘다', async () => {
    const other = 'noccAAAAAAA';
    const url = `https://www.youtube.com/watch?v=${other}&t=4s`;
    bridge.words.apply({ op: 'save-phrase', text: 'Mitigations make that much harder.', translation: '완화책이 그것을 훨씬 어렵게 만든다.', kind: 'sentence', url, title: 'Other talk', sentence: '', clip: { start: 4.7, end: 6.5 } });
    // 이 카드만 오늘 볼 것으로: 나머지 오늘 카드는 [알아요]로 넘겨 둔다
    const pid = phraseId('Mitigations make that much harder.');
    for (const c of bridge.words.reviewQueue().due) if (c.key !== pid) bridge.words.apply({ op: 'review', ...(c.type === 'word' ? { lemma: c.key } : { id: c.key }), result: 'know' });
    assert.deepEqual(bridge.words.reviewQueue().due.map((c) => c.key), [pid]);
    // 패널을 새로 그려 큐를 다시 받는다(닫고 열기)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('readgloss:open-panel')));
    await until(() => panel(`function(){ const b = [...this.querySelectorAll('.sub')][0]; if (b) b.click(); return Boolean(b) }`), 3000, '복습 탭');
    const newPage = ctx.waitForEvent('page', { timeout: 8000 });
    await until(() => panel(`function(){ const c = this.querySelector('.rev-card'); return Boolean(c && c.textContent.includes('Mitigations') && [...c.querySelectorAll('button')].some((x) => x.getAttribute('aria-label') === ${JSON.stringify(SCENE_BTN)})) }`), 5000, '그 카드의 장면 단추');
    await trustedClick(panel, `function(){ return [...this.querySelector('.rev-card').querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(SCENE_BTN)}) }`);
    const p2 = await newPage;
    await p2.waitForURL(new RegExp(`watch\\?v=${other}`), { timeout: 8000 });
    const U = await tools(p2);
    await U.until(async () => (await U.vtime()) >= 4.7 && !(await U.paused()), 8000, '새 탭에서 구간 시작');
    await U.until(() => U.paused(), 5000, '자막이 없어도 구간 끝에서 멈춤');
    const t = await U.vtime();
    assert.ok(t >= 6.4 && t < 6.9, `clip 끝(6.5)에서 멈춘다(${t})`);
    await p2.close();
    await page.bringToFront();
  });

  await step('F01-E1 자막 없는 영상: 5초 뒤 "이 영상은 자막이 없어요" 안내(8초 동안)', async () => {
    const p3 = await ctx.newPage();
    await p3.goto('https://www.youtube.com/watch?v=noccBBBBBBB');
    const U = await tools(p3);
    const msg = await U.until(() => U.subs(`function(){ const m = this.querySelector('.msg'); return m && !m.hidden ? m.textContent : null }`).catch(() => null), 9000, '안내');
    assert.equal(msg, '이 영상은 자막이 없어요');
    await U.shot('ui-msg-nocc');
    assert.equal(await p3.evaluate(() => document.documentElement.hasAttribute('data-readgloss-subs')), false);
    await p3.close();
    await page.bringToFront();
  });

  await step('F02-E1 키보드만으로: CC 다음 Tab 이면 자막 층에 들어가고 막대가 보여 [☆ 저장]까지 간다', async () => {
    await page.keyboard.press('Escape'); // 패널 닫기
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    await page.focus('.ytp-subtitles-button');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.localName), 'readgloss-subs', '자막 층으로 들어간다');
    assert.equal(await subs(`function(){ return this.activeElement?.className }`), 'lines', '먼저 두 줄');
    await page.waitForTimeout(250);
    await shot('ui-focus-lines');
    await until(async () => (await subs(`function(){ return getComputedStyle(this.querySelector('.bar')).visibility }`)) === 'visible', 2000, '막대가 보인다');
    const labels = [];
    for (let k = 0; k < 7; k++) {
      await page.keyboard.press('Tab');
      labels.push(await subs(`function(){ return this.activeElement?.getAttribute('aria-label') }`));
    }
    assert.deepEqual(labels, ['앞 줄 (A)', '이 줄 다시 (S)', '다음 줄 (D)', '가리기 바꾸기 (H) — 지금 끔', '줄마다 멈춤 (P)', '한국어 줄 보이기', '이 줄 저장 빼기']);
    await shot('ui-focus-bar');
    await page.keyboard.press('Enter'); // ★ 저장됨 → 빼기
    await until(() => !Object.values(bridge.words.all().phrases).some((x) => x.text.startsWith('Attackers')), 3000, '키보드로 저장 빼기');
    await page.waitForTimeout(250);
    assert.equal(await subs(`function(){ return getComputedStyle(this.querySelector('.bar')).visibility }`), 'visible', '키보드로 누른 뒤에도 막대가 보인다(포커스를 빼지 않는다)');
    assert.equal(await subs(`function(){ return this.activeElement?.getAttribute('aria-label') }`), '이 줄 구·문장에 저장');
    await until(async () => (await page.locator('readgloss-toast').count()) === 0, 4000, '확인 메시지가 사라짐(떠 있으면 Esc 는 그것부터 닫는다)');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.localName), 'body', 'Esc 로 막대를 나와 유튜브 키로');
  });

  await step('UI-6 키보드 낱말 자리: 두 줄에서 →·← 로 낱말을 고르고(유튜브 5초 이동 없음) Enter 사전 카드, Esc 는 카드 → 층 밖 차례', async () => {
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    await page.focus('.ytp-subtitles-button');
    await page.keyboard.press('Tab');
    assert.equal(await subs(`function(){ return this.activeElement?.className }`), 'lines');
    const t0 = await vtime();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await subs(`function(){ return this.querySelector('.w.cur')?.firstChild?.textContent }`), 'exploit');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await subs(`function(){ return this.querySelector('.w.cur')?.firstChild?.textContent }`), 'Attackers');
    for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowRight');
    const cur = await subs(`function(){ const c = this.querySelector('.w.cur'); return [c?.firstChild?.textContent, c && getComputedStyle(c.querySelector('.g') ?? c).display, getComputedStyle(c).outlineStyle] }`);
    assert.deepEqual(cur, ['payload', 'block', 'solid'], '어려운 낱말 자리에는 뜻 풍선도 보인다');
    assert.equal(await vtime(), t0, '화살표가 유튜브(5초 이동)로 새지 않았다');
    await shot('ui-key-cursor');
    await page.keyboard.press('Enter');
    await until(async () => (await page.locator('readgloss-card').count()) === 1, 3000, 'Enter 로 사전 카드');
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('readgloss-card').count()) === 0, 2000, '카드 닫힘');
    assert.equal(await page.evaluate(() => document.activeElement?.localName), 'readgloss-subs', '첫 Esc 는 카드만 닫는다');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.localName), 'body', '두 번째 Esc 로 층을 나온다');
  });

  await step('전체 화면: 사전 카드가 전체 화면 요소(플레이어) 안에 뜨고, 전체 화면을 나오면 닫힌다', async () => {
    await page.click('#fs');
    await until(() => page.evaluate(() => document.fullscreenElement?.id === 'movie_player'), 3000, '전체 화면');
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    assert.ok(await clickWord('payload'));
    await until(() => page.evaluate(() => Boolean(document.querySelector('#movie_player > readgloss-card'))), 3000, '플레이어 안의 카드');
    await page.waitForTimeout(500);
    await shot('6-fullscreen-card');
    const box = await page.locator('#movie_player > readgloss-card').boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 900 && box.x >= 0, `화면 안에 보인다 ${JSON.stringify(box)}`);
    await page.evaluate(() => document.exitFullscreen());
    await until(async () => (await page.locator('readgloss-card').count()) === 0, 3000, '전체 화면을 나오면 닫힘');
  });

  await step('F01-E2 자막 층 설정을 끄면 사라지고 유튜브 자막이 다시 보인다(켜면 돌아온다)', async () => {
    const setSubs = (on) => setVideo({ subs: on });
    await setSubs(false);
    await until(() => page.evaluate(() => !document.documentElement.hasAttribute('data-readgloss-subs')), 3000, '꺼짐');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('ytcaps')).display), 'none');
    await setSubs(true);
    await until(() => page.evaluate(() => document.documentElement.hasAttribute('data-readgloss-subs')), 3000, '다시 켜짐');
  });

  // ---- UI·접근성 재기(ui-ux-pro-max 규칙: 누를 자리 24px 이상, 포커스 표시, 움직임 줄이기, 색만으로 알리지 않기) ----
  await step('UI-1 자막 막대 단추는 누를 자리가 24×24px 이상', async () => {
    await page.bringToFront();
    await seek(3.0);
    await until(async () => (await enText())?.startsWith('Attackers'), 3000, '줄');
    const box = await page.locator('#movie_player > readgloss-subs').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
    await page.waitForTimeout(300);
    const sizes = await subs(`function(){ return [...this.querySelectorAll('.bar button')].map((b) => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)] }) }`);
    const small = sizes.filter(([, w, h]) => w < 24 || h < 24);
    assert.deepEqual(small, [], JSON.stringify(sizes));
    await page.mouse.move(5, 880);
  });

  await step('UI-2 움직임 줄이기 설정이면 막대·줄 전환이 없다', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const d = await subs(`function(){ return [getComputedStyle(this.querySelector('.bar')).transitionDuration, getComputedStyle(this.querySelector('.lines')).transitionDuration] }`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.ok(d.every((x) => x.split(',').every((v) => parseFloat(v) === 0)), JSON.stringify(d));
  });

  await step('UI-7 지난 줄(다음 줄 전)은 바탕은 그대로 두고 글자만 흐리게(밝은 화면에서도 대비 유지)', async () => {
    await seek(11.0); // 마지막 줄(8.6~10.4)이 끝난 뒤
    await until(() => subs(`function(){ return this.querySelector('.lines').classList.contains('past') }`), 3000, '지난 줄');
    const st = await subs(`function(){ const l = this.querySelector('.lines'); const en = this.querySelector('.en'); return [getComputedStyle(l).opacity, getComputedStyle(en).color, getComputedStyle(en).backgroundColor] }`);
    assert.deepEqual(st, ['1', 'rgba(255, 255, 255, 0.72)', 'rgba(8, 8, 8, 0.74)']);
    await shot('ui-past-line');
  });

  await step('UI-3 복습 새 단추(방식·소리·장면)는 24px 이상, 고르기 맞음·틀림은 색 말고 표시(✓·✕)와 읽는 이름으로도, 키 표시 대비', async () => {
    await openPanel();
    await selectTab('내 단어');
    await panel(`function(){ this.querySelector('.sub').click() }`);
    // 고를 카드가 있게 다시 하나 넣는다(앞 단계에서 다 넘겼을 수 있다)
    bridge.words.apply({ op: 'save', lemma: 'payload', word: 'payload', gloss: '수익 하중', sentence: 'Attackers exploit the bug to deliver a payload.', url: `${WATCH}&t=2s` });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('readgloss:words', { detail: { known: [], unknown: [] } })));
    await until(() => panel(`function(){ return Boolean(this.querySelector('.rev-card')) }`), 4000, '복습 카드');
    await panel(`function(){ [...this.querySelectorAll('.rev-modes button')].find((b) => b.textContent === '뒤집기').click() }`);
    await shot('ui-review-flip-front');
    const mode = await panel(`function(){ const b = this.querySelector('.rgw .rev-mode[aria-pressed="true"]'); return b && [b.textContent, getComputedStyle(b).backgroundColor] }`);
    assert.ok(mode && mode[0] === '뒤집기' && mode[1] !== 'rgba(0, 0, 0, 0)', `눌린 방식은 바탕으로도 보인다(공부 기록 .chip 이 새면 바탕이 빠진다) ${JSON.stringify(mode)}`);
    const kbd = await panel(`function(){ const k = this.querySelector('.rgw .kbd'); const s = k && getComputedStyle(k); return s && [s.color, s.opacity] }`);
    assert.deepEqual(kbd, ['rgb(31, 35, 40)', '1'], '키 표시 글자는 본문색(대비 13:1)');
    const sizes = await panel(`function(){ return [...this.querySelectorAll('.rev-modes button, .rev-tools button, .rev-btns button')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.width), Math.round(r.height)] }) }`);
    const small = sizes.filter(([, w, h]) => w < 24 || h < 24);
    assert.deepEqual(small, [], JSON.stringify(sizes));
    await panel(`function(){ [...this.querySelectorAll('.rev-modes button')].find((b) => b.textContent === '듣기').click() }`);
    await page.waitForTimeout(200);
    await shot('ui-review-listen-front');
    await panel(`function(){ [...this.querySelectorAll('.rev-modes button')].find((b) => b.textContent === '고르기').click() }`);
    const ok = await until(() => panel(`function(){ return this.querySelectorAll('.rev-choices button').length === 4 }`), 4000, '보기');
    assert.ok(ok);
    // 일부러 틀린 보기를 고른다: 카드 머리(낱말·구)의 정답 뜻을 다리에서 찾아 그것이 아닌 보기
    const head = await panel(`function(){ return this.querySelector('.rev-card .rev-head')?.textContent }`);
    const all = bridge.words.all();
    const answer = all.saved[head]?.gloss ?? Object.values(all.phrases).find((x) => x.text === head)?.translation;
    assert.ok(answer, `정답 뜻(${head})`);
    await panel(`function(){ const c = [...this.querySelectorAll('.rev-choices button')].find((b) => !b.textContent.endsWith(${JSON.stringify(answer)})); c.click() }`);
    await until(() => panel(`function(){ return this.querySelectorAll('.rev-choice.ok').length === 1 }`), 3000, '정답 표시');
    await shot('ui-review-choice-answered');
    const marks = await panel(`function(){ return [...this.querySelectorAll('.rev-choice.ok, .rev-choice.bad')].map((b) => [b.classList.contains('ok') ? 'ok' : 'bad', b.querySelector('.rev-mark')?.textContent, b.getAttribute('aria-label')]) }`);
    assert.equal(marks.length, 2, JSON.stringify(marks));
    for (const [kind, mark, label] of marks) {
      if (kind === 'ok') {
        assert.equal(mark, '✓');
        assert.match(label, /^정답: /);
      } else {
        assert.equal(mark, '✕');
        assert.match(label, /^내 답\(틀림\): /);
      }
    }
    const next = await panel(`function(){ return [...this.querySelectorAll('.rev-btn')].map((b) => b.getAttribute('aria-label')) }`);
    assert.deepEqual(next, ['아직이에요 · 다음 (Space)']);
  });

  await step('UI-4 어두운 테마·설정 칸·영상 탭 화면(눈으로 보는 용도)', async () => {
    const panelBg = () => panel(`function(){ return getComputedStyle(this.querySelector('.panel')).backgroundColor }`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await until(async () => (await panelBg()) === 'rgb(30, 33, 39)', 3000, '어두운 테마');
    await selectTab('영상');
    await page.waitForTimeout(200);
    await shot('ui-dark-panel-video');
    await selectTab('내 단어');
    await page.waitForTimeout(200);
    await shot('ui-dark-review');
    // 탭 CSS 를 묶은 뒤 다른 탭(단어장 목록·공부 기록)도 그대로인지 눈으로 보는 화면
    const tabShots = async (theme) => {
      await selectTab('내 단어');
      await panel(`function(){ const b = [...this.querySelectorAll('.rgw .sub')].find((x) => x.textContent.startsWith('단어장')); b.click() }`);
      await page.waitForTimeout(200);
      await shot(`ui-${theme}-words-list`);
      await selectTab('공부 기록');
      await page.waitForTimeout(300);
      await shot(`ui-${theme}-study`);
    };
    await tabShots('dark');
    await selectTab('설정');
    await panel(`function(){ const h = [...this.querySelectorAll('h3')].find((x) => x.textContent === '영상 자막'); h.scrollIntoView({ block: 'start' }) }`);
    await page.waitForTimeout(200);
    await shot('ui-dark-settings-video');
    await page.emulateMedia({ colorScheme: 'light' });
    await until(async () => (await panelBg()) === 'rgb(255, 255, 255)', 3000, '밝은 테마');
    await page.waitForTimeout(100);
    await shot('ui-light-settings-video');
    await tabShots('light');
    // 단어장 목록 줄은 다른 탭 규칙에 갈리지 않는다([영상] 탭의 옛 li 격자가 새면 grid 가 된다)
    await selectTab('내 단어');
    await panel(`function(){ [...this.querySelectorAll('.rgw .sub')].find((x) => x.textContent.startsWith('단어장')).click() }`);
    const li = await until(() => panel(`function(){ const l = this.querySelector('.rgw ul li'); return l && [getComputedStyle(l).display, getComputedStyle(l).borderTopStyle] }`), 3000, '단어장 목록 줄');
    assert.deepEqual(li, ['list-item', 'solid']);
    await page.keyboard.press('Escape');
  });

  await step('CR-6 한국어 줄을 꺼 두면 근처 줄 번역을 부르지 않고, [한국어 모두 보기]는 그래도 대본 전체를 채운다', async () => {
    await setVideo({ ko: false });
    const p5 = await ctx.newPage();
    await p5.goto('https://www.youtube.com/watch?v=kooffAAAAAA');
    const U = await tools(p5);
    await U.until(() => p5.evaluate(() => document.documentElement.hasAttribute('data-readgloss-subs')), 8000, '자막 층');
    await U.openPanel();
    await U.until(() => U.panel(`function(){ return this.querySelectorAll('.rgv .v-row').length === 5 }`), 5000, '대본');
    await p5.waitForTimeout(1500);
    assert.equal(await U.panel(`function(){ return [...this.querySelectorAll('.rgv .v-ko')].filter((n) => n.textContent).length }`), 0, '근처 줄도 번역하지 않았다');
    await U.panel(`function(){ [...this.querySelectorAll('.rgv .v-tools button')].find((b) => b.textContent.startsWith('한국어')).click() }`);
    await U.until(() => U.panel(`function(){ return [...this.querySelectorAll('.rgv .v-ko')].every((n) => /^번역\\d+:/.test(n.textContent)) }`), 8000, '대본 전체 한국어');
    assert.equal(await U.panel(`function(){ return this.querySelector('.rgv .v-tools button[aria-pressed="true"]')?.textContent }`), '한국어 받는 중 5/5 · 멈추기');
    await p5.close();
    await setVideo({ ko: true });
    await page.bringToFront();
  });

  await step('CR-12 광고(6초)가 끝난 뒤부터 자막을 기다린다: 광고 직후 "자막이 없어요"가 바로 뜨지 않는다', async () => {
    const p6 = await ctx.newPage();
    await p6.goto('https://www.youtube.com/watch?v=noccADADADA&ad=6');
    const U = await tools(p6);
    const msg = () => U.subs(`function(){ const m = this.querySelector('.msg'); return m && !m.hidden ? m.textContent : null }`).catch(() => null);
    await p6.waitForTimeout(6000 + 2500);
    assert.equal(await msg(), null, '광고 끝나고 2.5초: 아직 기다리는 중');
    assert.equal(await U.until(msg, 8000, '안내'), '이 영상은 자막이 없어요');
    await p6.close();
    await page.bringToFront();
  });

  await step('F01-E3 다리가 꺼지면 한국어 줄 자리에 "다리가 꺼져 있어요"', async () => {
    await bridge.close();
    bridgeUp = false;
    const p4 = await ctx.newPage();
    await p4.goto('https://www.youtube.com/watch?v=eeeeeeeeeee');
    const U = await tools(p4);
    await U.until(() => p4.evaluate(() => document.documentElement.hasAttribute('data-readgloss-subs')), 8000, '자막 층');
    await U.seek(3.0);
    const ko = await U.until(() => U.subs(`function(){ return this.querySelector('.ko')?.textContent || null }`), 6000, '한국어 줄 안내');
    assert.equal(ko, '다리가 꺼져 있어요');
    await p4.close();
  });

  await step('콘솔 오류 없음(페이지·확장)', async () => {
    const real = consoleErrors.filter((t) => !/Failed to load resource: net::ERR_CONNECTION_REFUSED/.test(t)); // 다리를 끈 뒤의 연결 거절은 일부러 낸 것
    assert.deepEqual(real, []);
  });
} finally {
  await ctx.close().catch(() => {});
  if (bridgeUp) await bridge.close().catch(() => {});
}

const failed = results.filter(([r]) => r === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
