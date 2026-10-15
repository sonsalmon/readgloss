import test from 'node:test';
import assert from 'node:assert/strict';

// extension/md-list.js는 classic script이므로 import 후 전역에서 꺼낸다.
await import('../extension/md-list.js');

const {
  onEnter,
  onShiftEnter,
  onTab,
  ensureStartsList,
  cleanForSave,
  appendNewItem,
} = globalThis.readglossMdList;

// ---- 1. onEnter ----
test('onEnter: 줄 끝에서 Enter를 치면 다음 줄에 같은 들여쓰기의 - 가 생긴다', () => {
  const v = '- 첫 번째 항목';
  const res = onEnter(v, v.length, v.length);
  const expected = '- 첫 번째 항목\n- ';
  assert.deepEqual(res, {
    value: expected,
    selStart: expected.length,
    selEnd: expected.length,
  });
});

test('onEnter: 줄 중간에서 Enter를 치면 커서 위치에서 나뉘고 다음 줄에 - 가 생긴다', () => {
  const v = '- 앞부분 뒷부분';
  const splitPos = 5; // '- 앞부분' 끝
  const res = onEnter(v, splitPos, splitPos);
  assert.deepEqual(res, {
    value: '- 앞부분\n-  뒷부분',
    selStart: 8,
    selEnd: 8,
  });
});

test('onEnter: 들여쓴 항목에서 줄 끝 Enter를 치면 같은 들여쓰기의 - 가 생긴다', () => {
  const v = '  - 하위 항목';
  const res = onEnter(v, v.length, v.length);
  const expected = '  - 하위 항목\n  - ';
  assert.deepEqual(res, {
    value: expected,
    selStart: expected.length,
    selEnd: expected.length,
  });
});

test('onEnter: 빈 항목(최상위 - )에서 Enter를 치면 그 줄을 빈 줄로 만든다 (null 대신 결과 반환)', () => {
  // 단독 빈 항목
  const single = '- ';
  const res1 = onEnter(single, 2, 2);
  assert.deepEqual(res1, {
    value: '',
    selStart: 0,
    selEnd: 0,
  });

  // 다른 줄 뒤의 빈 항목
  const multi = '- 첫째 항목\n- ';
  const res2 = onEnter(multi, multi.length, multi.length);
  assert.deepEqual(res2, {
    value: '- 첫째 항목\n',
    selStart: 8,
    selEnd: 8,
  });
});

test('onEnter: 들여쓴 빈 항목에서 Enter를 치면 한 단계(2칸) 내어쓴 - 로 바뀐다', () => {
  // 2칸 들여쓴 빈 항목 -> 최상위 - 
  const v2 = '  - ';
  const res2 = onEnter(v2, 4, 4);
  assert.deepEqual(res2, {
    value: '- ',
    selStart: 2,
    selEnd: 2,
  });

  // 4칸 들여쓴 빈 항목 -> 2칸 들여쓴 - 
  const v4 = '    - ';
  const res4 = onEnter(v4, 6, 6);
  assert.deepEqual(res4, {
    value: '  - ',
    selStart: 4,
    selEnd: 4,
  });
});

test('onEnter: 목록 형식이 아닌 줄에서는 null을 반환한다', () => {
  const plain = '일반 텍스트 줄';
  assert.equal(onEnter(plain, 3, 3), null);

  const num = '1. 번호 매겨진 목록';
  assert.equal(onEnter(num, 3, 3), null);

  const asterisk = '* 별표 목록';
  assert.equal(onEnter(asterisk, 2, 2), null);
});

test('onEnter: 선택 영역이 있을 때 Enter를 치면 선택 영역을 지우고 줄바꿈 및 같은 들여쓰기를 넣는다', () => {
  const v = '- 12345';
  // '34' 선택 (index 4 ~ 6)
  const res = onEnter(v, 4, 6);
  assert.deepEqual(res, {
    value: '- 12\n- 5',
    selStart: 7,
    selEnd: 7,
  });
});

