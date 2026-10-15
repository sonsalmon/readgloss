// scripts/export-notes.mjs
// 학습노트 문서를 대상 폴더에 내보낸다 (과제 T33b, 명세 16-4).
// 사용: node scripts/export-notes.mjs --to <폴더> [--data <폴더>] [--learning <폴더>]
import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLearning } from '../bridge/task-guess.mjs';
import { loadNotesData } from './data-source.mjs';
import { dateOf } from './export-day.mjs';
import { pageFileNames, pageKey, writeIfChanged, SCRAP_HEADER_COMMENT } from './export-scraps.mjs';

// 순수 함수 모듈 로드
await import('../extension/selection-core.js');
const normalizeUrl = (u) => globalThis.readglossSelection.normalizeUrl(u);

export const NOTE_HEADER_COMMENT = SCRAP_HEADER_COMMENT;

// 메모 항목 렌더링
function renderMemo(m) {
  const lines = [];
  const exact = String(m?.quote?.exact ?? '').trim();
  if (exact) {
    for (const l of exact.split('\n')) {
      lines.push(`> ${l}`);
    }
  }
  const text = String(m?.text ?? '').trim();
  if (text) {
    lines.push(text);
  }
  return lines.join('\n');
}

// 개념 항목 렌더링
function renderConcept(c) {
  const isLater = c.later === true || !c.definition || !c.definition.trim();
  if (isLater) {
    return `> [!question] 나중에 볼 것: ${c.name}`;
  }

  const lines = [`> [!concept] [[${c.name}]]`];
  const aliases = Array.isArray(c.aliases) ? c.aliases.filter(Boolean) : [];
  const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean) : [];

  if (aliases.length > 0 && tags.length > 0) {
    lines.push(`> 다른 이름: ${aliases.join(', ')} · ${tags.map((t) => `#${t}`).join(' ')}`);
  } else if (aliases.length > 0) {
    lines.push(`> 다른 이름: ${aliases.join(', ')}`);
  } else if (tags.length > 0) {
    lines.push(`> ${tags.map((t) => `#${t}`).join(' ')}`);
  }

  if (typeof c.definition === 'string' && c.definition.trim()) {
    for (const l of c.definition.trim().split('\n')) {
      lines.push(`> ${l}`);
    }
  }

  return lines.join('\n');
}

// 단어 항목 렌더링
function renderWord(w) {
  const lines = [`> [!word]- ${w.word} — ${w.def}`];
  const sentence = String(w.sentence ?? '').trim();
  if (sentence) {
    for (const l of sentence.split('\n')) {
      lines.push(`> ${l}`);
    }
  }
  const memoText = String(w.memo ?? '').trim();
  if (memoText) {
    lines.push(`> 메모: ${memoText}`);
  }
  return lines.join('\n');
}

// 구·문장 항목 렌더링
function renderPhrase(p) {
  const transPart = p.trans ? ` — ${p.trans}` : '';
  return `> [!word]- ${p.text}${transPart}`;
}

// 인용(스크랩) 항목 렌더링
function renderScrap(s) {
  const exact = String(s?.quote?.exact ?? s?.exact ?? '').trim();
  if (!exact) return '';
  return exact.split('\n').map((l) => `> ${l}`).join('\n');
}

// 학습노트 문서 생성 순수 함수: Map<상대경로, 내용>
export function renderNoteDocs(data, tasks = {}) {
  const docs = new Map();

  // 모든 항목 수집
  const items = [];

  // 1. 스크랩
  const scraps = Object.values(data.scraps?.scraps ?? {});
  for (const s of scraps) {
    const rawUrl = s.url;
    const u = normalizeUrl(rawUrl);
    if (!u) continue;
    items.push({
      kind: 'scrap',
      url: u,
      task: s.task ?? null,
      title: s.title || '',
      headings: Array.isArray(s.headings) ? s.headings : [],
      ts: Number.isFinite(s.ts) ? s.ts : 0,
      raw: s,
    });
  }

  // 2. 메모
  const memos = data.memos ?? [];
  for (const m of memos) {
    const u = normalizeUrl(m.url);
    if (!u) continue;
    items.push({
      kind: 'memo',
      url: u,
      task: m.task ?? null,
      title: m.title || '',
      headings: Array.isArray(m.headings) ? m.headings : [],
      ts: Number.isFinite(m.ts) ? m.ts : 0,
      raw: m,
    });
  }

  // 3. 개념 및 나중에 볼 것
  const concepts = data.concepts ?? [];
  for (const c of concepts) {
    const rawUrl = c.seen?.url || (c.appears && c.appears[0]?.url) || c.firstUrl;
    const u = normalizeUrl(rawUrl);
    if (!u) continue;
    const task = c.firstTask || c.seen?.task || (c.appears && c.appears[0]?.task) || null;
    const title = c.seen?.title || c.firstTitle || (c.appears && c.appears[0]?.title) || '';
    const headings = Array.isArray(c.seen?.headings) ? c.seen.headings : [];
    items.push({
      kind: 'concept',
      url: u,
      task,
      title,
      headings,
      ts: Number.isFinite(c.ts) ? c.ts : 0,
      raw: c,
    });
  }

  // 4. 단어장 단어
  const savedWords = Object.values(data.words?.saved ?? {});
  for (const w of savedWords) {
    const u = normalizeUrl(w.url);
    if (!u) continue;
    items.push({
      kind: 'word',
      url: u,
      task: w.task ?? null,
      title: w.title || '',
      headings: Array.isArray(w.headings) ? w.headings : [],
      ts: Number.isFinite(w.ts) ? w.ts : 0,
      raw: w,
    });
  }

  // 5. 구·문장
  const phrases = Object.values(data.words?.phrases ?? {});
  for (const p of phrases) {
    const u = normalizeUrl(p.url);
    if (!u) continue;
    items.push({
      kind: 'phrase',
      url: u,
      task: p.task ?? null,
      title: p.title || '',
      headings: Array.isArray(p.headings) ? p.headings : [],
      ts: Number.isFinite(p.ts) ? p.ts : 0,
      raw: p,
    });
  }

  // 정규화 주소(url)별로 페이지 묶기
  const pageMap = new Map();
  for (const item of items) {
    if (!pageMap.has(item.url)) {
      pageMap.set(item.url, []);
    }
    pageMap.get(item.url).push(item);
  }

  // 각 페이지의 대표 정보(task, title) 결정 및 pageFileNames 용 배열 생성
  const pageEntries = [];
  const combinedForNames = [];

  for (const [url, pageItems] of pageMap.entries()) {
    // 페이지 task: null이 아닌 첫 번째 task
    let pageTask = null;
    for (const it of pageItems) {
      if (it.task) {
        pageTask = it.task;
        break;
      }
    }

    // 페이지 제목: 비어있지 않은 첫 번째 제목
    let pageTitle = '';
    for (const it of pageItems) {
      if (typeof it.title === 'string' && it.title.trim()) {
        pageTitle = it.title.trim();
        break;
      }
    }
    if (!pageTitle) {
      pageTitle = 'page';
    }

    pageEntries.push({
      url,
      task: pageTask,
      title: pageTitle,
      items: pageItems,
    });

    // 할 일 없으면 'inbox' 로 가상 설정하여 pageFileNames 규칙 활용
    combinedForNames.push({
      task: pageTask ?? 'inbox',
      url,
      title: pageTitle,
    });
  }

  // pageFileNames 매핑 (복사 금지, 그대로 import 사용)
  const fileNamesMap = pageFileNames(combinedForNames);

  for (const page of pageEntries) {
    const { url, task, title, items: pageItems } = page;
    const lookupKey = pageKey(task ?? 'inbox', url);
    const relFileBase = fileNamesMap.get(lookupKey);
    const relPath = relFileBase ? `${relFileBase}.md` : (task ? `${task}/page.md` : 'inbox/page.md');

    // 가장 이른 ts 구하기
    let minTs = Infinity;
    for (const it of pageItems) {
      if (it.ts && it.ts < minTs) minTs = it.ts;
    }
    const noteDate = Number.isFinite(minTs) && minTs !== Infinity ? dateOf(minTs) : dateOf(Date.now());

    // 그 페이지 개념들의 태그 모음
    const pageTags = new Set();
    for (const it of pageItems) {
      if (it.kind === 'concept' && Array.isArray(it.raw?.tags)) {
        for (const t of it.raw.tags) {
          if (t && typeof t === 'string') pageTags.add(t.trim());
        }
      }
    }
    const sortedTags = [...pageTags].sort((a, b) => a.localeCompare(b));

    // 할 일 제목 텍스트 (task: <제목> (<id>))
    let taskLine = '';
    if (task) {
      const taskTitle = tasks[task] || task;
      taskLine = `task: ${taskTitle} (${task})`;
    } else {
      taskLine = 'task: 인박스';
    }

    // 앞머리 (YAML frontmatter)
    const fm = [
      '---',
      'type: study-note',
      `title: ${title}`,
      taskLine,
      `url: ${url}`,
      `date: ${noteDate}`,
    ];
    if (sortedTags.length > 0) {
      fm.push(`tags: [${sortedTags.join(', ')}]`);
    }
    fm.push('---');
    fm.push(NOTE_HEADER_COMMENT);

    // 항목들을 소제목별로 그룹화
    const sectionMap = new Map();
    const sectionOrder = [];
    let inPageItems = [];

    for (const it of pageItems) {
      const h = Array.isArray(it.headings) && it.headings.length > 0 ? it.headings : null;
      if (!h) {
        inPageItems.push(it);
      } else {
        const hName = h[h.length - 1];
        const depth = h.length;
        if (!sectionMap.has(hName)) {
          sectionMap.set(hName, { name: hName, depth, items: [], minTs: it.ts || Infinity });
          sectionOrder.push(hName);
        }
        const sec = sectionMap.get(hName);
        sec.items.push(it);
        if (it.ts && it.ts < sec.minTs) sec.minTs = it.ts;
      }
    }

    // 소제목 섹션들은 최초 ts 오름차순으로 정렬
    const sortedSections = sectionOrder
      .map((name) => sectionMap.get(name))
      .sort((a, b) => a.minTs - b.minTs);

    const bodyBlocks = [];

    // 각 소제목 섹션 본문 렌더링
    for (const sec of sortedSections) {
      const hLevel = sec.depth === 1 ? '##' : sec.depth === 2 ? '###' : '####';
      const secLines = [`${hLevel} ${sec.name}`];
      sec.items.sort((a, b) => a.ts - b.ts);
      for (const it of sec.items) {
        let rendered = '';
        if (it.kind === 'scrap') rendered = renderScrap(it.raw);
        else if (it.kind === 'memo') rendered = renderMemo(it.raw);
        else if (it.kind === 'concept') rendered = renderConcept(it.raw);
        else if (it.kind === 'word') rendered = renderWord(it.raw);
        else if (it.kind === 'phrase') rendered = renderPhrase(it.raw);

        if (rendered && rendered.trim()) {
          secLines.push(rendered.trim());
        }
      }
      bodyBlocks.push(secLines.join('\n\n'));
    }

    // headings 없는 항목은 맨 끝 '## 이 페이지에서' 칸
    if (inPageItems.length > 0) {
      inPageItems.sort((a, b) => a.ts - b.ts);
      const inPageLines = ['## 이 페이지에서'];
      for (const it of inPageItems) {
        let rendered = '';
        if (it.kind === 'scrap') rendered = renderScrap(it.raw);
        else if (it.kind === 'memo') rendered = renderMemo(it.raw);
        else if (it.kind === 'concept') rendered = renderConcept(it.raw);
        else if (it.kind === 'word') rendered = renderWord(it.raw);
        else if (it.kind === 'phrase') rendered = renderPhrase(it.raw);

        if (rendered && rendered.trim()) {
          inPageLines.push(rendered.trim());
        }
      }
      bodyBlocks.push(inPageLines.join('\n\n'));
    }

    const fullContent = [fm.join('\n'), `# ${title}`, ...bodyBlocks].join('\n\n').trimEnd() + '\n';
    docs.set(relPath, fullContent);
  }

  return docs;
}

// 자동 생성된 학습노트 파일인지 판정 (앞머리에 type: study-note, 앞머리 뒤 첫 줄에 주석)
export function isGeneratedNote(text) {
  if (typeof text !== 'string' || !text.startsWith('---\n')) return false;
  const endFm = text.indexOf('\n---\n', 4);
  if (endFm === -1) return false;
  const fm = text.slice(4, endFm);
  if (!/(?:^|\n)type:\s*study-note(?:\n|$)/.test(fm)) return false;
  const afterFm = text.slice(endFm + 5).trimStart();
  return afterFm.startsWith('<!-- 자동 생성');
}

function findMdFiles(base, sub = '') {
  const currentDir = join(base, sub);
  if (!existsSync(currentDir)) return [];
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) {
      files.push(...findMdFiles(base, rel));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      files.push(rel);
    }
  }
  return files;
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = join(dir, e.name);
      removeEmptyDirs(sub);
      try {
        rmdirSync(sub);
      } catch {
        // 비어있지 않으면 패스
      }
    }
  }
}

