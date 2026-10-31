// 과제 T51g(변경 기록 27-10): UI/UX 고치기 고리 1회차 — 패널 탭 CSS 가 서로 새지 않게, 글자색 토큰, 복습·자막 층 접근성, 코드 검토 고침.
// 패널의 탭들은 shadow root 하나를 같이 쓴다(panel.js mountPane). 탭 CSS 의 규칙이 탭 뿌리(.rgv·.rgw·.rgs)로 시작하지 않으면 다른 탭에도 걸린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

// 탭 소스의 `const <name> = \`...\`` 안 규칙 머리(선택자)들. @media 안도 본다. ${...} 끼워 넣기는 빼고 읽는다.
function selectorsOf(src, name = 'CSS') {
  const head = `const ${name} = \``;
  const start = src.indexOf(head);
  const css = src.slice(start + head.length, src.indexOf('\n  `;', start)).replace(/\$\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let depth = 0;
  let media = 0;
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const pre = buf.trim();
      if (depth === media) {
        if (pre.startsWith('@')) media++;
        else out.push(...pre.split(',').map((x) => x.trim()));
      }
      depth++;
      buf = '';
    } else if (ch === '}') {
      depth--;
      if (depth < media) media = depth;
      buf = '';
    } else if (ch === ';' && depth > media) buf = '';
    else buf += ch;
  }
  return out;
}

for (const [file, root] of [['panel-video.js', '.rgv'], ['panel-words.js', '.rgw'], ['panel-study.js', '.rgs']]) {
  test(`${file}: CSS 규칙은 모두 ${root} 아래(다른 탭으로 새지 않는다)`, () => {
    const sels = selectorsOf(read(file));
    assert.ok(sels.length > 20, `규칙을 읽었다(${sels.length})`);
    const leaks = sels.filter((s) => !(s === root || s.startsWith(`${root} `) || s.startsWith(`${root}:`) || s.startsWith(`${root}[`) || /^:host\([^)]*\) /.test(s) && s.includes(root)));
    assert.deepEqual(leaks, []);
  });
}

test('panel-video.js: 다른 탭과 겹치는 이름을 쓰지 않는다(v- 접두사)', () => {
  const sels = selectorsOf(read('panel-video.js')).join(' ');
  for (const cls of ['act', 'chip', 'status', 'title', 'txt', 'ko', 'hard', 'tools', 'star', 't']) {
    assert.doesNotMatch(sels, new RegExp(`\\.${cls}(?![\\w-])`), `.${cls}`);
  }
});

