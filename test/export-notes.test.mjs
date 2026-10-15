// test/export-notes.test.mjs
// 과제 T33b 학습노트 및 llm-wiki 형식 개념 내보내기 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { renderNoteDocs, writeNotesIfChanged } from '../scripts/export-notes.mjs';
import { renderConceptDocs, writeConceptsIfChanged } from '../scripts/export-concepts.mjs';
import { loadNotesData } from '../scripts/data-source.mjs';
import { pageFileNames, pageKey } from '../scripts/export-scraps.mjs';

function createTempDir(prefix = 'rg-notes-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('학습노트 내보내기: 앞머리, 소제목 묶음, 각 모양 마크다운, headings 없는 항목, inbox, 멱등성', async () => {
  const dataDir = createTempDir('rg-data-');
  const outDir = createTempDir('rg-out-');

  try {
    // 1. 임시 sqlite db에 스크랩·메모·개념·나중에·단어·구 데이터 넣기
    const dbFile = join(dataDir, 'readgloss.db');
    const db = openDb(dbFile);
    db.raw.prepare("INSERT INTO meta (key, value) VALUES ('migrated_at', '2026-10-15')").run();

    const pageUrl = 'https://portswigger.net/web-security/access-control';
    const inboxUrl = 'https://example.com/unassigned-article';

    // (1) 스크랩: 소제목 있음
    db.put({
      id: 's_01',
      kind: 'scrap',
      key: 's_01',
      data: {
        id: 's_01',
        url: pageUrl,
        title: 'Access Control Vulnerabilities',
        task: 'S1-04',
        headings: ['Access control vulnerabilities', 'Vertical privilege escalation'],
        quote: {
          exact: 'If a user can gain access to functionality\nthat they are not permitted to access…',
        },
        ts: 1000,
      },
      ts: 1000,
    });

    // (2) 메모: 소제목 있음, 인용 포함
    db.put({
      id: 'm_01',
      kind: 'memo',
      key: 'm_01',
      data: {
        id: 'm_01',
        url: pageUrl,
        title: 'Access Control Vulnerabilities',
        task: 'S1-04',
        headings: ['Vertical privilege escalation'],
        quote: { exact: 'Important quote' },
        text: '- 관리자 기능을 일반 사용자가 씀 = 수직\n  - 서버가 권한을 확인해야 함',
        ts: 1100,
      },
      ts: 1100,
    });

    // (3) 개념: 소제목 있음, 태그/별칭/정의 목록
    db.put({
      id: 'c_01',
      kind: 'concept',
      key: 'access control',
      data: {
        name: 'access control',
        aliases: ['접근 통제', 'AC'],
        tags: ['다시 보기'],
        definition: '- 누가 무엇을 할 수 있는지 서버가 정하는 규칙\n- 클라이언트 숨김은 통제가 아님',
        seen: {
          url: pageUrl,
          title: 'Access Control Vulnerabilities',
          headings: ['Vertical privilege escalation'],
        },
        firstTask: 'S1-04',
      },
      ts: 1200,
    });

    // (4) 나중에 볼 것: 설명 빈 개념
    db.put({
      id: 'c_02',
      kind: 'concept',
      key: 'idor',
      data: {
        name: 'IDOR',
        definition: '',
        later: true,
        seen: {
          url: pageUrl,
          title: 'Access Control Vulnerabilities',
          headings: ['Vertical privilege escalation'],
        },
        firstTask: 'S1-04',
      },
      ts: 1300,
    });

    // (5) 단어: 저장 문장, 메모 포함
    db.put({
      id: 'w_01',
      kind: 'word',
      key: 'escalation',
      data: {
        saved: {
          word: 'escalation',
          gloss: '상승, 확대',
          sentence: 'We observed privilege escalation.',
          memo: '중요 단어',
          url: pageUrl,
          headings: ['Vertical privilege escalation'],
          ts: 1400,
        },
      },
      ts: 1400,
    });

    // (6) 구·문장
    db.put({
      id: 'p_01',
      kind: 'phrase',
      key: 'p_01',
      data: {
        text: 'gain access',
        translation: '접근 권한을 얻다',
        url: pageUrl,
        headings: ['Vertical privilege escalation'],
        ts: 1500,
      },
      ts: 1500,
    });

    // (7) headings 없는 메모 -> 맨 끝 '## 이 페이지에서'에 모여야 함
    db.put({
      id: 'm_no_heading',
      kind: 'memo',
      key: 'm_no_heading',
      data: {
        id: 'm_no_heading',
        url: pageUrl,
        title: 'Access Control Vulnerabilities',
        task: 'S1-04',
        headings: [],
        text: '소제목 없는 페이지 전체 총평 메모',
        ts: 1600,
      },
      ts: 1600,
    });

    // (8) 할 일 없는 인박스 항목
    db.put({
      id: 's_inbox',
      kind: 'scrap',
      key: 's_inbox',
      data: {
        id: 's_inbox',
        url: inboxUrl,
        title: 'Inbox Article Title',
        task: null,
        headings: ['Section 1'],
        quote: { exact: 'An unassigned quote.' },
        ts: 2000,
      },
      ts: 2000,
    });

    db.close();

    // 2. data-source 에서 읽어오기
    const data = loadNotesData(dataDir);
    assert.equal(data.memos.length, 2);
    assert.equal(data.concepts.length, 2);
    assert.ok(data.words.saved.escalation);
    assert.ok(data.words.phrases.p_01);

    // 3. renderNoteDocs 테스트
    const tasks = { 'S1-04': '웹 해킹 첫걸음' };
    const docs = renderNoteDocs(data, tasks);

    // 2개 페이지 문서 생성 확인: S1-04/<페이지>.md, inbox/<페이지>.md
    assert.equal(docs.size, 2);

    // (A) S1-04 페이지 문서 확인
    const s1Keys = [...docs.keys()].filter((k) => k.startsWith('S1-04/'));
    assert.equal(s1Keys.length, 1);
    const noteFile = s1Keys[0];
    const noteContent = docs.get(noteFile);

    // 앞머리 (YAML frontmatter) 검증
    assert.ok(noteContent.startsWith('---\n'));
    assert.match(noteContent, /type: study-note\n/);
    assert.match(noteContent, /title: "Access Control Vulnerabilities"\n/);
    assert.match(noteContent, /task: "웹 해킹 첫걸음 \(S1-04\)"\n/);
    assert.match(noteContent, /url: "https:\/\/portswigger\.net\/web-security\/access-control"\n/);
    assert.match(noteContent, /date: 1970-01-01\n/);
    assert.match(noteContent, /tags: \["다시 보기"\]\n/);

    // 앞머리 바로 다음 줄 자동 생성 주석 확인
    const lines = noteContent.split('\n');
    const fmEndIndex = lines.indexOf('---', 1);
    assert.ok(fmEndIndex > 0);
    assert.equal(lines[fmEndIndex + 1], '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->');

    // 본문 제목
    assert.match(noteContent, /# Access Control Vulnerabilities/);

    // 소제목 검증
    assert.match(noteContent, /## Vertical privilege escalation/);

    // 인용 모양: > 문장 (줄마다 > )
    assert.match(noteContent, /> If a user can gain access to functionality\n> that they are not permitted to access…/);

    // 메모 모양: 인용 줄 먼저, 그 다음 글 그대로
    assert.ok(!noteContent.includes('access…)')); // 말줄임은 조각에서 뺀다
    assert.match(noteContent, /> Important quote \[↗\]\([^)]+#:~:text=Important%20quote\)\n\n- 관리자 기능을 일반 사용자가 씀 = 수직\n  - 서버가 권한을 확인해야 함/);

    // 개념 모양: > [!concept] [[이름]] + > 다른 이름: ... · #태그 + > - 정의 줄
    assert.match(noteContent, /> \[!concept\] \[\[access control\]\]\n> 다른 이름: 접근 통제, AC · #다시 보기\n> - 누가 무엇을 할 수 있는지 서버가 정하는 규칙\n> - 클라이언트 숨김은 통제가 아님/);

    // 나중에 볼 것 모양: > [!question] 나중에 볼 것: IDOR
    assert.match(noteContent, /> \[!question\] 나중에 볼 것: IDOR/);

    // 단어 모양: > [!word]- 원형 — 뜻 + > 문장 + > 메모: ...
    assert.match(noteContent, /> \[!word\]- escalation — 상승, 확대\n> We observed privilege escalation\.\n> 메모: 중요 단어/);

    // 구 모양: > [!word]- 글 — 번역
    assert.match(noteContent, /> \[!word\]- gain access — 접근 권한을 얻다/);

    // headings 없는 항목은 맨 끝 '## 이 페이지에서'에 위치
    const vpePos = noteContent.indexOf('## Vertical privilege escalation');
    const inPagePos = noteContent.indexOf('## 이 페이지에서');
    assert.ok(vpePos !== -1);
    assert.ok(inPagePos !== -1);
    assert.ok(inPagePos > vpePos, '## 이 페이지에서 칸은 소제목 뒤 맨 끝이어야 합니다');
    assert.match(noteContent, /## 이 페이지에서\n\n소제목 없는 페이지 전체 총평 메모/);

    // (B) 할 일 없는 inbox 페이지 확인
    const inboxKeys = [...docs.keys()].filter((k) => k.startsWith('inbox/'));
    assert.equal(inboxKeys.length, 1);
    const inboxFile = inboxKeys[0];
    const inboxContent = docs.get(inboxFile);
    assert.match(inboxContent, /type: study-note/);
    assert.match(inboxContent, /task: "인박스"/);
    assert.match(inboxContent, /title: "Inbox Article Title"/);
    assert.match(inboxContent, /url: "https:\/\/example\.com\/unassigned-article"/);
    assert.match(inboxContent, /# Inbox Article Title/);
    assert.match(inboxContent, /> An unassigned quote\./);

    // 4. writeNotesIfChanged 동작 확인
    const res1 = writeNotesIfChanged(outDir, docs);
    assert.equal(res1.written.length, 2);
    assert.equal(res1.removed.length, 0);

    const fullPath1 = join(outDir, noteFile);
    assert.ok(existsSync(fullPath1));
    const mtime1 = statSync(fullPath1).mtimeMs;

    // 다시 실행하면 안 씀 (mtime 유지)
    await new Promise((r) => setTimeout(r, 20));
    const res2 = writeNotesIfChanged(outDir, docs);
    assert.equal(res2.written.length, 0);
    const mtime2 = statSync(fullPath1).mtimeMs;
    assert.equal(mtime1, mtime2);

    // 수동 파일은 유지되고 자동 생성 파일만 삭제되는지 확인
    const manualFile = join(outDir, 'manual.md');
    writeFileSync(manualFile, '# 수동 메모\n손으로 쓴 파일');

    // 한 페이지만 남긴 docs 로 다시 저장
    const singleDoc = new Map([[noteFile, noteContent]]);
    const res3 = writeNotesIfChanged(outDir, singleDoc);
    assert.ok(res3.removed.includes(inboxFile));
    assert.ok(!existsSync(join(outDir, inboxFile)));
    assert.ok(existsSync(manualFile));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('개념 문서 내보내기 (llm-wiki 16-5 형식): 앞머리, sources 경로, 본문 구조, 관련 페이지', async () => {
  const dir = createTempDir('rg-concept-wiki-');
  try {
    const concepts = [
      {
        id: 'c_01',
        name: 'access control',
        aliases: ['접근 통제', 'AC'],
        tags: ['다시 보기'],
        definition: '- 누가 무엇을 할 수 있는지 서버가 정하는 규칙\n- 클라이언트 숨김은 통제가 아님',
        related: [{ id: 'c_02', name: 'privilege escalation' }],
        appears: [
          {
            scrapId: 's_01',
            task: 'S1-04',
            taskTitle: '웹 해킹 첫걸음',
            url: 'https://portswigger.net/web-security/access-control',
            title: 'Access Control Vulnerabilities',
            exact: 'Broken access control quote',
            heading: 'Vertical privilege escalation',
          },
        ],
        ts: 1729000000000,
      },
      {
        id: 'c_02',
        name: 'privilege escalation',
        aliases: [],
        tags: [],
        definition: '- 권한을 높이는 공격 기법',
        related: [{ id: 'c_01', name: 'access control' }],
        appears: [],
        ts: 1729000000000,
      },
    ];

    const scraps = [
      {
        task: 'S1-04',
        url: 'https://portswigger.net/web-security/access-control',
        title: 'Access Control Vulnerabilities',
      },
    ];
    const notePathsMap = new Map([
      ['https://portswigger.net/web-security/access-control', 'S1-04/access-control-vulnerabilities'],
    ]);

    const docs = renderConceptDocs(concepts, notePathsMap);
    assert.ok(docs.has('access-control.md'));
    assert.ok(docs.has('privilege-escalation.md'));

    const acDoc = docs.get('access-control.md');

    // 앞머리 YAML 검증
    assert.ok(acDoc.startsWith('---\n'));
    assert.match(acDoc, /type: concept\n/);
    assert.match(acDoc, /title: "access control"\n/);
    assert.match(acDoc, /description: "누가 무엇을 할 수 있는지 서버가 정하는 규칙"\n/);
    assert.match(acDoc, /aliases: \["접근 통제", "AC"\]\n/);
    assert.match(acDoc, /tags: \["다시 보기"\]\n/);
    assert.match(acDoc, /sources: \["notes\/S1-04\/access-control-vulnerabilities\.md"\]\n/);
    assert.match(acDoc, /created: \d{4}-\d{2}-\d{2}\n/);
    assert.match(acDoc, /updated: \d{4}-\d{2}-\d{2}\n/);

    // 앞머리 다음 줄 자동 생성 주석
    const lines = acDoc.split('\n');
    const fmEnd = lines.indexOf('---', 1);
    assert.equal(lines[fmEnd + 1], '<!-- 자동 생성 — 고치려면 확장 개념 탭에서 -->');

    // 본문: # 이름, 첫 줄 description, 정의 목록
    assert.match(acDoc, /# access control\n\n누가 무엇을 할 수 있는지 서버가 정하는 규칙\n\n- 누가 무엇을 할 수 있는지 서버가 정하는 규칙\n- 클라이언트 숨김은 통제가 아님/);

    // 나온 곳: - [[notes/<할일>/<페이지>]] — <소제목>
    assert.match(acDoc, /## 나온 곳\n- \[\[notes\/S1-04\/access-control-vulnerabilities\]\] — Vertical privilege escalation/);

    // 관련 페이지: - [[<관련 개념>]] — 관련
    assert.match(acDoc, /## 관련 페이지\n- \[\[privilege-escalation\]\] — 관련/);

    // 자동 생성 파일 쓰기 및 삭제 검증
    const res1 = writeConceptsIfChanged(dir, docs);
    assert.equal(res1.written.length, 2);

    // 수동 파일 유지
    const manualPath = join(dir, 'manual-concept.md');
    writeFileSync(manualPath, '# 수동\n지우지 마라');

    const singleDoc = new Map([['access-control.md', acDoc]]);
    const res2 = writeConceptsIfChanged(dir, singleDoc);
    assert.ok(res2.removed.includes('privilege-escalation.md'));
    assert.ok(existsSync(manualPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
