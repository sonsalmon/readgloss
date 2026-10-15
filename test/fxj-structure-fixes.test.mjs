// test/fxj-structure-fixes.test.mjs
// 과제 FX-J: 문장 구조 검증 문제 해결 시험.
// 1. 끔->켬 뒤 다시 표시(done WeakSet 재할당, 소스 및 stop 동작 검사)
// 2. 중첩 블록(blockquote>p) 한 번만, 문단 경계 줄바꿈으로 sentence 분리(blockText 순수 함수)
// 3. 긴 제목 300자 자르기(truncateTitle 순수 함수)
// 4. 링크 안 구절(shouldOpenOnClick: inLink, altKey, inOurUi, selectionEmpty)
// 5. "뜻 위치·단어 표시 둘 다 없음"이어도 켜짐(isEnabled 판정)
// 6. 글자 노드 여럿에 걸친 구절 위치 변환(resolveNodeOffsets 순수 함수)
// 7. 다리: phrase 가 sentence 안에 없으면 400, Esc 플래그 확인, 응답 경쟁 방지

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '../extension/structure-core.js';
const core = globalThis.readglossStructureCore;

import { createBridge } from '../bridge/server.mjs';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const MINE = `chrome-extension://${EXT}`;
const HOST = '127.0.0.1:47831';

// --- 서버 HTTP 헬퍼 ---
async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-fxj-srv-'));
  const bridge = createBridge({
    ask: async () => '{"gloss":"뜻"}',
    askContext: async () => '{"translation":"번역"}',
    askStructure: async () => JSON.stringify({
      skeleton: [{ role: '주어', text: 'Condition' }, { role: '동사', text: 'holds' }],
      phrase: 'in which = 조건이 성립하는',
      ko: '그 조건이 성립한다.',
    }),
    cacheFile: join(dir, 'cache.json'),
    tokenFile: join(dir, 'token'),
    extensionId: EXT,
  });

  const port = await bridge.listen(0);
  const token = readFileSync(join(dir, 'token'), 'utf8');

  const req = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        { host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: t,
              json: () => JSON.parse(t),
            }),
          );
        },
      );
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });

  const auth = { 'X-Bridge-Token': token, Origin: MINE };
  return {
    bridge,
    dir,
    auth,
    post: (body) => req('POST', '/explain-structure', { headers: auth, body }),
  };
}

// -------------------------------------------------------------
// 1. 끔->켬 뒤 다시 표시: done WeakSet 재할당 소스 검사
// -------------------------------------------------------------
test('FX-J 1: stop() 시 done = new WeakSet() 재할당 및 항목 초기화 소스 검사', () => {
  const src = readFileSync(join(process.cwd(), 'extension/structure.js'), 'utf8');

  // done 이 let 으로 선언되어 재할당 가능해야 함
  assert.match(src, /let\s+done\s*=\s*new\s+WeakSet\(\);/, 'done 은 let 으로 선언되어야 한다');

  // stop() 안에서 done = new WeakSet(), entriesByBlock.clear(), updateHighlights() 실행 확인
  const stopMatch = /function\s+stop\(\)\s*\{([\s\S]*?)\}/.exec(src);
  assert.ok(stopMatch, 'stop 함수가 존재해야 한다');
  const stopBody = stopMatch[1];
  assert.match(stopBody, /done\s*=\s*new\s+WeakSet\(\);/, 'stop() 에서 done 을 새 WeakSet 으로 재할당해야 한다');
  assert.match(stopBody, /entriesByBlock\.clear\(\);/, 'stop() 에서 entriesByBlock 을 비워야 한다');
  assert.match(stopBody, /updateHighlights\(\);/, 'stop() 에서 updateHighlights 를 불러야 한다');
});

