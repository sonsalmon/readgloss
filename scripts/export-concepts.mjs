// scripts/export-concepts.mjs
// 개념 문서를 대상 폴더에 내보낸다 (과제 T33b, 명세 16-5 llm-wiki 형식).
// 사용: node scripts/export-concepts.mjs --to <폴더> [--data <폴더(기본 data/)>] [--learning <폴더>]
import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConcepts } from '../bridge/concepts.mjs';
import { loadLearning } from '../bridge/task-guess.mjs';
import { openReadDb, loadNotesData } from './data-source.mjs';
import { slugifyPage, writeIfChanged } from './export-scraps.mjs';
import { normalizeUrl } from '../bridge/scraps.mjs';
import { notePaths } from './export-notes.mjs';
import { dateOf } from './export-day.mjs';

// 순수 함수 모듈 로드
await import('../extension/selection-core.js');

// 개념 문서 머리 주석(고치려면 개념 탭에서). 스크랩 문서 머리(export-scraps HEADER_COMMENT)와 다르다.
export const CONCEPT_HEADER_COMMENT = '<!-- 자동 생성 — 고치려면 확장 개념 탭에서 -->';

// 정의에서 첫 항목 텍스트 추출 (마크다운 목록 불릿 제거)
export function firstDefinitionItem(def) {
  if (!def || typeof def !== 'string') return '(아직 설명 없음)';
  const lines = def.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
    if (cleaned) return cleaned;
  }
  return '(아직 설명 없음)';
}

// 개념 목록 -> Map<상대경로, 내용>. notePaths 는 notePaths(data, tasks) 결과(Map<정규화 url, <할일>/<이름>>).
export function renderConceptDocs(concepts, notePaths = null) {
  const docs = new Map();
  const usedSlugs = new Set();
  const conceptsWithSlug = [];

  const getNoteRel = (url) => {
    if (!notePaths || !url) return null;
    const key = normalizeUrl(url) || url; // 개념에 남은 주소 원문(끝 슬래시·#조각)도 같은 노트로
    if (typeof notePaths.get === 'function') return notePaths.get(key) ?? null;
    return notePaths[key] || null;
  };

  for (const c of concepts) {
    const baseSlug = slugifyPage(c.name);
    let slug = baseSlug;
    for (let n = 2; usedSlugs.has(slug); n++) {
      const suffix = `-${n}`;
      slug = `${baseSlug.slice(0, 80 - suffix.length).replace(/-+$/, '')}${suffix}`;
    }
    usedSlugs.add(slug);
    conceptsWithSlug.push({ ...c, slug });
  }

  // 개념 id/name -> slug 매핑 테이블 생성 (related 링크 연결용)
  const slugByConcept = new Map();
  for (const c of conceptsWithSlug) {
    if (c.id) slugByConcept.set(c.id, c.slug);
    if (c.name) slugByConcept.set(c.name.toLowerCase(), c.slug);
  }

  for (const c of conceptsWithSlug) {
    const isLater = c.later === true || !c.definition;
    const desc = firstDefinitionItem(c.definition);

    // sources 경로 수집 및 나온 곳 목록 수집
    const sourcesSet = new Set();
    const whereList = [];
    const appearances = Array.isArray(c.appears) ? c.appears : [];

    for (const app of appearances) {
      if (!app?.url) continue;
      const u = globalThis.readglossSelection.normalizeUrl(app.url);
      const noteRel = getNoteRel(u);
      if (!noteRel) continue; // 표에 없는 주소는 생략

      sourcesSet.add(`notes/${noteRel}.md`);

      const heading =
        app.heading ||
        (Array.isArray(app.headings) && app.headings.length > 0 ? app.headings[app.headings.length - 1] : null) ||
        app.title ||
        '이 페이지에서';

      whereList.push({ target: `notes/${noteRel}`, heading });
    }

    // seen 처리: appears에서 나온 곳이 없는 개념(스크랩에서 안 나온 개념)도 seen.url 노트를 냄
    if (whereList.length === 0 && c.seen && c.seen.url) {
      const u = globalThis.readglossSelection.normalizeUrl(c.seen.url);
      const noteRel = getNoteRel(u);
      if (noteRel) {
        sourcesSet.add(`notes/${noteRel}.md`);
        const heading =
          (Array.isArray(c.seen.headings) && c.seen.headings.length > 0
            ? c.seen.headings[c.seen.headings.length - 1]
            : null) ||
          c.seen.title ||
          '이 페이지에서';
        whereList.push({ target: `notes/${noteRel}`, heading });
      }
    } else if (c.seen && c.seen.url) {
      const u = globalThis.readglossSelection.normalizeUrl(c.seen.url);
      const noteRel = getNoteRel(u);
      if (noteRel) {
        sourcesSet.add(`notes/${noteRel}.md`);
      }
    }

    const sources = [...sourcesSet];

    // 앞머리 (YAML frontmatter)
    const aliases = Array.isArray(c.aliases) ? c.aliases.filter(Boolean) : [];
    const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean) : [];
    const createdDate = dateOf(c.ts || Date.now());
    const updatedDate = dateOf(c.updated || c.ts || Date.now());

    const lines = [
      '---',
      'type: concept',
      `title: ${JSON.stringify(c.name)}`,
      `description: ${JSON.stringify(desc)}`,
      `aliases: [${aliases.map((a) => JSON.stringify(a)).join(', ')}]`,
      `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
      `sources: [${sources.map((s) => JSON.stringify(s)).join(', ')}]`,
      `created: ${createdDate}`,
      `updated: ${updatedDate}`,
      '---',
      CONCEPT_HEADER_COMMENT,
      '',
      `# ${c.name}`,
      '',
      desc,
      '',
    ];

    // 정의 문단
    if (isLater) {
      if (c.seen) {
        const title = c.seen.title || '';
        const url = c.seen.url || '';
        const sentence = (c.seen.sentence || '').slice(0, 120);
        lines.push(`본 곳: [${title}](${url}) — "${sentence}"`, '');
      }
    } else if (c.definition && c.definition.trim() !== desc) {
      lines.push(c.definition, '');
    }

    // ## 나온 곳
    // - [[notes/<할일>/<페이지>]] — <소제목>
    if (whereList.length > 0) {
      lines.push('## 나온 곳');
      for (const w of whereList) {
        lines.push(`- [[${w.target}]] — ${w.heading}`);
      }
      lines.push('');
    }

    // ## 관련 페이지
    // - [[<관련 개념>]] — 관련
    if (Array.isArray(c.related) && c.related.length > 0) {
      lines.push('## 관련 페이지');
      for (const r of c.related) {
        const targetName = r.name || r;
        const targetSlug =
          slugByConcept.get(r.id) ||
          slugByConcept.get(typeof targetName === 'string' ? targetName.toLowerCase() : '') ||
          slugifyPage(targetName);
        lines.push(`- [[${targetSlug}]] — 관련`);
      }
      lines.push('');
    }

    docs.set(`${c.slug}.md`, lines.join('\n').trimEnd() + '\n');
  }

  // 나중에-볼-것.md 목록 한 장(오래된 것 먼저: - <이름> · <본 곳 제목> · <YYYY-MM-DD>)
  const laterConcepts = concepts.filter((c) => c.later === true || !c.definition);
  if (laterConcepts.length > 0) {
    const sortedLater = [...laterConcepts].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const laterLines = [CONCEPT_HEADER_COMMENT, '', '# 나중에 볼 것', ''];
    for (const c of sortedLater) {
      const name = c.name || '';
      const seenTitle = c.seen?.title || c.firstTitle || '';
      const d = dateOf(c.ts || Date.now());
      laterLines.push(`- ${name} · ${seenTitle} · ${d}`);
    }
    docs.set('나중에-볼-것.md', laterLines.join('\n').trimEnd() + '\n');
  }

  // 글감-후보.md 목록 한 장(글감 후보 태그 개념만: - <이름> · <정의 첫 항목 또는 (아직 설명 없음)> · <YYYY-MM-DD>)
  const candidateConcepts = concepts.filter(
    (c) => Array.isArray(c.tags) && c.tags.includes('글감 후보'),
  );
  if (candidateConcepts.length > 0) {
    const sortedCandidates = [...candidateConcepts].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const candidateLines = [CONCEPT_HEADER_COMMENT, '', '# 글감 후보', ''];
    for (const c of sortedCandidates) {
      const name = c.name || '';
      const defItem = firstDefinitionItem(c.definition);
      const d = dateOf(c.ts || Date.now());
      candidateLines.push(`- ${name} · ${defItem} · ${d}`);
    }
    docs.set('글감-후보.md', candidateLines.join('\n').trimEnd() + '\n');
  }

  return docs;
}

