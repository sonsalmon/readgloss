import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportDay } from '../scripts/export-day.mjs';

const T = (d, h = 12) => new Date(2026, 9, d, h, 0, 0).getTime(); // 로컬 2026-10-d
const SCRIPT = new URL('../scripts/export-day.mjs', import.meta.url).pathname;

function fake() {
  const dir = mkdtempSync(join(tmpdir(), 'export-day-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'words.json'), JSON.stringify({
    saved: {
      mitigate: { word: 'mitigated', gloss: '완화하다', sentence: 'We mitigated the risk.', url: '', ts: T(6) },
      old: { word: 'old', gloss: '옛', sentence: '', url: '', ts: T(5) },
      long: { word: 'long', gloss: '긴', sentence: 'x'.repeat(300), url: '', ts: T(6, 13) },
    },
    phrases: {
      aaaaaaaaaaaa: { text: 'in the wild', translation: '실제 환경에서', context: { translation: '실전에서', note: '관용' }, ts: T(6, 14) },
      bbbbbbbbbbbb: { text: 'yesterday', translation: '어제', ts: T(5) },
      cccccccccccc: { text: 'delve into', translation: '깊이 파고들다', kind: 'expression', sentence: 'This module delves into the math behind the algorithms.', ts: T(6, 15) },
      dddddddddddd: { text: 'zero-day', translation: '제로데이', kind: 'expression', ts: T(6, 16) },
      eeeeeeeeeeee: { text: 'Plain sentence.', translation: '맥 번역만', kind: 'sentence', ts: T(6, 17) },
    },
  }));
  writeFileSync(join(dir, 'mydict.json'), JSON.stringify({ entries: { pca: { ko: '주성분 분석', exp: 'principal component analysis', ts: T(6) }, rce: { ko: '원격 코드 실행', ts: T(4) } } }));
  writeFileSync(join(dir, 'study-log.jsonl'), [
    { ts: T(6), kind: 'dict', text: 'a' }, { ts: T(6, 15), kind: 'dict', text: 'b' }, { ts: T(6, 16), kind: 'mt', text: 'c' }, { ts: T(5), kind: 'save', text: 'd' },
  ].map((v) => JSON.stringify(v)).join('\n') + '\n{깨진줄');
  return dir;
}

test('그날 것만 거르고 마크다운 모양을 만든다', () => {
  const md = exportDay('2026-10-06', fake());
  assert.match(md, /^## 영어 표현 \(readgloss\)\n/);
  assert.match(md, /- \*\*mitigate\*\* \(mitigated\) — 완화하다 \/ "We mitigated the risk\."/); // 원형(키)을 굵게, 굴절형은 괄호
  assert.match(md, /^- "in the wild" — 실전에서\n {2}- note: 관용$/m); // 문맥 번역이 있으면 그것이 번역, 맥 번역은 생략
  assert.doesNotMatch(md, /실제 환경에서|문맥 번역:/);
  assert.match(md, /^- "Plain sentence\." — 맥 번역만$/m); // 문맥 번역이 없을 때만 맥 번역
  assert.match(md, /### 표현\n\n- \*\*delve into\*\* — 깊이 파고들다 \/ "This module delves into the math behind the algorithms\."\n- \*\*zero-day\*\* — 제로데이\n/);
  assert.doesNotMatch(md, /- "delve into"|- "zero-day"/); // 표현은 구·문장 절에 섞이지 않는다
  assert.ok(md.indexOf('### 단어') < md.indexOf('### 표현') && md.indexOf('### 표현') < md.indexOf('### 구·문장'));
  assert.match(md, /- \*\*pca\*\* — 주성분 분석 \(principal component analysis\)/);
  assert.match(md, /공부 기록: dict 2, mt 1/);
  assert.doesNotMatch(md, /old|yesterday|rce/);
});

test('단어: word 가 원형과 같거나 비어 있어도 줄이 깨지지 않는다(원형만 굵게)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-day-'));
  writeFileSync(join(dir, 'words.json'), JSON.stringify({
    saved: {
      long: { word: 'long', gloss: '긴', ts: T(6, 13) },
      same: { word: 'Same', gloss: '같은', ts: T(6, 14) },
      blank: { gloss: '빈칸', ts: T(6, 15) },
      empty: { word: '', gloss: '빈문자열', ts: T(6, 16) },
    },
  }));
  const md = exportDay('2026-10-06', dir);
  assert.match(md, /^- \*\*long\*\* — 긴$/m);
  assert.match(md, /^- \*\*same\*\* — 같은$/m);
  assert.match(md, /^- \*\*blank\*\* — 빈칸$/m);
  assert.match(md, /^- \*\*empty\*\* — 빈문자열$/m);
  assert.doesNotMatch(md, /\*\*\*\*|\(\)/);
});

