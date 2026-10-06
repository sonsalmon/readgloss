// 실제 맥 사전 도우미 실연동. darwin 이고 native/macdict 가 빌드돼 있을 때만 돈다(npm run build:dict).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createDict } from '../bridge/dict.mjs';
import { pickEntry } from '../bridge/annotate.mjs';

const bin = new URL('../native/macdict', import.meta.url).pathname;
const skip = process.platform !== 'darwin' || !existsSync(bin) ? '맥이 아니거나 npm run build:dict 를 안 했어요' : false;

test('실연동: delves -> 원형 delve', { skip }, async () => {
  const d = createDict();
  try {
    const r = await d.lookup('delves');
    assert.equal(r.found, true);
    assert.equal(r.entries[0].headword, 'delve');
    assert.match(r.entries[0].senses[0].text, /파고들다/);
  } finally {
    d.close();
  }
});

test('실연동: exploit -> 표제어 2개 이상, 하나에 이용·악용', { skip }, async () => {
  const d = createDict();
  try {
    const r = await d.lookup('exploit');
    assert.ok(r.entries.length >= 2);
    assert.ok(r.entries.some((e) => /이용|악용/.test(e.raw)));
    assert.deepEqual(r.entries.slice(0, 2).map((e) => e.homograph), [1, 2]);
  } finally {
    d.close();
  }
});

test('실연동: deserialize -> found:false, 형식이 틀린 입력도 found:false', { skip }, async () => {
  const d = createDict();
  try {
    assert.deepEqual(await d.lookup('deserialize'), { found: false });
    for (const bad of ['a b', 'x1', '', 'a'.repeat(201)]) assert.deepEqual(await d.lookup(bad), { found: false }, bad);
  } finally {
    d.close();
  }
});

test('실연동: 상주 도우미 한 번 조회는 300ms 안', { skip }, async () => {
  const d = createDict();
  try {
    await d.lookup('warmup'); // 처음 띄우는 비용은 따로(스펙은 상주 상태의 조회 시간)
    for (const w of ['exploit', 'mitigate', 'delves', 'privilege']) {
      const t0 = performance.now();
      const r = await d.lookup(w);
      const ms = performance.now() - t0;
      assert.equal(r.found, true, w);
      assert.ok(ms < 300, `${w} ${ms.toFixed(0)}ms`);
    }
  } finally {
    d.close();
  }
});

test('실연동: 문장 첫머리 대문자(Exploit, Teams)도 같은 결과', { skip }, async () => {
  const d = createDict();
  try {
    assert.equal((await d.lookup('Exploit')).entries.length >= 2, true);
    assert.equal((await d.lookup('Teams')).entries[0].headword, 'team');
  } finally {
    d.close();
  }
});

test('실연동: 복수형 matrices(굴절 안내 항목이 먼저 옴)·indices·vertices·beacons -> 원형, 뜻은 원형 항목', { skip }, async () => {
  const d = createDict();
  try {
    for (const [w, lemma] of [['matrices', 'matrix'], ['indices', 'index'], ['vertices', 'vertex'], ['beacons', 'beacon']]) {
      const r = await d.lookup(w);
      const p = pickEntry(r.entries, w);
      assert.equal(p.lemma, lemma, w);
      assert.equal(p.e?.headword, lemma, `${w} 뜻 항목`);
    }
  } finally {
    d.close();
  }
});
