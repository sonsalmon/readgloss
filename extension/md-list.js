// extension/md-list.js
// 마크다운 순서 없는 목록 편집 순수 함수 (T32a)
// 개념 설명 칸과 패널 상세의 마크다운 목록(Enter, Shift+Enter, Tab, 저장 전 정리 등)을 처리한다.
(() => {
  /**
   * 커서 줄에서 Enter 처리
   * - 커서 줄이 목록(^(\s*)- (.*)$)이 아니면 null.
   * - 항목 글이 비어있으면:
   *   - 들여쓰기가 있으면 2칸 내어쓴 '- '로 변경.
   *   - 맨 바깥(들여쓰기 없음)이면 해당 줄을 빈 줄("")로 변경하고 결과 반환 (null 아님).
   * - 항목 글이 있으면 커서 위치에서 줄을 나누고 다음 줄에 같은 들여쓰기의 '- ' 추가.
   *
   * @param {string} v 전체 텍스트
   * @param {number} s 선택 시작
   * @param {number} e 선택 끝
   * @returns {{ value: string, selStart: number, selEnd: number } | null}
   */
  function onEnter(v, s, e) {
    const text = String(v ?? '');
    let start = Math.max(0, Math.min(Number(s) || 0, text.length));
    let end = Math.max(0, Math.min(Number(e) || 0, text.length));
    if (start > end) [start, end] = [end, start];

    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;

    const lineText = text.slice(lineStart, lineEnd);
    const m = lineText.match(/^(\s*)- (.*)$/);
    if (!m) return null;

    const indent = m[1];
    const body = m[2];

    // 항목 글이 비어있는 경우 (공백만 있는 경우 포함)
    if (body.trim() === '') {
      if (indent.length >= 2) {
        const replacement = indent.slice(2) + '- ';
        const value = text.slice(0, lineStart) + replacement + text.slice(lineEnd);
        const caret = lineStart + replacement.length;
        return { value, selStart: caret, selEnd: caret };
      }
      // 이미 맨 바깥이면 그 줄을 빈 줄로 만듦 (null 대신 그 결과)
      const value = text.slice(0, lineStart) + text.slice(lineEnd);
      return { value, selStart: lineStart, selEnd: lineStart };
    }

    // 항목 글이 있는 경우: 커서 위치에서 줄을 나누고 다음 줄에 같은 들여쓰기 - 추가
    const insertion = '\n' + indent + '- ';
    const value = text.slice(0, start) + insertion + text.slice(end);
    const caret = start + insertion.length;
    return { value, selStart: caret, selEnd: caret };
  }

  /**
   * 커서 줄에서 Shift+Enter 처리
   * - 커서 줄이 목록(^(\s*)- (.*)$)이면 줄바꿈 후 다음 줄을 항목 글 시작 열까지 공백으로 맞춤.
   * - 목록이 아니면 null.
   *
   * @param {string} v 전체 텍스트
   * @param {number} s 선택 시작
   * @param {number} e 선택 끝
   * @returns {{ value: string, selStart: number, selEnd: number } | null}
   */
  function onShiftEnter(v, s, e) {
    const text = String(v ?? '');
    let start = Math.max(0, Math.min(Number(s) || 0, text.length));
    let end = Math.max(0, Math.min(Number(e) || 0, text.length));
    if (start > end) [start, end] = [end, start];

    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;

    const lineText = text.slice(lineStart, lineEnd);
    const m = lineText.match(/^(\s*)- (.*)$/);
    if (!m) return null;

    const indent = m[1];
    const pad = ' '.repeat(indent.length + 2);
    const insertion = '\n' + pad;
    const value = text.slice(0, start) + insertion + text.slice(end);
    const caret = start + insertion.length;
    return { value, selStart: caret, selEnd: caret };
  }

  /**
   * 선택이 걸친 모든 줄의 들여쓰기/내어쓰기 처리 (Tab / Shift+Tab)
   * - shift가 false면 2칸 들여쓰기.
   * - shift가 true면 최대 2칸(앞 공백이 2칸 미만이면 있는 만큼) 내어쓰기.
   * - 선택 위치를 이동량에 맞춰 반환.
   *
   * @param {string} v 전체 텍스트
   * @param {number} s 선택 시작
   * @param {number} e 선택 끝
   * @param {boolean} [shift=false] 내어쓰기 여부
   * @returns {{ value: string, selStart: number, selEnd: number }}
   */
  function onTab(v, s, e, shift = false) {
    const text = String(v ?? '');
    let start = Math.max(0, Math.min(Number(s) || 0, text.length));
    let end = Math.max(0, Math.min(Number(e) || 0, text.length));
    if (start > end) [start, end] = [end, start];

    // 줄 분할
    const lines = [];
    let pos = 0;
    while (pos <= text.length) {
      const nextNl = text.indexOf('\n', pos);
      const lineEnd = nextNl === -1 ? text.length : nextNl;
      lines.push({
        origStart: pos,
        origEnd: lineEnd,
        text: text.slice(pos, lineEnd),
      });
      if (nextNl === -1) break;
      pos = nextNl + 1;
    }

    // 선택에 걸친 줄 판단
    // 단일 커서(start === end): start가 위치한 한 줄
    // 범위 선택(start < end): [start, end) 반열린 구간과 겹치는 줄들
    const targetIndices = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const nextStart = (i === lines.length - 1) ? l.origEnd : lines[i + 1].origStart;
      if (start === end) {
        if (l.origStart <= start && (start <= l.origEnd || (start === nextStart && i === lines.length - 1))) {
          targetIndices.push(i);
          break;
        }
      } else {
        if (l.origStart < end && nextStart > start) {
          targetIndices.push(i);
        }
      }
    }

    if (targetIndices.length === 0) {
      targetIndices.push(lines.length - 1);
    }

    // 각 줄 변환 및 새 위치 계산
    const firstTarget = targetIndices[0];
    const lastTarget = targetIndices[targetIndices.length - 1];

    let runningNewStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const isTarget = targetIndices.includes(i);
      let newText = l.text;
      let remove = 0;

      if (isTarget) {
        if (!shift) {
          newText = '  ' + l.text;
        } else {
          const leadSpaces = l.text.match(/^ */)[0].length;
          remove = Math.min(2, leadSpaces);
          newText = l.text.slice(remove);
        }
      }

      const newStart = runningNewStart;
      runningNewStart += newText.length + 1; // +1 for '\n'

      l.newText = newText;
      l.newStart = newStart;
      l.remove = remove;
    }

    const firstLine = lines[firstTarget];
    const lastLine = lines[lastTarget];

    let newS = start;
    let newE = end;

    if (start === end) {
      // 단일 커서
      if (!shift) {
        newS = firstLine.newStart + (start - firstLine.origStart) + 2;
      } else {
        newS = firstLine.newStart + Math.max(0, (start - firstLine.origStart) - firstLine.remove);
      }
      newE = newS;
    } else {
      // 범위 선택
      // s 위치 계산
      if (start === firstLine.origStart) {
        newS = firstLine.newStart;
      } else if (!shift) {
        newS = firstLine.newStart + (start - firstLine.origStart) + 2;
      } else {
        newS = firstLine.newStart + Math.max(0, (start - firstLine.origStart) - firstLine.remove);
      }

      // e 위치 계산
      const nextAfterLast = lastTarget + 1 < lines.length ? lines[lastTarget + 1] : null;
      if (nextAfterLast && end === nextAfterLast.origStart) {
        newE = nextAfterLast.newStart;
      } else if (!shift) {
        newE = lastLine.newStart + (end - lastLine.origStart) + 2;
      } else {
        newE = lastLine.newStart + Math.max(0, (end - lastLine.origStart) - lastLine.remove);
      }
    }

    const newValue = lines.map((l) => l.newText).join('\n');
    return {
      value: newValue,
      selStart: Math.max(0, Math.min(newS, newValue.length)),
      selEnd: Math.max(0, Math.min(newE, newValue.length)),
    };
  }

  /**
   * 빈 글이면 '- '로 시작하게 보장
   *
   * @param {string} v 입력 텍스트
   * @returns {string}
   */
  function ensureStartsList(v) {
    if (v == null || v === '') return '- ';
    return v;
  }

  /**
   * 저장 직전 정리: 내용 없는 '- ' 줄(공백·'-'·공백만)을 뺀 글, 끝 공백 정리
   *
   * @param {string} v 입력 텍스트
   * @returns {string}
   */
  function cleanForSave(v) {
    if (v == null) return '';
    const text = String(v);
    const lines = text.split('\n');
    const filtered = lines.filter((line) => !/^\s*-\s*$/.test(line));
    return filtered.join('\n').trimEnd();
  }

  /**
   * 새 항목 덧붙이기: 끝 줄이 빈 '- '면 그대로, 아니면 끝에 '\n- '를 붙인 글과 그 끝 커서 위치
   *
   * @param {string} v 입력 텍스트
   * @returns {{ value: string, caret: number }}
   */
  function appendNewItem(v) {
    if (v == null) v = '';
    const text = String(v);
    if (text === '') {
      return { value: '- ', caret: 2 };
    }

    const lastNl = text.lastIndexOf('\n');
    const lastLine = lastNl === -1 ? text : text.slice(lastNl + 1);

    if (/^\s*-\s*$/.test(lastLine)) {
      return { value: text, caret: text.length };
    }

    const value = text + '\n- ';
    return { value, caret: value.length };
  }

  globalThis.readglossMdList = {
    onEnter,
    onShiftEnter,
    onTab,
    ensureStartsList,
    cleanForSave,
    appendNewItem,
  };
})();
