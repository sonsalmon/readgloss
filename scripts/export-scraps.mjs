// 스크랩 문서를 대상 폴더에 내보낸다.
// 사용: node scripts/export-scraps.mjs --to <폴더> [--data <폴더(기본 저장소 data/)>]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLearning } from '../bridge/task-guess.mjs';
import { loadData } from './data-source.mjs';
import { dateOf } from './export-day.mjs';

// 순수 함수 모듈 로드
await import('../extension/selection-core.js');
await import('../extension/scrap-core.js');
const { buildTree } = globalThis.readglossScrap;

// 스크랩 문서 머리 주석.
export const HEADER_COMMENT = '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->';
export const SCRAP_HEADER_COMMENT = HEADER_COMMENT;
// 개념 문서 머리는 export-concepts.mjs 의 CONCEPT_HEADER_COMMENT.

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

// 할 일 id + 주소 -> 페이지 키. 주소는 정규화해서 맞춘다(스크랩 주소 원문과 페이지 주소가 다를 수 있다).
export function pageKey(task, url) {
  return `${task}|${globalThis.readglossSelection.normalizeUrl(url)}`;
}

// 스크랩 데이터로부터 페이지 파일 이름 매핑 생성: Map<pageKey(할 일, 주소), "<할 일>/<파일 이름>">
export function pageFileNames(scraps, memos = []) {
  const combined = [
    ...scraps.map((s) => ({ task: s.task ?? null, url: s.url, title: s.title })),
    ...memos.map((m) => ({ task: m.task ?? null, url: m.url, title: m.title })),
  ];
  const tree = buildTree(combined, {});
  const map = new Map();

  for (const node of tree) {
    if (node.task !== null) {
      const taskId = node.task;
      const usedSlugs = new Set();
      for (const page of node.pages) {
        const baseSlug = slugifyPage(page.title);
        let slug = baseSlug;
        for (let n = 2; usedSlugs.has(slug); n++) {
          const suffix = `-${n}`;
          slug = `${baseSlug.slice(0, 80 - suffix.length).replace(/-+$/, '')}${suffix}`;
        }
        usedSlugs.add(slug);
        map.set(pageKey(taskId, page.url), `${taskId}/${slug}`);
      }
    }
  }

  return map;
}

