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
import { pageFileNames, pageKey, slugifyPage, writeIfChanged, SCRAP_HEADER_COMMENT } from './export-scraps.mjs';

// 순수 함수 모듈 로드
await import('../extension/selection-core.js');
await import('../extension/memo-core.js');
const normalizeUrl = (u) => globalThis.readglossSelection.normalizeUrl(u);

export const NOTE_HEADER_COMMENT = SCRAP_HEADER_COMMENT;

// 텍스트 조각 주소(Text Fragment URL) 생성 순수 함수
export function textFragmentUrl(url, exact) {
  if (typeof url !== 'string' || !url) return '';
  const baseUrl = url.split('#')[0];
  // 저장할 때 잘려 붙은 말줄임(…)은 본문에 없으니 뺀다
  const cleaned = String(exact ?? '').replace(/\s+/g, ' ').trim().replace(/^…+|…+$/g, '').trim();
  if (!cleaned) return baseUrl;

  const words = cleaned.split(' ');
  const encodePart = (s) =>
    encodeURIComponent(s)
      .replace(/-/g, '%2D')
      .replace(/,/g, '%2C')
      .replace(/&/g, '%26')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');

  if (words.length <= 8) {
    return `${baseUrl}#:~:text=${encodePart(cleaned)}`;
  }
  const start = encodePart(words.slice(0, 4).join(' '));
  const end = encodePart(words.slice(-4).join(' '));
  return `${baseUrl}#:~:text=${start},${end}`;
}

