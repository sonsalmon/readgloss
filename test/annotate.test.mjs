import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ANNOTATE_LEVELS, LEVELS, createAnnotate, lemmaOf, loadWordLevels, parseWordLevels, shortGloss } from '../bridge/annotate.mjs';
import { createDict, parseEntry } from '../bridge/dict.mjs';

const fx = JSON.parse(readFileSync(new URL('../fixtures/dict-plain.json', import.meta.url), 'utf8'));
const firstSense = (word) => parseEntry(fx[word][0]).senses[0].text;

test('parseWordLevels: / 변형을 펼치고, 같은 단어는 가장 쉬운 등급, 여러 단어 표제어·기호는 건너뛴다', () => {
  const m = parseWordLevels(
    [
      'headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold',
      'a.m./A.M./am/AM,adverb,A1,,,',
      'close,verb,B1,,,',
      'close,adjective,A2,"News, lifestyles",,',
      'according to,preposition,B1,,,',
      'acknowledgment/acknowledgement,noun,B1,,,',
      'bogus,noun,Z9,,,',
    ].join('\n'),
  );
  assert.equal(m.get('am'), 'A1');
  assert.equal(m.has('a.m.'), false);
  assert.equal(m.get('close'), 'A2');
  assert.equal(m.get('acknowledgment'), 'B1');
  assert.equal(m.get('acknowledgement'), 'B1');
  assert.equal(m.has('according to'), false);
  assert.equal(m.has('bogus'), false);
});

test('parseWordLevels: 이미 있는 Map 에 합칠 때도 쉬운 쪽이 이긴다', () => {
  const m = parseWordLevels('headword,pos,CEFR\nfoo,noun,C1\n');
  parseWordLevels('headword,pos,CEFR\nfoo,noun,B2\nbar,noun,C2\n', m);
  assert.equal(m.get('foo'), 'B2');
  assert.equal(m.get('bar'), 'C2');
});

test('loadWordLevels: 실제 CEFR-J·Octanove 파일에서 등급을 읽는다', () => {
  const m = loadWordLevels();
  assert.equal(m.get('the'), 'A1');
  assert.equal(m.get('abandon'), 'B1');
  assert.equal(m.get('am'), 'A1');
  assert.equal(m.get('exterior'), 'C1'); // Octanove
  assert.ok(m.size > 7000);
  assert.ok([...m.values()].every((v) => LEVELS.includes(v)));
  assert.equal(m.has('payload'), false);
});

test('shortGloss: 티켓의 예상 뜻(사전 평문 그대로)', () => {
  assert.equal(shortGloss(firstSense('mitigate')), '완화시키다');
  assert.equal(shortGloss(firstSense('privilege')), '특권');
  assert.equal(shortGloss(firstSense('payload')), '수익 하중');
  assert.equal(shortGloss(firstSense('exploit')), '영웅적 행위'); // 첫 표제어는 명사
  assert.equal(shortGloss(firstSense('delve')), '손으로 더듬다');
});

test('shortGloss: 괄호 설명·문법 표지·말줄임 목적어·대괄호 대안 표기를 뺀다', () => {
  assert.equal(shortGloss('…을(청소·살균 등으로) 위생적으로 만들다.'), '위생적으로 만들다');
  assert.equal(shortGloss('（…을） (맹렬함·크기에서)단계적으로 확대[증대]시키다[하다]'), '단계적으로 확대시키다');
  assert.equal(shortGloss('…을 （이익·영리를 위해） 이용[활용]하다; …을 착취하다'), '이용하다');
  assert.equal(shortGloss('[불][가]（…할） 특권, 특전'), '특권');
  assert.equal(shortGloss('[불]《격식》 완화, (형벌의) 경감'), '완화');
  assert.equal(shortGloss('〔상업〕 〈…을〉 【어원】 값'), '값');
  assert.equal(shortGloss('공격자; （구기의） 공격 선수.'), '공격자');
  // 품사 표지·뜻 번호가 본문에 남은 모양(사전 평문이 품사를 못 가른 경우)
  assert.equal(shortGloss('타∙자동사1.〔군사〕 〈부대를[가]〉 배치하다[되다]; 알맞게 사용하다.'), '배치하다');
  assert.equal(shortGloss('[불]《또는a input》1.투입 （량） ; （일에의） 생각의 제공.'), '투입');
  assert.equal(shortGloss('《보통 credentials》1.신용 증명물[서]; 신임장'), '신용 증명물');
  assert.equal(shortGloss('명사 ① 특권'), '특권');
  assert.equal(shortGloss('{dynamo（발전기） ＋ic (…의) → 강력한} (more dynamic, most dynamic)1.동적인 (↔static); 동태(動態)의'), '동적인'); // 어원 {…}
  assert.equal(shortGloss('악성코드[바이러스]: 시스템을 손상하거나 파괴시키려고 고안된 소프트 웨어.'), '악성코드'); // 콜론 앞까지
});

