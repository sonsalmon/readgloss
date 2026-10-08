import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScraps, normalizeUrl, parseScrapOp, scrapId } from '../bridge/scraps.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'rg-scraps-')), 'scraps.json');
const clock = (start = 1000) => {
  let t = start;
  return () => t++;
};
const fresh = (file = tmp(), c = clock()) => ({ file, clock: c, s: createScraps({ file, now: c }) });

test('normalizeUrl: # 뒤 버림, utm_* 쿼리만 지움, 끝 / 뗌', () => {
  assert.equal(normalizeUrl('https://a.com/x/?utm_source=t&q=1#h'), 'https://a.com/x?q=1');
  assert.equal(normalizeUrl('https://a.com/x/'), 'https://a.com/x');
  assert.equal(normalizeUrl('https://a.com/'), 'https://a.com');
  assert.equal(normalizeUrl('https://a.com'), 'https://a.com');
  assert.equal(normalizeUrl('https://a.com/x/?utm_source=a&utm_medium=b'), 'https://a.com/x');
  assert.equal(normalizeUrl('https://a.com/x/y?b=2&a=1'), 'https://a.com/x/y?b=2&a=1');
  assert.equal(normalizeUrl('http://insecure.test/path/'), 'http://insecure.test/path');
  // http(s) 아니거나 문자열 아니면 빈 문자열
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl('file:///etc/passwd'), '');
  assert.equal(normalizeUrl(null), '');
  assert.equal(normalizeUrl(''), '');
});

test('같은 문장 다른 페이지는 다른 id', () => {
  assert.notEqual(scrapId('https://a/1', 's', 'p'), scrapId('https://a/2', 's', 'p'));
  assert.equal(scrapId('https://a/1', 's', 'p'), scrapId('https://a/1', 's', 'p'));
  // URL 정규화 처리 확인
  assert.equal(
    scrapId('https://a.com/x/?utm_source=test#frag', 'sentence', 'prefix'),
    scrapId('https://a.com/x', 'sentence', 'prefix'),
  );
  // sha1 앞 12자 형식
  assert.match(scrapId('https://a.com', 'exact', 'pre'), /^[0-9a-f]{12}$/);
});

test('상한 넘으면 parseScrapOp null', () => {
  const base = {
    op: 'save',
    task: 'S1-04',
    url: 'https://portswigger.net/web-security/access-control',
    title: 'Access Control',
    headings: ['H1', 'H2', 'H3'],
    quote: { exact: 'A test quote.', prefix: 'before ', suffix: ' after' },
    pos: 10,
    translation: '접근 통제 시험 문장',
    memo: '메모',
  };

  assert.ok(parseScrapOp(base));

  // exact 1001자 -> null, exact 0자 -> null
  assert.equal(parseScrapOp({ ...base, quote: { ...base.quote, exact: 'a'.repeat(1001) } }), null);
  assert.equal(parseScrapOp({ ...base, quote: { ...base.quote, exact: '' } }), null);

  // task 형식 틀림 (S1-4 -> null)
  assert.equal(parseScrapOp({ ...base, task: 'S1-4' }), null);
  assert.equal(parseScrapOp({ ...base, task: 'S01-01' }), null);
  assert.equal(parseScrapOp({ ...base, task: 'invalid' }), null);

  // headings 4개 -> null, headings 각 항목 201자 -> null
  assert.equal(parseScrapOp({ ...base, headings: ['1', '2', '3', '4'] }), null);
  assert.equal(parseScrapOp({ ...base, headings: ['a'.repeat(201)] }), null);

  // prefix / suffix 65자 -> null
  assert.equal(parseScrapOp({ ...base, quote: { ...base.quote, prefix: 'p'.repeat(65) } }), null);
  assert.equal(parseScrapOp({ ...base, quote: { ...base.quote, suffix: 's'.repeat(65) } }), null);

  // title 301자 -> null, url 2001자 -> null, translation 2001자 -> null, memo 1001자 -> null
  assert.equal(parseScrapOp({ ...base, title: 't'.repeat(301) }), null);
  assert.equal(parseScrapOp({ ...base, url: `https://a.test/${'u'.repeat(2000)}` }), null);
  assert.equal(parseScrapOp({ ...base, translation: 'tr'.repeat(1001) }), null);
  assert.equal(parseScrapOp({ ...base, memo: 'm'.repeat(1001) }), null);

  // Task 1에서는 guess op 아직 없음 -> null
  assert.equal(parseScrapOp({ op: 'guess', url: 'https://a.com' }), null);
  assert.equal(parseScrapOp(null), null);
  assert.equal(parseScrapOp({ op: 'unknown' }), null);
});

test('task null 허용(인박스)', () => {
  const op = parseScrapOp({
    op: 'save',
    task: null,
    url: 'https://portswigger.net/web-security/access-control',
    quote: { exact: 'Inbox scrap' },
  });
  assert.ok(op);
  assert.equal(op.task, null);

  const moveOp = parseScrapOp({ op: 'move', id: '0123456789ab', task: null });
  assert.ok(moveOp);
  assert.equal(moveOp.task, null);

  const moveInboxOp = parseScrapOp({ op: 'move', id: '0123456789ab', task: 'inbox' });
  assert.ok(moveInboxOp);
  assert.equal(moveInboxOp.task, null);
});