// 메모 항목 렌더링
export function renderMemo(m) {
  const lines = [];
  const exact = String(m?.quote?.exact ?? '').trim();
  const text = String(m?.text ?? '').trim();

  if (exact) {
    if (m?.quote?.table) {
      const table = m.quote.table;
      let head = Array.isArray(table.head) ? [...table.head] : null;
      let rows = Array.isArray(table.rows) ? [...table.rows] : [];

      if (!head || head.length === 0) {
        if (rows.length > 0) {
          head = rows[0];
          rows = rows.slice(1);
        } else {
          head = [];
        }
      }

      const formatCell = (c) => String(c ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

      if (head.length > 0) {
        lines.push(`| ${head.map(formatCell).join(' | ')} |`);
        lines.push(`| ${head.map(() => '---').join(' | ')} |`);
        for (const row of rows) {
          const cells = head.map((_, i) => formatCell(row[i] ?? ''));
          lines.push(`| ${cells.join(' | ')} |`);
        }
      }

      const rawUrl = m?.url ?? '';
      const link = rawUrl ? textFragmentUrl(rawUrl, exact) : '';
      if (link) {
        lines.push(`[↗](${link})`);
      }

      if (text) {
        lines.push(''); // 메모 인용 뒤 메모 글 사이에 빈 줄
      }
    } else if (m?.quote?.code) {
      const codeInfo = m.quote.code;
      if (codeInfo.block) {
        const lang = (typeof codeInfo.lang === 'string' && codeInfo.lang !== '자동') ? codeInfo.lang : '';
        lines.push(`\`\`\`${lang}`);
        lines.push(exact);
        lines.push('```');
      } else {
        const hasBacktick = exact.includes('`');
        lines.push(hasBacktick ? `\`\`${exact}\`\`` : `\`${exact}\``);
      }
      if (text) {
        lines.push(''); // 메모 인용 뒤 메모 글 사이에 빈 줄
      }
    } else if (m?.quote?.source === 'tutor') {
      const t = m.quote.tutor || {};
      const timePart = t.time ? ` ${t.time}` : '';
      lines.push(`> [!tutor] 튜터${timePart}`);
      for (const l of exact.split('\n')) {
        lines.push(`> ${l}`);
      }
      const rawTitle = String(t.title ?? '')
        .replace(/[\[\]|#^]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const titlePart = rawTitle ? ` ${rawTitle}` : '';
      lines.push(`> [[tutor-logs/${t.date ?? ''}#${t.time ?? ''}${titlePart}]]`);
      if (typeof m?.quote?.translation === 'string' && m.quote.translation.trim()) {
        lines.push(`> 번역: ${m.quote.translation.trim()}`);
      }
      if (text) {
        lines.push(''); // 메모 인용 뒤 메모 글 사이에 빈 줄
      }
    } else {
      const rawUrl = m?.url ?? '';
      const link = rawUrl ? textFragmentUrl(rawUrl, exact) : '';
      const quoteLines = exact.split('\n').map((l) => `> ${l}`);
      if (link && quoteLines.length > 0) {
        quoteLines[quoteLines.length - 1] += ` [↗](${link})`;
      }
      lines.push(...quoteLines);
      if (typeof m?.quote?.translation === 'string' && m.quote.translation.trim()) {
        lines.push(`> 번역: ${m.quote.translation.trim()}`);
      }
      if (text) {
        lines.push(''); // 메모 인용 뒤 메모 글 사이에 빈 줄
      }
    }
  }

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

export function defaultPageTitle(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.replace(/\/+$/, '');
    const title = `${u.host}${path}`;
    return title || 'page';
  } catch {
    return 'page';
  }
}

// 단어 항목 렌더링
function renderWord(w) {
  const lemma = w.lemma || w.word || '';
  const lines = [`> [!word]- ${lemma} — ${w.gloss || ''}`];
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
  const transPart = p.translation ? ` — ${p.translation}` : '';
  return `> [!word]- ${p.text}${transPart}`;
}

// 인용(스크랩) 항목 렌더링
function renderScrap(s) {
  const exact = String(s?.quote?.exact ?? s?.exact ?? '').trim();
  if (!exact) return '';
  const rawUrl = s?.url ?? '';
  const link = rawUrl ? textFragmentUrl(rawUrl, exact) : '';
  const lines = exact.split('\n').map((l) => `> ${l}`);
  if (link && lines.length > 0) {
    lines[lines.length - 1] += ` [↗](${link})`;
  }
  if (typeof s?.translation === 'string' && s.translation.trim()) {
    lines.push(`> 번역: ${s.translation.trim()}`);
  }
  if (typeof s?.memo === 'string' && s.memo.trim()) {
    lines.push('');
    lines.push(s.memo.trim());
  }
  return lines.join('\n');
}

function collectAllItems(data) {
  const items = [];

  // 1. 스크랩
  const scraps = Object.values(data?.scraps?.scraps ?? {});
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
  const memos = data?.memos ?? [];
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
  const concepts = data?.concepts ?? [];
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

  // 4. 단어장 단어 (Object.entries로 키=원형 보존)
  const savedWords = Object.entries(data?.words?.saved ?? {});
  for (const [lemma, w] of savedWords) {
    const u = normalizeUrl(w.url);
    if (!u) continue;
    items.push({
      kind: 'word',
      url: u,
      task: null,
      title: '',
      headings: Array.isArray(w.headings) ? w.headings : [],
      ts: Number.isFinite(w.ts) ? w.ts : 0,
      raw: { ...w, lemma },
    });
  }

  // 5. 구·문장
  const phrases = Object.values(data?.words?.phrases ?? {});
  for (const p of phrases) {
    const u = normalizeUrl(p.url);
    if (!u) continue;
    items.push({
      kind: 'phrase',
      url: u,
      task: null,
      title: '',
      headings: Array.isArray(p.headings) ? p.headings : [],
      ts: Number.isFinite(p.ts) ? p.ts : 0,
      raw: p,
    });
  }

  return items;
}

// 정규화 주소 -> 학습노트 상대 경로 (확장자 없이 <할일>/<이름>) 매핑 생성
export function notePaths(data, tasks = {}) {
  const items = collectAllItems(data);
  const pageMap = new Map();

  for (const item of items) {
    if (!pageMap.has(item.url)) {
      pageMap.set(item.url, { task: null, title: '' });
    }
    const pageInfo = pageMap.get(item.url);
    if (item.kind !== 'word' && item.kind !== 'phrase') {
      if (!pageInfo.task && item.task) pageInfo.task = item.task;
      if (!pageInfo.title && typeof item.title === 'string' && item.title.trim()) {
        pageInfo.title = item.title.trim();
      }
    }
  }

  const combinedForNames = [];
  for (const [url, pageInfo] of pageMap.entries()) {
    const pageTask = pageInfo.task;
    let pageTitle = pageInfo.title;
    if (!pageTitle) {
      pageTitle = defaultPageTitle(url);
    }
    combinedForNames.push({
      task: pageTask ?? 'inbox',
      url,
      title: pageTitle,
    });
  }

  const fileNamesMap = pageFileNames(combinedForNames);
  const result = new Map();

  for (const [url, pageInfo] of pageMap.entries()) {
    const pageTask = pageInfo.task;
    let pageTitle = pageInfo.title;
    if (!pageTitle) {
      pageTitle = defaultPageTitle(url);
    }
    const lookupKey = pageKey(pageTask ?? 'inbox', url);
    const relFileBase = fileNamesMap.get(lookupKey);
    const relPath = relFileBase || (pageTask ? `${pageTask}/${slugifyPage(pageTitle)}` : `inbox/${slugifyPage(pageTitle)}`);
    result.set(url, relPath);
  }

  return result;
}

// 학습노트 문서 생성 순수 함수: Map<상대경로, 내용>
export function renderNoteDocs(data, tasks = {}) {
  const docs = new Map();
  const paths = notePaths(data, tasks);
  const items = collectAllItems(data);

  // 정규화 주소(url)별로 페이지 묶기
  const pageMap = new Map();
  for (const item of items) {
    if (!pageMap.has(item.url)) {
      pageMap.set(item.url, { items: [], task: null, title: '' });
    }
    const pageInfo = pageMap.get(item.url);
    pageInfo.items.push(item);
    if (item.kind !== 'word' && item.kind !== 'phrase') {
      if (!pageInfo.task && item.task) pageInfo.task = item.task;
      if (!pageInfo.title && typeof item.title === 'string' && item.title.trim()) {
        pageInfo.title = item.title.trim();
      }
    }
  }

  for (const [url, pageInfo] of pageMap.entries()) {
    const task = pageInfo.task;
    let title = pageInfo.title;
    if (!title) {
      title = defaultPageTitle(url);
    }
    const pageItems = pageInfo.items;
    const relFileBase = paths.get(url);
    const relPath = `${relFileBase}.md`;

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

    // 할 일 제목 텍스트 (task: "...")
    const taskStr = task ? `${tasks[task] || task} (${task})` : '인박스';

    // 그 페이지 공부 시간(dwell) 모으기
    const allDwell = Array.isArray(data?.dwell) ? data.dwell : [];
    const pageDwells = allDwell.filter((d) => normalizeUrl(d.url) === url);
    let pageTotalSeconds = 0;
    for (const d of pageDwells) {
      if (typeof d.seconds === 'number' && Number.isFinite(d.seconds) && d.seconds > 0) {
        pageTotalSeconds += d.seconds;
      }
    }
    const pageMinutes = Math.round(pageTotalSeconds / 60);

    // 소제목 사슬별 dwell seconds 합산 (열쇠: headings.join('\0'))
    const dwellByChain = new Map();
    for (const d of pageDwells) {
      if (Array.isArray(d.headings) && d.headings.length > 0) {
        const key = d.headings.join('\u0000');
        dwellByChain.set(key, (dwellByChain.get(key) || 0) + (d.seconds || 0));
      }
    }

    // 앞머리 (YAML frontmatter)
    const fm = [
      '---',
      'type: study-note',
      `title: ${JSON.stringify(title)}`,
      `task: ${JSON.stringify(taskStr)}`,
      `url: ${JSON.stringify(url)}`,
      `date: ${noteDate}`,
    ];
    if (pageMinutes > 0) {
      fm.push(`minutes: ${pageMinutes}`);
    }
    if (sortedTags.length > 0) {
      fm.push(`tags: [${sortedTags.map((t) => JSON.stringify(t)).join(', ')}]`);
    }
    fm.push('---');
    fm.push(NOTE_HEADER_COMMENT);

    // 소제목 사슬을 나무처럼 묶기
    class HeadingNode {
      constructor(name, depth) {
        this.name = name;
        this.depth = depth;
        this.items = [];
        this.children = new Map();
        this.minTs = Infinity;
      }
    }

    const rootHeading = new HeadingNode('', 0);
    const inPageItems = [];

    for (const it of pageItems) {
      const h = Array.isArray(it.headings) && it.headings.length > 0 ? it.headings : null;
      if (!h) {
        inPageItems.push(it);
        continue;
      }
      let curr = rootHeading;
      const itTs = Number.isFinite(it.ts) ? it.ts : Infinity;
      for (let d = 0; d < h.length; d++) {
        const name = h[d];
        if (!curr.children.has(name)) {
          curr.children.set(name, new HeadingNode(name, d + 1));
        }
        curr = curr.children.get(name);
        if (itTs < curr.minTs) {
          curr.minTs = itTs;
        }
      }
      curr.items.push(it);
      if (itTs < curr.minTs) {
        curr.minTs = itTs;
      }
    }

    function collectHeadingBlocks(node, blocks, chain = []) {
      const sortedChildren = [...node.children.values()].sort((a, b) => a.minTs - b.minTs);
      for (const child of sortedChildren) {
        const currentChain = [...chain, child.name];
        const chainKey = currentChain.join('\u0000');
        const sec = dwellByChain.get(chainKey) || 0;
        const mins = sec >= 60 ? Math.floor(sec / 60) : 0;
        const titleSuffix = mins > 0 ? ` · ${mins}분` : '';

        const hLevel = child.depth === 1 ? '##' : child.depth === 2 ? '###' : '####';
        const lines = [`${hLevel} ${child.name}${titleSuffix}`];
        child.items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        for (const it of child.items) {
          let rendered = '';
          if (it.kind === 'scrap') rendered = renderScrap(it.raw);
          else if (it.kind === 'memo') rendered = renderMemo(it.raw);
          else if (it.kind === 'concept') rendered = renderConcept(it.raw);
          else if (it.kind === 'word') rendered = renderWord(it.raw);
          else if (it.kind === 'phrase') rendered = renderPhrase(it.raw);

          if (rendered && rendered.trim()) {
            lines.push(rendered.trim());
          }
        }
        blocks.push(lines.join('\n\n'));
        collectHeadingBlocks(child, blocks, currentChain);
      }
    }

    const bodyBlocks = [];
    collectHeadingBlocks(rootHeading, bodyBlocks);

    // headings 없는 항목은 맨 끝 '## 이 페이지에서' 칸
    if (inPageItems.length > 0) {
      inPageItems.sort((a, b) => (a.ts || 0) - (b.ts || 0));
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
  if (!/(?:^|\n)type:\s*["']?study-note["']?(?:\r?\n|$)/.test(fm)) return false;
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
