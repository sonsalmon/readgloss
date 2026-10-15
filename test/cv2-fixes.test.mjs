// test/cv2-fixes.test.mjs
// 독립 검증 지적 A~E 수정 검증 시험 (concepts-v2 브랜치).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../bridge/db.mjs';
import { createConcepts, parseConceptOp } from '../bridge/concepts.mjs';

const readExt = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

// 함수 이름 머리말부터 짝 맞는 중괄호 끝까지의 본문을 잘라 낸다(소스 검사용)
function fnBody(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `함수를 찾지 못함: ${header}`);
  let depth = 0;
  let opened = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') {
      depth++;
      opened = true;
    } else if (src[j] === '}') {
      depth--;
      if (opened && depth === 0) return src.slice(start, j + 1);
    }
  }
  assert.fail(`본문 끝을 찾지 못함: ${header}`);
}

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-cv2-fixes-'));
  const db = openDb(join(dir, 'test.db'));
  return { db, dir };
}

// -------------------------------------------------------------
// A 건: 확장 개념 중계가 tags를 빼먹어 고칠 때 기존 태그가 지워짐
// -------------------------------------------------------------
test('A-1: background.js 개념 중계가 tags를 구조 분해하고 POST 본문에 넣는다', () => {
  const src = readExt('background.js');
  const relay = fnBody(src, 'async function concepts(msg, retried = false)');
  assert.match(relay, /const\s*\{[^}]*\btags\b[^}]*\}\s*=\s*msg/, 'msg에서 tags를 꺼내야 한다');
  assert.match(relay, /JSON\.stringify\(\{[^}]*\btags\b[^}]*\}\)/, 'POST 본문에 tags가 들어가야 한다');
});

