import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guessTask, htbTaskFor, loadHtbModules, loadLearning } from '../bridge/task-guess.mjs';

// 가짜 작업실 번호 표 (실제 데이터 아님)
const PLACES = {
  v: 1,
  modules: [
    { name: 'Web Requests', module: 35, slug: 'web-requests' },
    { name: 'Fake Two Word', module: 99 }, // slug 칸 없음 → 이름 규칙
  ],
  sections: [{ name: 'Web Requests', items: [{ title: 'Intro' }, { title: 'Second One' }, { title: 'Third' }] }],
};
const SKILLS = {
  nodes: [
    { id: 'a-first', name: 'A', concepts: [{ id: 'c1', refs: [{ kind: 'htb', module: 'web-requests', secs: [1, 2] }] }] },
    { id: 'b-second', name: 'B', concepts: [{ id: 'c1', refs: [{ kind: 'htb', module: 'web-requests', secs: [3, 3] }, { kind: 'htb', module: 'fake-two-word', secs: [1, 9] }] }] },
    { id: 'c-plain', name: 'C', sources: [{ url: 'https://academy.hackthebox.com/course/preview/web-requests' }] },
  ],
  weeks: [],
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-htb-'));
  mkdirSync(join(dir, 'curriculum'));
  writeFileSync(join(dir, 'curriculum', 'skills.json'), JSON.stringify(SKILLS));
  const placesFile = join(dir, 'study_places.json');
  writeFileSync(placesFile, JSON.stringify(PLACES));
  return { learning: loadLearning(dir), modules: loadHtbModules(placesFile) };
}
const U = (n, s = 1) => `https://academy.hackthebox.com/app/module/${n}/section/${s}`;

test('loadHtbModules: 번호→slug, slug 칸 없으면 이름 규칙, 파일 없으면 null', () => {
  const { modules } = setup();
  assert.equal(modules.slugs.get(35), 'web-requests');
  assert.equal(modules.slugs.get(99), 'fake-two-word');
  assert.equal(loadHtbModules('/no/such/file.json'), null);
});

test('htbTaskFor: 섹션 제목으로 섹션 순번을 정해 범위가 덮는 스킬', () => {
  const { learning, modules } = setup();
  assert.equal(htbTaskFor({ url: U(35), title: 'Second One | Hack The Box Academy', modules, nodes: learning.nodes }), 'a-first');
  assert.equal(htbTaskFor({ url: U(35), title: 'third', modules, nodes: learning.nodes }), 'b-second');
});

test('htbTaskFor: 제목 없으면 지도 순서 첫째, 모듈 모르면 null, HTB 아니면 null', () => {
  const { learning, modules } = setup();
  assert.equal(htbTaskFor({ url: U(35), modules, nodes: learning.nodes }), 'a-first');
  assert.equal(htbTaskFor({ url: U(35), title: 'Nope', modules, nodes: learning.nodes }), 'a-first');
  assert.equal(htbTaskFor({ url: U(12345), modules, nodes: learning.nodes }), null);
  assert.equal(htbTaskFor({ url: 'https://example.com/app/module/35/x', modules, nodes: learning.nodes }), null);
  assert.equal(htbTaskFor({ url: U(35), modules: null, nodes: learning.nodes }), null);
});

test('guessTask: HTB 주소는 모듈 표로, remembered 가 있으면 그것이 먼저', () => {
  const { learning, modules } = setup();
  const base = { url: U(35), nodes: learning.nodes, roadmapOk: true, lastToday: 'ml-foundations', htbModules: modules };
  const r = guessTask(base);
  assert.equal(r.task, 'a-first');
  assert.equal(r.ask, false);
  assert.equal(guessTask({ ...base, remembered: 'my-pick' }).task, 'my-pick');
  assert.equal(guessTask({ ...base, htbModules: null }).task, 'c-plain'); // 표 없으면 옛 규칙(preview 주소 맞춤)
});
