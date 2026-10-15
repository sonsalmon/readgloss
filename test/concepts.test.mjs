import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createConcepts, parseConceptOp, conceptKey, conceptId } from '../bridge/concepts.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-concepts-test-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dir };
}

test('길이 상한을 넘으면 parseConceptOp는 null', () => {
  const valid = {
    op: 'save',
    name: 'Access Control',
    aliases: ['AC', 'Authorization'],
    definition: '시스템 리소스에 대한 접근 권한을 제어하는 규칙.',
    related: ['Authentication'],
    task: 'S1-04',
    scrapId: '0123456789ab',
  };

  assert.ok(parseConceptOp(valid));

  // name 상한 (1~80자)
  assert.equal(parseConceptOp({ ...valid, name: '' }), null);
  assert.equal(parseConceptOp({ ...valid, name: '   ' }), null);
  assert.equal(parseConceptOp({ ...valid, name: 'a'.repeat(81) }), null);

  // aliases 상한 (0~5개, 각 1~80자)
  assert.equal(parseConceptOp({ ...valid, aliases: ['a', 'b', 'c', 'd', 'e', 'f'] }), null);
  assert.equal(parseConceptOp({ ...valid, aliases: [''] }), null);
  assert.equal(parseConceptOp({ ...valid, aliases: ['a'.repeat(81)] }), null);
  assert.equal(parseConceptOp({ ...valid, aliases: 'not-an-array' }), null);

  // definition 상한 (0~500자, 빈 설명은 나중에 볼 것 — 변경 기록 13)
  assert.equal(parseConceptOp({ ...valid, definition: '' })?.definition, '');
  assert.equal(parseConceptOp({ ...valid, definition: 'd'.repeat(501) }), null);

  // related 상한 (0~10개, 각 1~80자)
  assert.equal(parseConceptOp({ ...valid, related: Array(11).fill('rel') }), null);
  assert.equal(parseConceptOp({ ...valid, related: [''] }), null);
  assert.equal(parseConceptOp({ ...valid, related: ['r'.repeat(81)] }), null);
  assert.equal(parseConceptOp({ ...valid, related: 'not-an-array' }), null);

  // task 형식 (S1-04 등 TASK_RE 만족 또는 null)
  assert.equal(parseConceptOp({ ...valid, task: '../x' }), null);
  assert.equal(parseConceptOp({ ...valid, task: 'S1-4' }), null);
  assert.ok(parseConceptOp({ ...valid, task: null }));

  // scrapId 형식 (12자리 16진수)
  assert.equal(parseConceptOp({ ...valid, scrapId: 'invalid-scrap-id' }), null);
  assert.equal(parseConceptOp({ ...valid, scrapId: '123' }), null);
  assert.ok(parseConceptOp({ ...valid, scrapId: null }));

  // remove 상한 및 형식
  assert.ok(parseConceptOp({ op: 'remove', id: 'c_0123456789ab' }));
  assert.equal(parseConceptOp({ op: 'remove', id: 'invalid-id' }), null);
  assert.equal(parseConceptOp({ op: 'remove' }), null);

  // link 상한 및 형식
  assert.ok(parseConceptOp({ op: 'link', id: 'c_0123456789ab', scrapId: 'abcdef012345' }));
  assert.equal(parseConceptOp({ op: 'link', id: 'c_0123456789ab', scrapId: 'bad' }), null);
  assert.equal(parseConceptOp({ op: 'link', id: 'bad', scrapId: 'abcdef012345' }), null);

  // op 자체가 없음 또는 지원하지 않음
  assert.equal(parseConceptOp(null), null);
  assert.equal(parseConceptOp({}), null);
  assert.equal(parseConceptOp({ op: 'unknown' }), null);
});