// ---- 2. onShiftEnter ----
test('onShiftEnter: 최상위 목록 줄에서 Shift+Enter는 줄바꿈 후 항목 글 시작 열(2칸)까지 공백을 넣는다', () => {
  const v = '- 첫 번째 항목';
  const res = onShiftEnter(v, v.length, v.length);
  const expected = '- 첫 번째 항목\n  ';
  assert.deepEqual(res, {
    value: expected,
    selStart: expected.length,
    selEnd: expected.length,
  });
});

test('onShiftEnter: 들여쓴 목록 줄에서 Shift+Enter는 들여쓰기+2칸(4칸)까지 공백을 넣는다', () => {
  const v = '  - 하위 항목';
  const res = onShiftEnter(v, v.length, v.length);
  const expected = '  - 하위 항목\n    ';
  assert.deepEqual(res, {
    value: expected,
    selStart: expected.length,
    selEnd: expected.length,
  });
});

test('onShiftEnter: 줄 중간에서 Shift+Enter를 치면 줄을 나누고 다음 줄에 열 맞춤 공백을 넣는다', () => {
  const v = '- 앞부분 뒷부분';
  const splitPos = 5;
  const res = onShiftEnter(v, splitPos, splitPos);
  assert.deepEqual(res, {
    value: '- 앞부분\n   뒷부분',
    selStart: 8,
    selEnd: 8,
  });
});

test('onShiftEnter: 목록이 아닌 줄에서는 null을 반환한다', () => {
  const plain = '목록이 아닙니다';
  assert.equal(onShiftEnter(plain, 3, 3), null);
});

// ---- 3. onTab ----
test('onTab: 단일 줄에서 Tab을 누르면 2칸 들여쓰기된다', () => {
  const v = '- 항목';
  const res = onTab(v, 2, 2, false);
  assert.deepEqual(res, {
    value: '  - 항목',
    selStart: 4,
    selEnd: 4,
  });
});

test('onTab: 단일 줄에서 Shift+Tab을 누르면 2칸 내어쓰기된다', () => {
  const v = '  - 항목';
  const res = onTab(v, 4, 4, true);
  assert.deepEqual(res, {
    value: '- 항목',
    selStart: 2,
    selEnd: 2,
  });
});

test('onTab: 앞 공백이 2칸 미만(1칸)일 때 Shift+Tab은 있는 만큼(1칸)만 내어쓴다', () => {
  const v = ' - 항목';
  const res = onTab(v, 3, 3, true);
  assert.deepEqual(res, {
    value: '- 항목',
    selStart: 2,
    selEnd: 2,
  });
});

test('onTab: 앞 공백이 0칸일 때 Shift+Tab은 줄과 커서를 그대로 유지한다', () => {
  const v = '- 항목';
  const res = onTab(v, 2, 2, true);
  assert.deepEqual(res, {
    value: '- 항목',
    selStart: 2,
    selEnd: 2,
  });
});

test('onTab: 여러 줄에 걸친 선택 영역을 Tab으로 2칸씩 들여쓰고 선택 영역을 유지한다', () => {
  const v = '- 항목 1\n- 항목 2';
  const res = onTab(v, 0, v.length, false);
  const expected = '  - 항목 1\n  - 항목 2';
  assert.deepEqual(res, {
    value: expected,
    selStart: 0,
    selEnd: expected.length,
  });
});

test('onTab: 여러 줄에 걸친 선택 영역을 Shift+Tab으로 2칸씩 내어쓰고 선택 영역을 유지한다', () => {
  const v = '  - 항목 1\n  - 항목 2';
  const res = onTab(v, 0, v.length, true);
  const expected = '- 항목 1\n- 항목 2';
  assert.deepEqual(res, {
    value: expected,
    selStart: 0,
    selEnd: expected.length,
  });
});

