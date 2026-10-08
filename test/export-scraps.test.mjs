import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderScrapDocs, writeIfChanged, slugifyPage } from '../scripts/export-scraps.mjs';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'readgloss-scraps-test-'));
}

test('페이지 파일 이름: 제목을 소문자·하이픈, 80자, 겹치면 -2', () => {
  assert.equal(slugifyPage('Access Control'), 'access-control');
  assert.equal(slugifyPage('웹 보안 취약점 & Privilege Escalation'), '웹-보안-취약점-privilege-escalation');
  assert.equal(slugifyPage('!@#$$%^'), 'page');
  const longTitle = 'a'.repeat(100);
  assert.equal(slugifyPage(longTitle).length, 80);

  // 겹칠 때 slug 처리 확인 (renderScrapDocs)
  const scraps = [
    {
      id: 's1',
      task: 'S1-04',
      url: 'https://example.com/p1',
      title: 'Same Title',
      headings: [],
      quote: { exact: 'first' },
      ts: 100,
    },
    {
      id: 's2',
      task: 'S1-04',
      url: 'https://example.com/p2',
      title: 'Same Title',
      headings: [],
      quote: { exact: 'second' },
      ts: 200,
    },
  ];
  const docs = renderScrapDocs(scraps, { 'S1-04': '접근 통제' });
  assert.ok(docs.has('S1-04/same-title.md'));
  assert.ok(docs.has('S1-04/same-title-2.md'));
});

