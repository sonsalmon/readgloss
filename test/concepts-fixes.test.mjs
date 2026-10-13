// test/concepts-fixes.test.mjs
// 독립 검증이 찾은 문제(A~H) 수정 검증 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createConcepts } from '../bridge/concepts.mjs';
import { openReadDb } from '../scripts/data-source.mjs';
import { pageFileNames, renderScrapDocs, writeIfChanged } from '../scripts/export-scraps.mjs';
import { renderConceptDocs, CONCEPT_HEADER_COMMENT } from '../scripts/export-concepts.mjs';

// 순수 모듈 로드
await import('../extension/panel.js');
const panelCore = globalThis.readglossPanelCore;

const readExt = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
const readScript = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'rg-fixes-test-'));
}

// -------------------------------------------------------------
// A 건: 패널이 닫혀 있을 때 개념 상세 열기 및 로딩 처리
// -------------------------------------------------------------
test('A: panel-concepts.js는 로딩 중 상세 요청 시 목록으로 튕기지 않고 로딩 표시하며, 목록에 없으면 재조회한다', () => {
  const src = readExt('panel-concepts.js');

  // 1. readgloss:open-panel 이벤트 등록 시 capture 모드 또는 ID를 놓치지 않는 배선 확인
  assert.match(
    src,
    /addEventListener\(\s*['"]readgloss:open-panel['"][\s\S]*?(?:capture:\s*true|true\s*\))/s,
    'open-panel 리스너는 panel.js보다 먼저 실행되도록 capture 단계여야 한다',
  );

  // 2. isLoading 플래그 관리 확인
  assert.match(src, /isLoading\s*=\s*(?:true|false)/, '개념 목록 로딩 상태를 관리해야 한다');

  // 3. 로딩 중일 때 상세 화면에서 목록(currentView = "list")으로 바로 되돌리지 않고 로딩 문구 표시
  assert.match(
    src,
    /if\s*\(\s*isLoading\s*\)[\s\S]*?불러오는\s*중/s,
    '목록을 아직 못 받았으면 목록 화면으로 되돌리지 말고 불러오는 중을 보여야 한다',
  );

  // 4. loadConcepts 시 targetConceptId가 목록에 없으면(방금 생성 등) 1회 더 받아옴
  assert.match(
    src,
    /send\(\s*\{\s*type:\s*['"]concepts['"],\s*op:\s*['"]get['"]\s*\}\s*\)[\s\S]*?send\(\s*\{\s*type:\s*['"]concepts['"],\s*op:\s*['"]get['"]\s*\}\s*\)/s,
    '목록에 targetConceptId가 없으면 한 번 더 받아와야 한다',
  );
});

// -------------------------------------------------------------
// B 건: 이름 변경 후 옛 이름으로 새 개념 생성 시 다른 개념을 덮지 않음
// -------------------------------------------------------------
test('B: Alpha 만들기 → Beta로 이름 바꾸기 → Alpha 새로 만들기 → 개념 2개, Beta 그대로', () => {
  const dir = createTempDir();
  try {
    const dbFile = join(dir, 'test.db');
    const db = openDb(dbFile);
    const concepts = createConcepts({ db });

    // 1. Alpha 만들기
    const alpha1 = concepts.apply({
      op: 'save',
      name: 'Alpha',
      definition: '첫 번째 Alpha 정의',
      related: [],
    });
    assert.ok(alpha1 && alpha1.id);
    assert.match(alpha1.id, /^c_[0-9a-f]{12}$/, 'id는 c_ + 12자리 hex 형식이어야 한다');
    assert.equal(alpha1.name, 'Alpha');

    const firstId = alpha1.id;

    // 2. Beta로 이름 바꾸기 (id 제공 수정 모드)
    const beta = concepts.apply({
      op: 'save',
      id: firstId,
      name: 'Beta',
      definition: 'Beta로 이름 변경됨',
      related: [],
    });
    assert.ok(beta);
    assert.equal(beta.id, firstId, '수정 시 id는 유지되어야 한다');
    assert.equal(beta.name, 'Beta');

    // 3. Alpha 새로 만들기 (옛 이름으로 신규 생성)
    const alpha2 = concepts.apply({
      op: 'save',
      name: 'Alpha',
      definition: '새로운 Alpha 정의',
      related: [],
    });
    assert.ok(alpha2 && alpha2.id);
    assert.notEqual(alpha2.id, firstId, '새로 만든 Alpha는 새 id를 받아야 한다');
    assert.equal(alpha2.name, 'Alpha');

    // 4. 전체 개념 목록 확인: 개념 2개, Beta 그대로 존재
    const list = concepts.list();
    assert.equal(list.length, 2, '개념은 덮어쓰이지 않고 총 2개여야 한다');

    const foundBeta = list.find((c) => c.name === 'Beta');
    assert.ok(foundBeta, 'Beta 개념이 그대로 남아있어야 한다');
    assert.equal(foundBeta.id, firstId);
    assert.equal(foundBeta.definition, 'Beta로 이름 변경됨');

    const foundAlpha = list.find((c) => c.name === 'Alpha');
    assert.ok(foundAlpha, '새 Alpha 개념이 목록에 존재해야 한다');
    assert.equal(foundAlpha.id, alpha2.id);
    assert.equal(foundAlpha.definition, '새로운 Alpha 정의');

    // 5. 새 이름이 다른 개념의 key와 충돌할 때는 409 반환
    const dupTry = concepts.apply({
      op: 'save',
      id: alpha2.id,
      name: 'Beta', // 이미 firstId가 쓰고 있는 이름
      definition: '충돌 시도',
      related: [],
    });
    assert.deepEqual(dupTry, { error: 'exists', id: firstId });

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------
// C 건: openReadDb(dataDir) 및 0바이트 db 보호
// -------------------------------------------------------------
test('C: openReadDb는 db 없거나 migrated_at 없으면 null, 열기·읽기 실패면 던진다', () => {
  const dir = createTempDir();
  try {
    // 1. db 파일이 아예 없는 경우 -> null
    const emptyDir = join(dir, 'no-db');
    mkdirSync(emptyDir, { recursive: true });
    assert.equal(openReadDb(emptyDir), null);

    // 2. 0바이트 db 파일 -> 열기/읽기 실패로 throw
    const zeroDir = join(dir, 'zero-db');
    mkdirSync(zeroDir, { recursive: true });
    writeFileSync(join(zeroDir, 'readgloss.db'), '');
    assert.throws(() => openReadDb(zeroDir));

    // 3. migrated_at이 없는 db 파일 -> null
    const unmigratedDir = join(dir, 'unmigrated-db');
    mkdirSync(unmigratedDir, { recursive: true });
    const unmigratedDb = openDb(join(unmigratedDir, 'readgloss.db'));
    unmigratedDb.close(); // meta 테이블에 migrated_at 없음
    assert.equal(openReadDb(unmigratedDir), null);

    // 4. export-concepts.mjs 소스 검사: openReadDb 사용 및 종료 코드/에러 메시지 처리 확인
    const src = readScript('export-concepts.mjs');
    assert.match(src, /openReadDb\(/, 'export-concepts는 openReadDb로 열어야 한다');
    assert.match(src, /개념 저장소가 아직 없어요/, 'db가 null일 때 "개념 저장소가 아직 없어요"를 출력해야 한다');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------
// D 건: Esc 및 바깥 클릭 시 개념 칸/카드 경로면 패널 닫지 않음
// -------------------------------------------------------------
test('D: Esc 및 바깥 클릭 시 readgloss-concept-form / readgloss-concept-card 경로면 패널 닫지 않음', () => {
  assert.ok(panelCore, 'readglossPanelCore가 존재해야 한다');
  assert.equal(typeof panelCore.isConceptPath, 'function', 'isConceptPath 순수 함수가 있어야 한다');

  // 경로 판정
  assert.equal(panelCore.isConceptPath([{ localName: 'readgloss-concept-form' }]), true);
  assert.equal(panelCore.isConceptPath([{ localName: 'readgloss-concept-card' }]), true);
  assert.equal(panelCore.isConceptPath([{ localName: 'div' }, { localName: 'readgloss-concept-form' }]), true);
  assert.equal(panelCore.isConceptPath([{ localName: 'div' }]), false);
  assert.equal(panelCore.isConceptPath([]), false);
  assert.equal(panelCore.isConceptPath(null), false);

  // 바깥 클릭·Escape 판정은 panel.js 리스너에 인라인으로 배선돼 있다(DOM 없이 소스 순서로 확인).
  const panelSrc = readExt('panel.js');
  assert.match(
    panelSrc,
    /!path\.includes\(host\) && !C\.isCardPath\(path\) && !C\.isConceptPath\(path\)/,
    '바깥 클릭이 개념 칸·카드를 예외로 둔다',
  );
  assert.match(
    panelSrc,
    /!C\.isConceptPath\(e\.composedPath\(\)\) && !C\.isToastPath\(e\.composedPath\(\)\) && closePanel\(\)/,
    'Esc 가 개념 칸·카드를 예외로 둔다',
  );
});

// -------------------------------------------------------------
// E 건: openForm(seed)에 task가 있으면 guess 건너뛰고 사용, panel-scraps는 task 전달
// -------------------------------------------------------------
test('E: openForm(seed)에 task가 있으면 그것을 쓰고 guess를 하지 않으며, panel-scraps는 task 전달', () => {
  // 1. panel-scraps.js 소스 검사: openForm 호출 시 task 넘김
  const scrapsSrc = readExt('panel-scraps.js');
  assert.match(
    scrapsSrc,
    /openForm\(\s*\{[\s\S]*?task:\s*item\.task[\s\S]*?\}\s*\)/s,
    'panel-scraps의 [내 개념으로] 버튼은 scrap의 task를 seed로 넘겨야 한다',
  );

  // 2. concept.js 소스 검사: seed.task가 있으면 guess 건너뜀
  const conceptSrc = readExt('concept.js');
  assert.match(
    conceptSrc,
    /seed\s*&&\s*['"]task['"]\s*in\s*seed|seed\.task\s*!==\s*undefined/,
    'seed에 task가 있으면 그것을 쓰고 guess를 건너뛰어야 한다',
  );
});

// -------------------------------------------------------------
// F 건: guess가 ask:true면 task 없이(null) 보낸다
// -------------------------------------------------------------
test('F: guess가 ask:true면 task 없이(null) 보낸다', () => {
  const conceptSrc = readExt('concept.js');
  // g.task가 있고 !g.ask 일 때만 task를 채우는지 확인
  assert.match(
    conceptSrc,
    /g\.task\s*&&\s*!g\.ask|!g\?\.ask\s*&&\s*g\?\.task/s,
    'guess 결과가 ask:true면 task 없이(null) 저장해야 한다',
  );
});

// -------------------------------------------------------------
// G 건: pageFileNames(scraps) -> 같은 할 일 제목 중복 페이지 각각 일치
// -------------------------------------------------------------
test('G: 같은 할 일에 제목 같은 페이지 둘 → 개념 문서 링크가 스크랩 문서의 실제 파일 두 개와 각각 맞는다', () => {
  // 스크랩 목록은 배열이다(export-scraps 의 main 이 Object.values 로 넘긴다).
  const scraps = [
    {
      id: 's1',
      task: 'S1-04',
      url: 'https://example.com/p1',
      title: 'Same Title',
      quote: { exact: 'first quote' },
      ts: 100,
    },
    {
      id: 's2',
      task: 'S1-04',
      url: 'https://example.com/p2',
      title: 'Same Title',
      quote: { exact: 'second quote' },
      ts: 200,
    },
  ];

  const tasks = { 'S1-04': '접근 통제' };
  const fileNames = pageFileNames(scraps);
  assert.ok(fileNames instanceof Map, 'pageFileNames는 Map을 반환해야 한다');

  const p1File = fileNames.get('S1-04|https://example.com/p1');
  const p2File = fileNames.get('S1-04|https://example.com/p2');

  assert.equal(p1File, 'S1-04/same-title');
  assert.equal(p2File, 'S1-04/same-title-2');

  // renderScrapDocs와도 일치하는지 확인
  const scrapDocs = renderScrapDocs(scraps, tasks);
  assert.ok(scrapDocs.has('S1-04/same-title.md'));
  assert.ok(scrapDocs.has('S1-04/same-title-2.md'));

  // 개념 문서 renderConceptDocs 검증: appears 링크가 각각 맞는 파일로 들어감
  const concepts = [
    {
      id: 'c_test',
      name: 'Test Concept',
      definition: '개념 정의',
      appears: [
        {
          scrapId: 's1',
          task: 'S1-04',
          taskTitle: '접근 통제',
          url: 'https://example.com/p1',
          title: 'Same Title',
          exact: 'first quote',
        },
        {
          scrapId: 's2',
          task: 'S1-04',
          taskTitle: '접근 통제',
          url: 'https://example.com/p2',
          title: 'Same Title',
          exact: 'second quote',
        },
      ],
    },
  ];

  const conceptDocs = renderConceptDocs(concepts, fileNames);
  const docContent = conceptDocs.get('test-concept.md');
  assert.ok(docContent);

  // [[../scraps/S1-04/same-title]] 와 [[../scraps/S1-04/same-title-2]] 둘 다 포함
  assert.match(docContent, /\[\[\.\.\/scraps\/S1-04\/same-title\]\]/);
  assert.match(docContent, /\[\[\.\.\/scraps\/S1-04\/same-title-2\]\]/);

  // 개념에 남은 주소 원문(끝 슬래시·#조각)이 페이지 주소와 달라도 같은 파일로 간다
  const rawUrlDoc = renderConceptDocs(
    [{ ...concepts[0], appears: [{ ...concepts[0].appears[1], url: 'https://example.com/p2/#top' }] }],
    fileNames,
  ).get('test-concept.md');
  assert.match(rawUrlDoc, /\[\[\.\.\/scraps\/S1-04\/same-title-2\]\]/);
});

// -------------------------------------------------------------
// H 건: 개념 문서 머리 주석 및 손으로 쓴 파일 보존
// -------------------------------------------------------------
test('H: 개념 문서 머리는 "고치려면 확장 개념 탭에서", 손으로 쓴 파일은 안 지움', () => {
  const dir = createTempDir();
  try {
    assert.equal(
      CONCEPT_HEADER_COMMENT,
      '<!-- 자동 생성 — 고치려면 확장 개념 탭에서 -->',
      '개념 문서 머리 주석 상수 확인',
    );

    const concepts = [{ id: 'c_01', name: 'Alpha Concept', definition: 'Alpha' }];
    const docs = renderConceptDocs(concepts);
    const acDoc = docs.get('alpha-concept.md');
    const firstLine = acDoc.split('\n')[0].trim();
    assert.equal(firstLine, '<!-- 자동 생성 — 고치려면 확장 개념 탭에서 -->');

    // 디렉토리에 3개 파일 생성:
    // 1. 기존 스크랩 문서 머리
    // 2. 새 개념 문서 머리
    // 3. 사용자가 손으로 작성한 메모
    writeFileSync(join(dir, 'scrap-style.md'), '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->\n# Scrap');
    writeFileSync(join(dir, 'concept-style.md'), '<!-- 자동 생성 — 고치려면 확장 개념 탭에서 -->\n# Concept');
    writeFileSync(join(dir, 'manual.md'), '# Manual Note\nDo not delete me');

    // 빈 맵으로 writeIfChanged 실행 -> 자동 생성 두 파일은 모두 지워지고 수동 파일은 남아야 함
    const { removed } = writeIfChanged(dir, new Map());
    assert.ok(removed.includes('scrap-style.md'), '스크랩 머리 자동 생성 파일 삭제');
    assert.ok(removed.includes('concept-style.md'), '개념 머리 자동 생성 파일 삭제');
    assert.ok(!removed.includes('manual.md'), '수동 파일은 지우지 않음');

    assert.ok(!existsSync(join(dir, 'scrap-style.md')));
    assert.ok(!existsSync(join(dir, 'concept-style.md')));
    assert.ok(existsSync(join(dir, 'manual.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
