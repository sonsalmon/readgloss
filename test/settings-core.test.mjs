import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/settings-core.js');
const S = globalThis.readglossSettings;

test('normalize: 빈 입력은 기본값', () => {
  for (const raw of [undefined, null, {}, 'x', []]) assert.deepEqual(S.normalize(raw), S.DEFAULTS);
  assert.equal(S.DEFAULTS.level, 'C1');
  assert.equal(S.DEFAULTS.maxPerParagraph, 3);
  assert.equal(S.DEFAULTS.repeat, 'page');
  assert.deepEqual(S.LEVELS, ['A2', 'B1', 'B2', 'C1', 'C2']);
});

test('normalize: 범위 밖 값은 가장 가까운 허용값, 잘못된 종류는 기본값', () => {
  const n = (p) => S.normalize(p);
  assert.equal(n({ annotation: { sizePct: 10 } }).annotation.sizePct, 40);
  assert.equal(n({ annotation: { sizePct: 300 } }).annotation.sizePct, 100);
  assert.equal(n({ annotation: { opacityPct: 0 } }).annotation.opacityPct, 30);
  assert.equal(n({ annotation: { gapEm: 9 } }).annotation.gapEm, 0.3);
  assert.equal(n({ annotation: { gapEm: -1 } }).annotation.gapEm, 0);
  assert.equal(n({ annotation: { gapEm: 0.15 } }).annotation.gapEm, 0.15);
  assert.equal(n({ maxPerParagraph: 99 }).maxPerParagraph, 10);
  assert.equal(n({ maxPerParagraph: -5 }).maxPerParagraph, 0);
  assert.equal(n({ maxPerParagraph: 2.6 }).maxPerParagraph, 3);
  assert.equal(n({ floatingButton: { top: 5 } }).floatingButton.top, 40);
  assert.equal(n({ level: 'Z' }).level, 'C1');
  assert.equal(n({ level: 'B2' }).level, 'B2');
  assert.equal(n({ repeat: 'never' }).repeat, 'page');
  assert.equal(n({ annotation: { position: 'left' } }).annotation.position, 'top');
  assert.equal(n({ annotation: { customColor: 'red' } }).annotation.customColor, '#2f6feb');
  assert.equal(n({ annotation: { customColor: '#ABCDEF' } }).annotation.customColor, '#abcdef');
  assert.equal(n({ maxPerParagraph: 'many' }).maxPerParagraph, 3);
  assert.equal(n({ enabled: 'yes' }).enabled, true);
  assert.equal(n({ annotation: 7 }).annotation.sizePct, 55);
});

test('normalize: 모르는 키는 버리고 예전 키도 남기지 않는다', () => {
  const n = S.normalize({ foo: 1, annotateEnabled: false, annotation: { bar: 2, sizePct: 60 }, floatingButton: { baz: 1 } });
  assert.equal('foo' in n, false);
  assert.equal('annotateEnabled' in n, false);
  assert.equal('bar' in n.annotation, false);
  assert.equal('baz' in n.floatingButton, false);
  assert.equal(n.annotation.sizePct, 60);
});

test('normalize: sites 는 문자열만, 공백 제거·소문자·중복 제거, 최대 200개', () => {
  assert.deepEqual(S.normalize({ sites: [' Example.COM ', 3, '', 'example.com', null, 'a.b'] }).sites, ['example.com', 'a.b']);
  assert.equal(S.normalize({ sites: Array.from({ length: 300 }, (_, i) => `s${i}.com`) }).sites.length, 200);
  assert.deepEqual(S.normalize({ sites: 'a.com' }).sites, []);
});

test('normalize: 결과를 바꿔도 DEFAULTS 는 그대로', () => {
  const n = S.normalize({});
  n.sites.push('x.com'); n.annotation.sizePct = 99;
  assert.deepEqual(S.normalize({}), S.DEFAULTS);
  assert.deepEqual(S.DEFAULTS.sites, []);
  assert.equal(S.DEFAULTS.annotation.sizePct, 55);
});