test('표현의 출처 문장은 200자에서 자르고, 표현만 있는 날도 빈 날이 아니다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-day-'));
  writeFileSync(join(dir, 'words.json'), JSON.stringify({ phrases: { aaaaaaaaaaaa: { text: 'en', translation: '뜻', kind: 'expression', sentence: `${'y'.repeat(300)}`, ts: T(6) } } }));
  const md = exportDay('2026-10-06', dir);
  assert.ok(md.includes(`- **en** — 뜻 / "${'y'.repeat(200)}…"`));
  assert.doesNotMatch(md, /이날 저장한 표현 없음|### 구·문장/);
});

test('빈 날은 안내 문구', () => {
  const md = exportDay('2026-10-01', fake());
  assert.match(md, /\(이날 저장한 표현 없음\)/);
  assert.doesNotMatch(md, /###/);
});

test('data 폴더가 없어도 빈 날로 처리', () => {
  assert.match(exportDay('2026-10-06', join(tmpdir(), 'no-such-export-day')), /\(이날 저장한 표현 없음\)/);
});

test('문장은 200자에서 자르고 말줄임', () => {
  const md = exportDay('2026-10-06', fake());
  assert.ok(md.includes(`"${'x'.repeat(200)}…"`));
  assert.ok(!md.includes('x'.repeat(201)));
});

// ---- T19: 메모 ----
test('메모가 있으면 단어·표현·구 줄에 " / 메모: <한 줄 정리>" 를 붙이고, 없으면 안 붙인다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-day-'));
  writeFileSync(join(dir, 'words.json'), JSON.stringify({
    saved: {
      mitigate: { word: 'mitigated', gloss: '완화하다', sentence: 'We mitigated the risk.', memo: '  모듈  290 용어 ', ts: T(6) },
      plain: { word: 'plain', gloss: '평범', memo: '', ts: T(6, 1) },
    },
    phrases: {
      aaaaaaaaaaaa: { text: 'in the wild', translation: '실제 환경에서', memo: '관용 표현', ts: T(6, 2) },
      cccccccccccc: { text: 'delve into', translation: '파고들다', kind: 'expression', sentence: 'Delve into it.', memo: 'x'.repeat(300), ts: T(6, 3) },
    },
  }));
  const md = exportDay('2026-10-06', dir);
  assert.match(md, /^- \*\*mitigate\*\* \(mitigated\) — 완화하다 \/ "We mitigated the risk\." \/ 메모: 모듈 290 용어$/m); // 공백은 한 줄로 정리
  assert.doesNotMatch(md, /^- \*\*plain\*\*.*메모/m); // 빈 메모는 안 붙는다
  assert.match(md, /^- "in the wild" — 실제 환경에서 \/ 메모: 관용 표현$/m);
  assert.ok(md.includes(`- **delve into** — 파고들다 / "Delve into it." / 메모: ${'x'.repeat(200)}…`)); // clip 규칙(200자+…)
});

test('CLI: 날짜와 --data 를 받아 표준 출력으로 찍는다', () => {
  const out = execFileSync('node', [SCRIPT, '2026-10-06', '--data', fake()], { encoding: 'utf8' });
  assert.match(out, /mitigated/);
});
