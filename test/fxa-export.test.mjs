// test/fxa-export.test.mjs
// 과제 FX-A: 학습노트 및 개념 문서 버그 수정 검증 시험 (1~7 항목)
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNoteDocs, notePaths, isGeneratedNote } from '../scripts/export-notes.mjs';
import { renderConceptDocs, isGeneratedConcept } from '../scripts/export-concepts.mjs';

test('과제 1: 단어·구 칸 이름 버그 (gloss, translation, 원형 키)', () => {
  const data = {
    scraps: { scraps: {} },
    memos: [],
    concepts: [],
    words: {
      saved: {
        escalate: {
          word: 'escalation',
          gloss: '상승, 확대',
          sentence: 'Privilege escalation was detected.',
          memo: '원형은 escalate',
          url: 'https://example.com/test-page',
          headings: ['Vulnerability'],
          ts: 1000,
        },
      },
      phrases: {
        p01: {
          text: 'gain access',
          translation: '접근 권한을 얻다',
          url: 'https://example.com/test-page',
          headings: ['Vulnerability'],
          ts: 1100,
        },
      },
    },
  };

  const docs = renderNoteDocs(data, {});
  const doc = [...docs.values()][0];

  // 단어: > [!word]- <원형 키> — <gloss>
  assert.match(doc, /> \[!word\]- escalate — 상승, 확대/);
  assert.match(doc, /> Privilege escalation was detected\./);
  assert.match(doc, /> 메모: 원형은 escalate/);

  // 구: > [!word]- <text> — <translation>
  assert.match(doc, /> \[!word\]- gain access — 접근 권한을 얻다/);

  // undefined 가 나오지 않아야 함
  assert.ok(!doc.includes('— undefined'));
});