test('merge: 깊은 병합, 나머지는 유지, 결과는 정규화', () => {
  const cur = S.normalize({ annotation: { sizePct: 80, color: 'accent' }, level: 'B1' });
  const m = S.merge(cur, { annotation: { sizePct: 10 }, mark: 'underline' });
  assert.equal(m.annotation.sizePct, 40);
  assert.equal(m.annotation.color, 'accent');
  assert.equal(m.level, 'B1');
  assert.equal(m.mark, 'underline');
  assert.deepEqual(cur.annotation.sizePct, 80); // 입력은 안 바뀐다
  assert.deepEqual(S.merge(cur, { sites: ['a.com'] }).sites, ['a.com']);
  assert.deepEqual(S.merge(S.merge(cur, { sites: ['a.com'] }), { sites: [] }).sites, []);
  assert.deepEqual(S.merge(undefined, undefined), S.DEFAULTS);
});

test('siteBlocked: 정확히 같은 도메인, * 와일드카드', () => {
  const s = (...sites) => ({ sites });
  assert.equal(S.siteBlocked(s('example.com'), 'example.com'), true);
  assert.equal(S.siteBlocked(s('example.com'), 'docs.example.com'), false);
  assert.equal(S.siteBlocked(s('example.com'), 'badexample.com'), false);
  assert.equal(S.siteBlocked(s('*.example.com'), 'docs.example.com'), true);
  assert.equal(S.siteBlocked(s('*.example.com'), 'a.b.example.com'), true);
  assert.equal(S.siteBlocked(s('*.example.com'), 'example.com'), false);
  assert.equal(S.siteBlocked(s('*.example.com'), 'xexample.com'), false);
  assert.equal(S.siteBlocked(s('docs.*'), 'docs.python.org'), true);
  assert.equal(S.siteBlocked(s('EXAMPLE.com'), 'Example.COM'), true);
  assert.equal(S.siteBlocked(s('example.com'), 'exampleXcom'), false); // . 는 글자 그대로
  assert.equal(S.siteBlocked(s(), 'example.com'), false);
  assert.equal(S.siteBlocked({}, 'example.com'), false);
  assert.equal(S.siteBlocked(s('example.com'), ''), false);
});

// 가짜 chrome.storage: 토큰 같은 다른 키가 살아 있는지, set 이 'settings' 만 쓰는지 본다.
function fakeChrome(initial = {}) {
  const store = { ...initial };
  const sets = [];
  const listeners = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(k) { return typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : { ...store }; },
        async set(o) { sets.push(Object.keys(o)); Object.assign(store, o); },
        async clear() { throw new Error('clear 금지'); },
        async remove() { throw new Error('remove 금지'); },
      },
      onChanged: { addListener: (f) => listeners.push(f) },
    },
  };
  return { store, sets, listeners };
}

test('load: 저장 없으면 기본값, 있으면 정규화', async () => {
  fakeChrome();
  assert.deepEqual(await S.load(), S.DEFAULTS);
  fakeChrome({ settings: { level: 'Z', annotation: { sizePct: 500 } } });
  const s = await S.load();
  assert.equal(s.level, 'C1');
  assert.equal(s.annotation.sizePct, 100);
});

test('save: settings 키만 쓰고 token 등 다른 키는 그대로, 병합해서 돌려준다', async () => {
  const { store, sets } = fakeChrome({ token: 'secret', settings: { level: 'B1' } });
  const r = await S.save({ annotation: { sizePct: 70 } });
  assert.deepEqual(sets, [['settings']]);
  assert.equal(store.token, 'secret');
  assert.equal(store.settings.level, 'B1');
  assert.equal(store.settings.annotation.sizePct, 70);
  assert.deepEqual(r, store.settings);
  await S.save({ level: 'Z' }); // 잘못된 값도 정규화되어 저장
  assert.equal(store.settings.level, 'C1');
  assert.deepEqual(sets, [['settings'], ['settings']]);
});

