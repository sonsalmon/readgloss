// scripts/export-concepts.mjs
// 개념 문서를 대상 폴더에 내보낸다.
// 사용: node scripts/export-concepts.mjs --to <폴더> [--data <폴더(기본 data/)>] [--learning <폴더>]
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConcepts } from '../bridge/concepts.mjs';
import { loadLearning } from '../bridge/task-guess.mjs';
import { openReadDb, loadData } from './data-source.mjs';
import { slugifyPage, writeIfChanged, pageFileNames, pageKey } from './export-scraps.mjs';
import { dateOf } from './export-day.mjs';

// 개념 문서 머리 주석(고치려면 개념 탭에서). 스크랩 문서 머리(export-scraps HEADER_COMMENT)와 다르다.
export const CONCEPT_HEADER_COMMENT = '<!-- 자동 생성 — 고치려면 확장 개념 탭에서 -->';

// 개념 목록 -> Map<상대경로, 내용>. pageFiles 는 pageFileNames 결과(없으면 제목으로 링크).
export function renderConceptDocs(concepts, pageFiles = null) {
  const docs = new Map();
  const usedSlugs = new Set();
  const conceptsWithSlug = [];

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
    const lines = [CONCEPT_HEADER_COMMENT, '', `# ${c.name}`, ''];

    // 별칭 (있을 때만)
    if (Array.isArray(c.aliases) && c.aliases.length > 0) {
      lines.push(`별칭: ${c.aliases.join(', ')}`, '');
    }

    // 정의 문단
    const isLater = c.later === true || !c.definition;
    if (isLater) {
      lines.push('(아직 설명 없음)', '');
      if (c.seen) {
        const title = c.seen.title || '';
        const url = c.seen.url || '';
        const sentence = (c.seen.sentence || '').slice(0, 120);
        lines.push(`본 곳: [${title}](${url}) — "${sentence}"`, '');
      }
    } else if (c.definition) {
      lines.push(c.definition, '');
    }

    // 관련: [[<다른 개념 파일 이름>]]
    if (Array.isArray(c.related) && c.related.length > 0) {
      const links = [];
      for (const r of c.related) {
        const targetName = r.name || r;
        const targetSlug =
          slugByConcept.get(r.id) ||
          slugByConcept.get(typeof targetName === 'string' ? targetName.toLowerCase() : '') ||
          slugifyPage(targetName);
        links.push(`[[${targetSlug}]]`);
      }
      lines.push(`관련: ${links.join(', ')}`, '');
    }

    // ## 나온 곳
    // - <할 일 제목> · [[../scraps/<할일>/<페이지 파일 이름>]] — "<exact 앞 80자>"
    if (Array.isArray(c.appears) && c.appears.length > 0) {
      lines.push('## 나온 곳', '');
      for (const app of c.appears) {
        const taskTitle = app.taskTitle || (app.task ? app.task : '인박스');
        let pageLink;
        if (app.task) {
          const matched = pageFiles?.get(pageKey(app.task, app.url));
          pageLink = matched ? `../scraps/${matched}` : `../scraps/${app.task}/${slugifyPage(app.title || 'page')}`;
        } else {
          pageLink = '../scraps/inbox';
        }
        const exact80 = (app.exact || '').slice(0, 80);
        lines.push(`- ${taskTitle} · [[${pageLink}]] — "${exact80}"`);
      }
      lines.push('');
    }

    docs.set(`${c.slug}.md`, lines.join('\n').trimEnd() + '\n');
  }

  // 나중에-볼-것.md 목록 한 장(오래된 것 먼저: - <이름> · <본 곳 제목> · <YYYY-MM-DD>)
  // 나중에 볼 것이 없으면 그 파일을 만들지 않는다(있던 자동 생성 파일이면 writeIfChanged가 지움).
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

  return docs;
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
  let data;
  try {
    const learning = loadLearning(learningDir);
    concepts = createConcepts({ db, learning }).list();
    db.close();
    data = loadData(dataDir);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  const pageFiles = pageFileNames(Object.values(data.scraps.scraps));
  const map = renderConceptDocs(concepts, pageFiles);
  const { written, removed } = writeIfChanged(toDir, map);

  console.log(`개념 문서 내보내기 완료: ${written.length}개 작성, ${removed.length}개 삭제 (${toDir})`);
}
