// 과제 T53h(변경 기록 28-11): 자막 스타일 — 두 줄 구성·설정 기본값·범위·옛 값 옮기기·화면 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/video-core.js');
await import('../extension/settings-core.js');
await import('../extension/panel.js');
const V = globalThis.readglossVideo;
const S = globalThis.readglossSettings;
const C = globalThis.readglossPanelCore;
const subs = readFileSync(new URL('../extension/video-subs.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');

test('subLayout: 네 유형의 줄 보이기와 koAbove 순서', () => {
  assert.deepEqual(V.subLayout({ subType: 'dual', koAbove: false }), { showEn: true, showKo: true, order: ['en', 'ko'] });
  assert.deepEqual(V.subLayout({ subType: 'en', koAbove: false }), { showEn: true, showKo: false, order: ['en', 'ko'] });
  assert.deepEqual(V.subLayout({ subType: 'ko', koAbove: false }), { showEn: false, showKo: true, order: ['en', 'ko'] });
  assert.deepEqual(V.subLayout({ subType: 'none', koAbove: false }), { showEn: false, showKo: false, order: ['en', 'ko'] });
  assert.deepEqual(V.subLayout({ subType: 'dual', koAbove: true }), { showEn: true, showKo: true, order: ['ko', 'en'] });
  assert.deepEqual(V.subLayout({ subType: 'en', koAbove: true }), { showEn: true, showKo: false, order: ['ko', 'en'] });
  assert.deepEqual(V.subLayout({ subType: 'ko', koAbove: true }).order, ['ko', 'en']);
  assert.deepEqual(V.subLayout({ subType: 'none', koAbove: true }).showEn, false);
  assert.deepEqual(V.subLayout({ subType: 'nope' }), { showEn: true, showKo: true, order: ['en', 'ko'] }, '모르는 값은 둘 다');
  assert.deepEqual(V.subLayout(), { showEn: true, showKo: true, order: ['en', 'ko'] });
});

test('설정 기본값: subType·koAbove·두 크기·배경·위치', () => {
  const v = S.DEFAULTS.video;
  assert.equal(v.subType, 'dual');
  assert.equal(v.koAbove, false);
  assert.equal(v.enFontPct, 100);
  assert.equal(v.koFontPct, 100);
  assert.equal(v.bgOpacity, 75);
  assert.equal(v.posY, 0);
  assert.deepEqual(S.normalize({}).video, S.DEFAULTS.video);
});

test('설정 범위: 크기는 60~160·10 단위, 배경은 0·25·50·75·100, 위치는 -40~0', () => {
  const f = (video) => S.normalize({ video }).video;
  assert.equal(f({ enFontPct: 59 }).enFontPct, 60);
  assert.equal(f({ enFontPct: 161 }).enFontPct, 160);
  assert.equal(f({ enFontPct: 123 }).enFontPct, 120);
  assert.equal(f({ enFontPct: '120' }).enFontPct, 100, '숫자가 아니면 기본값');
  assert.equal(f({ koFontPct: 69 }).koFontPct, 70);
  assert.equal(f({ koFontPct: 999 }).koFontPct, 160);
  assert.equal(f({ koFontPct: -5 }).koFontPct, 60);

  assert.equal(f({ bgOpacity: -5 }).bgOpacity, 0);
  assert.equal(f({ bgOpacity: 30 }).bgOpacity, 25);
  assert.equal(f({ bgOpacity: 40 }).bgOpacity, 50);
  assert.equal(f({ bgOpacity: 120 }).bgOpacity, 100);
  assert.equal(f({ bgOpacity: '75' }).bgOpacity, 75);

  assert.equal(f({ posY: 10 }).posY, 0);
  assert.equal(f({ posY: -99 }).posY, -40);
  assert.equal(f({ posY: -12.6 }).posY, -13);
  assert.equal(f({ posY: 'x' }).posY, 0);

  assert.equal(f({ subType: 'both' }).subType, 'dual');
  assert.equal(f({ subType: 'none' }).subType, 'none');
  assert.equal(f({ koAbove: 'yes' }).koAbove, false);
  assert.equal(f({ koAbove: true }).koAbove, true);
});

test('옛 값 옮기기: fontPct 는 두 크기로, ko=false 는 subType en 으로, 새 값이 이긴다', () => {
  const f = (video) => S.normalize({ video }).video;
  const migrated = f({ fontPct: 130 });
  assert.equal(migrated.enFontPct, 130);
  assert.equal(migrated.koFontPct, 130);
  const one = f({ fontPct: 130, enFontPct: 80 });
  assert.equal(one.enFontPct, 80);
  assert.equal(one.koFontPct, 130);

  assert.equal(f({ ko: false }).subType, 'en');
  assert.equal(f({ ko: true }).subType, 'dual');
  assert.equal(f({ ko: false, subType: 'ko' }).subType, 'ko', '새 값이 있으면 새 값');
  assert.equal(f({ ko: false, fontPct: 150 }).enFontPct, 150);

  const n = f({ ko: false, fontPct: 120 });
  assert.equal('ko' in n, false, '옛 키는 결과에 남지 않는다');
  assert.equal('fontPct' in n, false);
});

test('설정 병합: 옛 저장값을 정규화해도 새 키가 유지된다', () => {
  const a = S.merge(S.normalize({ video: { ko: false, fontPct: 130 } }), { video: { enFontPct: 120 } });
  assert.equal(a.video.subType, 'en');
  assert.equal(a.video.enFontPct, 120);
  assert.equal(a.video.koFontPct, 130);
  assert.equal(a.video.bgOpacity, 75);
  const b = S.merge(a, { video: { subType: 'dual', koAbove: true, bgOpacity: 25, posY: -20 } });
  assert.equal(b.video.subType, 'dual');
  assert.equal(b.video.koAbove, true);
  assert.equal(b.video.bgOpacity, 25);
  assert.equal(b.video.posY, -20);
});

test('패널 표: 자막 유형·한국어 위로·영어/한국어 크기·배경 진하기, 옛 칸은 없다', () => {
  assert.deepEqual(C.CHOICES.find((c) => c.path === 'video.subType').options.map(([v]) => v), ['dual', 'en', 'ko', 'none']);
  assert.deepEqual(C.CHOICES.find((c) => c.path === 'video.bgOpacity').options.map(([v]) => v), [0, 25, 50, 75, 100]);
  assert.deepEqual(C.RANGES.find((r) => r.path === 'video.enFontPct'), { path: 'video.enFontPct', min: 60, max: 160, step: 10 });
  assert.deepEqual(C.RANGES.find((r) => r.path === 'video.koFontPct'), { path: 'video.koFontPct', min: 60, max: 160, step: 10 });
  assert.ok(C.TOGGLES.some((t) => t.path === 'video.koAbove'));
  assert.equal(C.TOGGLES.some((t) => t.path === 'video.ko'), false);
  assert.equal(C.RANGES.some((r) => r.path === 'video.fontPct'), false);
  assert.match(panel, /text: '영상 자막'/);
  assert.match(panel, /text: '자막 위치 조정'/);
  assert.match(panel, /new CustomEvent\('readgloss:subs-adjust'\)/);
});

test('자막 층: subLayout 으로 줄 숨김·순서, 두 크기·배경 알파·posY, 위치 조정 띠', () => {
  assert.match(subs, /V\.subLayout\(\{ subType: v\.subType, koAbove: v\.koAbove \}\)/);
  assert.match(subs, /ui\.en\.hidden = !lay\.showEn;/);
  assert.match(subs, /ui\.ko\.hidden = !lay\.showKo;/);
  assert.match(subs, /ui\.en\.style\.order = orderOf\('en'\);/);
  assert.match(subs, /var\(--fs-en/);
  assert.match(subs, /var\(--fs-ko/);
  assert.match(subs, /rgba\(8, 8, 8, var\(--bg/);
  assert.match(subs, /host\.style\.setProperty\('--bg'/);
  assert.match(subs, /host\.style\.bottom = .*Math\.abs\(posY\)/);
  assert.match(subs, /window\.addEventListener\('readgloss:subs-adjust'/);
  assert.match(subs, /위아래로 끌어 옮기세요/);
  assert.match(subs, /button\('적용'/);
  assert.match(subs, /button\('초기화'/);
  assert.doesNotMatch(subs, /vs\(\)\.fontPct|vs\(\)\.ko\b/);
});
