import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createConcepts, parseConceptOp } from '../bridge/concepts.mjs';
import { renderConceptDocs, CONCEPT_HEADER_COMMENT } from '../scripts/export-concepts.mjs';
import { writeIfChanged } from '../scripts/export-scraps.mjs';
import { pendingDays, exportPending } from '../scripts/export-pending.mjs';
import { dateOf } from '../scripts/export-day.mjs';

await import('../extension/concept-core.js');
const { splitTerms } = globalThis.readglossConcept;

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-later-test-db-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dir };
}

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'rg-later-test-dir-'));
}

test('bridge: parseConceptOp definition 빈 글(0~500자) 및 seen 유효성 검사', () => {
  const validLater = {
    op: 'save',
    name: 'Privilege Escalation',
    definition: '',
    seen: {
      url: 'https://portswigger.net/web-security/access-control?utm_source=test&id=1#frag',
      title: 'Access Control',
      sentence: 'Users can escalate privileges easily.',
    },
  };

  const parsed = parseConceptOp(validLater);
  assert.ok(parsed);
  assert.equal(parsed.name, 'Privilege Escalation');
  assert.equal(parsed.definition, '');
  assert.ok(parsed.seen);
  // normalizeUrl 적용 확인: #frag 제거, utm_* 제거, 나머지 쿼리 보존
  assert.equal(parsed.seen.url, 'https://portswigger.net/web-security/access-control?id=1');
  assert.equal(parsed.seen.title, 'Access Control');
  assert.equal(parsed.seen.sentence, 'Users can escalate privileges easily.');

  // definition 상한 검사 (500자 이하 허용, 501자 이상 거절)
  assert.ok(parseConceptOp({ ...validLater, definition: 'a'.repeat(500) }));
  assert.equal(parseConceptOp({ ...validLater, definition: 'a'.repeat(501) }), null);

  // seen이 없는 일반 개념 저장도 정상
  const withoutSeen = parseConceptOp({
    op: 'save',
    name: 'Normal Concept',
    definition: '정의 내용',
  });
  assert.ok(withoutSeen);
  assert.equal(withoutSeen.seen, null);

  // seen sentence 상한 (300자)
  assert.ok(parseConceptOp({
    ...validLater,
    seen: { ...validLater.seen, sentence: 's'.repeat(300) },
  }));
  assert.equal(parseConceptOp({
    ...validLater,
    seen: { ...validLater.seen, sentence: 's'.repeat(301) },
  }), null);

  // seen title 상한 (300자)
  assert.ok(parseConceptOp({
    ...validLater,
    seen: { ...validLater.seen, title: 't'.repeat(300) },
  }));
  assert.equal(parseConceptOp({
    ...validLater,
    seen: { ...validLater.seen, title: 't'.repeat(301) },
  }), null);

  // seen url 형식 오류 (http/https 아님 등)
  assert.equal(parseConceptOp({
    ...validLater,
    seen: { ...validLater.seen, url: 'invalid-url' },
  }), null);
  assert.equal(parseConceptOp({
    ...validLater,
    seen: { ...validLater.seen, url: 'javascript:alert(1)' },
  }), null);
});

