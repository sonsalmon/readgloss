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
  assert.match(md, /- "in the wild" — 실제 환경에서\n {2}- 문맥 번역: 실전에서\n {2}- note: 관용/);
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

test('CLI: 날짜와 --data 를 받아 표준 출력으로 찍는다', () => {
  const out = execFileSync('node', [SCRIPT, '2026-10-06', '--data', fake()], { encoding: 'utf8' });
  assert.match(out, /mitigated/);
});
