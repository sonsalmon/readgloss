import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// extension/annotate-core.js 는 text.js 와 같은 classic script. 전역 readglossAnnotate 로 쓴다.
await import('../extension/annotate-core.js');
const { MAX_WORDS, candidates, blockCandidates, chooseSpans, splitText, chunk, isDarkColor } = globalThis.readglossAnnotate;
const words = (text, before) => candidates(text, before).map((c) => c.word);

test('candidates: 4글자 이상 단어만, 소문자로', () => {
  assert.deepEqual(words('the quick brown fox jumps over a lazy dog'), ['quick', 'brown', 'jumps', 'over', 'lazy']);
  assert.deepEqual(words('see use run'), []);
});

test('candidates: 위치(start,end)와 원문 글자를 함께 준다', () => {
  const t = 'An attacker sends payloads.';
  const [a, , p] = candidates(t);
  assert.deepEqual({ ...a, raw: t.slice(a.start, a.end) }, { word: 'attacker', raw: 'attacker', start: 3, end: 11 });
  assert.equal(t.slice(p.start, p.end), 'payloads');
});

test('candidates: 전부 대문자(약어)는 제외, 안쪽에 대문자가 있는 식별자(JavaScript, iPhone)도 제외', () => {
  assert.deepEqual(words('Use HTTPS and TLS with OAuth on JavaScript or iPhone, then NASA CVE-2024 SQLI'), ['with', 'then']);
  assert.deepEqual(words('cross-site CROSS-SITE'), ['cross-site']);
});

test('candidates: 문장 중간 대문자 시작은 고유명사로 제외, 문장 첫 단어는 소문자 후보', () => {
  assert.deepEqual(words('Attackers use Microsoft tools. Defenders patch Linux kernels! Why? Because Windows'), ['attackers', 'tools', 'defenders', 'patch', 'kernels', 'because']);
  assert.deepEqual(words('He said "Exploit this." Then (Delete it)'), ['said', 'this', 'then']); // 따옴표·괄호는 건너뛰고 앞 글자로 판단
  assert.deepEqual(words('"Exploit this." (Delete it) [Drop it]'), ['exploit', 'this', 'delete']); // 문장이 끝나지 않았으니 [Drop 은 고유명사 취급
});

test('candidates: 블록 맨 앞이나 앞 글자가 문장 끝이면 문장 첫머리, 아니면 앞 글자(before)를 이어서 판단', () => {
  assert.deepEqual(words('Payload delivered'), ['payload', 'delivered']);
  assert.deepEqual(words('Payload delivered', 'Previous sentence ends here. '), ['payload', 'delivered']);
  assert.deepEqual(words('Payload delivered', 'the attacker sends a '), ['delivered']);
  assert.deepEqual(words('Payload delivered', ''), ['payload', 'delivered']);
  assert.deepEqual(words('  \n  Payload'), ['payload']);
});

test('candidates: 축약·소유격·숫자·URL·파일 이름에 붙은 조각은 제외', () => {
  assert.deepEqual(words("doesn't it's attacker's payload's don't"), ['attacker', 'payload']);
  assert.deepEqual(words('x86 2fa abcd1234 tokens4you word_part snake_case'), []);
  assert.deepEqual(words('visit https://example.com/pathname or user@example.org and node.js file.txt'), ['visit']);
  assert.deepEqual(words('café résumé naïve'), []);
});

test('candidates: 하이픈 낱말은 한 단어, 끝 하이픈은 뺀다', () => {
  assert.deepEqual(words('a well-known cross-site anti- tool'), ['well-known', 'cross-site', 'anti', 'tool']);
});

test('blockCandidates: 텍스트 노드 여러 개를 이어 문맥을 보고, 노드 번호와 노드 안 위치로 돌려준다', () => {
  // <p>Attackers <em>exploit</em> the Linux kernel. <b>Payloads</b> run.</p>
  const texts = ['Attackers ', 'exploit', ' the Linux kernel. ', 'Payloads', ' run.'];
  const got = blockCandidates(texts).map((c) => [c.node, c.word, texts[c.node].slice(c.start, c.end)]);
  assert.deepEqual(got, [
    [0, 'attackers', 'Attackers'],
    [1, 'exploit', 'exploit'],
    [2, 'kernel', 'kernel'],
    [3, 'payloads', 'Payloads'], // 앞 문장이 끝났으니 문장 첫머리
  ]);
});

test('blockCandidates: 노드 경계를 걸치는 낱말(pay<b>load</b>)은 버린다', () => {
  assert.deepEqual(blockCandidates(['The pay', 'load is large']).map((c) => c.word), ['large']);
});

const occ = (word, node, start) => ({ word, node, start, end: start + word.length });
const items = {
  delves: { lemma: 'delve', level: 'B2', gloss: '파고들다' },
  delve: { lemma: 'delve', level: 'B2', gloss: '파고들다' },
  payload: { lemma: 'payload', level: null, gloss: '수익 하중' },
};

