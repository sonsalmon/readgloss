import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guessTask, lastTaskToday, loadLearning } from '../bridge/task-guess.mjs';
import { TASK_FIND_RE, TASK_RE } from '../bridge/scraps.mjs';

const FIXTURES_DIR = join(new URL('..', import.meta.url).pathname, 'fixtures', 'learning');
const SKILLS_FIXTURES_DIR = join(FIXTURES_DIR, 'skills');

test('loadLearning: skills.json 과 archive roadmap 을 합쳐 읽고 thisWeek 계산', () => {
  // 오늘 2026-10-15 는 W2(2026-10-12~2026-10-18)에 속함
  const now = new Date('2026-10-15T12:00:00+09:00');
  const res = loadLearning(SKILLS_FIXTURES_DIR, now);

  assert.equal(res.roadmapOk, true);
  // 이번 주 노드 목록 (W2)
  assert.deepEqual(res.thisWeek, ['web-access-control', 'htb-ai-intro']);

  // skills.json 의 nodes 확인
  const skillNode = res.nodes.find((n) => n.id === 'web-access-control');
  assert.ok(skillNode);
  assert.equal(skillNode.card_title, '웹 접근 통제 취약점');
  assert.deepEqual(skillNode.urls, ['https://portswigger.net/web-security/access-control']);

  // archive roadmap 의 S1-04 제목도 tasks 표(id→제목 매핑)에 나옴
  assert.ok(res.tasks);
  assert.equal(res.tasks['S1-04'], '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면');
  assert.equal(res.tasks['web-access-control'], '웹 접근 통제 취약점');

  // nodes 에서도 S1-04 제목을 찾을 수 있음 (server.mjs 의 nodes.find 호환)
  const archiveNode = res.nodes.find((n) => n.id === 'S1-04');
  assert.ok(archiveNode);
  assert.equal(archiveNode.card_title, '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면');
});

test('PortSwigger 접근 통제 페이지 → 이번 주 노드(web-access-control) 짐작', () => {
  const now = new Date('2026-10-15T12:00:00+09:00');
  const { nodes, next, roadmapOk, thisWeek } = loadLearning(SKILLS_FIXTURES_DIR, now);

  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next,
    thisWeek,
    roadmapOk,
  });

  assert.equal(r.task, 'web-access-control');
  assert.equal(r.ask, false);
  assert.ok(r.matches.includes('web-access-control'));
});

test('지난주 노드보다 이번 주 노드 우선', () => {
  // web-requests (W1, 지난주: https://portswigger.net/web-security)
  // web-access-control (W2, 이번 주: https://portswigger.net/web-security/access-control)
  // 하위 경로로 둘 다 매칭될 때 이번 주 노드가 우선
  const now = new Date('2026-10-15T12:00:00+09:00');
  const { nodes, roadmapOk, thisWeek } = loadLearning(SKILLS_FIXTURES_DIR, now);

  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control/lab-user-role',
    nodes,
    thisWeek,
    roadmapOk,
  });

  // web-access-control 이 thisWeek 에 있으므로 선택됨
  assert.equal(r.task, 'web-access-control');

  // nodes 에서 순서를 바꾸거나 동일한 스코어인 상황에서도 thisWeek 가 지난주보다 우선
  const customNodes = [
    {
      id: 'last-week-task',
      card_title: '지난주 할 일',
      urls: ['https://academy.hackthebox.com/course/preview'],
    },
    {
      id: 'this-week-task',
      card_title: '이번 주 할 일',
      urls: ['https://academy.hackthebox.com/course/preview'],
    },
  ];

  const rPriority = guessTask({
    url: 'https://academy.hackthebox.com/course/preview/123',
    nodes: customNodes,
    thisWeek: ['this-week-task'],
    roadmapOk: true,
  });

  assert.equal(rPriority.task, 'this-week-task');
});

test('archive roadmap의 S1-04 제목도 tasks 표 및 candidates 에 나옴', () => {
  const now = new Date('2026-10-15T12:00:00+09:00');
  const learning = loadLearning(SKILLS_FIXTURES_DIR, now);

  // tasks 표에 S1-04 제목 나옴
  assert.equal(learning.tasks['S1-04'], '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면');

  // 오늘 스크랩에 옛 id(S1-04)가 있을 때 candidates 에도 제목이 나옴
  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes: learning.nodes,
    todayTasks: ['S1-04'],
    roadmapOk: learning.roadmapOk,
  });

  const c04 = r.candidates.find((c) => c.id === 'S1-04');
  assert.ok(c04);
  assert.equal(c04.title, '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면');
});

