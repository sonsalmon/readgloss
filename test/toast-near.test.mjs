import test from 'node:test';
import assert from 'node:assert/strict';

// content.js 는 DOM 에 붙는 classic script 다. 여기서는 등록 호출만 받는 가짜 document·window 를 두고 순수 함수만 꺼낸다.
await import('../extension/text.js');
globalThis.document = { addEventListener() {} };
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
await import('../extension/content.js');
const { toastPosition, startsMemo } = globalThis.readglossToast;

const VIEW = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 40 };
const rect = (left, top, w = 100, h = 20) => ({ left, top, right: left + w, bottom: top + h });

test('toastPosition: 화면 가운데 anchor 는 아래 8px 에 맞춘다', () => {
  const p = toastPosition(rect(400, 300), SIZE, VIEW);
  assert.equal(p.placement, 'below');
  assert.equal(p.top, 320 + 8, 'top = anchor.bottom + 8');
  assert.equal(p.left, 400, '왼쪽은 anchor.left');
});

test('toastPosition: 아래 공간이 메시지 높이보다 모자라면 위 8px 에 띄운다', () => {
  const p = toastPosition(rect(400, 770), SIZE, VIEW); // bottom 790 -> 아래 여백 2 < 40
  assert.equal(p.placement, 'above');
  assert.equal(p.top, 770 - 8 - 40, 'top = anchor.top - 8 - 높이');
});

test('toastPosition: 메모 칸이 열려 높이가 커지면 아래 공간이 모자라 위로 다시 맞춘다', () => {
  assert.equal(toastPosition(rect(400, 600), { width: 200, height: 40 }, VIEW).placement, 'below');
  const p = toastPosition(rect(400, 600), { width: 200, height: 200 }, VIEW); // 아래 여백 172 < 200
  assert.equal(p.placement, 'above');
  assert.equal(p.top, 600 - 8 - 200);
});

test('toastPosition: 오른쪽 끝 anchor 는 왼쪽으로 밀어 오른쪽 여백 8px 을 지킨다', () => {
  const p = toastPosition(rect(990, 300, 10), SIZE, VIEW);
  assert.equal(p.placement, 'below');
  assert.ok(p.left <= VIEW.width - SIZE.width - 8, `left ${p.left}`);
  assert.equal(p.left, 792);
});

test('toastPosition: anchor 없음·null·화면 밖이면 아래 가운데', () => {
  const c = toastPosition(undefined, SIZE, VIEW);
  assert.equal(c.placement, 'bottom-center');
  assert.equal(c.left, 400, '가운데');
  assert.equal(c.top, 800 - 24 - 40, '화면 아래 24px 위');
  assert.equal(toastPosition(null, SIZE, VIEW).placement, 'bottom-center');
  assert.equal(toastPosition(rect(-500, 300), SIZE, VIEW).placement, 'bottom-center', '왼쪽 밖');
  assert.equal(toastPosition(rect(1200, 300), SIZE, VIEW).placement, 'bottom-center', '오른쪽 밖');
  assert.equal(toastPosition(rect(300, 900), SIZE, VIEW).placement, 'bottom-center', '아래 밖');
});

test('startsMemo: 영문 글자와 한글 입력기(Process, 자모 한 글자)는 메모를 연다', () => {
  assert.equal(startsMemo({ key: 'a' }, []), true);
  assert.equal(startsMemo({ key: 'Process' }, []), true);
  assert.equal(startsMemo({ key: 'ㅎ' }, []), true);
  assert.equal(startsMemo({ key: 'a', shiftKey: true }, [{ localName: 'div' }]), true, '페이지 요소 위에서도');
});

test('startsMemo: 공백·방향키·Esc·Enter 와 ctrl·meta·alt 조합은 열지 않는다', () => {
  assert.equal(startsMemo({ key: ' ' }, []), false, '스페이스는 페이지 스크롤과 겹친다');
  assert.equal(startsMemo({ key: 'ArrowDown' }, []), false);
  assert.equal(startsMemo({ key: 'Escape' }, []), false);
  assert.equal(startsMemo({ key: 'Enter' }, []), false);
  assert.equal(startsMemo({ key: 'c', metaKey: true }, []), false);
  assert.equal(startsMemo({ key: 'c', ctrlKey: true }, []), false);
  assert.equal(startsMemo({ key: 'c', altKey: true }, []), false);
  assert.equal(startsMemo({}, []), false);
});

test('startsMemo: 경로에 입력칸(input·textarea·select·contenteditable)이 있으면 열지 않는다', () => {
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'input' }, { localName: 'body' }]), false);
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'textarea' }]), false);
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'select' }]), false);
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'p', isContentEditable: true }]), false);
});

test('startsMemo: 우리 카드 안(닫힌 shadow 의 입력칸 포함)에서 친 글자는 메모를 열지 않고, 확인 메시지 위에서는 연다', () => {
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'readgloss-selection' }, { localName: 'body' }]), false, '드래그 카드의 내 사전 입력칸');
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'readgloss-card' }]), false);
  assert.equal(startsMemo({ key: 'a' }, [{ localName: 'readgloss-toast' }, { localName: 'body' }]), true, '메시지의 [메모] 버튼 위');
});
