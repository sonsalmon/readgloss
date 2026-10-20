import test from 'node:test';
import assert from 'node:assert/strict';
import { recheckRows } from '../scripts/tasks-recheck.mjs';

const modules = { slugs: new Map([[35, 'web-requests']]), titles: new Map([['web-requests', ['intro', 'second']]]) };
const nodes = [
  { id: 'ml-foundations', htb: [] },
  { id: 'http-and-proxy', htb: [{ module: 'web-requests', secs: [1, 2] }] },
];
const rows = [
  { id: 's1', kind: 'scrap', url: 'https://academy.hackthebox.com/app/module/35/section/1', title: 'Intro | Hack The Box Academy', task: 'ml-foundations' },
  { id: 's2', kind: 'scrap', url: 'https://academy.hackthebox.com/app/module/35/section/2', title: 'Second', task: 'http-and-proxy' },
  { id: 's3', kind: 'memo', url: 'https://example.com/x', title: 'x', task: 'ml-foundations' },
  { id: 'c1', kind: 'concept', url: 'https://academy.hackthebox.com/app/module/35/section/1', title: 'Intro', task: null },
];

test('recheckRows: 다른 것만 id·제목·옛→새로, 메모 글은 담지 않는다', () => {
  const { changed, total } = recheckRows(rows, { modules, nodes });
  assert.equal(total, 4);
  assert.deepEqual(changed.map((c) => [c.id, c.from, c.to]), [
    ['s1', 'ml-foundations', 'http-and-proxy'],
    ['c1', null, 'http-and-proxy'],
  ]);
  assert.deepEqual(Object.keys(changed[0]).sort(), ['from', 'id', 'kind', 'title', 'to']);
});