test('skills.json 없고 roadmap만 있으면 옛 동작', () => {
  // 기존 FIXTURES_DIR 엔 skills.json 이 없고 curriculum/roadmap.json 만 있음
  const { nodes, next, roadmapOk } = loadLearning(FIXTURES_DIR);

  assert.equal(roadmapOk, true);
  assert.equal(nodes.length, 5);
  assert.equal(nodes[0].id, 'S1-03');
  assert.equal(next, 'S1-03');

  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next,
    roadmapOk,
  });

  assert.equal(r.task, 'S1-04');
  assert.equal(r.ask, false);
});

test('skills.json 없고 roadmap.json 도 없으면 인박스', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-empty-learning-'));
  const origError = console.error;
  console.error = () => {};
  try {
    const res = loadLearning(dir);
    assert.equal(res.roadmapOk, false);
    assert.deepEqual(res.nodes, []);

    const r = guessTask({
      url: 'https://portswigger.net/web-security/access-control',
      nodes: res.nodes,
      roadmapOk: res.roadmapOk,
    });

    assert.deepEqual(r, { task: null, ask: false, candidates: [], matches: [] });
  } finally {
    console.error = origError;
  }
});

test('skills.json 없고 archive/roadmap.json 만 있을 때 fallback 로드', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-archive-only-'));
  const archDir = join(dir, 'curriculum', 'archive');
  mkdirSync(archDir, { recursive: true });
  writeFileSync(
    join(archDir, 'roadmap.json'),
    JSON.stringify({
      nodes: [
        {
          id: 'S1-04',
          card_title: '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면',
          resources: [{ url: 'https://portswigger.net/web-security' }],
        },
      ],
    }),
  );

  const res = loadLearning(dir);
  assert.equal(res.roadmapOk, true);
  assert.equal(res.nodes.length, 1);
  assert.equal(res.nodes[0].id, 'S1-04');

  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes: res.nodes,
    roadmapOk: res.roadmapOk,
  });

  assert.equal(r.task, 'S1-04');
});

test('할 일 id 형식 TASK_RE 안전성 시험 (경로 탈출 .. 및 / 불가)', () => {
  // 유효한 형식들
  const validIds = [
    'S1-04',
    'S2-18',
    'S1-02b',
    'BUF-01',
    'BUF-99',
    'py-scripting',
    'web-access-control',
    'ml-foundations',
    'a-1',
    'b2',
    'c-d-e-f',
  ];

  for (const id of validIds) {
    assert.ok(TASK_RE.test(id), `유효한 id여야 함: ${id}`);
  }

  // 경로 조작(Directory Traversal)이나 파일명으로 위험한 문자열들 거부
  const dangerousIds = [
    '..',
    '../etc/passwd',
    '..\\windows\\system32',
    'foo/bar',
    '/root',
    './test',
    '.',
    '~',
    '\0',
    'a/b',
    'foo..bar',
    'name with space',
    'UPPER-CASE',
    '-starts-with-hyphen',
    '',
  ];

  for (const id of dangerousIds) {
    assert.ok(!TASK_RE.test(id), `위험한/부적합한 id는 거절되어야 함: ${id}`);
  }
});

test('NOTES.md 에서 스킬 id(영소문자)는 TASK_FIND_RE 로 찾지 않음', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-notes-skills-'));
  writeFileSync(join(dir, 'NOTES.md'), '## 다음 한 걸음\n- py-scripting 기본기 연습\n');

  const origError = console.error;
  console.error = () => {};
  try {
    const res = loadLearning(dir);
    // 스킬 id 는 낱말과 헷갈리므로 NOTES 에서 찾지 않고 next: null 이어야 함
    assert.equal(res.next, null);
  } finally {
    console.error = origError;
  }
});

test('skills.json 이 깨졌으면 한 줄 로그 남기고 roadmap 으로 계속', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-broken-skills-'));
  mkdirSync(join(dir, 'curriculum'), { recursive: true });
  writeFileSync(join(dir, 'curriculum', 'skills.json'), '{ invalid json');
  writeFileSync(
    join(dir, 'curriculum', 'roadmap.json'),
    readFileSync(join(FIXTURES_DIR, 'curriculum', 'roadmap.json'), 'utf8'),
  );
  writeFileSync(join(dir, 'NOTES.md'), '## 다음 한 걸음\n- S1-03\n');

  const lines = [];
  const origError = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const res = loadLearning(dir);
    assert.equal(res.roadmapOk, true);
    assert.equal(res.nodes[0].id, 'S1-03');
  } finally {
    console.error = origError;
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('skills.json'));
});