test('문서: S1-04.md에 페이지 목록·들여쓰기, S1-04/<페이지>.md에 ## 소제목, > 문장, 메모, 원문 주소, 머리 문구', () => {
  const scraps = [
    {
      id: 's1',
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control Vulnerabilities',
      headings: ['Access control vulnerabilities', 'Vertical privilege escalation'],
      quote: { exact: 'Broken access control is a common vulnerability.', prefix: 'Intro: ', suffix: '...' },
      translation: '취약한 접근 제어는 흔한 취약점입니다.',
      memo: '시험 빈출',
      ts: 100,
    },
    {
      id: 's2',
      task: 'S1-04',
      url: 'https://portswigger.net/web-security/access-control/idor',
      title: 'IDOR',
      headings: ['Insecure direct object references'],
      quote: { exact: 'IDOR is a sub-type of access control vulnerabilities.' },
      translation: 'IDOR는 접근 제어 취약점의 한 종류입니다.',
      memo: '',
      ts: 200,
    },
  ];

  const tasks = { 'S1-04': '접근 통제' };
  const docs = renderScrapDocs(scraps, tasks);

  // 1. S1-04.md 확인
  assert.ok(docs.has('S1-04.md'));
  const s104 = docs.get('S1-04.md');
  const s104Lines = s104.split('\n');
  assert.equal(s104Lines[0], '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->');
  assert.match(s104, /# 접근 통제/);
  // idor 는 access-control 아래 경로이므로 depth 1 (들여쓰기 2칸)
  assert.match(s104, /- \[\[S1-04\/access-control-vulnerabilities\]\]/);
  assert.match(s104, / {2}- \[\[S1-04\/idor\]\]/);

  // 2. S1-04/access-control-vulnerabilities.md 확인
  assert.ok(docs.has('S1-04/access-control-vulnerabilities.md'));
  const page1 = docs.get('S1-04/access-control-vulnerabilities.md');
  const page1Lines = page1.split('\n');
  assert.equal(page1Lines[0], '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->');
  assert.match(page1, /# Access Control Vulnerabilities/);
  assert.match(page1, /https:\/\/portswigger\.net\/web-security\/access-control/);
  assert.match(page1, /## Access control vulnerabilities/);
  assert.match(page1, /> Broken access control is a common vulnerability\./);
  assert.match(page1, /번역: 취약한 접근 제어는 흔한 취약점입니다\./);
  assert.match(page1, /메모: 시험 빈출/);

  // 3. S1-04/idor.md 확인
  assert.ok(docs.has('S1-04/idor.md'));
  const page2 = docs.get('S1-04/idor.md');
  assert.match(page2, /# IDOR/);
  assert.match(page2, /https:\/\/portswigger\.net\/web-security\/access-control\/idor/);
  assert.match(page2, /> IDOR is a sub-type of access control vulnerabilities\./);
  // 메모가 없을 땐 "메모:" 줄 없음
  assert.ok(!page2.includes('메모:'));
});

test('인박스는 inbox.md 한 파일', () => {
  const scraps = [
    {
      id: 's1',
      task: null,
      url: 'https://example.com/inbox1',
      title: 'Inbox Page 1',
      headings: ['Section A'],
      quote: { exact: 'Inbox quote 1' },
      translation: '인박스 번역 1',
      memo: '인박스 메모',
      ts: 100,
    },
    {
      id: 's2',
      task: null,
      url: 'https://example.com/inbox2',
      title: 'Inbox Page 2',
      headings: [],
      quote: { exact: 'Inbox quote 2' },
      ts: 200,
    },
  ];

  const docs = renderScrapDocs(scraps, {});
  assert.ok(docs.has('inbox.md'));
  assert.ok(!docs.has('null.md'));

  const inbox = docs.get('inbox.md');
  const lines = inbox.split('\n');
  assert.equal(lines[0], '<!-- 자동 생성 — 고치려면 확장 스크랩북에서 -->');
  assert.match(inbox, /# 인박스/);
  assert.match(inbox, /> Inbox quote 1/);
  assert.match(inbox, /번역: 인박스 번역 1/);
  assert.match(inbox, /메모: 인박스 메모/);
  assert.match(inbox, /> Inbox quote 2/);
});

test('같은 내용이면 파일 mtime 안 바뀜, 빈 할 일 문서는 지움, 인박스는 inbox.md', async () => {
  const dir = createTempDir();
  try {
    const scraps = [
      {
        id: 's1',
        task: 'S1-04',
        url: 'https://example.com/p1',
        title: 'Page 1',
        headings: ['Heading 1'],
        quote: { exact: 'Text 1' },
        ts: 100,
      },
      {
        id: 's2',
        task: null,
        url: 'https://example.com/p2',
        title: 'Inbox Page',
        headings: [],
        quote: { exact: 'Inbox Text' },
        ts: 200,
      },
    ];

    const map1 = renderScrapDocs(scraps, { 'S1-04': '접근 통제' });
    const res1 = writeIfChanged(dir, map1);

    assert.equal(res1.written.length, 3); // S1-04.md, S1-04/page-1.md, inbox.md
    assert.equal(res1.removed.length, 0);

    const s104Path = join(dir, 'S1-04.md');
    const mtime1 = statSync(s104Path).mtimeMs;

    // 잠시 대기 후 동일한 내용 다시 쓰기
    await new Promise((resolve) => setTimeout(resolve, 30));

    const res2 = writeIfChanged(dir, map1);
    assert.equal(res2.written.length, 0); // 변경 없으므로 0개 작성
    const mtime2 = statSync(s104Path).mtimeMs;
    assert.equal(mtime1, mtime2); // mtime 유지

    // 사용자가 직접 작성한 수동 .md 파일 (자동 생성 주석 없음)
    const userDocPath = join(dir, 'my-manual-note.md');
    writeFileSync(userDocPath, '# 내 수동 메모\n이건 지우면 안 됨.');

    // S1-04가 삭제되고 inbox 만 남은 map2
    const scraps2 = scraps.filter((s) => s.task === null);
    const map2 = renderScrapDocs(scraps2, {});
    const res3 = writeIfChanged(dir, map2);

    // S1-04.md 와 S1-04/page-1.md 가 지워져야 함
    assert.ok(res3.removed.includes('S1-04.md'));
    assert.ok(res3.removed.includes('S1-04/page-1.md'));
    assert.ok(!existsSync(s104Path));
    assert.ok(!existsSync(join(dir, 'S1-04', 'page-1.md')));

    // 수동 메모는 지워지지 않아야 함
    assert.ok(existsSync(userDocPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