test('onChange: settings 변경만 정규화해서 전달', () => {
  const { listeners } = fakeChrome();
  const got = [];
  S.onChange((s) => got.push(s));
  assert.equal(listeners.length, 1);
  listeners[0]({ token: { newValue: 'x' } }, 'local');
  listeners[0]({ settings: { newValue: { level: 'A2' } } }, 'sync');
  assert.equal(got.length, 0);
  listeners[0]({ settings: { newValue: { level: 'A2' } } }, 'local');
  assert.equal(got.length, 1);
  assert.equal(got[0].level, 'A2');
  listeners[0]({ settings: { newValue: undefined } }, 'local'); // 지워지면 기본값
  assert.deepEqual(got[1], S.DEFAULTS);
});

test('glossary: 자동(기본)·끄기만 받고 그 밖은 기본값, 병합해도 유지', () => {
  assert.equal(S.DEFAULTS.glossary, 'auto');
  assert.equal(S.normalize({}).glossary, 'auto');
  assert.equal(S.normalize({ glossary: 'off' }).glossary, 'off');
  for (const bad of ['on', true, 0, null, 'OFF']) assert.equal(S.normalize({ glossary: bad }).glossary, 'auto');
  assert.equal(S.merge({ glossary: 'off' }, { level: 'B2' }).glossary, 'off');
  assert.equal(S.merge({}, { glossary: 'off' }).glossary, 'off');
});

const HTB_DEFAULTS = ['academy.hackthebox.com', 'app.hackthebox.com', 'portswigger.net', 'owasp.org', '*.owasp.org', 'book.hacktricks.xyz', 'book.hacktricks.wiki', 'cloud.hacktricks.xyz', 'hacktricks.wiki', '*.hacktricks.wiki', 'tryhackme.com', 'attack.mitre.org', 'atlas.mitre.org', 'cwe.mitre.org', 'nvd.nist.gov', 'www.exploit-db.com', 'gtfobins.github.io', 'lolbas-project.github.io', 'arxiv.org'];

test('glossarySites: 기본값은 보안·ML 사이트 19개, 설정에 없으면(옛 저장값) 기본값', () => {
  assert.deepEqual(S.DEFAULTS.glossarySites, HTB_DEFAULTS);
  assert.deepEqual(S.normalize({}).glossarySites, HTB_DEFAULTS);
  assert.deepEqual(S.normalize({ level: 'B2' }).glossarySites, HTB_DEFAULTS);
  for (const bad of ['a.com', 5, null, {}]) assert.deepEqual(S.normalize({ glossarySites: bad }).glossarySites, HTB_DEFAULTS, String(bad));
});

test('glossarySites: sites 와 같은 정리(문자열만·trim·소문자·중복 제거·200개). 빈 배열은 "다 지웠다"로 유지', () => {
  assert.deepEqual(S.normalize({ glossarySites: [' Example.COM ', 3, '', 'example.com', null, 'a.b'] }).glossarySites, ['example.com', 'a.b']);
  assert.equal(S.normalize({ glossarySites: Array.from({ length: 300 }, (_, i) => `s${i}.com`) }).glossarySites.length, 200);
  assert.deepEqual(S.normalize({ glossarySites: [] }).glossarySites, []);
  assert.deepEqual(S.merge({}, { glossarySites: [] }).glossarySites, [], '병합해도 빈 배열이 기본값으로 돌아가지 않는다');
  assert.deepEqual(S.merge({ glossarySites: ['a.com'] }, { level: 'B2' }).glossarySites, ['a.com']);
  assert.deepEqual(S.normalize({ sites: ['x.com'] }).glossarySites, HTB_DEFAULTS, '끌 사이트와 서로 영향 없음');
});

test('glossarySites: 결과를 바꿔도 DEFAULTS 는 그대로', () => {
  S.normalize({}).glossarySites.push('x.com');
  assert.deepEqual(S.normalize({}).glossarySites, HTB_DEFAULTS);
  assert.deepEqual(S.DEFAULTS.glossarySites, HTB_DEFAULTS);
  assert.ok(Object.isFrozen(S.DEFAULTS.glossarySites));
});