test('과제 2: 단어·구만 있는 페이지의 제목·할 일 및 다른 항목이 있는 페이지', () => {
  const data = {
    scraps: {
      scraps: {
        s01: {
          url: 'https://example.com/mixed-page',
          task: 'S1-01',
          title: 'Mixed Page Title',
          quote: { exact: 'Some scrap' },
          ts: 500,
        },
      },
    },
    memos: [],
    concepts: [],
    words: {
      saved: {
        // mixed-page에 있는 단어 (title/task 없음) -> mixed-page의 S1-01 / Mixed Page Title 상속
        token: {
          word: 'token',
          gloss: '토큰',
          url: 'https://example.com/mixed-page',
          ts: 600,
        },
        // 단어만 있는 페이지 -> host+경로 제목, inbox, 파일 이름도 host+경로
        payload: {
          word: 'payload',
          gloss: '공격 코드 본체',
          url: 'https://example.com/tools/sqlmap',
          ts: 700,
        },
      },
      phrases: {},
    },
  };

  const tasks = { 'S1-01': '웹 보안 기초' };
  const docs = renderNoteDocs(data, tasks);

  // 1. 혼합 페이지: S1-01/<slug>.md
  const mixedDocKey = [...docs.keys()].find((k) => k.startsWith('S1-01/'));
  assert.ok(mixedDocKey);
  const mixedDoc = docs.get(mixedDocKey);
  assert.match(mixedDoc, /title: "Mixed Page Title"/);
  assert.match(mixedDoc, /task: "웹 보안 기초 \(S1-01\)"/);
  assert.match(mixedDoc, /> \[!word\]- token — 토큰/);

  // 2. 단어만 있는 페이지: inbox/example-com-tools-sqlmap.md
  assert.ok(docs.has('inbox/example-com-tools-sqlmap.md'));
  const wordOnlyDoc = docs.get('inbox/example-com-tools-sqlmap.md');
  assert.match(wordOnlyDoc, /title: "example\.com\/tools\/sqlmap"/);
  assert.match(wordOnlyDoc, /task: "인박스"/);
  assert.match(wordOnlyDoc, /# example\.com\/tools\/sqlmap/);
  assert.match(wordOnlyDoc, /> \[!word\]- payload — 공격 코드 본체/);
});

test('과제 3: 소제목 구조 트리 (사슬 전체 묶음, 상위 소제목 빈 줄 생성, 깊이별 #, 갈래 순서, 맨 끝 이 페이지에서)', () => {
  const pageUrl = 'https://example.com/tree-test';
  const data = {
    scraps: {
      scraps: {
        // Part B 갈래: 가장 이른 ts 100
        sB_setup: {
          url: pageUrl,
          title: 'Tree Test',
          headings: ['Part B', 'Setup'],
          quote: { exact: 'Part B Setup Scrap' },
          ts: 100,
        },
        // Part A 갈래: 가장 이른 ts 200
        sA_setup: {
          url: pageUrl,
          title: 'Tree Test',
          headings: ['Part A', 'Setup', 'Deep Step'],
          quote: { exact: 'Part A Deep Scrap' },
          ts: 200,
        },
      },
    },
    memos: [
      // headings 없는 메모 -> 맨 끝 '## 이 페이지에서'
      {
        url: pageUrl,
        title: 'Tree Test',
        headings: [],
        text: '페이지 총평 메모',
        ts: 50,
      },
    ],
    concepts: [],
    words: { saved: {}, phrases: {} },
  };

  const docs = renderNoteDocs(data, {});
  const doc = [...docs.values()][0];

  // 1. Part A와 Part B의 Setup이 합쳐지지 않고 독립적으로 존재
  assert.match(doc, /## Part B\n\n### Setup/);
  assert.match(doc, /## Part A\n\n### Setup\n\n#### Deep Step/);

  // 2. Part B의 minTs(100)가 Part A의 minTs(200)보다 빠르므로 Part B가 Part A보다 먼저 등장
  const posPartB = doc.indexOf('## Part B');
  const posPartA = doc.indexOf('## Part A');
  assert.ok(posPartB !== -1);
  assert.ok(posPartA !== -1);
  assert.ok(posPartB < posPartA, 'Part B가 Part A보다 먼저 나와야 함');

  // 3. 상위 소제목은 항목이 없어도 제목 줄을 냄 (Part B, Part A, Part A의 Setup)
  assert.ok(doc.includes('## Part B'));
  assert.ok(doc.includes('## Part A'));

  // 4. ## 이 페이지에서 칸은 모든 소제목 섹션 뒤 맨 끝
  const posInPage = doc.indexOf('## 이 페이지에서');
  assert.ok(posInPage !== -1);
  assert.ok(posInPage > posPartA);
  assert.match(doc, /## 이 페이지에서\n\n페이지 총평 메모/);
});

test('과제 4: 앞머리 YAML 따옴표 처리 및 판정 함수', () => {
  const pageUrl = 'https://example.com/yaml-test';
  const trickyTitle = 'Kerberos: "basics" & `tickets`: overview';
  const trickyDesc = 'Definition with "quotes", `backticks`: and colons.';

  const data = {
    scraps: {
      scraps: {
        s01: {
          url: pageUrl,
          title: trickyTitle,
          task: 'TASK: 01',
          quote: { exact: 'quote' },
          ts: 1000,
        },
      },
    },
    memos: [],
    concepts: [
      {
        name: 'Kerberos: Auth',
        definition: trickyDesc,
        aliases: ['Krb: 5', 'Kerb "auth"'],
        tags: ['다시 보기: 1', 'tag`2`'],
        appears: [{ url: pageUrl, title: trickyTitle, task: 'TASK: 01', exact: 'quote' }],
        ts: 1000,
      },
    ],
    words: { saved: {}, phrases: {} },
  };

  const tasks = { 'TASK: 01': 'Task: "Special" (01)' };
  const paths = notePaths(data, tasks);
  const noteDocs = renderNoteDocs(data, tasks);
  const noteDoc = [...noteDocs.values()][0];

  // 학습노트 앞머리 검증
  const noteLines = noteDoc.split('\n');
  const noteTitleLine = noteLines.find((l) => l.startsWith('title: '));
  const noteTaskLine = noteLines.find((l) => l.startsWith('task: '));
  const noteUrlLine = noteLines.find((l) => l.startsWith('url: '));
  const noteTagsLine = noteLines.find((l) => l.startsWith('tags: '));

  assert.equal(JSON.parse(noteTitleLine.slice('title: '.length)), trickyTitle);
  assert.equal(JSON.parse(noteTaskLine.slice('task: '.length)), 'Task: "Special" (01) (TASK: 01)');
  assert.equal(JSON.parse(noteUrlLine.slice('url: '.length)), pageUrl);
  assert.deepEqual(JSON.parse(noteTagsLine.slice('tags: '.length)), ['tag`2`', '다시 보기: 1']);

  // 개념 문서 앞머리 검증
  const conceptDocs = renderConceptDocs(data.concepts, paths);
  const cDoc = [...conceptDocs.values()][0];
  const cLines = cDoc.split('\n');

  const cTitleLine = cLines.find((l) => l.startsWith('title: '));
  const cDescLine = cLines.find((l) => l.startsWith('description: '));
  const cAliasesLine = cLines.find((l) => l.startsWith('aliases: '));
  const cTagsLine = cLines.find((l) => l.startsWith('tags: '));
  const cSourcesLine = cLines.find((l) => l.startsWith('sources: '));

  assert.equal(JSON.parse(cTitleLine.slice('title: '.length)), 'Kerberos: Auth');
  assert.equal(JSON.parse(cDescLine.slice('description: '.length)), trickyDesc);
  assert.deepEqual(JSON.parse(cAliasesLine.slice('aliases: '.length)), ['Krb: 5', 'Kerb "auth"']);
  assert.deepEqual(JSON.parse(cTagsLine.slice('tags: '.length)), ['다시 보기: 1', 'tag`2`']);
  assert.ok(Array.isArray(JSON.parse(cSourcesLine.slice('sources: '.length))));

  // 판정 함수: 따옴표 유무 모두 인식
  assert.ok(isGeneratedNote('---\ntype: study-note\n---\n<!-- 자동 생성 -->'));
  assert.ok(isGeneratedNote('---\ntype: "study-note"\n---\n<!-- 자동 생성 -->'));
  assert.ok(isGeneratedNote("---\ntype: 'study-note'\n---\n<!-- 자동 생성 -->"));
  assert.ok(!isGeneratedNote('---\ntype: other\n---\n<!-- 자동 생성 -->'));

  assert.ok(isGeneratedConcept('---\ntype: concept\n---\n<!-- 자동 생성 -->'));
  assert.ok(isGeneratedConcept('---\ntype: "concept"\n---\n<!-- 자동 생성 -->'));
  assert.ok(isGeneratedConcept("---\ntype: 'concept'\n---\n<!-- 자동 생성 -->"));
  assert.ok(!isGeneratedConcept('---\ntype: other\n---\n<!-- 자동 생성 -->'));
});

test('과제 5: notePaths export 및 개념 문서 sources / 나온 곳 경로 매핑 (표에 없는 주소 생략)', () => {
  const data = {
    scraps: {
      scraps: {
        s01: {
          url: 'https://example.com/page-one',
          task: 'S1-04',
          title: 'Page One',
          quote: { exact: 'Quote one' },
          ts: 1000,
        },
      },
    },
    memos: [],
    concepts: [],
    words: { saved: {}, phrases: {} },
  };

  const tasks = { 'S1-04': 'Access Control' };
  const paths = notePaths(data, tasks);
  assert.ok(paths instanceof Map);
  assert.equal(paths.get('https://example.com/page-one'), 'S1-04/page-one');

  // renderNoteDocs가 생성한 파일 키와 notePaths가 일치하는지 확인
  const noteDocs = renderNoteDocs(data, tasks);
  assert.ok(noteDocs.has('S1-04/page-one.md'));

  // 개념 문서 테스트: 표에 있는 주소와 표에 없는 주소
  const concepts = [
    {
      name: 'Auth Concept',
      definition: 'Auth concept explanation',
      appears: [
        { url: 'https://example.com/page-one', heading: 'Section 1' },
        { url: 'https://example.com/unknown-page', heading: 'Unknown Section' }, // 표에 없음 -> 생략
      ],
      ts: 1000,
    },
  ];

  const cDocs = renderConceptDocs(concepts, paths);
  const cDoc = cDocs.get('auth-concept.md');

  // sources: S1-04/page-one.md 만 포함
  assert.match(cDoc, /sources: \["notes\/S1-04\/page-one\.md"\]/);

  // 나온 곳: notes/S1-04/page-one 만 포함, unknown-page는 생략
  assert.match(cDoc, /## 나온 곳\n- \[\[notes\/S1-04\/page-one\]\] — Section 1/);
  assert.ok(!cDoc.includes('unknown-page'));
  assert.ok(!cDoc.includes('Unknown Section'));
});

test('과제 6: seen만 있는 개념의 ## 나온 곳 출력 및 소제목 처리', () => {
  const paths = new Map([
    ['https://example.com/seen-page', 'S1-04/seen-page'],
    ['https://example.com/no-heading-page', 'inbox/no-heading-page'],
  ]);

  const concepts = [
    {
      name: 'Later Concept With Heading',
      definition: '',
      later: true,
      appears: [], // 스크랩에서 안 나옴
      seen: {
        url: 'https://example.com/seen-page',
        title: 'Seen Page Title',
        headings: ['Chapter 1', 'Target Subheading'],
      },
      ts: 1000,
    },
    {
      name: 'Later Concept Without Heading',
      definition: '',
      later: true,
      appears: [],
      seen: {
        url: 'https://example.com/no-heading-page',
        title: 'No Heading Page Title',
        headings: [],
      },
      ts: 1100,
    },
  ];

  const docs = renderConceptDocs(concepts, paths);

  // 1. headings가 있는 seen 개념 -> headings 마지막 소제목
  const doc1 = docs.get('later-concept-with-heading.md');
  assert.match(doc1, /sources: \["notes\/S1-04\/seen-page\.md"\]/);
  assert.match(doc1, /## 나온 곳\n- \[\[notes\/S1-04\/seen-page\]\] — Target Subheading/);

  // 2. headings가 없는 seen 개념 -> 페이지 제목
  const doc2 = docs.get('later-concept-without-heading.md');
  assert.match(doc2, /sources: \["notes\/inbox\/no-heading-page\.md"\]/);
  assert.match(doc2, /## 나온 곳\n- \[\[notes\/inbox\/no-heading-page\]\] — No Heading Page Title/);
});

test('과제 7: 스크랩에 붙은 번역과 메모 출력 형식', () => {
  const pageUrl = 'https://example.com/scrap-memo-trans';
  const data = {
    scraps: {
      scraps: {
        s_both: {
          url: pageUrl,
          title: 'Scrap Test',
          headings: ['Section 1'],
          quote: { exact: 'First quote exact line 1\nline 2' },
          translation: '첫 번째 인용 한국어 번역문',
          memo: '인용에 대한 생각과 메모',
          ts: 1000,
        },
        s_trans_only: {
          url: pageUrl,
          title: 'Scrap Test',
          headings: ['Section 2'],
          quote: { exact: 'Second quote exact' },
          translation: '두 번째 인용 번역만 있음',
          ts: 1100,
        },
        s_memo_only: {
          url: pageUrl,
          title: 'Scrap Test',
          headings: ['Section 3'],
          quote: { exact: 'Third quote exact' },
          memo: '세 번째 인용 메모만 있음',
          ts: 1200,
        },
      },
    },
    memos: [],
    concepts: [],
    words: { saved: {}, phrases: {} },
  };

  const docs = renderNoteDocs(data, {});
  const doc = [...docs.values()][0];

  // 번역 + 메모: 인용 바로 다음 줄에 `> 번역: ...`, 그 다음 빈 줄, 메모 글
  assert.match(
    doc,
    /> First quote exact line 1\n> line 2 \[↗\]\([^)]+\)\n> 번역: 첫 번째 인용 한국어 번역문\n\n인용에 대한 생각과 메모/,
  );

  // 번역만 있음
  assert.match(
    doc,
    /> Second quote exact \[↗\]\([^)]+\)\n> 번역: 두 번째 인용 번역만 있음/,
  );

  // 메모만 있음
  assert.match(
    doc,
    /> Third quote exact \[↗\]\([^)]+\)\n\n세 번째 인용 메모만 있음/,
  );
});
