import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createConcepts, parseConceptOp } from '../bridge/concepts.mjs';
import { renderConceptDocs, CONCEPT_HEADER_COMMENT } from '../scripts/export-concepts.mjs';
import { writeIfChanged } from '../scripts/export-scraps.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-concept-tags-db-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dir };
}

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'rg-concept-tags-dir-'));
}

test('parseConceptOp tags 검증: 1~20자 공백 정리, 5개 이하, 중복 제거, 형식 틀리면 null', () => {
  const valid = {
    op: 'save',
    name: 'Access Control',
    definition: '시스템 자원에 대한 접근 권한 제어',
  };

  // 1. 정상 파싱: tags 배열
  const parsed1 = parseConceptOp({ ...valid, tags: ['다시 보기', '글감 후보'] });
  assert.ok(parsed1);
  assert.deepEqual(parsed1.tags, ['다시 보기', '글감 후보']);

  // 2. 공백 정리 및 중복 제거
  const parsed2 = parseConceptOp({ ...valid, tags: ['  보안   개념  ', '보안 개념', '  글감  '] });
  assert.ok(parsed2);
  assert.deepEqual(parsed2.tags, ['보안 개념', '글감']);

  // 3. 5개 이하 허용 (경계값 5개)
  const parsed3 = parseConceptOp({ ...valid, tags: ['t1', 't2', 't3', 't4', 't5'] });
  assert.ok(parsed3);
  assert.equal(parsed3.tags.length, 5);

  // 4. tags 미지정 시 빈 배열
  const parsed4 = parseConceptOp(valid);
  assert.ok(parsed4);
  assert.deepEqual(parsed4.tags, []);

  // 5. 형식 틀리면 null: 배열 아님
  assert.equal(parseConceptOp({ ...valid, tags: '문자열' }), null);
  assert.equal(parseConceptOp({ ...valid, tags: 123 }), null);
  assert.equal(parseConceptOp({ ...valid, tags: null }), null);
  assert.equal(parseConceptOp({ ...valid, tags: {} }), null);

  // 6. 형식 틀리면 null: 원소 유효성 (문자열 아님, 빈 문자열, 공백만, 20자 초과)
  assert.equal(parseConceptOp({ ...valid, tags: [123] }), null);
  assert.equal(parseConceptOp({ ...valid, tags: [''] }), null);
  assert.equal(parseConceptOp({ ...valid, tags: ['   '] }), null);
  assert.equal(parseConceptOp({ ...valid, tags: ['a'.repeat(21)] }), null);
  assert.equal(parseConceptOp({ ...valid, tags: [' ' + 'a'.repeat(21) + ' '] }), null);

  // 7. 형식 틀리면 null: 5개 초과
  assert.equal(parseConceptOp({ ...valid, tags: ['1', '2', '3', '4', '5', '6'] }), null);
});

