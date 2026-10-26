// 과제 T51c(변경 기록 27-3): 다리 save-phrase 의 clip(영상 장면 구간), 복습 카드의 url·clip, 다시 불러오기.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIP, createWords, parseClip, parseWordsOp, phraseId } from '../bridge/words.mjs';
import { openDb } from '../bridge/db.mjs';
import { start } from '../fixtures/bridge-harness.mjs';

const SCENE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=83s';
const line = (extra = {}) => ({ op: 'save-phrase', text: 'So it begins', translation: '이제 시작이다', kind: 'sentence', url: SCENE, title: 'A talk', ...extra });

test('parseClip: 없으면 undefined, 맞으면 소수 둘째 자리, 틀리면 null', () => {
  assert.equal(parseClip(undefined), undefined);
  assert.equal(parseClip(null), undefined);
  assert.deepEqual(parseClip({ start: 83.456, end: 86.2 }), { start: 83.46, end: 86.2 });
  assert.deepEqual(parseClip({ start: 0, end: 60 }), { start: 0, end: 60 }, '60초까지');
  for (const bad of [{ start: 2, end: 1 }, { start: 1, end: 1 }, { start: -1, end: 2 }, { start: 0, end: 60.5 }, { start: 86_399, end: 86_401 }, { start: '1', end: 2 }, { start: 1 }, { start: NaN, end: 2 }, { start: 1.001, end: 1.004 }, [], 'x', 5]) {
    assert.equal(parseClip(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(CLIP, { maxLength: 60, maxEnd: 86_400 });
  // 코드 검토 7: 길이는 1/100초 정수로 잰다(64.01 - 4.01 = 60.00000000000001 이어도 60초)
  assert.deepEqual(parseClip({ start: 4.01, end: 64.01 }), { start: 4.01, end: 64.01 });
  assert.deepEqual(parseClip({ start: 0.14, end: 60.14 }), { start: 0.14, end: 60.14 });
  assert.deepEqual(parseClip({ start: 1234.56, end: 1294.56 }), { start: 1234.56, end: 1294.56 });
  assert.equal(parseClip({ start: 0.14, end: 60.15 }), null);
});

test('parseWordsOp: save-phrase 에 clip 이 실리고, 틀린 clip 은 요청 전체를 거절', () => {
  assert.deepEqual(parseWordsOp(line({ clip: { start: 83.46, end: 86.2 } })).clip, { start: 83.46, end: 86.2 });
  assert.equal('clip' in parseWordsOp(line()), false);
  assert.equal(parseWordsOp(line({ clip: { start: 5, end: 1 } })), null);
});

test('/words save-phrase clip: 저장 → 복습 큐 카드에 url·clip, 다시 저장하면 새 요청의 clip(없으면 없앰)', async () => {
  const s = await start();
  try {
    const ok = await s.post('/words', line({ clip: { start: 83.46, end: 86.2 } }));
    assert.equal(ok.status, 200);
    const id = phraseId('So it begins');
    assert.deepEqual(ok.json().phrases[id].clip, { start: 83.46, end: 86.2 });
    assert.equal((await s.post('/words', line({ clip: { start: 0, end: 90 } }))).status, 400);

    const q = (await s.get('/words/review')).json();
    const card = q.due.find((c) => c.key === id);
    assert.deepEqual(card, { type: 'phrase', key: id, text: 'So it begins', translation: '이제 시작이다', kind: 'sentence', url: SCENE, clip: { start: 83.46, end: 86.2 } });

    // 낱말: 사전 카드가 장면 주소를 url 로 싣는다 → 카드에 url
    await s.post('/words', { op: 'save', lemma: 'begin', word: 'begins', gloss: '시작하다', sentence: 'So it begins', url: SCENE });
    const w = (await s.get('/words/review')).json().due.find((c) => c.key === 'begin');
    assert.equal(w.url, SCENE);
    assert.equal('clip' in w, false);

    // 다시 저장(clip 없음): 복습 상태는 남고 clip 은 없어진다
    const before = s.bridge.words.all().phrases[id].review;
    await s.post('/words', line({ url: 'https://example.com/page' }));
    const after = s.bridge.words.all().phrases[id];
    assert.equal('clip' in after, false);
    assert.deepEqual(after.review, before);
  } finally {
    await s.close();
  }
});

test('clip 은 db·JSON 둘 다 다시 불러와도 남고, 깨진 clip 은 버린다', () => {
  const now = () => new Date('2026-10-26T12:00:00').getTime();
  const dir = mkdtempSync(join(tmpdir(), 'rg-t51c-'));
  const db = openDb(join(dir, 'readgloss.db'));
  try {
    const a = createWords({ db, now });
    a.apply(parseWordsOp(line({ clip: { start: 1, end: 3 } })));
    const id = phraseId('So it begins');
    assert.deepEqual(createWords({ db, now }).all().phrases[id].clip, { start: 1, end: 3 });
    // 손으로 깨뜨린 값
    const node = db.get(id);
    db.put({ ...node, data: { ...node.data, clip: { start: 9, end: 2 } } });
    assert.equal('clip' in createWords({ db, now }).all().phrases[id], false);
  } finally {
    db.close();
  }

  const file = join(dir, 'words.json');
  createWords({ file, now }).apply(parseWordsOp(line({ clip: { start: 4.5, end: 7 } })));
  assert.deepEqual(createWords({ file, now }).all().phrases[phraseId('So it begins')].clip, { start: 4.5, end: 7 });
});
