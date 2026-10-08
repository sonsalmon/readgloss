import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guessTask, lastTaskToday, loadLearning } from '../bridge/task-guess.mjs';

const FIXTURES_DIR = join(new URL('..', import.meta.url).pathname, 'fixtures', 'learning');

test('loadLearning: roadmap.json 및 NOTES.md 정상 로드', () => {
  const { nodes, next } = loadLearning(FIXTURES_DIR);
  assert.equal(nodes.length, 5);
  assert.equal(nodes[0].id, 'S1-03');
  assert.equal(nodes[0].card_title, 'HTTP를 손으로: 파이썬 스크립트 2개');
  assert.equal(nodes[1].id, 'S1-04');
  assert.equal(next, 'S1-03');
});

test('NOTES 다음 한 걸음 절 첫 S\\d-\\d\\d 만 읽는다(다른 절 무시)', () => {
  const { next } = loadLearning(FIXTURES_DIR);
  // fixtures/learning/NOTES.md 에 다른 절의 S1-18 이 있지만 '## 다음 한 걸음'의 S1-03 만 읽는다
  assert.equal(next, 'S1-03');
});

test('roadmap 없음/깨짐 → 인박스, 던지지 않음', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-learning-broken-'));
  // 파일이 아예 없을 때
  const emptyRes = loadLearning(dir);
  assert.deepEqual(emptyRes, { nodes: [], next: null });

  // roadmap.json 이 깨졌을 때
  const curDir = join(dir, 'curriculum');
  mkdirSync(curDir, { recursive: true });
  writeFileSync(join(curDir, 'roadmap.json'), '{ invalid json');
  writeFileSync(join(dir, 'NOTES.md'), '## 다음 한 걸음\n- S1-05');
  const brokenRes = loadLearning(dir);
  assert.deepEqual(brokenRes.nodes, []);
  assert.equal(brokenRes.next, 'S1-05');
});

test('lastTaskToday: 오늘 마지막 스크랩의 task 반환', () => {
  const now = new Date('2026-10-08T15:00:00+09:00').getTime();
  const scraps = [
    { id: '1', task: 'S1-03', ts: new Date('2026-10-07T23:59:59+09:00').getTime() }, // 어제
    { id: '2', task: 'S1-04', ts: new Date('2026-10-08T10:00:00+09:00').getTime() }, // 오늘
    { id: '3', task: 'S1-18', ts: new Date('2026-10-08T14:30:00+09:00').getTime() }, // 오늘 마지막
  ];
  assert.equal(lastTaskToday(scraps, now), 'S1-18');

  // 오늘 스크랩이 없는 경우
  assert.equal(lastTaskToday([scraps[0]], now), null);
  // 빈 목록
  assert.equal(lastTaskToday([], now), null);
  // 마지막 스크랩의 task 가 null (인박스) 인 경우
  const withInbox = [
    ...scraps,
    { id: '4', task: null, ts: new Date('2026-10-08T14:50:00+09:00').getTime() },
  ];
  assert.equal(lastTaskToday(withInbox, now), null);
});

test('PortSwigger 접근 통제, 오늘 첫 스크랩, next S1-03 → S1-04', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-03',
    lastToday: null,
  });
  assert.deepEqual([r.task, r.ask], ['S1-04', false]);
  assert.ok(r.matches.includes('S1-04'));
  assert.equal(r.matches[0], 'S1-04');
  assert.ok(Array.isArray(r.candidates));
  assert.ok(r.candidates.some((c) => c.id === 'S1-04' && c.title.includes('접근 통제')));
});

test('① 오늘 마지막 S1-18이 맞는 할 일 안이면 S1-18', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-03',
    lastToday: 'S1-18',
  });
  assert.deepEqual([r.task, r.ask], ['S1-18', false]);
});

test('② next가 맞는 할 일 안이면 next', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  // next 가 맞는 할 일 중 하나인 S1-11 일 때 (lastToday 는 null)
  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-11',
    lastToday: null,
  });
  assert.deepEqual([r.task, r.ask], ['S1-11', false]);
});

test('④ 밖 페이지(developer.mozilla.org), lastToday S1-04 → task S1-04, ask true', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  const r = guessTask({
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
    nodes,
    next: 'S1-03',
    lastToday: 'S1-04',
  });
  assert.deepEqual([r.task, r.ask], ['S1-04', true]);
  assert.deepEqual(r.matches, []);
});

test('④ 밖 페이지, lastToday 없고 next S1-03 → task S1-03, ask true', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  const r = guessTask({
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
    nodes,
    next: 'S1-03',
    lastToday: null,
  });
  assert.deepEqual([r.task, r.ask], ['S1-03', true]);
  assert.deepEqual(r.matches, []);
});

test('⑤ 밖 페이지, 후보 없음 → task null, ask false', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  const r = guessTask({
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
    nodes,
    next: null,
    lastToday: null,
  });
  assert.deepEqual([r.task, r.ask], [null, false]);
  assert.deepEqual(r.matches, []);
});

test('일반 호스트 github.com 은 맞춤에서 빠진다', () => {
  const nodes = [
    {
      id: 'S1-99',
      card_title: '깃허브 도구 실습',
      urls: ['https://github.com/some/repo'],
    },
  ];
  const r = guessTask({
    url: 'https://github.com/some/repo/issues',
    nodes,
    next: null,
    lastToday: null,
  });
  assert.deepEqual(r.matches, []);
  assert.equal(r.task, null);
  assert.equal(r.ask, false);
});

test('candidates 구성: 오늘 쓴 할 일들 + next + 맞는 할 일 (중복 제거 및 {id, title})', () => {
  const { nodes } = loadLearning(FIXTURES_DIR);
  const r = guessTask({
    url: 'https://portswigger.net/web-security/access-control',
    nodes,
    next: 'S1-03',
    lastToday: 'S1-18',
    todayTasks: ['S1-18', 'S1-04'],
  });
  const ids = r.candidates.map((c) => c.id);
  // 중복이 없어야 함
  assert.equal(new Set(ids).size, ids.length);
  // S1-18, S1-04, S1-03, matches...
  assert.ok(ids.includes('S1-18'));
  assert.ok(ids.includes('S1-04'));
  assert.ok(ids.includes('S1-03'));
  // title 검증
  const c04 = r.candidates.find((c) => c.id === 'S1-04');
  assert.equal(c04.title, '웹 해킹 첫걸음: 접근 통제가 뚫리는 10가지 장면');
});