// -------------------------------------------------------------
// 2. 중첩 블록 한 번만, 문단 경계 줄바꿈으로 sentence 분리 (blockText)
// -------------------------------------------------------------
test('FX-J 2: blockText 순수 함수 및 문단 경계 줄바꿈 분리', () => {
  assert.equal(typeof core.blockText, 'function', 'core.blockText 함수가 존재해야 한다');

  // 1) 일반 텍스트 노드 이어붙이기
  const simple = core.blockText([{ text: 'Hello ' }, { text: 'world.' }]);
  assert.equal(simple, 'Hello world.');

  // 2) 경계(isBoundary) 요소 사이에 줄바꿈(\n) 삽입
  const withBoundary = core.blockText([
    { text: 'First line.' },
    { isBoundary: true },
    { text: 'Second line.' },
  ]);
  assert.equal(withBoundary, 'First line.\nSecond line.');

  // 3) 연속된 경계 요소가 있어도 중복 줄바꿈 방지
  const multiBoundary = core.blockText([
    { text: 'First line.' },
    { isBoundary: true },
    { isBoundary: true },
    { text: 'Second line.' },
  ]);
  assert.equal(multiBoundary, 'First line.\nSecond line.');

  // 4) sentenceAround 가 문단 경계(\n)를 넘지 않고 해당 문장만 추출하는지 검증
  const fullText = core.blockText([
    { text: 'First paragraph with unrelated words.' },
    { isBoundary: true },
    { text: 'This is the framework within which we operate.' },
    { isBoundary: true },
    { text: 'Third paragraph with another idea.' },
  ]);
  const phrases = core.findPhrases(fullText);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].phrase, 'within which');
  const sentence = core.sentenceAround(fullText, phrases[0].start, phrases[0].end);
  assert.equal(sentence, 'This is the framework within which we operate.');

  // 5) structure.js 에서 자식 BLOCK 을 경계로 수집하고 내부는 건너뛰는지 소스 검사
  const src = readFileSync(join(process.cwd(), 'extension/structure.js'), 'utf8');
  assert.match(src, /child\.matches\?\.\(BLOCK\)/, '자식 BLOCK 요소를 검사해야 한다');
  assert.match(src, /isBoundary:\s*true/, '경계 플래그를 추가해야 한다');
  assert.match(src, /closest\(BLOCK\)\s*!==\s*block/, '가장 가까운 블록 필터가 존재해야 한다');
});

// -------------------------------------------------------------
// 3. 긴 제목이면 300자로 자르기 (truncateTitle)
// -------------------------------------------------------------
test('FX-J 3: truncateTitle 순수 함수 및 제목 300자 자르기', () => {
  assert.equal(typeof core.truncateTitle, 'function', 'core.truncateTitle 함수가 존재해야 한다');

  // 300자 초과 문자열 자르기
  const longTitle = 'a'.repeat(350);
  const truncated = core.truncateTitle(longTitle, 300);
  assert.equal(truncated.length, 300);
  assert.equal(truncated, 'a'.repeat(300));

  // 300자 이하 문자열 유지
  assert.equal(core.truncateTitle('Short title', 300), 'Short title');
  assert.equal(core.truncateTitle('', 300), '');
  assert.equal(core.truncateTitle(null, 300), '');
  assert.equal(core.truncateTitle(undefined, 300), '');

  // 저장 버튼용 200자 자르기 확인
  assert.equal(core.truncateTitle('b'.repeat(250), 200).length, 200);

  // structure.js 소스 검사: openCard 및 저장 버튼에서 truncateTitle 사용
  const src = readFileSync(join(process.cwd(), 'extension/structure.js'), 'utf8');
  assert.match(src, /core\.truncateTitle\(document\.title,\s*300\)/, 'openCard 에서 제목을 300자로 잘라야 한다');
  assert.match(src, /core\.truncateTitle\(document\.title,\s*200\)/, '저장 버튼에서 제목을 200자로 잘라야 한다');
});