// 자동 생성된 개념 파일인지 판정 (첫 줄 주석이거나, 앞머리에 type: concept가 있고 주석이 있는 파일)
export function isGeneratedConcept(text) {
  if (typeof text !== 'string') return false;
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.startsWith('<!-- 자동 생성')) return true;

  if (text.startsWith('---\n')) {
    const endFm = text.indexOf('\n---\n', 4);
    if (endFm === -1) return false;
    const fm = text.slice(4, endFm);
    if (!/(?:^|\n)type:\s*["']?concept["']?(?:\r?\n|$)/.test(fm)) return false;
    const afterFm = text.slice(endFm + 5).trimStart();
    return afterFm.startsWith('<!-- 자동 생성');
  }
  return false;
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

// 개념 문서 쓰기 및 자동 생성 파일 삭제
export function writeConceptsIfChanged(dir, map) {
  const res = writeIfChanged(dir, map);

  // 추가 정리: map에 없는 기존 .md 중 자동 생성 판정된 개념 파일 삭제
  const root = resolve(dir);
  const existingFiles = findMdFiles(root);
  for (const rel of existingFiles) {
    const normRel = rel.replace(/\\/g, '/');
    if (!map.has(normRel)) {
      const fullPath = join(root, rel);
      try {
        const text = readFileSync(fullPath, 'utf8');
        if (isGeneratedConcept(text)) {
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
      console.error('사용: node scripts/export-concepts.mjs --to <폴더> [--data <폴더>] [--learning <폴더>]');
      process.exit(2);
    }
  }

  if (!toDir) {
    console.error('오류: --to <폴더> 인자가 필수입니다.');
    process.exit(2);
  }

  let db = null;
  try {
    db = openReadDb(dataDir);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  if (!db) {
    console.log('개념 저장소가 아직 없어요');
    process.exit(0);
  }

  let concepts;
  let notesData;
  let tasks;
  try {
    const learning = loadLearning(learningDir);
    tasks = learning.tasks || {};
    concepts = createConcepts({ db, learning }).list();
    db.close();
    notesData = loadNotesData(dataDir);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  const paths = notePaths(notesData, tasks);
  const map = renderConceptDocs(concepts, paths);
  const { written, removed } = writeConceptsIfChanged(toDir, map);

  console.log(`개념 문서 내보내기 완료: ${written.length}개 작성, ${removed.length}개 삭제 (${toDir})`);
}