test('저장 및 list에 tags가 들어가고, 고치기에서 tags가 교체된다', () => {
  const { db, dir } = createTempDb();
  try {
    const concepts = createConcepts({ db });

    // 1. tags를 포함하여 새로 저장
    const saved = concepts.apply({
      op: 'save',
      name: 'XSS',
      tags: ['다시 보기', '헷갈림'],
      definition: '크로스 사이트 스크립팅',
    });
    assert.ok(saved);
    assert.deepEqual(saved.tags, ['다시 보기', '헷갈림']);

    // list()에서 확인
    const list1 = concepts.list();
    const xss1 = list1.find((c) => c.name === 'XSS');
    assert.ok(xss1);
    assert.deepEqual(xss1.tags, ['다시 보기', '헷갈림']);

    // 2. 고치기에서 tags 교체 (기존 tags와 병합되지 않고 통째로 바뀜)
    const updated = concepts.apply({
      op: 'save',
      id: saved.id,
      name: 'XSS',
      tags: ['글감 후보'],
      definition: '크로스 사이트 스크립팅 공격 기법',
    });
    assert.ok(updated);
    assert.deepEqual(updated.tags, ['글감 후보']);

    // list()에서 교체 확인
    const list2 = concepts.list();
    const xss2 = list2.find((c) => c.id === saved.id);
    assert.ok(xss2);
    assert.deepEqual(xss2.tags, ['글감 후보']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export 개념 문서에 tags: [..] 줄이 들어가고 없는 개념은 줄이 없다', () => {
  const concepts = [
    {
      id: 'c_01',
      name: 'Access Control',
      tags: ['다시 보기', '글감 후보'],
      definition: '- 자원 접근 권한 통제',
    },
    {
      id: 'c_02',
      name: 'SQL Injection',
      tags: [],
      definition: '- SQL 쿼리 조작 취약점',
    },
  ];

  const docs = renderConceptDocs(concepts);
  const acDoc = docs.get('access-control.md');
  const sqlDoc = docs.get('sql-injection.md');

  assert.ok(acDoc);
  assert.ok(acDoc.includes('\ntags: ["다시 보기", "글감 후보"]\n')); // 16-5: 앞머리로 옮김

  assert.ok(sqlDoc);
  assert.ok(sqlDoc.includes('\ntags: []\n')); // 앞머리에는 빈 목록
});

test('글감-후보.md: 글감 후보 태그 개념만 목록에 들어가고, 없으면 파일이 없다(있던 자동 생성 파일이면 지움)', () => {
  const dir = createTempDir();
  try {
    const fixedTs = new Date('2026-10-15T09:00:00Z').getTime();

    // 1. 글감 후보 개념 1개, 일반 개념 1개
    const concepts = [
      {
        id: 'c_01',
        name: 'CSRF',
        tags: ['글감 후보'],
        definition: '- 사이트 간 요청 위조\n- 피해자 권한으로 요청 실행',
        ts: fixedTs,
      },
      {
        id: 'c_02',
        name: 'Insecure Deserialization',
        tags: ['글감 후보'],
        definition: '', // 나중에 볼 것 (설명 없음)
        ts: fixedTs,
      },
      {
        id: 'c_03',
        name: 'Buffer Overflow',
        tags: ['다시 보기'],
        definition: '- 버퍼 경계 침범',
        ts: fixedTs,
      },
    ];

    const docs = renderConceptDocs(concepts);
    assert.ok(docs.has('글감-후보.md'));

    const content = docs.get('글감-후보.md');
    // 헤더 주석
    assert.ok(content.startsWith(CONCEPT_HEADER_COMMENT));
    // 글감 후보 태그를 가진 2개만 포함됨
    assert.ok(content.includes('- CSRF · 사이트 간 요청 위조 · 2026-10-15'));
    assert.ok(content.includes('- Insecure Deserialization · (아직 설명 없음) · 2026-10-15'));
    // 글감 후보 태그가 없는 Buffer Overflow는 목록에 없음
    assert.ok(!content.includes('Buffer Overflow'));

    // 디스크에 저장
    const res1 = writeIfChanged(dir, docs);
    assert.ok(existsSync(join(dir, '글감-후보.md')));

    // 2. 글감 후보 태그가 모두 사라진 상태
    const noCandidates = [
      {
        id: 'c_01',
        name: 'CSRF',
        tags: ['다시 보기'], // 글감 후보 제외
        definition: '- 사이트 간 요청 위조',
        ts: fixedTs,
      },
    ];

    const docs2 = renderConceptDocs(noCandidates);
    // 글감 후보가 없으면 파일 목록에 없음
    assert.equal(docs2.has('글감-후보.md'), false);

    // writeIfChanged를 실행하면 있던 자동 생성 글감-후보.md 파일이 지워져야 함
    const res2 = writeIfChanged(dir, docs2);
    assert.ok(res2.removed.includes('글감-후보.md'));
    assert.equal(existsSync(join(dir, '글감-후보.md')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