test('bridge: 빈 설명 저장 200 + later true, 설명 채우기(edit) 뒤 later false, terms()에도 later 포함', () => {
  const { db, dir } = createTempDb();
  try {
    const concepts = createConcepts({ db, now: () => 1760342400000 });

    // 1. 빈 설명으로 저장 -> later: true
    const savedLater = concepts.apply({
      op: 'save',
      name: 'SQL Injection',
      definition: '',
      seen: {
        url: 'https://example.com/sqli',
        title: 'SQLi Lab',
        sentence: 'SQL Injection occurs when user input is concatenated into a database query.',
      },
    });

    assert.ok(savedLater);
    assert.equal(savedLater.definition, '');
    assert.equal(savedLater.later, true);
    assert.deepEqual(savedLater.seen, {
      url: 'https://example.com/sqli',
      title: 'SQLi Lab',
      sentence: 'SQL Injection occurs when user input is concatenated into a database query.',
    });

    // list() 검증: later가 true로 들어있는지 확인
    const list1 = concepts.list();
    const item1 = list1.find((c) => c.id === savedLater.id);
    assert.ok(item1);
    assert.equal(item1.later, true);
    assert.equal(item1.seen?.title, 'SQLi Lab');

    // terms() 검증: terms의 각 항목에 later 포함
    const termList1 = concepts.terms();
    const termItem1 = termList1.find((t) => t.id === savedLater.id);
    assert.ok(termItem1);
    assert.equal(termItem1.term, 'SQL Injection');
    assert.equal(termItem1.later, true);

    // 2. 설명 채우기 (edit with id) -> later: false
    const edited = concepts.apply({
      op: 'save',
      id: savedLater.id,
      name: 'SQL Injection',
      definition: '데이터베이스 질의문에 악의적인 SQL 코드를 삽입하여 실행시키는 취약점.',
    });

    assert.ok(edited);
    assert.equal(edited.id, savedLater.id);
    assert.equal(edited.later, false);
    assert.equal(edited.definition, '데이터베이스 질의문에 악의적인 SQL 코드를 삽입하여 실행시키는 취약점.');
    // 기존 seen 보존 확인
    assert.equal(edited.seen?.title, 'SQLi Lab');

    // list()와 terms() 재확인
    const list2 = concepts.list();
    const item2 = list2.find((c) => c.id === savedLater.id);
    assert.equal(item2.later, false);

    const termList2 = concepts.terms();
    const termItem2 = termList2.find((t) => t.id === savedLater.id);
    assert.equal(termItem2.later, false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concept-core: splitTerms 순수 함수로 defined와 later 분류', () => {
  const terms = [
    { id: 'c1', term: 'Cross-Site Scripting', later: false },
    { id: 'c2', term: 'Server-Side Request Forgery', later: true },
    { id: 'c3', term: 'XSS', later: false },
    { id: 'c4', term: 'SSRF', later: true },
  ];

  const { defined, later } = splitTerms(terms);
  assert.deepEqual(
    defined.map((t) => t.term),
    ['Cross-Site Scripting', 'XSS']
  );
  assert.deepEqual(
    later.map((t) => t.term),
    ['Server-Side Request Forgery', 'SSRF']
  );

  // 빈 배열 처리
  assert.deepEqual(splitTerms([]), { defined: [], later: [] });
  assert.deepEqual(splitTerms(null), { defined: [], later: [] });
});

test('export-concepts: 나중에 볼 것 마크다운 문서 및 나중에-볼-것.md 목록 생성/삭제', () => {
  const dir = createTempDir();
  try {
    const concepts = [
      {
        id: 'c_normal',
        name: 'Normal Concept',
        definition: '설명이 있는 일반 개념 정의입니다.',
        aliases: [],
        related: [],
        appears: [],
        later: false,
        ts: 1760342400000,
      },
      {
        id: 'c_later_1',
        name: 'Later One',
        definition: '',
        aliases: [],
        related: [],
        appears: [],
        seen: {
          url: 'https://example.com/one',
          title: 'First Page',
          sentence: 'This is the first sentence that is quite long and should be trimmed to 120 chars if it exceeds the limit in display but this one is around here.',
        },
        later: true,
        ts: 1760342400000, // 2025-10-13 or similar
      },
      {
        id: 'c_later_2',
        name: 'Later Two',
        definition: '',
        aliases: [],
        related: [],
        appears: [],
        seen: {
          url: 'https://example.com/two',
          title: 'Second Page',
          sentence: 'Short sentence.',
        },
        later: true,
        ts: 1760342500000,
      },
    ];

    const docs = renderConceptDocs(concepts);

    // 1. 개별 문서 확인
    assert.ok(docs.has('normal-concept.md'));
    assert.ok(docs.has('later-one.md'));
    assert.ok(docs.has('later-two.md'));
    assert.ok(docs.has('나중에-볼-것.md'));

    const laterDoc1 = docs.get('later-one.md');
    assert.match(laterDoc1, /# Later One/);
    assert.match(laterDoc1, /\(아직 설명 없음\)/);
    assert.match(laterDoc1, /본 곳: \[First Page\]\(https:\/\/example\.com\/one\) — "This is the first sentence/);

    // 2. 나중에-볼-것.md 목록 확인 (오래된 것 먼저: - <이름> · <본 곳 제목> · <YYYY-MM-DD>)
    const laterListDoc = docs.get('나중에-볼-것.md');
    assert.ok(laterListDoc.startsWith(CONCEPT_HEADER_COMMENT));
    assert.match(laterListDoc, /# 나중에 볼 것/);

    const dateStr1 = dateOf(1760342400000);
    const dateStr2 = dateOf(1760342500000);
    assert.match(laterListDoc, new RegExp(`- Later One · First Page · ${dateStr1}`));
    assert.match(laterListDoc, new RegExp(`- Later Two · Second Page · ${dateStr2}`));

    // writeIfChanged 최초 파일 생성
    writeIfChanged(dir, docs);
    assert.ok(existsSync(join(dir, '나중에-볼-것.md')));

    // 3. 나중에 볼 것이 모두 사라진 경우 -> 나중에-볼-것.md 삭제 확인
    const docsNoLater = renderConceptDocs([concepts[0]]);
    assert.ok(!docsNoLater.has('나중에-볼-것.md'));
    writeIfChanged(dir, docsNoLater);
    assert.ok(!existsSync(join(dir, '나중에-볼-것.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export-pending: 당일 새로 등록된 나중에 볼 것(definition 빈 글)이 있으면 "나중에 볼 것 N개" 출력', () => {
  const dir = createTempDir();
  try {
    const today = '2026-10-13';
    const tToday = new Date('2026-10-13T10:00:00').getTime();

    // words.json 및 scraps.json 초기화
    writeFileSync(join(dir, 'words.json'), JSON.stringify({ v: 1, saved: {}, phrases: {} }));
    writeFileSync(join(dir, 'scraps.json'), JSON.stringify({ v: 1, scraps: {} }));

    // readgloss.db 생성 및 nodes에 later concept 추가
    const dbFile = join(dir, 'readgloss.db');
    const db = openDb(dbFile);
    // meta migrated_at 기록
    db.raw.prepare("INSERT INTO meta (key, value) VALUES ('migrated_at', '2026-10-13T00:00:00.000Z')").run();

    // 1. 오늘 날짜의 later 개념 (definition: '')
    db.put({
      id: 'c_lat1',
      kind: 'concept',
      key: 'later concept 1',
      data: { name: 'Later Concept 1', definition: '', seen: { title: 'T1', url: 'https://ex.com/1', sentence: 'S1' } },
      ts: tToday,
    });
    // 2. 오늘 날짜의 일반 개념 (definition 채워짐)
    db.put({
      id: 'c_norm1',
      kind: 'concept',
      key: 'normal concept',
      data: { name: 'Normal Concept', definition: '설명 있음' },
      ts: tToday,
    });
    // 3. 오늘 날짜의 두 번째 later 개념
    db.put({
      id: 'c_lat2',
      kind: 'concept',
      key: 'later concept 2',
      data: { name: 'Later Concept 2', definition: '', seen: { title: 'T2', url: 'https://ex.com/2', sentence: 'S2' } },
      ts: tToday,
    });
    db.close();

    // pendingDays 확인 (today 포함)
    const days = pendingDays(dir, today);
    assert.ok(days.includes(today));

    // exportPending 출력에 '나중에 볼 것 2개' 포함 확인
    const out = exportPending(dir, today);
    assert.match(out, /### 2026-10-13/);
    assert.match(out, /나중에 볼 것 2개/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