// 메모 한 개를 목록 항목 줄들로: 첫 줄은 "- 글 (날짜)", 다음 줄은 들여써서 같은 항목 안에 둔다.
// 인용이 있으면 맨 앞에 "- > 인용"(앞 200자, 한 줄)을 두고, 글이 없으면 그 줄 끝에 날짜를 쓴다.
// 줄 맨 앞의 # · > - 는 마크다운 제목·인용·목록으로 읽히지 않게 \ 를 붙인다.
function memoItemLines(m) {
  const d = dateOf(m.ts);
  const esc = (l) => l.replace(/^(\s*)([#>-])/, '$1\\$2');
  const exact = Array.from(String(m.quote?.exact ?? '').replace(/\s+/g, ' ').trim()).slice(0, 200).join('');
  const quote = exact ? `> ${esc(exact)}` : '';
  const hasText = String(m.text ?? '').trim().length > 0;
  const [first, ...rest] = String(m.text ?? '').split('\n').map(esc);
  if (!quote) return [`- ${first} (${d})`, ...rest.map((l) => `  ${l}`)];
  if (!hasText) return [`- ${quote} (${d})`];
  return [`- ${quote}`, `  ${first} (${d})`, ...rest.map((l) => `  ${l}`)];
}

// 스크랩 목록과 할 일 매핑 -> Map<상대경로, 내용>
export function renderScrapDocs(scraps, tasks = {}, memos = []) {
  const combined = [
    ...scraps.map((s) => ({ task: s.task ?? null, url: s.url, title: s.title })),
    ...memos.map((m) => ({ task: m.task ?? null, url: m.url, title: m.title })),
  ];
  const tree = buildTree(combined, tasks);
  const scrapsTree = buildTree(scraps, tasks);
  const fileNames = pageFileNames(scraps, memos);
  const docs = new Map();

  const scrapPageMap = new Map();
  for (const node of scrapsTree) {
    const t = node.task ?? null;
    for (const p of node.pages) {
      scrapPageMap.set(pageKey(t, p.url), p);
    }
  }

  const memoMap = new Map();
  for (const m of memos) {
    const k = pageKey(m.task ?? null, m.url);
    if (!memoMap.has(k)) memoMap.set(k, []);
    memoMap.get(k).push(m);
  }

  for (const node of tree) {
    if (node.task !== null) {
      const taskId = node.task;
      const taskTitle = node.title;

      const pagesWithSlugs = node.pages.map((page) => {
        const fullPath = fileNames.get(pageKey(taskId, page.url));
        const slug = fullPath ? fullPath.slice(taskId.length + 1) : slugifyPage(page.title);
        return { ...page, slug };
      });

      // 1. 할 일 문서: <id>.md
      const taskLines = [SCRAP_HEADER_COMMENT, '', `# ${taskTitle}`, ''];
      for (const page of pagesWithSlugs) {
        const indent = '  '.repeat(page.depth);
        taskLines.push(`${indent}- [[${taskId}/${page.slug}]]`);
      }
      docs.set(`${taskId}.md`, taskLines.join('\n') + '\n');

      // 2. 페이지 문서들: <id>/<slug>.md
      for (const page of pagesWithSlugs) {
        const scrapPage = scrapPageMap.get(pageKey(taskId, page.url));
        const pageMemos = memoMap.get(pageKey(taskId, page.url)) || [];

        const pageLines = [SCRAP_HEADER_COMMENT, '', `# ${page.title}`, '', page.url, ''];

        // 기존 스크랩 렌더링 (buildTree가 만든 sections를 그대로 재사용)
        if (scrapPage) {
          for (const sec of scrapPage.sections) {
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
        }

        // 메모 렌더링
        if (pageMemos.length > 0) {
          pageLines.push('## 메모', '');

          const sortedMemos = [...pageMemos].sort((a, b) => (a.ts || 0) - (b.ts || 0));
          const memoSectionMap = new Map();
          const memoSectionOrder = [];
          for (const m of sortedMemos) {
            const heading = Array.isArray(m.headings) && m.headings.length > 0 ? m.headings[m.headings.length - 1] : '';
            if (!memoSectionMap.has(heading)) {
              memoSectionMap.set(heading, []);
              memoSectionOrder.push(heading);
            }
            memoSectionMap.get(heading).push(m);
          }

          for (const heading of memoSectionOrder) {
            const items = memoSectionMap.get(heading);
            if (heading) {
              pageLines.push(`### ${heading}`, '');
            }
            for (const m of items) {
              pageLines.push(...memoItemLines(m));
            }
            pageLines.push('');
          }
        }

        docs.set(`${taskId}/${page.slug}.md`, pageLines.join('\n').trimEnd() + '\n');
      }
    } else {
      // 3. 인박스: inbox.md 한 파일
      const inboxLines = [SCRAP_HEADER_COMMENT, '', '# 인박스', ''];

      for (const page of node.pages) {
        const scrapPage = scrapPageMap.get(pageKey(null, page.url));
        const pageMemos = memoMap.get(pageKey(null, page.url)) || [];

        inboxLines.push(`## ${page.title}`, '', page.url, '');

        if (scrapPage) {
          for (const sec of scrapPage.sections) {
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

        // 메모 렌더링
        if (pageMemos.length > 0) {
          inboxLines.push('### 메모', '');

          const sortedMemos = [...pageMemos].sort((a, b) => (a.ts || 0) - (b.ts || 0));
          const memoSectionMap = new Map();
          const memoSectionOrder = [];
          for (const m of sortedMemos) {
            const heading = Array.isArray(m.headings) && m.headings.length > 0 ? m.headings[m.headings.length - 1] : '';
            if (!memoSectionMap.has(heading)) {
              memoSectionMap.set(heading, []);
              memoSectionOrder.push(heading);
            }
            memoSectionMap.get(heading).push(m);
          }

          for (const heading of memoSectionOrder) {
            const items = memoSectionMap.get(heading);
            if (heading) {
              inboxLines.push(`#### ${heading}`, '');
            }
            for (const m of items) {
              inboxLines.push(...memoItemLines(m));
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

// 스크랩 파일이 제대로 읽히는지 직접 본다. createScraps 는 깨진 파일을 .bad 로 옮기므로, 그 전에 멈추려고 따로 본다.
// 없으면 괜찮고(null), 깨졌거나 못 읽으면 이유 문자열을 돌려준다.
export function scrapsFileProblem(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    return e?.code === 'ENOENT' ? null : `읽지 못했습니다(${e?.message})`;
  }
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && v.v === 1 && v.scraps && typeof v.scraps === 'object' && !Array.isArray(v.scraps)) return null;
  } catch {
    // 아래에서 깨진 파일로 본다
  }
  return '깨진 scraps.json';
}

// 내용이 같으면 쓰지 않고, map 에 없는 기존 생성 문서는 지운다.
// 대상 폴더 밖을 가리키는 경로(.. 나 절대 경로)가 하나라도 있으면 아무것도 쓰기 전에 throw 한다.
export function writeIfChanged(dir, map) {
  const written = [];
  const removed = [];
  const root = resolve(dir);
  for (const relPath of map.keys()) {
    const rel = relative(root, resolve(root, relPath));
    if (!rel || rel.split(sep)[0] === '..' || resolve(root, rel) !== resolve(root, relPath)) {
      throw new Error(`대상 폴더 밖 경로입니다: ${relPath}`);
    }
  }

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
        if (firstLine.startsWith('<!-- 자동 생성')) {
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

  const scrapsFile = join(dataDir, 'scraps.json');
  const problem = scrapsFileProblem(scrapsFile);
  if (problem) {
    console.error(`오류: ${problem} (${scrapsFile}). 아무것도 지우지 않고 멈춥니다. 파일을 고친 뒤 다시 실행하세요.`);
    process.exit(1);
  }

  let data;
  try {
    data = loadData(dataDir);
  } catch (e) {
    console.error(`오류: ${e?.message ?? e}`);
    process.exit(1);
  }
  const { scraps: scrapsData, memos = [] } = data;
  const scraps = Object.values(scrapsData?.scraps ?? {});

  const { nodes } = loadLearning(learningDir);
  const tasks = Object.fromEntries(nodes.map((n) => [n.id, n.card_title]));

  const map = renderScrapDocs(scraps, tasks, memos);
  const { written, removed } = writeIfChanged(toDir, map);

  console.log(`스크랩 문서 내보내기 완료: ${written.length}개 작성, ${removed.length}개 삭제 (${toDir})`);
}