test('chooseSpans: 어려운 단어만, 같은 원형은 블록에서 첫 번째만', () => {
  const picked = chooseSpans([occ('payload', 0, 0), occ('easy', 0, 8), occ('delves', 1, 0), occ('payload', 1, 7), occ('delve', 2, 0)], items);
  assert.deepEqual(picked.map((s) => [s.word, s.node, s.lemma, s.gloss]), [
    ['payload', 0, 'payload', '수익 하중'],
    ['delves', 1, 'delve', '파고들다'],
  ]);
});

test('chooseSpans: 이미 주석 붙은 원형(seen)은 건너뛰고, 새로 고른 원형을 seen 에 더한다', () => {
  const seen = new Set(['payload']);
  const picked = chooseSpans([occ('payload', 0, 0), occ('delves', 0, 8)], items, seen);
  assert.deepEqual(picked.map((s) => s.word), ['delves']);
  assert.deepEqual([...seen].sort(), ['delve', 'payload']);
});

test('chooseSpans: seen 이 null 이면 같은 원형도 매번, limit 은 개수 상한, skip 은 아는 단어 원형', () => {
  const occs = [occ('payload', 0, 0), occ('payload', 0, 8), occ('delves', 0, 16), occ('delve', 0, 24)];
  assert.equal(chooseSpans(occs, items, null).length, 4);
  assert.equal(chooseSpans(occs, items, new Set()).length, 2);
  assert.deepEqual(chooseSpans(occs, items, null, { limit: 3 }).map((s) => s.start), [0, 8, 16]);
  assert.deepEqual(chooseSpans(occs, items, null, { limit: 0 }), []);
  assert.deepEqual(chooseSpans(occs, items, new Set(), { skip: new Set(['payload']) }).map((s) => s.lemma), ['delve']);
  const seen = new Set();
  chooseSpans(occs, items, seen, { limit: 1 });
  assert.deepEqual([...seen], ['payload']); // 상한에 걸려 못 붙인 원형은 seen 에 안 들어간다
});

test('splitText: 텍스트 + 위치 -> 조각(글자는 하나도 잃지 않는다)', () => {
  const t = 'The payload and delves deep';
  const spans = [{ start: 4, end: 11, gloss: '수익 하중', lemma: 'payload' }, { start: 16, end: 22, gloss: '파고들다', lemma: 'delve' }];
  const pieces = splitText(t, spans);
  assert.deepEqual(pieces, [
    { text: 'The ' },
    { text: 'payload', gloss: '수익 하중', lemma: 'payload' },
    { text: ' and ' },
    { text: 'delves', gloss: '파고들다', lemma: 'delve' },
    { text: ' deep' },
  ]);
  assert.equal(pieces.map((p) => p.text).join(''), t);
});

test('splitText: 맨 앞·맨 끝·붙은 위치·위치 없음·순서가 뒤섞인 입력', () => {
  assert.deepEqual(splitText('payload', []), [{ text: 'payload' }]);
  assert.deepEqual(splitText('payload', [{ start: 0, end: 7, gloss: 'g', lemma: 'l' }]), [{ text: 'payload', gloss: 'g', lemma: 'l' }]);
  const two = splitText('abcd efgh', [{ start: 5, end: 9, gloss: 'b', lemma: 'b' }, { start: 0, end: 4, gloss: 'a', lemma: 'a' }]);
  assert.deepEqual(two.map((p) => p.text), ['abcd', ' ', 'efgh']);
  assert.deepEqual(splitText('', []), []);
});

test('chunk: 300개씩 나눈다', () => {
  assert.equal(MAX_WORDS, 300);
  const sizes = chunk(Array.from({ length: 650 }, (_, i) => i), MAX_WORDS).map((c) => c.length);
  assert.deepEqual(sizes, [300, 300, 50]);
  assert.deepEqual(chunk([], 300), []);
});

test('isDarkColor: 밝은 글자(어두운 배경 페이지)나 어두운 모드면 어두운 배경으로 본다', () => {
  assert.equal(isDarkColor('rgb(230, 232, 235)', false), true); // 밝은 글자 = 어두운 배경
  assert.equal(isDarkColor('rgb(31, 35, 40)', true), false); // 어두운 모드여도 글자가 어두우면 밝은 페이지
  assert.equal(isDarkColor('rgba(0, 0, 0, 0)', true), true); // 못 읽으면 어두운 모드 설정을 따른다
  assert.equal(isDarkColor('', false), false);
});

test('annotate-core.js: ES 모듈 import/export 없음, manifest 목록에 있다', () => {
  assert.doesNotMatch(readFileSync(new URL('../extension/annotate-core.js', import.meta.url), 'utf8'), /^\s*(import|export)\s/m);
  const js = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')).content_scripts[0].js;
  assert.ok(js.indexOf('annotate-core.js') > js.indexOf('paragraph-core.js') && js.indexOf('annotate-core.js') < js.indexOf('content.js'), js.join()); // 계약 G: 판단 로직은 content.js 앞
  assert.ok(js.indexOf('annotate.js') > js.indexOf('paragraph.js'), js.join());
});