test('onTab: 여러 줄 선택 시 마지막 줄 줄바꿈 직후(다음 줄 시작)에 커서가 있으면 다음 줄은 들여쓰지 않는다', () => {
  const v = '- 1\n- 2\n- 3';
  // '- 1\n'만 선택 (0 ~ 4)
  const res = onTab(v, 0, 4, false);
  assert.deepEqual(res, {
    value: '  - 1\n- 2\n- 3',
    selStart: 0,
    selEnd: 6,
  });
});

test('onTab: 여러 줄 각각의 앞 공백이 다를 때 Shift+Tab은 각 줄의 공백을 최대 2칸씩 줄인다', () => {
  const v = '   - 세칸\n  - 두칸\n - 한칸\n- 영칸';
  const res = onTab(v, 0, v.length, true);
  const expected = ' - 세칸\n- 두칸\n- 한칸\n- 영칸';
  assert.deepEqual(res, {
    value: expected,
    selStart: 0,
    selEnd: expected.length,
  });
});

// ---- 4. ensureStartsList ----
test('ensureStartsList: 빈 문자열이나 null/undefined이면 - 를 반환한다', () => {
  assert.equal(ensureStartsList(''), '- ');
  assert.equal(ensureStartsList(null), '- ');
  assert.equal(ensureStartsList(undefined), '- ');
});

test('ensureStartsList: 이미 글이 있으면 그대로 반환한다', () => {
  assert.equal(ensureStartsList('- 기존 글'), '- 기존 글');
  assert.equal(ensureStartsList('일반 글'), '일반 글');
});

// ---- 5. cleanForSave ----
test('cleanForSave: 내용 없는 - 줄을 빼고 끝 공백을 정리한다', () => {
  assert.equal(cleanForSave('- '), '');
  assert.equal(cleanForSave('  - '), '');
  assert.equal(cleanForSave('- \n  - \n'), '');
  assert.equal(cleanForSave('- 첫 항목\n- \n- 둘째 항목'), '- 첫 항목\n- 둘째 항목');
  assert.equal(cleanForSave('- 첫 항목\n  - \n'), '- 첫 항목');
  assert.equal(cleanForSave('- 내용   \n\n'), '- 내용');
});

test('cleanForSave: 빈 입력이나 내용이 없는 경우 빈 문자열을 반환한다', () => {
  assert.equal(cleanForSave(''), '');
  assert.equal(cleanForSave(null), '');
  assert.equal(cleanForSave(undefined), '');
});

// ---- 6. appendNewItem ----
test('appendNewItem: 끝 줄이 빈 - 이면 그대로와 끝 커서 위치를 반환한다', () => {
  const v1 = '- 첫 항목\n- ';
  assert.deepEqual(appendNewItem(v1), {
    value: v1,
    caret: v1.length,
  });
  const v2 = '- 첫 항목\n  - ';
  assert.deepEqual(appendNewItem(v2), {
    value: v2,
    caret: v2.length,
  });
  assert.deepEqual(appendNewItem('- '), {
    value: '- ',
    caret: 2,
  });
});

test('appendNewItem: 끝 줄에 내용이 있으면 줄바꿈 후 최상위 - 를 붙인다', () => {
  const v1 = '- 첫 항목';
  assert.deepEqual(appendNewItem(v1), {
    value: '- 첫 항목\n- ',
    caret: '- 첫 항목\n- '.length,
  });
  const v2 = '- 첫 항목\n  - 둘째 항목';
  assert.deepEqual(appendNewItem(v2), {
    value: '- 첫 항목\n  - 둘째 항목\n- ',
    caret: '- 첫 항목\n  - 둘째 항목\n- '.length,
  });
});

test('appendNewItem: 빈 글이면 최상위 - 를 생성한다', () => {
  assert.deepEqual(appendNewItem(''), {
    value: '- ',
    caret: 2,
  });
  assert.deepEqual(appendNewItem(null), {
    value: '- ',
    caret: 2,
  });
});
