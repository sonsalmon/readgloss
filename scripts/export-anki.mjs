// 단어장 내보내기(변경 기록 28-24): 낱말·구를 CSV 또는 Anki 가져오기용 탭 구분 텍스트로 만든다.
// 사용: node scripts/export-anki.mjs [--out 파일] [--format csv|anki] [--data <폴더(기본 저장소 data/)>]
// data/ 파일만 읽는다(다리 안 띄움). --out 이 없으면 표준 출력에 쓴다.
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './data-source.mjs';
import { formsOf } from '../bridge/annotate.mjs';

export const CSV_HEADER = ['word', 'gloss', 'sentence', 'link'];
export const FORMATS = ['csv', 'anki'];

// CSV 칸: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 안쪽 따옴표는 두 번 쓴다.
export function csvField(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// 탭 구분 칸: 탭은 공백으로, 줄바꿈은 Anki 가 줄로 읽는 <br> 로 바꾼다.
// 큰따옴표가 있으면 Anki 가 따옴표 칸으로 읽어 카드가 합쳐지므로, 칸 전체를 따옴표로 감싸고 안쪽은 두 번 쓴다.
export function ankiField(value) {
  const s = String(value ?? '')
    .replace(/\r\n?|\n/g, '<br>')
    .replaceAll('\t', ' ');
  return s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
}

// 장면 링크: 저장한 주소를 그대로 쓰고, 구간(clip)이 있는데 시각이 없으면 시작 시각을 붙인다.
export function sceneLink(entry) {
  const url = typeof entry?.url === 'string' ? entry.url : '';
  if (!url) return '';
  if (!entry?.clip || !Number.isFinite(entry.clip.start)) return url;
  if (/[?&]t=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.max(0, Math.floor(entry.clip.start))}s`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 문장에서 낱말(원형·활용형) 또는 구를 ____ 로 가린다. 찾지 못하면 문장을 그대로 돌려준다.
export function blankWord(sentence, target) {
  const text = String(sentence ?? '');
  const targets = (Array.isArray(target) ? target : [target])
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim());
  if (!text || !targets.length) return text;

  const forms = new Set();
  for (const t of targets) {
    forms.add(t.toLowerCase());
    const parts = t.split(/\s+/);
    if (parts.length === 1) {
      for (const f of formsOf(t)) forms.add(f);
    } else {
      // 구는 낱말 하나씩만 활용형으로 바꾼다(예: delve into -> delved into).
      for (let i = 0; i < parts.length; i++) {
        for (const f of formsOf(parts[i])) {
          const copy = [...parts];
          copy[i] = f;
          forms.add(copy.join(' '));
        }
      }
    }
  }
  const candidates = [...forms].sort((a, b) => b.length - a.length).map(escapeRe);
  if (!candidates.length) return text;

  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${candidates.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return text.replace(re, '____');
}

// 낱말·구 저장 모양 -> 내보내기 줄. 원형(또는 구 기본형)으로 빈칸을 만들고 저장 때 본 형태도 함께 본다.
export function rowsFromWords(words) {
  const rows = [];
  const saved = words?.saved && typeof words.saved === 'object' ? words.saved : {};
  for (const [lemma, w] of Object.entries(saved)) {
    if (!w || typeof w !== 'object') continue;
    const surface = typeof w.word === 'string' && w.word.trim() ? w.word : lemma;
    rows.push({
      word: lemma,
      gloss: w.gloss ?? '',
      sentence: w.sentence ?? '',
      link: sceneLink(w),
      targets: [lemma, surface],
      ts: Number.isFinite(w.ts) ? w.ts : 0,
    });
  }

  const phrases = words?.phrases && typeof words.phrases === 'object' ? words.phrases : {};
  for (const p of Object.values(phrases)) {
    if (!p || typeof p !== 'object') continue;
    const text = typeof p.text === 'string' ? p.text : '';
    if (!text) continue;
    const sentence = typeof p.sentence === 'string' && p.sentence ? p.sentence : text;
    rows.push({
      word: text,
      gloss: p.context?.translation || p.translation || '',
      sentence,
      link: sceneLink(p),
      targets: [p.base, text],
      ts: Number.isFinite(p.ts) ? p.ts : 0,
    });
  }

  return rows.sort((a, b) => a.ts - b.ts || a.word.localeCompare(b.word));
}

export function csvExport(rows) {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) lines.push([r.word, r.gloss, r.sentence, r.link].map(csvField).join(','));
  return `${lines.join('\n')}\n`;
}

// 뒷면 = 낱말 · 뜻 · 링크(빈 칸은 빼고 이어 붙인다).
export function ankiExport(rows) {
  const lines = rows.map((r) => {
    const back = [r.word, r.gloss, r.link].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');
    return `${ankiField(blankWord(r.sentence, r.targets))}\t${ankiField(back)}`;
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function exportWords(format, words) {
  if (!FORMATS.includes(format)) throw new Error(`모르는 형식: ${format}`);
  const rows = rowsFromWords(words);
  return format === 'csv' ? csvExport(rows) : ankiExport(rows);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let out = null;
  let format = 'anki';
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) out = resolve(args[++i]);
    else if (args[i] === '--format' && args[i + 1]) format = args[++i];
    else if (args[i] === '--data' && args[i + 1]) dataDir = resolve(args[++i]);
    else {
      console.error('사용: node scripts/export-anki.mjs [--out 파일] [--format csv|anki] [--data <폴더>]');
      process.exit(2);
    }
  }
  if (!FORMATS.includes(format)) {
    console.error(`오류: --format 은 ${FORMATS.join(' 또는 ')} 이어야 합니다.`);
    process.exit(2);
  }

  const { words } = loadData(dataDir);
  const text = exportWords(format, words);
  if (out) {
    writeFileSync(out, text, 'utf8');
    console.error(`단어장 내보내기 완료: ${out}`);
  } else {
    process.stdout.write(text);
  }
}
