// 하루치 내보내기: 그날 저장한 표현을 마크다운 "## 영어 표현 (readgloss)" 절로 표준 출력에 찍는다.
// 사용: node scripts/export-day.mjs [YYYY-MM-DD(기본 오늘, 로컬)] [--data <폴더(기본 저장소 data/)>]
// data/ 파일만 읽는다(다리 안 띄움, 아무것도 안 쓴다). 날짜 판정은 로컬 시간대.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './data-source.mjs';

const CLIP = 200;
const pad = (n) => String(n).padStart(2, '0');
export const dateOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// 저작물 보호: 한 줄로 정리하고 200자에서 자른다
const clip = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > CLIP ? `${t.slice(0, CLIP)}…` : t;
};
// T19: 메모가 있으면 줄 끝에 " / 메모: ..." 로 붙인다(한 줄 정리는 clip 규칙 그대로)
const memo = (v) => (typeof v?.memo === 'string' && v.memo.trim() ? ` / 메모: ${clip(v.memo)}` : '');
const readText = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const readJson = (file) => {
  try {
    const v = JSON.parse(readText(file));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
// { 키: 값 } 의 [키, 값] 쌍. 값이 객체가 아닌 것은 뺀다. 단어는 키가 원형이라 키를 버리지 않는다.
const pairs = (o) => Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => v && typeof v === 'object');
const entries = (o) => pairs(o).map(([, v]) => v);

// 번역은 문맥 번역(AI)이 있으면 그것, 없을 때만 맥 번역
const tr = (p) => p.context?.translation || p.translation;

export function exportDay(date, dataDir) {
  const on = (v) => Number.isFinite(v?.ts) && dateOf(v.ts) === date;
  const byTs = (a, b) => a.ts - b.ts;
  const { words, mydict } = loadData(dataDir);
  const saved = pairs(words.saved).filter(([, v]) => on(v)).sort((a, b) => byTs(a[1], b[1]));
  const all = entries(words.phrases).filter(on).sort(byTs);
  const expressions = all.filter((p) => p.kind === 'expression');
  const phrases = all.filter((p) => p.kind !== 'expression');
  const mine = Object.entries(mydict.entries ?? {})
    .filter(([, v]) => v && on(v))
    .sort((a, b) => a[1].ts - b[1].ts);
  const counts = {};
  for (const line of readText(join(dataDir, 'study-log.jsonl')).split('\n')) {
    try {
      const v = JSON.parse(line);
      if (v && typeof v.kind === 'string' && on(v)) counts[v.kind] = (counts[v.kind] ?? 0) + 1;
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }

  const out = ['## 영어 표현 (readgloss)', ''];
  if (!saved.length && !expressions.length && !phrases.length && !mine.length) out.push('(이날 저장한 표현 없음)');
  if (saved.length) {
    out.push('### 단어', '');
    // 원형(키)을 굵게, 저장 때 본 굴절형(word)이 원형과 다르면 괄호로 덧붙인다
    for (const [lemma, w] of saved) {
      const form = clip(w.word);
      out.push(`- **${lemma}**${form && form.toLowerCase() !== lemma ? ` (${form})` : ''} — ${clip(w.gloss)}${w.sentence ? ` / "${clip(w.sentence)}"` : ''}${memo(w)}`);
    }
    out.push('');
  }
  if (expressions.length) {
    out.push('### 표현', '');
    for (const p of expressions) out.push(`- **${clip(p.text)}** — ${clip(tr(p))}${p.sentence ? ` / "${clip(p.sentence)}"` : ''}${memo(p)}`);
    out.push('');
  }
  if (phrases.length) {
    out.push('### 구·문장', '');
    for (const p of phrases) {
      out.push(`- "${clip(p.text)}" — ${clip(tr(p))}${memo(p)}`);
      if (p.context?.note) out.push(`  - note: ${clip(p.context.note)}`);
    }
    out.push('');
  }
  if (mine.length) {
    out.push('### 내 사전', '');
    for (const [key, e] of mine) out.push(`- **${key}** — ${clip(e.ko)}${e.exp ? ` (${clip(e.exp)})` : ''}`);
    out.push('');
  }
  const kinds = Object.entries(counts);
  if (kinds.length) out.push(`공부 기록: ${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  return `${out.join('\n').trimEnd()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let date = dateOf(Date.now());
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) dataDir = resolve(args[++i]);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(args[i])) date = args[i];
    else {
      console.error('사용: node scripts/export-day.mjs [YYYY-MM-DD] [--data <폴더>]');
      process.exit(2);
    }
  }
  process.stdout.write(exportDay(date, dataDir));
}