test('같은 이름(대소문자·공백 차이)이면 409와 기존 id', () => {
  const { db } = createTempDb();
  const concepts = createConcepts({ db });

  // 1. 처음 생성
  const first = concepts.apply({
    op: 'save',
    name: 'Access Control',
    aliases: ['AC'],
    definition: '접근 통제 정의',
    related: [],
  });
  assert.ok(first);
  assert.ok(first.id);
  assert.equal(first.name, 'Access Control');

  // 2. 소문자 동일 이름으로 새로 생성 시도
  const dupLower = concepts.apply({
    op: 'save',
    name: 'access control',
    aliases: [],
    definition: '다른 정의',
    related: [],
  });
  assert.deepEqual(dupLower, { error: 'exists', id: first.id });

  // 3. 앞뒤 및 중간 공백 차이 이름으로 새로 생성 시도
  const dupWhitespace = concepts.apply({
    op: 'save',
    name: '  Access    Control  ',
    aliases: [],
    definition: '또 다른 정의',
    related: [],
  });
  assert.deepEqual(dupWhitespace, { error: 'exists', id: first.id });

  // 4. 기존 id를 제공하여 수정하는 것은 허용됨
  const updated = concepts.apply({
    op: 'save',
    id: first.id,
    name: 'Access Control',
    aliases: ['AC', '권한 관리'],
    definition: '수정된 정의',
    related: [],
  });
  assert.ok(updated);
  assert.equal(updated.id, first.id);
  assert.deepEqual(updated.aliases, ['AC', '권한 관리']);
  assert.equal(updated.definition, '수정된 정의');

  db.close();
});

test('related는 양쪽에 선이 생긴다. 관련 이름이 없으면 그 이름은 버린다', () => {
  const { db } = createTempDb();
  const concepts = createConcepts({ db });

  // 개념 A와 B 생성
  const a = concepts.apply({
    op: 'save',
    name: 'Concept A',
    definition: 'Definition A',
    related: [],
  });
  const b = concepts.apply({
    op: 'save',
    name: 'Concept B',
    definition: 'Definition B',
    related: [],
  });

  // A에 related로 B와 없는 개념 'Concept NonExistent' 지정
  const aUpdated = concepts.apply({
    op: 'save',
    id: a.id,
    name: 'Concept A',
    definition: 'Definition A',
    related: ['Concept B', 'Concept NonExistent'],
  });

  // 없는 이름은 버려지고 B만 연결됨
  assert.equal(aUpdated.related.length, 1);
  assert.equal(aUpdated.related[0].id, b.id);
  assert.equal(aUpdated.related[0].name, 'Concept B');

  // DB 상의 선 확인: A -> B, B -> A 양방향
  const outA = db.out(a.id, 'related');
  assert.equal(outA.length, 1);
  assert.equal(outA[0].dst, b.id);

  const outB = db.out(b.id, 'related');
  assert.equal(outB.length, 1);
  assert.equal(outB[0].dst, a.id);

  // list() 조회 시 B의 related에도 A가 나와야 함
  const list = concepts.list();
  const itemB = list.find((c) => c.id === b.id);
  assert.equal(itemB.related.length, 1);
  assert.equal(itemB.related[0].id, a.id);
  assert.equal(itemB.related[0].name, 'Concept A');

  // A의 related를 빈 목록으로 고치면 양쪽 선이 모두 지워져야 함
  concepts.apply({
    op: 'save',
    id: a.id,
    name: 'Concept A',
    definition: 'Definition A',
    related: [],
  });
  assert.equal(db.out(a.id, 'related').length, 0);
  assert.equal(db.out(b.id, 'related').length, 0);

  db.close();
});

