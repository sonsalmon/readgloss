import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp, MEMO_ID_RE } from '../bridge/memos.mjs';

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-memos-test-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dir };
}

test('parseMemoOp 상한 및 형식 검사', () => {
  const valid = {
    op: 'save',
    text: '단축키로 메모를 남긴다.',
    url: 'https://portswigger.net/web-security/access-control',
    title: 'Access Control',
    headings: ['Web Security', 'Access Control'],
    para: {
      exact: 'Broken access control is a vulnerability.',
      prefix: 'Intro: ',
      suffix: '...',
    },
    pos: 120,
    selection: 'selected text',
    task: 'S1-04',
  };

  // 정상 동작
  const parsed = parseMemoOp(valid);
  assert.ok(parsed);
  assert.equal(parsed.op, 'save');
  assert.equal(parsed.text, valid.text);
  assert.equal(parsed.url, valid.url);
  assert.equal(parsed.title, valid.title);
  assert.deepEqual(parsed.headings, valid.headings);
  assert.deepEqual(parsed.para, valid.para);
  assert.equal(parsed.pos, 120);
  assert.equal(parsed.selection, 'selected text');
  assert.equal(parsed.task, 'S1-04');

  // 1. text 상한: 1~2000자
  assert.equal(parseMemoOp({ ...valid, text: '' }), null);
  assert.equal(parseMemoOp({ ...valid, text: 'a'.repeat(2001) }), null);
  assert.ok(parseMemoOp({ ...valid, text: 'a' }));
  assert.ok(parseMemoOp({ ...valid, text: 'a'.repeat(2000) }));
  assert.equal(parseMemoOp({ ...valid, text: 123 }), null);

  // 2. headings 상한: <=3개, 각 <=200자
  assert.equal(parseMemoOp({ ...valid, headings: ['a', 'b', 'c', 'd'] }), null);
  assert.equal(parseMemoOp({ ...valid, headings: ['a'.repeat(201)] }), null);
  assert.ok(parseMemoOp({ ...valid, headings: [] }));
  assert.ok(parseMemoOp({ ...valid, headings: null }));
  assert.ok(parseMemoOp({ ...valid, headings: ['a'.repeat(200)] }));

  // 3. para 상한: exact <=300, prefix <=64, suffix <=64
  assert.ok(parseMemoOp({ ...valid, para: null }));
  assert.equal(parseMemoOp({ ...valid, para: { exact: 'a'.repeat(301), prefix: '', suffix: '' } }), null);
  assert.equal(parseMemoOp({ ...valid, para: { exact: 'abc', prefix: 'a'.repeat(65), suffix: '' } }), null);
  assert.equal(parseMemoOp({ ...valid, para: { exact: 'abc', prefix: '', suffix: 'a'.repeat(65) } }), null);
  assert.ok(parseMemoOp({ ...valid, para: { exact: 'a'.repeat(300), prefix: 'a'.repeat(64), suffix: 'a'.repeat(64) } }));

  // 4. selection 상한: <=1000자
  assert.equal(parseMemoOp({ ...valid, selection: 'a'.repeat(1001) }), null);
  assert.ok(parseMemoOp({ ...valid, selection: 'a'.repeat(1000) }));
  assert.ok(parseMemoOp({ ...valid, selection: null }));

  // 5. title 상한: <=300자
  assert.equal(parseMemoOp({ ...valid, title: 'a'.repeat(301) }), null);
  assert.ok(parseMemoOp({ ...valid, title: 'a'.repeat(300) }));
  assert.ok(parseMemoOp({ ...valid, title: null }));

  // 6. url 상한: <=2000자, normalizeUrl 유효성
  assert.equal(parseMemoOp({ ...valid, url: 'a'.repeat(2001) }), null);
  assert.equal(parseMemoOp({ ...valid, url: 'not-a-valid-url' }), null);
  assert.equal(parseMemoOp({ ...valid, url: '' }), null);

  // 7. task 형식: TASK_RE 만족 또는 null
  assert.equal(parseMemoOp({ ...valid, task: '../x' }), null);
  assert.equal(parseMemoOp({ ...valid, task: 'S1-4' }), null);
  assert.ok(parseMemoOp({ ...valid, task: 'S1-04' }));
  assert.ok(parseMemoOp({ ...valid, task: 'BUF-01' }));
  assert.ok(parseMemoOp({ ...valid, task: null }));

  // 8. edit 상한 및 형식
  assert.ok(parseMemoOp({ op: 'edit', id: 'm_0123456789ab', text: '수정된 내용' }));
  assert.equal(parseMemoOp({ op: 'edit', id: 'm_0123456789ab', text: '' }), null);
  assert.equal(parseMemoOp({ op: 'edit', id: 'm_0123456789ab', text: 'a'.repeat(2001) }), null);
  assert.equal(parseMemoOp({ op: 'edit', id: 'invalid-id', text: '내용' }), null);
  assert.equal(parseMemoOp({ op: 'edit', id: 'm_0123456789ab' }), null);

  // 9. remove 상한 및 형식
  assert.ok(parseMemoOp({ op: 'remove', id: 'm_0123456789ab' }));
  assert.equal(parseMemoOp({ op: 'remove', id: 'invalid-id' }), null);
  assert.equal(parseMemoOp({ op: 'remove' }), null);

  // 알 수 없는 op 또는 객체 아님
  assert.equal(parseMemoOp(null), null);
  assert.equal(parseMemoOp({}), null);
  assert.equal(parseMemoOp({ op: 'other' }), null);
});