// -------------------------------------------------------------
// 4. 링크 안 구절 판정 (shouldOpenOnClick)
// -------------------------------------------------------------
test('FX-J 4: shouldOpenOnClick 순수 함수 및 링크 altKey 판정', () => {
  assert.equal(typeof core.shouldOpenOnClick, 'function', 'core.shouldOpenOnClick 함수가 존재해야 한다');

  // 일반 텍스트 클릭(링크 아님, alt 없음) -> 열림
  assert.equal(core.shouldOpenOnClick({ inLink: false, altKey: false }), true);

  // 링크 안, altKey 없음 -> 열지 않음 (기본 링크 이동으로 진행)
  assert.equal(core.shouldOpenOnClick({ inLink: true, altKey: false }), false);

  // 링크 안, altKey 있음 -> 열림 (⌥+클릭)
  assert.equal(core.shouldOpenOnClick({ inLink: true, altKey: true }), true);

  // 우리 UI 호스트 클릭 -> 절대 열지 않음
  assert.equal(core.shouldOpenOnClick({ inOurUi: true }), false);
  assert.equal(core.shouldOpenOnClick({ inLink: false, altKey: false, inOurUi: true }), false);
  assert.equal(core.shouldOpenOnClick({ inLink: true, altKey: true, inOurUi: true }), false);

  // 텍스트 선택 드래그 중(selectionEmpty: false) -> 열지 않음
  assert.equal(core.shouldOpenOnClick({ selectionEmpty: false }), false);
  assert.equal(core.shouldOpenOnClick({ inLink: false, altKey: false, selectionEmpty: false }), false);

  // structure.js 소스 검사: inLink && e.altKey 일 때 preventDefault 호출 확인
  const src = readFileSync(join(process.cwd(), 'extension/structure.js'), 'utf8');
  assert.match(src, /if\s*\(inLink\s*&&\s*e\.altKey\)\s*\{\s*e\.preventDefault\(\);\s*\}/, '링크 안 alt 클릭 시 preventDefault 를 불러야 한다');
});

// -------------------------------------------------------------
// 5. "뜻 위치·단어 표시 둘 다 없음"이어도 켜짐
// -------------------------------------------------------------
test('FX-J 5: isEnabled 판정에서 A.annotating 대신 enabledHere 사용', () => {
  const src = readFileSync(join(process.cwd(), 'extension/structure.js'), 'utf8');

  // A.annotating 은 position==='none' && mark==='none' 일 때 false 가 되므로 쓰면 안 됨
  assert.doesNotMatch(src, /A\?\.annotating/, 'isEnabled 에서 A.annotating 을 호출하지 않아야 한다');
  assert.match(src, /enabledHere/, 'isEnabled 에서 enabledHere 를 사용해야 한다');
});

// -------------------------------------------------------------
// 6. 글자 노드 여럿에 걸친 구절 위치 변환 (resolveNodeOffsets)
// -------------------------------------------------------------
test('FX-J 6: resolveNodeOffsets 순수 함수 (여럿 노드 및 br 걸침)', () => {
  assert.equal(typeof core.buildNodeIndex, 'function', 'core.buildNodeIndex 함수가 존재해야 한다');
  assert.equal(typeof core.resolveNodeOffsets, 'function', 'core.resolveNodeOffsets 함수가 존재해야 한다');

  // 1) <b>in</b> which (두 노드에 걸친 구절)
  const node1 = { id: 1 };
  const node2 = { id: 2 };
  const nodesSplit = [
    { node: node1, text: 'the condition in' },
    { node: node2, text: ' which we test' },
  ];
  const idx1 = core.buildNodeIndex(nodesSplit);
  assert.equal(idx1.text, 'the condition in which we test');

  const matches1 = core.findPhrases(idx1.text);
  assert.equal(matches1.length, 1);
  assert.equal(matches1[0].phrase, 'in which');

  const loc1 = core.resolveNodeOffsets(idx1.entries, matches1[0].start, matches1[0].end);
  assert.ok(loc1);
  assert.equal(loc1.startNode, node1);
  assert.equal(loc1.startOffset, 14); // 'the condition in' 에서 'in' 시작 (인덱스 14)
  assert.equal(loc1.endNode, node2);
  assert.equal(loc1.endOffset, 6);   // ' which' 에서 'which' 끝 (인덱스 6)

  // 2) in<br>which (중간에 br 태그가 끼어 줄바꿈된 경우)
  const nodeA = { id: 'A' };
  const brNode = { id: 'BR' };
  const nodeB = { id: 'B' };
  const nodesBr = [
    { node: nodeA, text: 'rule in' },
    { isBoundary: true, node: brNode, isBr: true },
    { node: nodeB, text: 'which it applies' },
  ];
  const idx2 = core.buildNodeIndex(nodesBr);
  assert.equal(idx2.text, 'rule in\nwhich it applies');

  const matches2 = core.findPhrases(idx2.text);
  assert.equal(matches2.length, 1);
  assert.equal(matches2[0].phrase, 'in\nwhich');

  const loc2 = core.resolveNodeOffsets(idx2.entries, matches2[0].start, matches2[0].end);
  assert.ok(loc2);
  assert.equal(loc2.startNode, nodeA);
  assert.equal(loc2.startOffset, 5); // 'rule in' 에서 'in' 시작 (인덱스 5)
  assert.equal(loc2.endNode, nodeB);
  assert.equal(loc2.endOffset, 5);   // 'which' 끝 (인덱스 5)

  // 3) 단일 노드 안 구절
  const singleNode = { id: 'single' };
  const idx3 = core.buildNodeIndex([{ node: singleNode, text: 'for which' }]);
  const loc3 = core.resolveNodeOffsets(idx3.entries, 0, 9);
  assert.deepEqual(loc3, {
    startNode: singleNode,
    startOffset: 0,
    endNode: singleNode,
    endOffset: 9,
  });

  // 4) 범위 벗어남
  assert.equal(core.resolveNodeOffsets(idx3.entries, 20, 30), null);
});

