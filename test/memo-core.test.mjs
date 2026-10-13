import test from 'node:test';
import assert from 'node:assert/strict';

// memo-core.js는 classic script이므로 import 후 전역에서 꺼낸다.
await import('../extension/selection-core.js');
await import('../extension/memo-core.js');

const { currentHeading, centerParagraphText, orderForList, padKey } = globalThis.readglossMemo;

test('currentHeading: 화면 위 1/3 선(top <= vh/3) 이하 중 마지막 소제목 객체 반환, 없으면 null', () => {
  const headings = [
    { text: '소제목 1', top: 50 },
    { text: '소제목 2', top: 200 },
    { text: '소제목 3', top: 500 },
  ];

  // 1. vh = 600 -> 기준선 200px. top <= 200인 [소제목 1, 소제목 2] 중 마지막은 소제목 2
  assert.deepEqual(currentHeading(headings, 600), { text: '소제목 2', top: 200 });

  // 2. vh = 300 -> 기준선 100px. top <= 100인 [소제목 1] 중 마지막은 소제목 1
  assert.deepEqual(currentHeading(headings, 300), { text: '소제목 1', top: 50 });

  // 3. vh = 100 -> 기준선 33.3px. 33.3px 이하인 소제목 없음 -> null
  assert.equal(currentHeading(headings, 100), null);

  // 4. 경계값: top === vh/3 포함
  assert.deepEqual(currentHeading([{ text: '경계', top: 100 }], 300), { text: '경계', top: 100 });

  // 5. 빈 배열이거나 잘못된 입력은 null
  assert.equal(currentHeading([], 600), null);
  assert.equal(currentHeading(null, 600), null);
  assert.equal(currentHeading(headings, null), null);
});

test('centerParagraphText: 글 앞 300자로 자른다', () => {
  // 1. 300자 이하 글은 그대로 유지
  const shortText = '짧은 문단 텍스트입니다.';
  assert.equal(centerParagraphText(shortText), shortText);

  // 2. 정확히 300자
  const exact300 = 'a'.repeat(300);
  assert.equal(centerParagraphText(exact300), exact300);

  // 3. 300자 초과 글은 앞 300자만 자름
  const longText = 'x'.repeat(400);
  assert.equal(centerParagraphText(longText), 'x'.repeat(300));
  assert.equal(centerParagraphText(longText).length, 300);

  // 4. 빈 문자열 및 비문자열 입력 처리
  assert.equal(centerParagraphText(''), '');
  assert.equal(centerParagraphText(null), '');
  assert.equal(centerParagraphText(undefined), '');
});

test('orderForList: 이 페이지 메모(정규화 주소 같음) 먼저, 그다음 나머지 최근 순', () => {
  const memos = [
    { id: 'm_1', url: 'https://example.com/other', text: '다른 페이지 옛 메모', ts: 100 },
    { id: 'm_2', url: 'https://example.com/page?utm_source=feed#frag', text: '이 페이지 최신 메모', ts: 300 },
    { id: 'm_3', url: 'https://example.com/other', text: '다른 페이지 최신 메모', ts: 400 },
    { id: 'm_4', url: 'https://example.com/page/', text: '이 페이지 옛 메모', ts: 200 },
  ];

  const currentUrl = 'https://example.com/page';
  const ordered = orderForList(memos, currentUrl);

  // 1. 이 페이지 메모(m_2, m_4)가 먼저 오고, 그 안에서 최신순(ts: 300 -> 200)
  // 2. 그다음 다른 페이지 메모(m_3, m_1)가 오고, 그 안에서 최신순(ts: 400 -> 100)
  assert.deepEqual(ordered.map((m) => m.id), ['m_2', 'm_4', 'm_3', 'm_1']);

  // 3. 원본 배열은 변경되지 않아야 함
  assert.equal(memos[0].id, 'm_1');

  // 4. 빈 배열이거나 잘못된 입력 처리
  assert.deepEqual(orderForList([], currentUrl), []);
  assert.deepEqual(orderForList(null, currentUrl), []);
});

test('padKey: textarea 안 키 이벤트 판정 (Enter=save, Shift+Enter=newline, Esc=fold, 그 밖=null)', () => {
  // 1. Enter (Shift 아님, 조합 중 아님) -> 'save'
  assert.equal(padKey({ key: 'Enter', shiftKey: false, isComposing: false }), 'save');

  // 2. Shift + Enter -> 'newline'
  assert.equal(padKey({ key: 'Enter', shiftKey: true, isComposing: false }), 'newline');

  // 3. 한글 등 IME 조합 중 Enter -> null
  assert.equal(padKey({ key: 'Enter', shiftKey: false, isComposing: true }), null);
  assert.equal(padKey({ key: 'Enter', shiftKey: true, isComposing: true }), null);

  // 4. Ctrl, Meta, Alt와 함께 누른 Enter -> null (특수 조합 키는 기본 save가 아님)
  assert.equal(padKey({ key: 'Enter', ctrlKey: true, shiftKey: false, isComposing: false }), null);
  assert.equal(padKey({ key: 'Enter', metaKey: true, shiftKey: false, isComposing: false }), null);
  assert.equal(padKey({ key: 'Enter', altKey: true, shiftKey: false, isComposing: false }), null);

  // 5. Esc -> 'fold'
  assert.equal(padKey({ key: 'Escape', isComposing: false }), 'fold');

  // 6. 그 밖의 키 -> null
  assert.equal(padKey({ key: 'a', isComposing: false }), null);
  assert.equal(padKey({ key: 'Backspace', isComposing: false }), null);
  assert.equal(padKey({ key: 'Tab', isComposing: false }), null);
  assert.equal(padKey(null), null);
});