test('save → GET ?url= 에 1건, GET 은 최근 것 먼저, task 있으면 in_task 선', () => {
  const { db } = createTempDb();
  let currentTime = 1000;
  const memos = createMemos({ db, now: () => currentTime });

  // 1. 첫 메모 저장 (task 있음)
  const saved1 = memos.apply({
    op: 'save',
    text: '첫 번째 메모',
    url: 'https://example.com/page1',
    title: 'Page 1',
    headings: ['Intro'],
    para: null,
    pos: 0,
    selection: null,
    task: 'S1-04',
  });

  assert.ok(saved1);
  assert.ok(MEMO_ID_RE.test(saved1.id));
  assert.equal(saved1.text, '첫 번째 메모');
  assert.equal(saved1.url, 'https://example.com/page1');
  assert.equal(saved1.ts, 1000);
  assert.equal(saved1.task, 'S1-04');

  // in_task 선 확인
  const edges = db.out(saved1.id, 'in_task');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].dst, 'task:S1-04');
  assert.ok(db.get('task:S1-04'));

  // 2. 두 번째 메모 저장 (같은 페이지, task 없음, 시간 경과)
  currentTime = 2000;
  const saved2 = memos.apply({
    op: 'save',
    text: '두 번째 메모',
    url: 'https://example.com/page1#section2', // 해시는 정규화되어 같은 url
    title: 'Page 1',
    headings: ['Section 2'],
    para: null,
    pos: 10,
    selection: null,
    task: null,
  });

  assert.ok(saved2);
  assert.equal(saved2.ts, 2000);
  assert.equal(db.out(saved2.id, 'in_task').length, 0);

  // 3. 다른 페이지 메모 저장
  currentTime = 3000;
  const saved3 = memos.apply({
    op: 'save',
    text: '다른 페이지 메모',
    url: 'https://example.com/page2',
    title: 'Page 2',
    headings: [],
    para: null,
    pos: 0,
    selection: null,
    task: null,
  });

  // forUrl 확인: page1 에는 2건, page2 에는 1건
  const forPage1 = memos.forUrl('https://example.com/page1');
  assert.equal(forPage1.length, 2);
  // forUrl 도 최근 것 먼저 정렬
  assert.equal(forPage1[0].id, saved2.id);
  assert.equal(forPage1[1].id, saved1.id);

  const forPage2 = memos.forUrl('https://example.com/page2');
  assert.equal(forPage2.length, 1);
  assert.equal(forPage2[0].id, saved3.id);

  // list() 확인: 전체 3건, 최근 것 먼저 (saved3, saved2, saved1)
  const list = memos.list();
  assert.equal(list.length, 3);
  assert.equal(list[0].id, saved3.id);
  assert.equal(list[1].id, saved2.id);
  assert.equal(list[2].id, saved1.id);

  db.close();
});

test('edit(text만 바뀜, ts 유지) · remove(선까지 삭제) · 없는 id 처리', () => {
  const { db } = createTempDb();
  let currentTime = 5000;
  const memos = createMemos({ db, now: () => currentTime });

  const initial = memos.apply({
    op: 'save',
    text: '원래 텍스트',
    url: 'https://example.com/item',
    title: '제목',
    headings: ['헤딩'],
    para: { exact: '앞 300자', prefix: 'p', suffix: 's' },
    pos: 50,
    selection: 'sel',
    task: 'S1-04',
  });

  assert.ok(initial);
  assert.equal(initial.text, '원래 텍스트');
  assert.equal(initial.ts, 5000);
  assert.equal(db.out(initial.id, 'in_task').length, 1);

  // 시간이 지난 후 edit 수행
  currentTime = 9000;
  const edited = memos.apply({
    op: 'edit',
    id: initial.id,
    text: '바뀐 텍스트',
  });

  assert.ok(edited);
  assert.equal(edited.id, initial.id);
  assert.equal(edited.text, '바뀐 텍스트');
  // ts 유지 확인
  assert.equal(edited.ts, 5000);
  // 다른 필드 유지 확인
  assert.equal(edited.url, 'https://example.com/item');
  assert.equal(edited.title, '제목');
  assert.deepEqual(edited.headings, ['헤딩']);
  assert.deepEqual(edited.para, { exact: '앞 300자', prefix: 'p', suffix: 's' });
  assert.equal(edited.pos, 50);
  assert.equal(edited.selection, 'sel');
  assert.equal(edited.task, 'S1-04');

  // 없는 id edit -> null
  const editNotFound = memos.apply({
    op: 'edit',
    id: 'm_000000000000',
    text: '없는 id',
  });
  assert.equal(editNotFound, null);

  // remove 수행
  const removed = memos.apply({
    op: 'remove',
    id: initial.id,
  });
  assert.deepEqual(removed, { ok: true });

  // 점 및 선 삭제 확인
  assert.equal(db.get(initial.id), null);
  assert.equal(db.out(initial.id).length, 0);
  assert.equal(db.in(initial.id).length, 0);
  assert.equal(memos.list().length, 0);

  // 없는 id remove -> null
  const removeNotFound = memos.apply({
    op: 'remove',
    id: 'm_000000000000',
  });
  assert.equal(removeNotFound, null);

  db.close();
});