test('save 두 번이면 memo·ts 유지', () => {
  const c = clock(1000);
  const { s } = fresh(undefined, c);

  const op1 = parseScrapOp({
    op: 'save',
    task: 'S1-04',
    url: 'https://portswigger.net/web-security/access-control',
    title: 'Old Title',
    headings: ['H1'],
    quote: { exact: 'Target quote', prefix: 'pre', suffix: 'suf' },
    pos: 100,
    translation: '첫 번역',
    memo: '첫 메모',
  });
  const res1 = s.apply(op1);
  assert.equal(res1.length, 1);
  const item1 = res1[0];
  assert.equal(item1.ts, 1000);
  assert.equal(item1.memo, '첫 메모');
  assert.equal(item1.title, 'Old Title');

  // 시간 경과 후 다시 save (새 title, translation, memo='다른 메모')
  c(); // 1001
  c(); // 1002
  const op2 = parseScrapOp({
    op: 'save',
    task: 'S1-05',
    url: 'https://portswigger.net/web-security/access-control',
    title: 'New Title',
    headings: ['H2'],
    quote: { exact: 'Target quote', prefix: 'pre', suffix: 'suf' },
    pos: 200,
    translation: '새 번역',
    memo: '다른 메모',
  });
  const res2 = s.apply(op2);
  assert.equal(res2.length, 1);
  const item2 = res2[0];
  // id, ts, memo 는 유지되고 나머지는 새 값으로 갱신됨
  assert.equal(item2.id, item1.id);
  assert.equal(item2.ts, 1000);
  assert.equal(item2.memo, '첫 메모');
  assert.equal(item2.title, 'New Title');
  assert.equal(item2.task, 'S1-05');
  assert.equal(item2.translation, '새 번역');
});

test('깨진 파일은 .bad-<ts>로 보존하고 빈 목록', () => {
  const file = tmp();
  writeFileSync(file, '{not valid json');
  const s = createScraps({ file, now: () => 1791443400000 });
  assert.deepEqual(s.all(), []);
  assert.equal(existsSync(file), false);
  const badFile = `${file}.bad-1791443400000`;
  assert.equal(existsSync(badFile), true);
  assert.equal(readFileSync(badFile, 'utf8'), '{not valid json');
});

test('move/memo 없는 id → null', () => {
  const { s } = fresh();
  assert.equal(s.apply({ op: 'move', id: '000000000000', task: 'S1-01' }), null);
  assert.equal(s.apply({ op: 'memo', id: '000000000000', memo: '메모' }), null);
  assert.equal(s.apply({ op: 'remove', id: '000000000000' }), null);
});

test('createScraps: forUrl, remove, move, memo 정상 동작과 영속성', () => {
  const { file, s } = fresh();
  const url1 = 'https://portswigger.net/web-security/access-control';
  const url2 = 'https://portswigger.net/web-security/authentication';

  const op1 = parseScrapOp({
    op: 'save',
    task: 'S1-04',
    url: url1,
    title: 'AC',
    headings: ['H1'],
    quote: { exact: 'Quote 1', prefix: 'p1', suffix: 's1' },
  });
  const op2 = parseScrapOp({
    op: 'save',
    task: 'S1-04',
    url: url1,
    title: 'AC',
    headings: ['H2'],
    quote: { exact: 'Quote 2', prefix: 'p2', suffix: 's2' },
  });
  const op3 = parseScrapOp({
    op: 'save',
    task: 'S1-03',
    url: url2,
    title: 'Auth',
    headings: ['H3'],
    quote: { exact: 'Quote 3', prefix: 'p3', suffix: 's3' },
  });

  s.apply(op1);
  s.apply(op2);
  s.apply(op3);

  assert.equal(s.all().length, 3);
  assert.equal(s.forUrl(url1).length, 2);
  assert.equal(s.forUrl(url2).length, 1);
  assert.equal(s.forUrl('https://other.com').length, 0);

  const id1 = s.forUrl(url1)[0].id;
  // memo 수정
  s.apply({ op: 'memo', id: id1, memo: '수정된 메모' });
  assert.equal(s.forUrl(url1).find((x) => x.id === id1).memo, '수정된 메모');

  // move 로 task 변경
  s.apply({ op: 'move', id: id1, task: 'S1-99' });
  assert.equal(s.forUrl(url1).find((x) => x.id === id1).task, 'S1-99');

  // remove 삭제
  s.apply({ op: 'remove', id: id1 });
  assert.equal(s.all().length, 2);
  assert.equal(s.forUrl(url1).length, 1);

  // 새로 열어도 파일 내용 복원 확인 및 임시 파일 없음
  const reloaded = createScraps({ file });
  assert.deepEqual(reloaded.all(), s.all());
  assert.deepEqual(readdirSync(join(file, '..')).filter((f) => f.endsWith('.tmp')), []);
});
