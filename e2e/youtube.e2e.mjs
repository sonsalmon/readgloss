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
  return { page, cdp, call, shadowNodes, inShadow, subs, panel, card, enText, clickWord, barButton, until, seek, vtime, paused, shot };
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
  const { subs, panel, card, enText, clickWord, barButton, until, seek, vtime, paused, shot } = T;

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
    await page.keyboard.press('KeyH');
    await until(async () => (await hidden()) === 7, 3000, '문장 전체 가림(낱말 7개 — 한 글자 a 는 낱말이 아니다)');
    await subs(`function(){ this.querySelector('.w.hid').click() }`);
    await until(async () => (await hidden()) === 0, 3000, '눌러서 보기');
    await page.keyboard.press('KeyH'); // 끔으로
  });

  await step('F01-H6 [☆ 저장] = 그 줄을 구·문장으로(장면 주소 + clip)', async () => {
    assert.ok(await barButton('☆ 저장'));
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
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('readgloss:open-panel')));
    await until(() => panel(`function(){ return this.querySelectorAll('.rgv li .txt').length === 5 }`), 5000, '대본 5줄');
    await panel(`function(){ this.querySelectorAll('.rgv li .txt')[3].click() }`);
    await until(async () => (await vtime()) >= 6.6 && (await vtime()) < 7.5, 3000, '넷째 줄로');
    await until(() => panel(`function(){ const c = this.querySelectorAll('.rgv li.cur'); return c.length === 1 && c[0].querySelector('.en').textContent.startsWith("Let's delve") }`), 3000, '지금 줄 강조');
  });

  await step('F03-H2 패널 [영상] 탭: 어려운 단어 미리 보기', async () => {
    await panel(`function(){ this.querySelector('.rgv .tools button').click() }`);
    const labels = await until(() => panel(`function(){ const c = [...this.querySelectorAll('.rgv .chip')].map((n) => n.textContent); return c.length >= 2 ? c : null }`), 6000, '칩');
    assert.deepEqual(labels, ['payload 수익 하중', 'delve 손으로 더듬다'], '처음 나온 순');
    await shot('4-panel-video');
  });

  await step('F04-H1 복습: 구 카드에 [▶ 장면] — 같은 영상이면 그 구간을 재생하고 끝에서 멈춘다', async () => {
    await page.evaluate(() => document.querySelector('video').pause());
    await panel(`function(){ [...this.querySelectorAll('.tab')].find((b) => b.textContent === '내 단어').click() }`);
    await panel(`function(){ this.querySelector('.sub').click() }`); // [복습]
    // 구 카드(Attackers…)가 나올 때까지 [뒤집기]→[아직] 으로 넘긴다(낱말 payload 가 먼저일 수 있다)
    let found = false;
    for (let k = 0; k < 6 && !found; k++) {
      const info = await until(() => panel(`function(){ const c = this.querySelector('.rev-card'); return c && { head: c.querySelector('.rev-head')?.textContent ?? '', scene: [...c.querySelectorAll('button')].some((b) => b.textContent === '▶ 장면') } }`), 4000, '복습 카드');
      if (info.head.startsWith('Attackers') && info.scene) found = true;
      else {
        await panel(`function(){ [...this.querySelectorAll('.rev-btn')].find((b) => b.textContent.startsWith('뒤집기'))?.click() }`);
        await until(() => panel(`function(){ const b = [...this.querySelectorAll('.rev-btn')].find((x) => x.textContent.startsWith('아직')); if (b) b.click(); return Boolean(b) }`), 3000, '아직');
        await page.waitForTimeout(200);
      }
    }
    assert.ok(found, '장면 단추가 있는 구 카드');
    await panel(`function(){ [...this.querySelector('.rev-card').querySelectorAll('button')].find((b) => b.textContent === '▶ 장면').click() }`);
    await until(async () => !(await paused()), 2000, '재생 시작');
    await until(() => paused(), 5000, '구간 끝에서 멈춤');
    const t = await vtime();
    assert.ok(t >= 4.55 && t < 4.9, `clip 끝(4.6)에서 멈춘다(${t})`);
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
    await until(() => panel(`function(){ const c = this.querySelector('.rev-card'); const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent === '▶ 장면'); if (b && c.textContent.includes('Mitigations')) { b.click(); return true } return false }`), 5000, '그 카드의 장면 단추');
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
    await until(async () => (await subs(`function(){ return getComputedStyle(this.querySelector('.bar')).visibility }`)) === 'visible', 2000, '막대가 보인다');
    const labels = [];
    for (let k = 0; k < 7; k++) {
      await page.keyboard.press('Tab');
      labels.push(await subs(`function(){ return this.activeElement?.getAttribute('aria-label') }`));
    }
    assert.deepEqual(labels, ['앞 줄 (A)', '이 줄 다시 (S)', '다음 줄 (D)', '가리기 바꾸기 (H) — 지금 끔', '줄마다 멈춤 (P)', '한국어 줄 보이기', '이 줄 저장 빼기']);
    await page.keyboard.press('Enter'); // ★ 저장됨 → 빼기
    await until(() => !Object.values(bridge.words.all().phrases).some((x) => x.text.startsWith('Attackers')), 3000, '키보드로 저장 빼기');
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
    const sw = ctx.serviceWorkers()[0];
    const setSubs = (on) => sw.evaluate(async (on) => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, video: { ...(settings.video ?? {}), subs: on } } });
    }, on);
    await setSubs(false);
    await until(() => page.evaluate(() => !document.documentElement.hasAttribute('data-readgloss-subs')), 3000, '꺼짐');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('ytcaps')).display), 'none');
    await setSubs(true);
    await until(() => page.evaluate(() => document.documentElement.hasAttribute('data-readgloss-subs')), 3000, '다시 켜짐');
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
