// 스크랩 문서를 대상 폴더에 내보낸다.
// 사용: node scripts/export-scraps.mjs --to <폴더> [--data <폴더(기본 저장소 data/)>]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScraps } from '../bridge/scraps.mjs';
import { loadLearning } from '../bridge/task-guess.mjs';

// 순수 함수 모듈 로드
await import('../extension/selection-core.js');
await import('../extension/scrap-core.js');
const { buildTree } = globalThis.readglossScrap;

export const HEADER_COMMENT = '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->';

// 페이지 파일 이름: 제목을 소문자, 영숫자·한글 아닌 것은 하이픈, 80자
export function slugifyPage(title) {
  if (typeof title !== 'string' || !title.trim()) {
    return 'page';
  }
  const lower = title.toLowerCase();
  const slug = lower
    .replace(/[^a-z0-9\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const res = slug || 'page';
  return res.slice(0, 80).replace(/-+$/, '');
}

// 스크랩 목록과 할 일 매핑 -> Map<상대경로, 내용>
export function renderScrapDocs(scraps, tasks = {}) {
  const tree = buildTree(scraps, tasks);
  const docs = new Map();

  for (const node of tree) {
    if (node.task !== null) {
      const taskId = node.task;
      const taskTitle = node.title;

      // 같은 할 일 안에서 slug 중복 방지
      const slugCounts = new Map();
      const pagesWithSlugs = [];

      for (const page of node.pages) {
        const baseSlug = slugifyPage(page.title);
        let slug;
        if (!slugCounts.has(baseSlug)) {
          slugCounts.set(baseSlug, 1);
          slug = baseSlug;
        } else {
          const nextNum = slugCounts.get(baseSlug) + 1;
          slugCounts.set(baseSlug, nextNum);
          slug = `${baseSlug}-${nextNum}`;
        }
        pagesWithSlugs.push({ ...page, slug });
      }

      // 1. 할 일 문서: <id>.md
      const taskLines = [HEADER_COMMENT, '', `# ${taskTitle}`, ''];
      for (const page of pagesWithSlugs) {
        const indent = '  '.repeat(page.depth);
        taskLines.push(`${indent}- [[${taskId}/${page.slug}]]`);
      }
      docs.set(`${taskId}.md`, taskLines.join('\n') + '\n');

      // 2. 페이지 문서들: <id>/<slug>.md
      for (const page of pagesWithSlugs) {
        const pageLines = [HEADER_COMMENT, '', `# ${page.title}`, '', page.url, ''];

        for (const sec of page.sections) {
          if (Array.isArray(sec.headings) && sec.headings.length > 0) {
            for (let i = 0; i < sec.headings.length; i++) {
              const hLevel = '#'.repeat(Math.min(6, i + 2));
              pageLines.push(`${hLevel} ${sec.headings[i]}`, '');
            }
          }

          for (const item of sec.items) {
            const exactLines = String(item?.quote?.exact ?? '')
              .split('\n')
              .map((l) => `> ${l}`)
              .join('\n');
            pageLines.push(exactLines);

            if (typeof item?.translation === 'string' && item.translation.trim()) {
              pageLines.push(`번역: ${item.translation.trim()}`);
            }
            if (typeof item?.memo === 'string' && item.memo.trim()) {
              pageLines.push(`메모: ${item.memo.trim()}`);
            }
            pageLines.push('');
          }
        }

        docs.set(`${taskId}/${page.slug}.md`, pageLines.join('\n').trimEnd() + '\n');
      }
    } else {
      // 3. 인박스: inbox.md 한 파일
      const inboxLines = [HEADER_COMMENT, '', '# 인박스', ''];

      for (const page of node.pages) {
        inboxLines.push(`## ${page.title}`, '', page.url, '');

        for (const sec of page.sections) {
          if (Array.isArray(sec.headings) && sec.headings.length > 0) {
            for (let i = 0; i < sec.headings.length; i++) {
              const hLevel = '#'.repeat(Math.min(6, i + 3));
              inboxLines.push(`${hLevel} ${sec.headings[i]}`, '');
            }
          }

          for (const item of sec.items) {
            const exactLines = String(item?.quote?.exact ?? '')
              .split('\n')
              .map((l) => `> ${l}`)
              .join('\n');
            inboxLines.push(exactLines);

            if (typeof item?.translation === 'string' && item.translation.trim()) {
              inboxLines.push(`번역: ${item.translation.trim()}`);
            }
            if (typeof item?.memo === 'string' && item.memo.trim()) {
              inboxLines.push(`메모: ${item.memo.trim()}`);
            }
            inboxLines.push('');
          }
        }
      }

      docs.set('inbox.md', inboxLines.join('\n').trimEnd() + '\n');
    }
  }

  return docs;
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

// 내용이 같으면 쓰지 않고, map 에 없는 기존 생성 문서는 지운다.
export function writeIfChanged(dir, map) {
  const written = [];
  const removed = [];

  mkdirSync(dir, { recursive: true });

  // 1. 파일 쓰기/변경 검사
  for (const [relPath, content] of map.entries()) {
    const fullPath = join(dir, relPath);
    let same = false;
    try {
      const existing = readFileSync(fullPath, 'utf8');
      if (existing === content) same = true;
    } catch {
      // 파일 없음
    }

    if (!same) {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
      written.push(relPath);
    }
  }

  // 2. map 에 없는 기존 .md 중 자동 생성 주석이 있는 파일 삭제
  const existingFiles = findMdFiles(dir);
  for (const rel of existingFiles) {
    // Windows 경로 구분자 대응 정규화
    const normRel = rel.replace(/\\/g, '/');
    if (!map.has(normRel)) {
      const fullPath = join(dir, rel);
      try {
        const text = readFileSync(fullPath, 'utf8');
        const firstLine = text.split('\n')[0].trim();
        if (firstLine === HEADER_COMMENT) {
          unlinkSync(fullPath);
          removed.push(normRel);
        }
      } catch {
        // 읽기/삭제 실패 무시
      }
    }
  }

  // 빈 하위 디렉토리 정리
  removeEmptyDirs(dir);

  return { written, removed };
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
      console.error('사용: node scripts/export-scraps.mjs --to <폴더> [--data <폴더>]');
      process.exit(2);
    }
  }

  if (!toDir) {
    console.error('오류: --to <폴더> 인자가 필수입니다.');
    process.exit(2);
  }

  const scrapsStore = createScraps({ file: join(dataDir, 'scraps.json') });
  const scraps = scrapsStore.all();

  const { nodes } = loadLearning(learningDir);
  const tasks = Object.fromEntries(nodes.map((n) => [n.id, n.card_title]));

  const map = renderScrapDocs(scraps, tasks);
  const { written, removed } = writeIfChanged(toDir, map);

  console.log(`스크랩 문서 내보내기 완료: ${written.length}개 작성, ${removed.length}개 삭제 (${toDir})`);
}
