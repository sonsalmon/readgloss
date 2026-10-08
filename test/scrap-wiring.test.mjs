import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../extension/text.js');
await import('../extension/selection-core.js');
const S = globalThis.readglossSelection;

const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('scrapMessage 모양: {type:"scraps", op:"save", url(정규화), title, headings≤3, quote, pos, translation, task}', () => {
  const msg = S.scrapMessage({
    url: 'https://portswigger.net/web-security/access-control/?utm_source=test#frag',
    title: 'Access Control Vulnerabilities',
    headings: ['Section 1', 'Section 2', 'Section 3', 'Section 4'],
    quote: {
      exact: 'Insecure direct object references (IDOR) are a type of access control vulnerability.',
      prefix: 'Background context: ',
      suffix: ' For example, an application might...',
    },
    pos: 1234,
    translation: '안전하지 않은 직접 객체 참조(IDOR)는 접근 통제 취약점의 한 유형입니다.',
    task: 'S1-04',
  });

  assert.equal(msg.type, 'scraps');
  assert.equal(msg.op, 'save');
  assert.equal(msg.url, 'https://portswigger.net/web-security/access-control');
  assert.equal(msg.title, 'Access Control Vulnerabilities');
  assert.deepEqual(msg.headings, ['Section 2', 'Section 3', 'Section 4']);
  assert.deepEqual(msg.quote, {
    exact: 'Insecure direct object references (IDOR) are a type of access control vulnerability.',
    prefix: 'Background context: ',
    suffix: ' For example, an application might...',
  });
  assert.equal(msg.pos, 1234);
  assert.equal(msg.translation, '안전하지 않은 직접 객체 참조(IDOR)는 접근 통제 취약점의 한 유형입니다.');
  assert.equal(msg.task, 'S1-04');

  // task가 유효하지 않은 형식이면 null
  const msg2 = S.scrapMessage({ url: 'https://example.com', task: 'INVALID' });
  assert.equal(msg2.task, null);

  // headings 상한 3개, 각 200자
  const longH = 'a'.repeat(300);
  const msg3 = S.scrapMessage({ url: 'https://example.com', headings: [longH] });
  assert.equal(msg3.headings[0].length, 200);

  // quote 상한: exact 1000, prefix 64, suffix 64
  const msg4 = S.scrapMessage({
    url: 'https://example.com',
    quote: { exact: 'e'.repeat(1200), prefix: 'p'.repeat(100), suffix: 's'.repeat(100) },
  });
  assert.equal(msg4.quote.exact.length, 1000);
  assert.equal(msg4.quote.prefix.length, 64);
  assert.equal(msg4.quote.suffix.length, 64);
});

test('⌥S 처리기는 카드 열림 조건 안에만 있다', () => {
  const src = read('selection.js');
  // ⌥S는 host(카드)가 열려 있을 때만 실행되어야 한다
  assert.match(src, /host\s*&&\s*e\.code\s*===\s*['"]KeyS['"]\s*&&\s*e\.altKey/);
  // 전역 commands에는 등록되지 않았음을 확인
  const manifest = read('manifest.json');
  assert.doesNotMatch(manifest, /"commands"/);
});

test('다리 꺼짐이면 기존 꺼짐 안내를 쓴다', () => {
  const sel = read('selection.js');
  // 스크랩 저장/삭제 실패 시 기존 notify(errText(r))를 사용한다
  assert.match(sel, /notify\(errText\(r\)\)/);

  // background.js 가 'scraps' 메시지를 다리로 중계하고 BridgeOff 를 처리한다
  const bg = read('background.js');
  assert.match(bg, /msg\?\.type\s*!==\s*['"]scraps['"]/);
  assert.match(bg, /let path = ['"]\/scraps['"]/); // 경로는 path 변수로 만들어 bridgeFetch(path, init)에 넘긴다
  assert.match(bg, /BridgeOff\s*\?\s*['"]bridge-off['"]/);
});

test('밖 페이지 답은 chrome.storage.local 키 scrapAsk:<날짜>:<정규화 주소>', () => {
  // 순수 함수 키 생성 확인
  const key = S.scrapAskKey('2026-10-08', 'https://portswigger.net/web-security/access-control/?utm_source=t#frag');
  assert.equal(key, 'scrapAsk:2026-10-08:https://portswigger.net/web-security/access-control');

  // selection.js 에서 해당 storage 키를 사용하는지 확인
  const sel = read('selection.js');
  assert.match(sel, /scrapAskKey/);
  assert.match(sel, /storage/);
});

// T25 fix A: 막대 ← → 는 우리 화면 안에서 눌리면 아무것도 안 하고, 무시할 때는 preventDefault 전에 빠진다
test('onBarKeyDown: 우리 화면 판정(isOwnUiPath) 뒤에만 preventDefault', () => {
  const src = read('scrap.js');
  const body = src.slice(src.indexOf('function onBarKeyDown'), src.indexOf('function openBar'));
  const check = body.indexOf('isOwnUiPath?.(path, barHost)');
  assert.ok(check > 0, 'isOwnUiPath 판정이 있어야 한다');
  assert.ok(check < body.indexOf('e.preventDefault()'), '판정 뒤에 preventDefault');
});