test('토큰: --rg-accent-ink(옅은 강조 바탕 위 글자, 4.5:1 이상)와 복습 맞음색 --w-ok(밝음·어두움)', () => {
  const panel = read('panel.js');
  assert.match(panel, /const LIGHT = `[^`]*--rg-accent-ink: #245ac4;/);
  assert.match(panel, /const DARK = `[^`]*--rg-accent-ink: #8db4ff;/);
  const words = read('panel-words.js');
  assert.match(words, /--w-err: #b31d28; --w-ok: #116329;/, '밝음: ✓·✕ 표시가 옅은 바탕 위에서도 4.5:1(감사 2회차 4)');
  assert.match(words, /--w-ok: #3fb950;/);
  assert.match(words, /:host\(\[data-theme="dark"\]\) \.rgw \{[^}]*--w-ok: #3fb950;/, '설정 테마를 따른다');
  // 계산한 대비(밝음: ink #245ac4 / 옅은 바탕 = 5.54, 어두움: #8db4ff = 6.17)
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const mix = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  assert.ok(ratio(hex('#245ac4'), mix(hex('#2f6feb'), hex('#ffffff'), 0.1)) >= 4.5);
  assert.ok(ratio(hex('#8db4ff'), mix(hex('#6b9bff'), hex('#1e2127'), 0.14)) >= 4.5);
  assert.ok(ratio(hex('#3fb950'), hex('#1e2127')) >= 4.5);
  assert.ok(ratio(hex('#116329'), mix(hex('#116329'), hex('#ffffff'), 0.12)) >= 4.5, '✓ 표시 / 맞음 바탕');
  assert.ok(ratio(hex('#b31d28'), mix(hex('#b31d28'), hex('#ffffff'), 0.10)) >= 4.5, '✕ 표시 / 틀림 바탕');
});

test('감사 2회차 3·5: 공부 기록·내 단어는 껍데기 이름(.head·.sec·.status)을 쓰지 않고, 옅은 강조 바탕 위 글자는 ink 색', () => {
  const study = read('panel-study.js');
  // 탭이 만드는 요소의 클래스(el('div', 'a b')·className·classList·class: ·btn(…, 'cls')) 중 껍데기 CSS 가 꾸미는 이름이 있으면
  // 그 규칙이 탭 안으로 내려온다(공부 기록 줄 전체가 12px·굵게·옅은 색이던 것)
  const shell = new Set(selectorsOf(read('panel.js'), 'STYLE_TEXT').flatMap((x) => [...x.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])));
  for (const file of ['panel-video.js', 'panel-words.js', 'panel-study.js', 'panel-concepts.js', 'panel-scraps.js']) {
    const src = read(file);
    const dom = new Set();
    for (const re of [/el\('[a-z0-9]+',\s*'([^']+)'/g, /className\s*=\s*'([^']+)'/g, /class:\s*'([^']+)'/g, /btn\([^)]*?,\s*'([a-z][\w -]*)'[,)]/g]) {
      for (const m of src.matchAll(re)) m[1].split(/\s+/).forEach((c) => dom.add(c));
    }
    for (const m of src.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) dom.add(m[1]);
    assert.ok(dom.size > 5, `${file} 클래스를 읽었다`);
    assert.deepEqual([...dom].filter((c) => shell.has(c)), [], `${file}: 껍데기 규칙이 걸리는 이름`);
  }
  assert.match(study, /--s-ink: var\(--rg-accent-ink, #245ac4\)/);
  for (const sel of ['.rg-view-tab[aria-selected="true"]', '.rng[aria-pressed="true"]', '.badge', '.time-sum-val']) {
    const rule = study.slice(study.indexOf(`.rgs ${sel} {`), study.indexOf('}', study.indexOf(`.rgs ${sel} {`)));
    assert.match(rule, /color: var\(--s-ink\)/, sel);
  }
  const panel = read('panel.js');
  for (const sel of ['.mitem:hover', '.seg button[aria-pressed="true"]', '.btn:hover:not(:disabled)']) {
    const at = panel.indexOf(`${sel} {`);
    assert.match(panel.slice(at, panel.indexOf('}', at)), /color: var\(--rg-accent-ink\)/, sel);
  }
});

test('복습 고르기: 맞음·틀림을 색 말고 표시(✓·✕)와 읽어 주는 이름으로도, 새 카드 포커스는 보기 묶음에', () => {
  const src = read('panel-words.js');
  assert.match(src, /answered && c\.correct \? '✓' : answered && k === quiz\.picked \? '✕' : ''/);
  assert.match(src, /setAttribute\('aria-label', `정답\$\{k === quiz\.picked \? '\(내 답\)' : ''\}: /);
  assert.match(src, /setAttribute\('aria-label', `내 답\(틀림\): /);
  assert.match(src, /\$\{right \? '맞았어요' : '아직이에요'\} · 다음/, '다음 단추 글이 맞음·틀림 모두 같은 꼴');
  assert.match(src, /box\.tabIndex = -1;/);
  assert.match(src, /requestAnimationFrame\(\(\) => box\.focus\(\)\)/);
  assert.doesNotMatch(src, /box\.querySelector\('button'\)\?\.focus\(\)/, '첫 보기에 포커스를 두지 않는다');
});

test('코드 검토 1: 고르기 키 — 눌러 둔 키·고르기 전 Space/Enter 는 먹고, Tab 으로 간 단추 위 Space/Enter 는 그 단추', () => {
  const src = read('panel-words.js');
  const i = src.indexOf('if (quiz?.choices) {');
  const block = src.slice(i, src.indexOf('if (cardState.side ===', i));
  assert.match(block, /if \(next && !e\.repeat && target\?\.localName === 'button'\) return void e\.stopPropagation\(\);/);
  assert.match(block, /stop\(\);\s*if \(e\.repeat\) return;/);
  assert.match(block, /if \(pick && quiz\.picked < 0\) answerChoice/);
  assert.match(block, /else if \(next && quiz\.picked >= 0\) nextAfterChoice\(\)/);
});

test('코드 검토 4·11: 답한 뒤 방식을 바꾸면 다음 카드, [장면]은 페이지 스크립트 클릭 무시', () => {
  const src = read('panel-words.js');
  assert.match(src, /const answered = quiz\?\.picked >= 0;[\s\S]{0,200}if \(answered\) return nextCard\(\);/);
  assert.match(src, /\(e\) => e\.isTrusted !== false && openScene\(scene\)/);
  assert.doesNotMatch(src, /'🔊|'▶ 장면'/, '이모지·글자 아이콘 대신 SVG');
  assert.match(src, /document\.createElementNS\(NS, 'svg'\)/);
});

test('자막 층: 마우스는 두 줄·막대·풀이만 받고, 지난 줄은 글자만 흐리게, 가린 칸은 밑줄, 단추 28px, 키보드 낱말 자리', () => {
  const src = read('video-subs.js');
  assert.match(src, /\.box \{ pointer-events: none;/);
  assert.match(src, /\.lines, \.bar, \.note \{ pointer-events: auto; \}/);
  assert.doesNotMatch(src, /\.lines\.past \{ opacity/);
  assert.match(src, /\.lines\.past \.en, \.lines\.past \.ko \{ color: rgba\(255, 255, 255, \.72\); \}/);
  assert.match(src, /\.w\.hid \{[^}]*box-shadow: inset 0 -2px 0/);
  assert.match(src, /button \{ all: unset;[^}]*min-width: 28px; min-height: 28px;/);
  assert.match(src, /if \(e\.detail > 0\) b\.blur\(\);/, '키보드로 누르면 막대가 그대로 보인다');
  assert.match(src, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'/);
  assert.match(src, /\.lines:focus \.w\.cur \{ outline: 2px solid/);
  assert.match(src, /\.w\.hard:hover \.g, \.lines:focus \.w\.hard\.cur \.g \{ display: block; \}/, '키보드 자리 낱말도 뜻 풍선');
  assert.match(src, /if \(e\.key === 'Escape' && !e\.readglossCardClosed\) e\.target\?\.blur\?\.\(\);/);
  assert.match(src, /W 키보드 저장 모드 · ←→ 낱말 · Enter 저장 · ↓ 자세히 · Esc 재생'\);/, '두 줄 묶음 이름에 새 키 안내(감사 2회차 7, T53d)');
  assert.match(src, /if \(e\.target\.closest\?\.\('\.ko'\)\) koPress = true;\s*else e\.preventDefault\(\);/, '마우스로는 포커스를 옮기지 않는다(감사 2회차 1), 한국어 줄은 끌어 고르기가 된다(3회차)');
  assert.match(src, /if \(!koPress\) return;\s*koPress = false;\s*lines\.blur\(\);/, '한국어 줄을 고른 뒤 포커스는 놓는다');
  assert.match(src, /\.lines:focus-visible \{ outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 2px rgba\(8, 8, 8, \.92\), 0 0 0 6px rgba\(8, 8, 8, \.92\); \}/, '포커스 표시 검정·흰·검정 세 겹(3회차)');
  assert.match(src, /button\[aria-pressed="true"\], button\[aria-expanded="true"\] \{ background: linear-gradient\(rgba\(245, 158, 11, \.30\), rgba\(245, 158, 11, \.30\)\), rgba\(28, 28, 28, \.92\); border-color: #f59e0b;/, '눌린 단추는 주황 테두리(28-10)');
  assert.match(src, /if \(box\.contains\(e\.relatedTarget\) \|\| !document\.hasFocus\(\)\) return;\s*holdOff\('keys'\);\s*ui\.wcur = -1;/, '층을 떠나면 낱말 자리를 지우되, 창을 잠깐 떠날 때는 그대로(영상이 저절로 재생되지 않게)');
  assert.match(src, /const anchor = r && inLayer \? \{ left: r\.left, right: r\.right, top: r\.top, bottom: innerHeight \} : r;/, '확인 메시지는 층 위에');
  assert.match(src, /for \(const m of text\.matchAll\(\/\[\\p\{L\}\\p\{N\}\]\+\/gu\)\)/, '문장 전체 가리기는 한 글자·숫자도');
});

test('코드 검토 2·3·5·6·12·13: 저장 값 미리 잡기, 누르는 중 카드 닫힘, 구간 넘겨 옮김, 번역 범위, 광고 뒤 기다림, 360°', () => {
  const src = read('video-subs.js');
  assert.match(src, /const key = S\.mainKey;[\s\S]{0,300}const id = S\.id;\s*const title = titleNow\(\);[\s\S]{0,400}if \(key !== S\.mainKey\) \{/);
  assert.match(src, /V\.lineMessage\(\{ cue, ko, id, title \}\)/);
  assert.match(src, /window\.addEventListener\('pointerdown', \(e\) => \{ if \(e\.isTrusted\) pressing = true; \}, true\);/);
  assert.match(src, /if \(pressing && Date\.now\(\) < until\) return void setTimeout/);
  assert.match(src, /const reached = t < S\.clip\.end \+ 1;[\s\S]{0,140}if \(reached\) video\.pause\(\);/);
  assert.match(src, /!\(S\.koAll \|\| \(vs\(\)\.ko && visible\(\)\)\)/, '[한국어 모두 보기]는 한국어 줄 설정과 상관없이, 근처 줄은 보일 때만');
  assert.match(src, /!visible\(\) \|\| S\.annotBusy/);
  assert.match(src, /if \(S\.ad && !ad\) S\.waitSince = Date\.now\(\);/);
  assert.match(src, /if \(!e\.isTrusted\) return; \/\/ 페이지 스크립트가 만든 키/);
  assert.match(src, /ytp-webgl-spherical/);
});

test('감사 2회차 6: 뿌리로 묶지 않은 개념·스크랩북 탭 CSS 는 클래스로만 시작하고, 이름이 패널 껍데기·다른 탭과 겹치지 않는다', () => {
  const classes = (sels) => new Set(sels.flatMap((x) => [...x.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])));
  const sets = {
    shell: classes(selectorsOf(read('panel.js'), 'STYLE_TEXT')),
    words: classes(selectorsOf(read('panel-words.js'))),
    study: classes(selectorsOf(read('panel-study.js'))),
    video: classes(selectorsOf(read('panel-video.js'))),
  };
  for (const [file, name] of [['panel-concepts.js', 'CSS'], ['panel-scraps.js', 'STYLE_TEXT']]) {
    const sels = selectorsOf(read(file), name);
    assert.ok(sels.length > 15, `${file} 규칙을 읽었다(${sels.length})`);
    assert.deepEqual(sels.filter((x) => !x.startsWith('.')), [], `${file}: 맨 요소·속성 선택자는 모든 탭에 걸린다`);
    const mine = classes(sels);
    for (const [other, set] of Object.entries(sets)) assert.deepEqual([...mine].filter((c) => set.has(c)), [], `${file} ↔ ${other} 같은 이름`);
  }
});