test('shortGloss: 12자 안팎으로 자른다(가능하면 띄어쓰기에서)', () => {
  const g = shortGloss('아주 아주 긴 설명이 한참 계속되는 뜻풀이입니다, 다음');
  assert.ok(g.length <= 12, g);
  assert.ok(!g.endsWith(' '));
  assert.equal(shortGloss('가나다라마바사아자차카타파하'), '가나다라마바사아자차카타');
});

test('shortGloss: 비거나 한글이 없거나 값이 아니면 빈 문자열(주석 없음)', () => {
  for (const s of ['', '   ', '《격식》', '〔…〕 ', '[불]', '＝had better.', undefined, null, 42]) assert.equal(shortGloss(s), '', String(s));
});

test('lemmaOf: 본문 머리의 · 와 번호, 악센트를 걷어 원형으로 만든다', () => {
  const e = (headword, raw) => ({ headword, raw });
  assert.equal(lemmaOf(e('mitigations', 'mit·i·ga·tion | mìtəɡéiʃən | 명사1.[불]완화'), 'mitigations'), 'mitigation');
  assert.equal(lemmaOf(e('páylòad', 'páy·lòad 명사1.〔상업〕 수익 하중.'), 'payload'), 'payload');
  assert.equal(lemmaOf(e('exploit', 'ex·ploit 2 | iksplɔ́it | 동사'), 'exploit'), 'exploit');
  assert.equal(lemmaOf(e('delve', 'delve | delv | 동사'), 'delves'), 'delve');
  assert.equal(lemmaOf(e('the-', '모음으로 시작되는 말에 붙여'), 'the'), 'the');
  assert.equal(lemmaOf(e('', ''), 'word'), 'word');
});

// 가짜 사전: word -> entries(parseEntry 모양). 호출 기록을 남긴다.
function fakeDict(table) {
  const calls = [];
  return {
    calls,
    lookup: async (w) => {
      calls.push(w);
      const entries = table[w];
      return entries ? { found: true, entries } : { found: false };
    },
  };
}
const ent = (raw, headword) => ({ headword, raw, senses: parseEntry({ headword, text: raw }).senses });
const levels = new Map([['delve', 'B2'], ['include', 'B1'], ['simple', 'A1'], ['simply', 'A2'], ['easy', 'A1'], ['abandoned', 'B2'], ['abandon', 'B1'], ['exterior', 'C1'], ['cloak', 'C2']]);
const table = {
  delves: [{ ...parseEntry({ ...fx.delve[0], headword: 'delve' }), headword: 'delve' }], // 도우미가 delves 에 원형 delve 를 돌려주는 모양
  payload: [parseEntry({ ...fx.payload[0] })],
  include: [ent('in·clude | inklúːd | 동사…을 포함하다', 'include')],
  abandoned: [ent('abandon | əbǽndən | 동사…을 버리다', 'abandon')],
  exterior: [ent('ex·te·ri·or | ikstíəriər | 명사외부', 'exterior')],
  cloak: [ent('cloak | klouk | 명사망토', 'cloak')],
  blank: [ent('bl·ank | x | 명사《격식》', 'blank')],
};

test('판정: 원형이 기준 등급 이상이면 어려움(delves -> delve B2)', async () => {
  const a = createAnnotate({ dict: fakeDict(table), levels });
  assert.deepEqual(await a(['delves']), { delves: { lemma: 'delve', level: 'B2', gloss: '손으로 더듬다' } });
});

test('판정: 목록에 없는 원형은 사전에 있으면 어려움(level null), 사전에 없으면 주석 없음', async () => {
  const a = createAnnotate({ dict: fakeDict(table), levels });
  assert.deepEqual(await a(['payload', 'zzyzx']), { payload: { lemma: 'payload', level: null, gloss: '수익 하중' } });
});

test('판정: 기준 등급 바꾸기(B1 include 는 B1 부터 어려움, B2 에선 쉬움)', async () => {
  const a = createAnnotate({ dict: fakeDict(table), levels });
  assert.deepEqual(Object.keys(await a(['include'], 'B2')), []);
  assert.deepEqual(Object.keys(await a(['include'], 'B1')), ['include']);
  assert.deepEqual(Object.keys(await a(['include'], 'A2')), ['include']);
  assert.deepEqual(Object.keys(await a(['exterior'], 'C1')), ['exterior']);
  assert.deepEqual(Object.keys(await a(['cloak', 'exterior'], 'B2')).sort(), ['cloak', 'exterior']);
});

test('판정: 표면형이 목록에서 기준 미만이면 사전을 부르지 않고 쉬움, 표면형이 어려워도 원형이 쉬우면 쉬움', async () => {
  const d = fakeDict(table);
  const a = createAnnotate({ dict: d, levels });
  assert.deepEqual(await a(['simple', 'easy']), {});
  assert.deepEqual(d.calls, []);
  assert.deepEqual(await a(['abandoned']), {}); // 표면형 B2 지만 원형 abandon 은 B1
  assert.deepEqual(d.calls, ['abandoned']);
});