test('siteMatches: 목록·호스트만 받는 같은 규칙. siteBlocked 는 settings.sites 로 그것을 쓴다', () => {
  assert.equal(S.siteMatches(['example.com'], 'example.com'), true);
  assert.equal(S.siteMatches(['example.com'], 'docs.example.com'), false);
  assert.equal(S.siteMatches(['*.example.com'], 'docs.example.com'), true);
  assert.equal(S.siteMatches(['*.example.com'], 'example.com'), false);
  assert.equal(S.siteMatches(['EXAMPLE.com'], 'Example.COM'), true);
  assert.equal(S.siteMatches([], 'example.com'), false);
  assert.equal(S.siteMatches(undefined, 'example.com'), false);
  assert.equal(S.siteMatches('example.com', 'example.com'), false, '배열이 아니면 아니다');
  assert.equal(S.siteMatches([3, '', null, 'a.com'], 'a.com'), true);
  assert.equal(S.siteMatches(['example.com'], ''), false);
  assert.equal(S.siteBlocked({ sites: ['example.com'] }, 'example.com'), true);
  assert.equal(S.siteBlocked({ glossarySites: ['example.com'] }, 'example.com'), false, 'siteBlocked 는 sites 만 본다');
  // 기본 목록: 본 도메인·하위 도메인 규칙
  const d = S.DEFAULTS.glossarySites;
  assert.equal(S.siteMatches(d, 'academy.hackthebox.com'), true);
  assert.equal(S.siteMatches(d, 'hackthebox.com'), false);
  assert.equal(S.siteMatches(d, 'owasp.org'), true);
  assert.equal(S.siteMatches(d, 'cheatsheetseries.owasp.org'), true);
  assert.equal(S.siteMatches(d, 'evil-owasp.org'), false);
  assert.equal(S.siteMatches(d, 'arxiv.org.evil.com'), false);
});

test('selectionTranslate: 기본은 켜짐, 불리언만 받고 나머지는 기본값', () => {
  assert.equal(S.DEFAULTS.selectionTranslate, true);
  assert.equal(S.normalize({ selectionTranslate: false }).selectionTranslate, false);
  assert.equal(S.normalize({ selectionTranslate: 'no' }).selectionTranslate, true);
  assert.equal(S.merge({}, { selectionTranslate: false }).selectionTranslate, false);
  // 이 페이지 끄기·사이트 끄기와는 별개: sites 에 걸려도 값은 그대로
  assert.equal(S.normalize({ sites: ['a.com'], selectionTranslate: true }).selectionTranslate, true);
});

test('video.repeatLine·skipGaps: 기본 false, 불리언만 받고, 문장 반복이 켜지면 줄마다 멈춤은 꺼진다', () => {
  assert.equal(S.DEFAULTS.video.repeatLine, false);
  assert.equal(S.DEFAULTS.video.skipGaps, false);
  assert.equal(S.normalize({}).video.repeatLine, false);
  assert.equal(S.normalize({}).video.skipGaps, false);
  assert.equal(S.normalize({ video: { repeatLine: true } }).video.repeatLine, true);
  assert.equal(S.normalize({ video: { skipGaps: true } }).video.skipGaps, true);
  for (const bad of ['yes', 1, null, {}]) {
    assert.equal(S.normalize({ video: { repeatLine: bad } }).video.repeatLine, false, String(bad));
    assert.equal(S.normalize({ video: { skipGaps: bad } }).video.skipGaps, false, String(bad));
  }
  // 28-1 배타: 둘 다 참이면 문장 반복을 남기고 줄마다 멈춤을 끈다
  const both = S.normalize({ video: { repeatLine: true, pauseEach: true } });
  assert.equal(both.video.repeatLine, true);
  assert.equal(both.video.pauseEach, false);
  assert.equal(S.normalize({ video: { repeatLine: false, pauseEach: true } }).video.pauseEach, true);
  assert.equal(S.merge({}, { video: { repeatLine: true, pauseEach: true } }).video.pauseEach, false);
});