// 학습노트 쓰기 및 변경 검사: writeIfChanged 재사용 + 앞머리 뒤 주석 판정으로 삭제
export function writeNotesIfChanged(dir, map) {
  const res = writeIfChanged(dir, map);

  // 추가 정리: map에 없는 기존 .md 중 앞머리가 type: study-note 이고 주석이 있는 파일 삭제
  const root = resolve(dir);
  const existingFiles = findMdFiles(root);
  for (const rel of existingFiles) {
    const normRel = rel.replace(/\\/g, '/');
    if (!map.has(normRel)) {
      const fullPath = join(root, rel);
      try {
        const text = readFileSync(fullPath, 'utf8');
        if (isGeneratedNote(text)) {
          unlinkSync(fullPath);
          if (!res.removed.includes(normRel)) {
            res.removed.push(normRel);
          }
        }
      } catch {
        // 읽기/삭제 실패 무시
      }
    }
  }

  removeEmptyDirs(root);
  return res;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let toDir = null;
  let dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  let learningDir = process.env.READGLOSS_LEARNING_DIR || join(homedir(), 'dev', 'learning', 'security-career');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) {
      toDir = resolve(args[++i]);
    } else if (args[i] === '--data' && args[i + 1]) {
      dataDir = resolve(args[++i]);
    } else if (args[i] === '--learning' && args[i + 1]) {
      learningDir = resolve(args[++i]);
    } else {
      console.error('사용: node scripts/export-notes.mjs --to <폴더> [--data <폴더>] [--learning <폴더>]');
      process.exit(2);
    }
  }

  if (!toDir) {
    console.error('오류: --to <폴더> 인자가 필수입니다.');
    process.exit(2);
  }

  let data;
  try {
    data = loadNotesData(dataDir);
  } catch (e) {
    console.error(`오류: ${e?.message ?? e}`);
    process.exit(1);
  }

  const { tasks } = loadLearning(learningDir);
  const map = renderNoteDocs(data, tasks);
  const { written, removed } = writeNotesIfChanged(toDir, map);

  console.log(`학습노트 내보내기 완료: ${written.length}개 작성, ${removed.length}개 삭제 (${toDir})`);
}
