import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KINDS, createStudy, parseDays } from '../bridge/study.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'rg-study-')), 'study-log.jsonl');
const DAY = 86_400_000;
// 로컬 정오를 기준 시각으로 쓴다(하루 경계·DST 에 덜 민감)
const noon = (offsetDays = 0) => {
  const d = new Date(2026, 9, 6, 12, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
};
const clock = (start) => {
  const c = { t: start, now: () => c.t };
  return c;
};

test('parseDays: 기본 7, 1~60 정수만, 나머지는 null', () => {
  assert.equal(parseDays(undefined), 7);
  assert.equal(parseDays('1'), 1);
  assert.equal(parseDays('60'), 60);
  for (const bad of ['0', '61', '-1', '1.5', 'abc', '', '7 ', '1e1', '007x']) assert.equal(parseDays(bad), null, bad);
});

test('record: 한 줄씩 JSONL, text·ko 200자, url 은 http(s) 만, 모양이 틀리면 버린다', () => {
  const file = tmp();
  const c = clock(noon());
  const s = createStudy({ file, now: c.now });
  s.record({ kind: 'dict', text: '  payload \n x ', ko: '수익 하중', url: 'https://a.test/p' });
  s.record({ kind: 'mt', text: 'a'.repeat(300), ko: '가'.repeat(300), url: 'javascript:alert(1)' });
  s.record({ kind: 'nope', text: 'x' });
  s.record({ kind: 'dict', text: '   ' });
  s.record({ kind: 'dict' });
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { ts: c.t, kind: 'dict', text: 'payload x', ko: '수익 하중', url: 'https://a.test/p' });
  assert.equal(lines[1].text.length, 200);
  assert.equal(lines[1].ko.length, 200);
  assert.equal('url' in lines[1], false);
});

test('report: 오늘부터 days 일을 최신 날 먼저, 기록 없는 날도 0, 날짜는 로컬, 항목은 최신순', () => {
  const file = tmp();
  const c = clock(noon());
  const s = createStudy({ file, now: c.now });
  for (const [off, kind, text] of [[-2, 'save', 'old'], [0, 'dict', 'a'], [0, 'mt', 'b'], [0, 'dict', 'c']]) {
    c.t = noon(off) + (text === 'c' ? 1000 : 0);
    s.record({ kind, text, ko: text + 'ko' });
  }
  c.t = noon() + 2000;
  const r = s.report(3);
  assert.deepEqual(r.days.map((d) => d.date), ['2026-10-06', '2026-10-05', '2026-10-04']);
  assert.deepEqual(Object.keys(r.days[0].counts), KINDS);
  assert.deepEqual(r.days[0].counts, { dict: 2, mt: 1, context: 0, aigloss: 0, paragraph: 0, save: 0, known: 0, mydict: 0 });
  assert.deepEqual(r.days[0].items.map((i) => i.text), ['c', 'a', 'b']); // 최신 먼저, 시각이 같으면 파일 순서
  assert.deepEqual(r.days[1].items, []);
  assert.equal(r.days[2].counts.save, 1);
  assert.deepEqual(r.days[2].items.map((i) => [i.kind, i.text, i.ko]), [['save', 'old', 'oldko']]);
  assert.equal(s.report(2).days.length, 2); // days 안쪽만
  assert.equal(s.report().days.length, 7); // 기본 7
});

test('report: 하루 항목은 최신순 200개까지, 개수는 전부 센다. 미래 시각·깨진 줄은 건너뛴다', () => {
  const file = tmp();
  const c = clock(noon());
  const s = createStudy({ file, now: c.now });
  for (let i = 0; i < 205; i++) {
    c.t = noon() - 205_000 + i * 1000;
    s.record({ kind: 'dict', text: `w${i}` });
  }
  c.t = noon();
  writeFileSync(file, `${readFileSync(file, 'utf8')}{"ts":1,"kind":\nnot json\n${JSON.stringify({ ts: noon() + DAY, kind: 'dict', text: 'future' })}\n`);
  const d = s.report(1).days[0];
  assert.equal(d.counts.dict, 205);
  assert.equal(d.items.length, 200);
  assert.equal(d.items[0].text, 'w204');
  assert.equal(d.items[199].text, 'w5');
});

test('기동할 때 90일보다 오래된 줄과 깨진 줄을 정리한다(임시 파일 안 남음, 바뀐 게 없으면 다시 쓰지 않는다)', () => {
  const file = tmp();
  const old = { ts: noon(-91), kind: 'dict', text: 'old' };
  const edge = { ts: noon(-89), kind: 'save', text: 'edge' };
  const now = { ts: noon(), kind: 'mt', text: 'now' };
  writeFileSync(file, [old, edge, now].map((v) => JSON.stringify(v)).join('\n') + '\nbroken line\n');
  createStudy({ file, now: () => noon() });
  const kept = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(kept.map((v) => v.text), ['edge', 'now']);
  assert.deepEqual(readdirSync(join(file, '..')).filter((f) => f.endsWith('.tmp')), []);
  const before = readFileSync(file, 'utf8');
  createStudy({ file, now: () => noon() });
  assert.equal(readFileSync(file, 'utf8'), before);
  const none = tmp();
  createStudy({ file: none, now: () => noon() });
  assert.equal(existsSync(none), false); // 없으면 만들지 않는다
});
