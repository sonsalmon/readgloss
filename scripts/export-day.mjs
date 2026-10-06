// 하루치 내보내기: 그날 저장한 표현을 마크다운 "## 영어 표현 (readgloss)" 절로 표준 출력에 찍는다.
// 사용: node scripts/export-day.mjs [YYYY-MM-DD(기본 오늘, 로컬)] [--data <폴더(기본 저장소 data/)>]
// data/ 파일만 읽는다(다리 안 띄움, 아무것도 안 쓴다). 날짜 판정은 로컬 시간대.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const entries = (o) => Object.values(o && typeof o === 'object' ? o : {}).filter((v) => v && typeof v === 'object');

export function exportDay(date, dataDir) {
  const on = (v) => Number.isFinite(v?.ts) && dateOf(v.ts) === date;
  const byTs = (a, b) => a.ts - b.ts;
  const words = readJson(join(dataDir, 'words.json'));
  const saved = entries(words.saved).filter(on).sort(byTs);
  const phrases = entries(words.phrases).filter(on).sort(byTs);
  const mine = Object.entries(readJson(join(dataDir, 'mydict.json')).entries ?? {})
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
  if (!saved.length && !phrases.length && !mine.length) out.push('(이날 저장한 표현 없음)');
  if (saved.length) {
    out.push('### 단어', '');
    for (const w of saved) out.push(`- **${w.word || ''}** — ${clip(w.gloss)}${w.sentence ? ` / "${clip(w.sentence)}"` : ''}`);
    out.push('');
  }
  if (phrases.length) {
    out.push('### 구·문장', '');
    for (const p of phrases) {
      out.push(`- "${clip(p.text)}" — ${clip(p.translation)}`);
      if (p.context?.translation) out.push(`  - 문맥 번역: ${clip(p.context.translation)}`);
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