test('판정: 뜻이 빈 표제어는 주석 없음', async () => {
  const a = createAnnotate({ dict: fakeDict(table), levels });
  assert.deepEqual(await a(['blank']), {});
});

test('캐시: 같은 단어는 사전을 한 번만 부르고 기준 등급이 달라도 재사용한다', async () => {
  const d = fakeDict(table);
  const a = createAnnotate({ dict: d, levels });
  await a(['delves', 'payload', 'zzyzx', 'delves']);
  await a(['delves', 'payload', 'zzyzx'], 'C1');
  assert.deepEqual(d.calls, ['delves', 'payload', 'zzyzx']);
});

test('아는 단어: 원형이 아는 단어면 결과에서 빼고, 취소하면 사전을 다시 부르지 않고 바로 다시 나온다', async () => {
  const d = fakeDict(table);
  const known = new Set();
  const a = createAnnotate({ dict: d, levels, isKnown: (l) => known.has(l) });
  assert.deepEqual(Object.keys(await a(['delves', 'payload'])), ['delves', 'payload']);
  known.add('delve'); // 표면형 delves 의 원형
  assert.deepEqual(Object.keys(await a(['delves', 'payload'])), ['payload']);
  known.delete('delve');
  assert.deepEqual(Object.keys(await a(['delves', 'payload'])), ['delves', 'payload']);
  assert.deepEqual(d.calls, ['delves', 'payload']);
});

test('아는 단어: 표면형 자체가 아는 원형이면 사전도 안 부른다', async () => {
  const d = fakeDict(table);
  const a = createAnnotate({ dict: d, levels, isKnown: (l) => l === 'payload' });
  assert.deepEqual(await a(['payload']), {});
  assert.deepEqual(d.calls, []);
});

test('C2: 기준 등급 C2 는 C2 단어와 목록 밖 단어만(C1 exterior·B2 delve 는 빠진다)', async () => {
  assert.ok(ANNOTATE_LEVELS.includes('C2'));
  const a = createAnnotate({ dict: fakeDict(table), levels });
  assert.deepEqual(Object.keys(await a(['cloak', 'exterior', 'delves', 'payload'], 'C2')).sort(), ['cloak', 'payload']);
});

test('사전 오류는 캐시하지 않고 그대로 던진다', async () => {
  let n = 0;
  const dict = { lookup: async () => { if (n++ === 0) throw new Error('boom'); return { found: false }; } };
  const a = createAnnotate({ dict, levels });
  await assert.rejects(a(['payload']), /boom/);
  assert.deepEqual(await a(['payload']), {});
  assert.equal(n, 2);
});

// --- 맥 사전 실연동 (darwin + native/macdict 가 있을 때만) ---
const bin = new URL('../native/macdict', import.meta.url).pathname;
const skip = process.platform !== 'darwin' || !existsSync(bin) ? '맥이 아니거나 npm run build:dict 를 안 했어요' : false;

test('실연동: 보안 문장의 단어 중 payload·sanitize·mitigation 은 어렵고 the·include 는 안 나온다', { skip }, async () => {
  const dict = createDict();
  try {
    const a = createAnnotate({ dict });
    const sentence = 'Attackers exploit the vulnerability to escalate privileges; mitigations include sanitizing the payload';
    const words = [...new Set(sentence.toLowerCase().split(/[^a-z]+/).filter(Boolean))];
    const items = await a(words);
    for (const w of ['payload', 'sanitizing', 'mitigations']) assert.ok(items[w], `${w} 가 어려운 단어로 나와야 해요: ${Object.keys(items)}`);
    assert.equal(items.mitigations.lemma, 'mitigation');
    assert.equal(items.payload.gloss, '수익 하중');
    for (const w of ['the', 'include', 'to']) assert.equal(items[w], undefined, w);
    assert.ok(Object.values(items).every((v) => v.gloss && v.lemma));
  } finally {
    dict.close();
  }
});

test('실연동: 상주 도우미로 서로 다른 200단어를 500ms 안에 처리한다', { skip }, async () => {
  const dict = createDict();
  try {
    await dict.lookup('warmup'); // 도우미를 처음 띄우는 비용(약 1초)은 따로
    const text = readFileSync(new URL('../fixtures/security-article.txt', import.meta.url), 'utf8');
    const words = [...new Set(text.toLowerCase().match(/[a-z]{4,}/g))].slice(0, 200);
    assert.equal(words.length, 200);
    // npm test 는 파일을 병렬로 돌려 CPU 가 붐빈다. 기준(500ms)은 그대로 두고, 새 annotate(빈 캐시)로 3번 재서 가장 빠른 값을 본다(지연 시험의 표준 방식).
    let ms = Infinity;
    let items;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      items = await createAnnotate({ dict })(words);
      ms = Math.min(ms, performance.now() - t0);
      if (ms < 500) break;
    }
    console.log(`200단어 최고 ${ms.toFixed(0)}ms, 주석 ${Object.keys(items).length}개`);
    assert.ok(ms < 500, `${ms.toFixed(0)}ms`);
  } finally {
    dict.close();
  }
});
