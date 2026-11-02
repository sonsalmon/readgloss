// test/t60a-marks.test.mjs
// 티켓 T60a: 메모·스크랩 표시(mark)·태그 저장, 하루치 내보내기·학습노트 모아 보기 (변경 기록 29-5·29-6)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createMemos, parseMemoOp } from '../bridge/memos.mjs';
import { createScraps, parseScrapOp } from '../bridge/scraps.mjs';
import { createBridge } from '../bridge/server.mjs';
import { loadNotesData } from '../scripts/data-source.mjs';
import { exportDay } from '../scripts/export-day.mjs';
import { renderNoteDocs } from '../scripts/export-notes.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const HOST = '127.0.0.1:47831';
const FIXTURES_DIR = join(new URL('..', import.meta.url).pathname, 'fixtures', 'learning');
const ID = 'm_0123456789ab';
const DAY = new Date(2026, 10, 2, 10, 0, 0).getTime(); // 로컬 2026-11-02

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t60a-'));
  const db = openDb(join(dir, 'readgloss.db'));
  db.raw.prepare("INSERT INTO meta (key, value) VALUES ('migrated_at', '2026-11-02')").run();
  return { dir, db };
}

// ---- 메모 파싱 ----

test('parseMemoOp save: mark·tags 를 받고, 형식이 틀리면 null', () => {
  const base = { op: 'save', text: '메모', url: 'https://example.com/a' };

  const op = parseMemoOp({ ...base, mark: 'question', tags: ['보안', '다시보기'] });
  assert.equal(op.mark, 'question');
  assert.deepEqual(op.tags, ['보안', '다시보기']);

  // 선택 칸이 없으면 표시 없음·빈 태그
  const plain = parseMemoOp(base);
  assert.equal(plain.mark, null);
  assert.deepEqual(plain.tags, []);

  // null 은 표시 없음
  assert.equal(parseMemoOp({ ...base, mark: null }).mark, null);

  // 그 밖의 표시는 400
  assert.equal(parseMemoOp({ ...base, mark: 'later' }), null);
  assert.equal(parseMemoOp({ ...base, mark: 1 }), null);

  // 태그: 5개까지, 각 1~20자, 공백·# 없음
  assert.ok(parseMemoOp({ ...base, tags: ['a', 'b', 'c', 'd', 'e'] }));
  assert.equal(parseMemoOp({ ...base, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), null);
  assert.equal(parseMemoOp({ ...base, tags: ['a'.repeat(21)] }), null);
  assert.equal(parseMemoOp({ ...base, tags: [''] }), null);
  assert.equal(parseMemoOp({ ...base, tags: ['a b'] }), null);
  assert.equal(parseMemoOp({ ...base, tags: ['#a'] }), null);
  assert.equal(parseMemoOp({ ...base, tags: [1] }), null);
  assert.equal(parseMemoOp({ ...base, tags: 'a' }), null);
});

test('parseMemoOp edit: mark 가 없으면 유지, null 이면 지움. tags 도 없으면 유지', () => {
  const base = { op: 'edit', id: ID, text: '고친 메모' };

  const keep = parseMemoOp(base);
  assert.ok(!('mark' in keep));
  assert.ok(!('tags' in keep));

  const clear = parseMemoOp({ ...base, mark: null });
  assert.equal(clear.mark, null);

  const set = parseMemoOp({ ...base, mark: 'insight', tags: ['새태그'] });
  assert.equal(set.mark, 'insight');
  assert.deepEqual(set.tags, ['새태그']);

  assert.equal(parseMemoOp({ ...base, mark: 'bad' }), null);
  assert.equal(parseMemoOp({ ...base, tags: ['a'.repeat(21)] }), null);
});

// ---- 메모 저장·조회 ----

test('메모 저장·수정·목록: mark·tags 가 남고 없으면 null·[]', () => {
  const { dir, db } = tempDb();
  let tick = 1000;
  const memos = createMemos({ db, now: () => tick++ });
  try {
    const saved = memos.apply(parseMemoOp({
      op: 'save',
      text: '서버가 권한을 확인해야 함',
      url: 'https://example.com/a',
      title: 'Page A',
      mark: 'question',
      tags: ['보안'],
    }));
    assert.equal(saved.mark, 'question');
    assert.deepEqual(saved.tags, ['보안']);

    const plain = memos.apply(parseMemoOp({
      op: 'save',
      text: '표시 없는 메모',
      url: 'https://example.com/a',
    }));
    assert.equal(plain.mark, null);
    assert.deepEqual(plain.tags, []);

    // edit: mark 없음 -> 유지, tags 없음 -> 유지
    const kept = memos.apply(parseMemoOp({ op: 'edit', id: saved.id, text: '고침' }));
    assert.equal(kept.mark, 'question');
    assert.deepEqual(kept.tags, ['보안']);

    // edit: mark null -> 지움, tags 새 값 -> 교체
    const cleared = memos.apply(parseMemoOp({ op: 'edit', id: saved.id, text: '고침', mark: null, tags: ['새태그', '둘'] }));
    assert.equal(cleared.mark, null);
    assert.deepEqual(cleared.tags, ['새태그', '둘']);

    const listed = memos.list();
    assert.equal(listed.length, 2);
    for (const m of listed) {
      assert.ok('mark' in m);
      assert.ok(Array.isArray(m.tags));
    }
    const forUrl = memos.forUrl('https://example.com/a');
    assert.equal(forUrl.length, 2);
    assert.equal(forUrl.find((m) => m.id === saved.id).mark, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 스크랩 파싱·저장 ----

test('parseScrapOp: save 의 mark 와 새 op mark, 형식이 틀리면 null', () => {
  const base = { op: 'save', url: 'https://example.com/a', quote: { exact: '인용' } };

  assert.equal(parseScrapOp({ ...base, mark: 'insight' }).mark, 'insight');
  assert.equal(parseScrapOp({ ...base, mark: null }).mark, null);
  assert.ok(!('mark' in parseScrapOp(base)));
  assert.equal(parseScrapOp({ ...base, mark: 'bad' }), null);

  const id = '0123456789ab';
  assert.deepEqual(parseScrapOp({ op: 'mark', id, mark: null }), { op: 'mark', id, mark: null });
  assert.equal(parseScrapOp({ op: 'mark', id, mark: 'question' }).mark, 'question');
  assert.equal(parseScrapOp({ op: 'mark', id, mark: 'bad' }), null);
  assert.equal(parseScrapOp({ op: 'mark', id, mark: undefined }), null);
  assert.equal(parseScrapOp({ op: 'mark', id: 'nope', mark: null }), null);
});

test('스크랩 저장·표시 변경: GET 각 스크랩에 mark(없으면 null), 없는 id 는 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t60a-scraps-'));
  const file = join(dir, 'scraps.json');
  try {
    const scraps = createScraps({ file, now: () => 1000 });
    const saved = scraps.apply(parseScrapOp({
      op: 'save',
      url: 'https://example.com/a',
      quote: { exact: '인용' },
      mark: 'question',
    }));
    assert.equal(saved[0].mark, 'question');
    const id = saved[0].id;

    const plain = scraps.apply(parseScrapOp({
      op: 'save',
      url: 'https://example.com/a',
      quote: { exact: '표시 없음' },
    }));
    assert.equal(plain.find((s) => s.quote.exact === '표시 없음').mark, null);

    const marked = scraps.apply(parseScrapOp({ op: 'mark', id, mark: null }));
    assert.equal(marked.find((s) => s.id === id).mark, null);
    assert.equal(scraps.all().find((s) => s.id === id).mark, null);

    assert.equal(scraps.apply(parseScrapOp({ op: 'mark', id: '000000000000', mark: null })), null);

    // 파일에서 다시 읽어도 표시가 남는다
    const again = createScraps({ file, now: () => 2000 });
    assert.equal(again.all().find((s) => s.id === id).mark, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('다리 /scraps op mark 는 200, GET 에 mark 가 실린다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t60a-srv-'));
  const bridge = createBridge({
    ask: async () => '{}',
    askTranslate: async () => '{}',
    askContext: async () => '{}',
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    learningDir: FIXTURES_DIR,
    extensionId: EXT,
    dict: { lookup: async () => ({ found: false }), close: () => {} },
    mt: { translate: async () => '', close: () => {} },
  });
  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');
  const req = (method, path, body) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, 'X-Bridge-Token': token, Origin: `chrome-extension://${EXT}` } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(t) }));
        },
      );
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });

  try {
    const saved = await req('POST', '/scraps', {
      op: 'save',
      url: 'https://example.com/a',
      quote: { exact: '인용' },
      mark: 'question',
    });
    assert.equal(saved.status, 200);
    const id = saved.json().scrap.id;
    assert.equal(saved.json().scrap.mark, 'question');

    const marked = await req('POST', '/scraps', { op: 'mark', id, mark: null });
    assert.equal(marked.status, 200);
    assert.equal(marked.json().scraps.find((s) => s.id === id).mark, null);

    const got = await req('GET', '/scraps');
    assert.equal(got.json().scraps.find((s) => s.id === id).mark, null);

    assert.equal((await req('POST', '/scraps', { op: 'mark', id: '000000000000', mark: null })).status, 404);
  } finally {
    await bridge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 하루치 내보내기 ----

function seedMemos(db) {
  const put = (id, data, ts) => db.put({ id, kind: 'memo', key: data.url, data: { id, ...data }, ts });
  put('m_000000000001', {
    url: 'https://example.com/a',
    title: 'Page A',
    text: '서버 권한 확인 #다시보기 #보안',
    quote: { exact: 'first line\nsecond line' },
    mark: 'question',
    tags: ['다시보기', '보안'],
    ts: DAY,
  }, DAY);
  put('m_000000000002', {
    url: 'https://example.com/a',
    title: '',
    text: '깨달음 메모',
    mark: 'insight',
    tags: [],
    ts: DAY + 1,
  }, DAY + 1);
  put('m_000000000003', {
    url: 'https://example.com/a',
    title: 'Page A',
    text: '표시 없는 메모 #태그',
    tags: ['태그'],
    ts: DAY + 2,
  }, DAY + 2);
  put('m_000000000004', {
    url: 'https://example.com/a',
    title: 'Page A',
    text: '다른 날 메모',
    mark: 'question',
    ts: DAY + 86400000,
  }, DAY + 86400000);
}

test('export-day: 그날 표시 메모가 있으면 끝에 다시 볼 것·깨달음 절, 없으면 절 없음', () => {
  const { dir, db } = tempDb();
  try {
    seedMemos(db);
    db.close();

    const md = exportDay('2026-11-02', dir);
    assert.match(md, /## 다시 볼 것·깨달음 \(readgloss\)/);
    assert.match(md, /### ❓ 다시 볼 것\n\n- 서버 권한 확인 #다시보기 #보안 \/ "first line" — Page A/);
    assert.match(md, /### 💡 깨달음\n\n- 깨달음 메모/);
    assert.doesNotMatch(md, /표시 없는 메모|다른 날 메모/);
    assert.ok(md.indexOf('## 다시 볼 것·깨달음') > md.indexOf('## 영어 표현'));

    const empty = exportDay('2026-11-04', dir);
    assert.doesNotMatch(empty, /다시 볼 것·깨달음/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 학습노트 ----

test('export-notes: 표시 메모는 help·tip 콜아웃, 표시 없으면 지금 모양(태그는 글 안, 두 번 안 찍음), 앞머리 tags 합침', () => {
  const { dir, db } = tempDb();
  try {
    seedMemos(db);
    // 같은 페이지 개념 태그도 앞머리에 함께 모이는지
    db.put({
      id: 'c_000000000001',
      kind: 'concept',
      key: 'idor',
      data: {
        name: 'IDOR',
        definition: '',
        seen: { url: 'https://example.com/a', title: 'Page A' },
      },
      ts: DAY,
    });
    db.close();

    const data = loadNotesData(dir);
    const docs = renderNoteDocs(data, {});
    assert.equal(docs.size, 1);
    const note = [...docs.values()][0];

    assert.match(note, /> \[!help\] 다시 볼 것\n> first line\n> second line\n> 서버 권한 확인 #다시보기 #보안\n\n/);
    assert.match(note, /> \[!tip\] 깨달음\n> 깨달음 메모/);
    assert.match(note, /표시 없는 메모 #태그/);
    assert.doesNotMatch(note, /#태그\s*\n#태그/);
    assert.match(note, /tags: \["다시보기", "보안", "태그"\]/);
    // 기존 나중에 볼 것 모양은 그대로
    assert.match(note, /> \[!question\] 나중에 볼 것: IDOR/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
