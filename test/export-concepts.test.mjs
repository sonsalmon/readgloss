import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderConceptDocs } from '../scripts/export-concepts.mjs';
import { writeIfChanged, slugifyPage, HEADER_COMMENT } from '../scripts/export-scraps.mjs';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'rg-export-concepts-test-'));
}

test('export-concepts: 링크 모양, 같은 내용이면 안 씀, 주석 없는 파일은 안 지움', async () => {
  const dir = createTempDir();
  try {
    const concepts = [
      {
        id: 'c_01',
        name: 'Access Control',
        aliases: ['AC', 'Authorization'],
        definition: '시스템 자원에 대한 접근 권한을 제어하는 규칙과 절차.',
        related: [{ id: 'c_02', name: 'Privilege Escalation' }],
        appears: [
          {
            scrapId: 's_01',
            task: 'S1-04',
            taskTitle: '접근 통제',
            url: 'https://portswigger.net/web-security/access-control',
            title: 'Access Control Vulnerabilities',
            exact: 'Broken access control is the failure to enforce access restrictions properly.',
          },
          {
            scrapId: 's_02',
            task: null,
            taskTitle: null,
            url: 'https://example.com/inbox-item',
            title: 'Inbox Title',
            exact: 'This is an unassigned inbox item quote.',
          },
        ],
      },
      {
        id: 'c_02',
        name: 'Privilege Escalation',
        aliases: [],
        definition: '부여된 권한보다 높은 권한을 부당하게 획득하는 공격 기법.',
        related: [{ id: 'c_01', name: 'Access Control' }],
        appears: [],
      },
    ];

    const docs = renderConceptDocs(concepts);

    // 1. 파일 이름 규칙 및 개수 확인
    assert.equal(docs.size, 2);
    assert.ok(docs.has('access-control.md'));
    assert.ok(docs.has('privilege-escalation.md'));

    // 2. access-control.md 마크다운 형식 검증
    const acDoc = docs.get('access-control.md');
    const acLines = acDoc.split('\n');

    // 첫 줄 자동 생성 주석
    assert.equal(acLines[0], HEADER_COMMENT);

    // 제목
    assert.match(acDoc, /# Access Control/);

    // 별칭
    assert.match(acDoc, /별칭: AC, Authorization/);

    // 정의
    assert.match(acDoc, /시스템 자원에 대한 접근 권한을 제어하는 규칙과 절차\./);

    // 관련 개념 위키링크: [[privilege-escalation]]
    assert.match(acDoc, /관련: \[\[privilege-escalation\]\]/);

    // ## 나온 곳 절 및 항목 링크 모양
    // - <할 일 제목> · [[../scraps/<할일>/<페이지 파일 이름>]] — "<exact 앞 80자>"
    assert.match(acDoc, /## 나온 곳/);
    assert.match(
      acDoc,
      /- 접근 통제 · \[\[\.\.\/scraps\/S1-04\/access-control-vulnerabilities\]\] — "Broken access control is the failure to enforce access restrictions properly\."/,
    );
    // 인박스 항목 모양
    assert.match(
      acDoc,
      /- 인박스 · \[\[\.\.\/scraps\/inbox\]\] — "This is an unassigned inbox item quote\."/,
    );

    // 3. privilege-escalation.md 형식 검증
    const peDoc = docs.get('privilege-escalation.md');
    assert.match(peDoc, /# Privilege Escalation/);
    assert.ok(!peDoc.includes('별칭:')); // 별칭이 없을 때는 별칭 줄 없음
    assert.match(peDoc, /관련: \[\[access-control\]\]/);
    assert.ok(!peDoc.includes('## 나온 곳')); // 나온 곳이 없을 때는 섹션 없음

    // 4. writeIfChanged 동작 확인 (최초 쓰기)
    const res1 = writeIfChanged(dir, docs);
    assert.equal(res1.written.length, 2);
    assert.equal(res1.removed.length, 0);

    const acPath = join(dir, 'access-control.md');
    const pePath = join(dir, 'privilege-escalation.md');
    assert.ok(existsSync(acPath));
    assert.ok(existsSync(pePath));

    const mtime1 = statSync(acPath).mtimeMs;

    // 잠시 대기 후 동일 내용 다시 쓰기 -> 쓰지 않음 (mtime 유지)
    await new Promise((resolve) => setTimeout(resolve, 30));
    const res2 = writeIfChanged(dir, docs);
    assert.equal(res2.written.length, 0);
    const mtime2 = statSync(acPath).mtimeMs;
    assert.equal(mtime1, mtime2);

    // 5. 사용자가 직접 쓴 수동 마크다운 파일 (주석 없음)
    const manualFile = join(dir, 'my-manual-concept.md');
    writeFileSync(manualFile, '# 내 수동 메모\n자동 생성 주석이 없으니 지워지면 안 됨.');

    // 6. Privilege Escalation 개념이 삭제된 상태의 map
    const singleDoc = new Map([['access-control.md', acDoc]]);
    const res3 = writeIfChanged(dir, singleDoc);

    // privilege-escalation.md는 자동 생성 주석이 있으므로 삭제됨
    assert.ok(res3.removed.includes('privilege-escalation.md'));
    assert.ok(!existsSync(pePath));

    // 수동 파일은 유지됨
    assert.ok(existsSync(manualFile));
    assert.equal(readFileSync(manualFile, 'utf8'), '# 내 수동 메모\n자동 생성 주석이 없으니 지워지면 안 됨.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('이름 겹침 시 -2 접미사 및 폴더 밖 거절', () => {
  const dir = createTempDir();
  try {
    const concepts = [
      { id: 'c_01', name: 'Access Control', definition: 'First' },
      { id: 'c_02', name: 'access-control', definition: 'Second (slug conflict)' },
    ];
    const docs = renderConceptDocs(concepts);
    assert.ok(docs.has('access-control.md'));
    assert.ok(docs.has('access-control-2.md'));

    // 폴더 밖 경로가 있으면 writeIfChanged가 throw
    assert.throws(() => writeIfChanged(dir, new Map([['../escape.md', 'content']])));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