test('remove는 그 개념의 모든 선을 지운다', () => {
  const { db } = createTempDb();
  const concepts = createConcepts({ db });

  // 1. 스크랩 점과 태스크 점을 직접 DB에 생성
  const scrapId = 'abcdef012345';
  db.put({
    id: scrapId,
    kind: 'scrap',
    key: 'https://example.com',
    data: { id: scrapId, task: 'S1-04', url: 'https://example.com', title: 'Example', quote: { exact: 'Text' } },
  });

  // 2. 개념 A (scrapId, task 연결), 개념 B 생성
  const a = concepts.apply({
    op: 'save',
    name: 'Target Concept',
    definition: 'Will be deleted',
    task: 'S1-04',
    scrapId,
    related: [],
  });

  const b = concepts.apply({
    op: 'save',
    name: 'Other Concept',
    definition: 'Will survive',
    related: ['Target Concept'],
  });

  // 선 연결 확인
  assert.ok(db.out(a.id, 'in_task').length > 0);
  assert.ok(db.out(a.id, 'from_scrap').length > 0);
  assert.ok(db.out(a.id, 'related').length > 0);
  assert.ok(db.out(b.id, 'related').length > 0);

  // 3. 개념 A 삭제
  const removeRes = concepts.apply({ op: 'remove', id: a.id });
  assert.deepEqual(removeRes, { ok: true });

  // 개념 A 노드 삭제 확인
  assert.equal(db.get(a.id), null);

  // 개념 A의 나가는 선 및 들어오는 선 모두 삭제 확인
  assert.equal(db.out(a.id).length, 0);
  assert.equal(db.in(a.id).length, 0);

  // 개념 B에서 A로 가던 related 선도 지워졌는지 확인 (검토 초점 3)
  assert.equal(db.out(b.id, 'related').length, 0);

  db.close();
});

test('terms는 별칭을 포함하고 긴 것이 먼저', () => {
  const { db } = createTempDb();
  const concepts = createConcepts({ db });

  concepts.apply({
    op: 'save',
    name: 'CSRF',
    aliases: ['Cross-Site Request Forgery'],
    definition: 'CSRF 설명',
    related: [],
  });

  concepts.apply({
    op: 'save',
    name: 'XSS',
    aliases: ['Cross-Site Scripting', 'Stored XSS'],
    definition: 'XSS 설명',
    related: [],
  });

  const terms = concepts.terms();
  // 총 5개: 'Cross-Site Request Forgery' (27), 'Cross-Site Scripting' (20), 'Stored XSS' (10), 'CSRF' (4), 'XSS' (3)
  assert.equal(terms.length, 5);

  const termTexts = terms.map((t) => t.term);
  assert.deepEqual(termTexts, [
    'Cross-Site Request Forgery',
    'Cross-Site Scripting',
    'Stored XSS',
    'CSRF',
    'XSS',
  ]);

  db.close();
});

test('appears는 scrapId 선을 따라 할 일 제목까지 준다', () => {
  const { db } = createTempDb();
  const learning = {
    nodes: [
      { id: 'S1-04', card_title: '접근 통제' },
      { id: 'S1-05', card_title: '인증' },
    ],
  };
  const concepts = createConcepts({ db, learning });

  const scrapId = 'abcdef012345';
  db.put({
    id: scrapId,
    kind: 'scrap',
    key: 'https://portswigger.net/web-security/access-control',
    data: {
      id: scrapId,
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control Vulnerabilities',
      headings: ['Introduction'],
      quote: { exact: 'Broken access control is a security risk.' },
      ts: 12345,
    },
  });

  const concept = concepts.apply({
    op: 'save',
    name: 'Access Control',
    definition: '리소스 접근 제어',
    scrapId,
    related: [],
  });

  assert.equal(concept.appears.length, 1);
  const app = concept.appears[0];
  assert.equal(app.scrapId, scrapId);
  assert.equal(app.task, 'S1-04');
  assert.equal(app.taskTitle, '접근 통제');
  assert.equal(app.url, 'https://portswigger.net/web-security/access-control');
  assert.equal(app.title, 'Access Control Vulnerabilities');
  assert.equal(app.exact, 'Broken access control is a security risk.');

  // 처음 생성 시 first* 정보도 채워짐 확인
  assert.equal(concept.firstUrl, 'https://portswigger.net/web-security/access-control');
  assert.equal(concept.firstTitle, 'Access Control Vulnerabilities');
  assert.equal(concept.firstTask, 'S1-04');

  db.close();
});