test('A-2: 다리 고치기(id 있는 save)에서 tags 키가 없으면 기존 태그를 유지한다', () => {
  const { db, dir } = createTempDb();
  try {
    const concepts = createConcepts({ db });
    const saved = concepts.apply(parseConceptOp({
      op: 'save',
      name: 'XSS',
      tags: ['다시 보기', '헷갈림'],
      definition: '크로스 사이트 스크립팅',
    }));
    assert.ok(saved);

    // tags 키를 아예 보내지 않은 고치기
    const edited = concepts.apply(parseConceptOp({
      op: 'save',
      id: saved.id,
      name: 'XSS',
      definition: '고친 정의',
    }));
    assert.ok(edited);
    assert.deepEqual(edited.tags, ['다시 보기', '헷갈림']);
  } finally {
    db.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A-3: 고치기에서 tags가 빈 배열이면 태그를 비운다', () => {
  const { db, dir } = createTempDb();
  try {
    const concepts = createConcepts({ db });
    const saved = concepts.apply(parseConceptOp({
      op: 'save',
      name: 'XSS',
      tags: ['다시 보기'],
      definition: '정의',
    }));
    const cleared = concepts.apply(parseConceptOp({
      op: 'save',
      id: saved.id,
      name: 'XSS',
      tags: [],
      definition: '정의',
    }));
    assert.deepEqual(cleared.tags, []);
  } finally {
    db.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A-4: aliases·related도 키가 없으면 기존 값을 유지하고, 빈 배열이면 비운다', () => {
  const { db, dir } = createTempDb();
  try {
    const concepts = createConcepts({ db });
    concepts.apply(parseConceptOp({ op: 'save', name: 'Concept B', definition: 'B' }));
    const a = concepts.apply(parseConceptOp({
      op: 'save',
      name: 'Concept A',
      aliases: ['CA'],
      related: ['Concept B'],
      definition: 'A',
    }));
    assert.equal(a.related.length, 1);

    // aliases·related 키 없이 고치기: 기존 별칭·관련 개념 유지
    const kept = concepts.apply(parseConceptOp({ op: 'save', id: a.id, name: 'Concept A', definition: 'A2' }));
    assert.deepEqual(kept.aliases, ['CA']);
    assert.equal(kept.related.length, 1);
    assert.equal(kept.related[0].name, 'Concept B');

    // 빈 배열로 고치기: 비운다
    const emptied = concepts.apply(parseConceptOp({
      op: 'save',
      id: a.id,
      name: 'Concept A',
      aliases: [],
      related: [],
      definition: 'A2',
    }));
    assert.deepEqual(emptied.aliases, []);
    assert.equal(emptied.related.length, 0);
  } finally {
    db.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A-5: parseConceptOp는 tags 키 없음과 빈 배열을 구분하는 표시(hasTags)를 준다', () => {
  const base = { op: 'save', name: 'X', definition: '' };
  assert.equal(parseConceptOp(base).hasTags, false);
  assert.equal(parseConceptOp({ ...base, tags: [] }).hasTags, true);
  assert.equal(parseConceptOp({ ...base, tags: ['a'] }).hasTags, true);
});

// -------------------------------------------------------------
// B 건: 다시 열기가 소제목 칸에 쓰던 초안을 덮어씀
// -------------------------------------------------------------
const memoSrc = () => readExt('memo-pad.js');

test('B-1: reopenMemo는 칸의 쓰던 글을 덮어쓰기 전에 보관(stash)한다', () => {
  const body = fnBody(memoSrc(), 'function reopenMemo(id)');
  const stashAt = body.search(/stash\[[^\]]+\]\s*=/);
  const overwriteAt = body.indexOf('drafts[key] = memo.text');
  assert.ok(stashAt >= 0, 'reopenMemo 안에서 stash[칸] = 초안 을 해야 한다');
  assert.ok(overwriteAt > stashAt, '보관은 drafts[key] = memo.text 덮어쓰기보다 먼저여야 한다');
});

test('B-2: 고치기 성공(performEdit)과 그만두기(closePad)는 보관한 초안으로 되돌린다', () => {
  const src = memoSrc();
  const edit = fnBody(src, 'async function performEdit(sectionKey, ta)');
  assert.doesNotMatch(edit, /drafts\[sectionKey\]\s*=\s*'';/, '고친 뒤 칸을 빈 값으로 덮지 않는다');
  assert.match(edit, /endEdit\(\)/, '고치기 성공 시 endEdit()로 보관 초안을 되돌린다');

  const close = fnBody(src, 'function closePad()');
  assert.match(close, /endEdit\(\)/, 'Esc 등으로 닫으면 endEdit()로 보관 초안을 되돌린다');

  const end = fnBody(src, 'function endEdit()');
  assert.match(end, /stash/, 'endEdit은 보관 초안을 쓴다');
});

test('B-3: 보관(stash)은 탭 상태 저장에 들어가고 백그라운드가 저장·복원한다', () => {
  const src = memoSrc();
  assert.match(fnBody(src, 'function saveDrafts()'), /stash/, 'saveDrafts 가 stash 를 보낸다');
  assert.match(fnBody(src, 'function restoreStateOnLoad()'), /res\.stash/, '탭 상태 복원 때 stash 를 되돌린다');

  const bg = readExt('background.js');
  const setBlock = bg.slice(bg.indexOf("msg.type === 'memo-state-set'"), bg.indexOf("msg.type === 'memo-state-set'") + 600);
  assert.match(setBlock, /stash:\s*obj\(msg\.stash\)/, 'memo-state-set 이 stash 를 저장한다');
});

// -------------------------------------------------------------
// C 건: 열린 패널에서 다른 개념 표시를 누르면 닫혔다 다시 열림
// -------------------------------------------------------------
test('C-1: concept.js는 개념 표시를 누르면 readglossConceptHit 표시를 단다', () => {
  const body = fnBody(readExt('concept.js'), 'function onWindowMouseDown(e)');
  assert.match(body, /readglossConceptHit\s*=\s*true/, 'mousedown 에서 개념 표시 위 누름을 이벤트에 남겨야 한다');
});

test('C-2: panel.js 바깥 mousedown은 개념 표시 위 누름이면 패널을 닫지 않는다', () => {
  const src = readExt('panel.js');
  const at = src.indexOf("document.addEventListener('mousedown'");
  assert.ok(at >= 0, '바깥 mousedown 리스너가 있어야 한다');
  const block = src.slice(at, at + 400);
  assert.match(block, /!e\.readglossConceptHit/, '개념 표시 위 누름이면 닫지 않아야 한다');
});

// -------------------------------------------------------------
// D 건: 다른 곳에서 온 저장 이벤트가 상세 입력을 날림
// -------------------------------------------------------------
test('D-1: 다른 곳 저장 이벤트는 상세에 저장 안 된 변경·포커스가 있으면 목록 자료만 받는다', () => {
  const src = readExt('panel-concepts.js');
  const at = src.indexOf("addEventListener('readgloss:concepts-updated'");
  assert.ok(at >= 0, '개념 갱신 리스너가 있어야 한다');
  const listener = src.slice(at, at + 500);
  assert.match(listener, /fromDetail/, '상세 자동 저장 무시 조건은 그대로 있어야 한다');
  assert.match(listener, /quiet:\s*conceptsBusy\(\)/, '작업 중이면 quiet 로 목록 자료만 받는다');

  const load = fnBody(src, 'loadConcepts = async function');
  assert.match(load, /const quiet = /, 'loadConcepts 는 quiet 옵션을 받는다');
  assert.match(load, /if \(quiet\) return;/, 'quiet 이면 화면을 다시 그리지 않고 끝낸다');

  // 선언(let conceptsBusy = () => false)이 아니라 render 안의 대입을 본다
  const assignAt = src.indexOf('conceptsBusy = () => currentView');
  assert.ok(assignAt >= 0, 'render 안에서 conceptsBusy 를 연결해야 한다');
  const render = src.slice(assignAt, assignAt + 200);
  assert.match(render, /focus-within/, '칸 포커스 여부를 본다');
  assert.match(render, /detailHasWork\(\)/, '저장 안 된 변경 여부를 본다');
});

// -------------------------------------------------------------
// E 건: 라벨 문구
// -------------------------------------------------------------
test('E-1: 개념 칸 라벨은 "내 정의 (비우면 나중에 볼 것 · 500자까지)"이고 옛 라벨은 없다', () => {
  const src = readExt('concept.js');
  assert.match(src, /내 정의 \(비우면 나중에 볼 것 · 500자까지\)/);
  assert.doesNotMatch(src, /내 정의 \(1~500자\)/);
});