// -------------------------------------------------------------
// 7. 작은 것: 다리 phrase 검증(400), Esc 및 응답 경쟁
// -------------------------------------------------------------
test('FX-J 7: 다리 phrase 검증(문장에 없으면 400), Esc 및 응답 경쟁 방지', async () => {
  // 1) 다리 서버 검증
  const s = await startServer();
  try {
    // 문장 안에 구절이 없는 경우 -> 400 bad-request
    const resNoPhrase = await s.post({
      sentence: 'The quick brown fox jumps over the lazy dog.',
      phrase: 'in which',
    });
    assert.equal(resNoPhrase.status, 400);
    assert.deepEqual(resNoPhrase.json(), { error: 'bad-request' });

    // 문장 안에 구절이 있는 경우 -> 200 성공
    const resOk = await s.post({
      sentence: 'This is the framework in which we operate.',
      phrase: 'in which',
    });
    assert.equal(resOk.status, 200);
    assert.equal(resOk.json().pattern, 'prep+which');
  } finally {
    await s.bridge.close();
  }

  // 2) Esc 키 리스너 소스 검사: e.readglossCardClosed 검사 및 stopPropagation 미호출
  const src = readFileSync(join(process.cwd(), 'extension/structure.js'), 'utf8');
  assert.match(src, /if\s*\(e\.readglossCardClosed\)\s*return;/, 'Esc 에서 이미 닫힌 카드 플래그를 확인해야 한다');
  assert.match(src, /e\.readglossCardClosed\s*=\s*true;/, 'Esc 에서 readglossCardClosed 플래그를 설정해야 한다');

  const escBlock = /if\s*\(e\.key\s*===\s*'Escape'[\s\S]*?closeCard\(\);/.exec(src)?.[0] ?? '';
  assert.doesNotMatch(escBlock, /stopPropagation/, 'Esc 핸들러에서 stopPropagation 을 부르지 않아야 한다');

  // 3) 응답 경쟁 방지: currentRequestId 증가 및 검사
  assert.match(src, /let\s+currentRequestId\s*=\s*0;/, 'currentRequestId 변수가 선언되어야 한다');
  assert.match(src, /const\s+reqId\s*=\s*\+\+currentRequestId;/, '열 때마다 requestId 를 올려야 한다');
  assert.match(src, /reqId\s*!==\s*currentRequestId/, '응답 시 requestId 일치를 확인해야 한다');
});
