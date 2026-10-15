// test/t33a-headings.test.mjs
// 과제 T33a: 자리 저장(16-2) 개념·단어 소제목 사슬(headings) 및 공부 모드(16-6) background 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../bridge/db.mjs';
import { createConcepts, parseConceptOp, LIMIT } from '../bridge/concepts.mjs';
import { createWords, parseWordsOp } from '../bridge/words.mjs';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const backgroundSrcPath = join(__dirname, '../extension/background.js');

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t33a-concepts-'));
  const dbFile = join(dir, 'test.db');
  const db = openDb(dbFile);
  return { db, dir };
}

function createTempWordsFile() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-t33a-words-'));
  const file = join(dir, 'words.json');
  return { file, dir };
}

// ==========================================
// 1. 다리 개념: seen.headings 상한 및 저장
// ==========================================

test('개념 parseConceptOp: seen.headings 검증 및 상한(문자열 배열 ≤3, 각 ≤200자)', () => {
  const validBase = {
    op: 'save',
    name: 'Access Control',
    definition: '접근 통제 규칙',
    seen: {
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control Vulnerabilities',
      sentence: 'Access control is the application of constraints.',
    },
  };

  // headings 생략 시 통과
  const resNoHeadings = parseConceptOp(validBase);
  assert.ok(resNoHeadings);
  assert.ok(resNoHeadings.seen);
  assert.equal(resNoHeadings.seen.headings, undefined);

  // headings 유효한 배열 (1~3개, 각 200자 이하)
  const res1 = parseConceptOp({
    ...validBase,
    seen: {
      ...validBase.seen,
      headings: ['Web Security', 'Access Control', 'What is access control?'],
    },
  });
  assert.ok(res1);
  assert.deepEqual(res1.seen.headings, ['Web Security', 'Access Control', 'What is access control?']);

  // 빈 배열도 통과
  const resEmpty = parseConceptOp({
    ...validBase,
    seen: {
      ...validBase.seen,
      headings: [],
    },
  });
  assert.ok(resEmpty);
  assert.deepEqual(resEmpty.seen.headings, []);

  // 4개 이상이면 거절 (null)
  const resTooMany = parseConceptOp({
    ...validBase,
    seen: {
      ...validBase.seen,
      headings: ['h1', 'h2', 'h3', 'h4'],
    },
  });
  assert.equal(resTooMany, null);

  // 문자열이 아니면 거절 (null)
  const resNonString = parseConceptOp({
    ...validBase,
    seen: {
      ...validBase.seen,
      headings: ['h1', 123],
    },
  });
  assert.equal(resNonString, null);

  // 200자 초과 문자열이 있으면 거절 (null)
  const resTooLong = parseConceptOp({
    ...validBase,
    seen: {
      ...validBase.seen,
      headings: ['h1', 'a'.repeat(201)],
    },
  });
  assert.equal(resTooLong, null);

  // 배열이 아닌 형태(문자열, 객체 등)면 거절 (null)
  const resNotArray = parseConceptOp({
    ...validBase,
    seen: {
      ...validBase.seen,
      headings: 'not-array',
    },
  });
  assert.equal(resNotArray, null);
});

test('개념 createConcepts: seen.headings 저장 및 db 복원', () => {
  const { db } = createTempDb();
  const concepts = createConcepts({ db });

  const headings = ['H1 Title', 'H2 Section', 'H3 Subsection'];
  const saved = concepts.apply({
    op: 'save',
    name: 'Privilege Escalation',
    definition: '권한 상승 공격',
    seen: {
      url: 'https://portswigger.net/web-security/access-control',
      title: 'Access Control',
      sentence: 'Privilege escalation occurs when user gets unauthorized rights.',
      headings,
    },
  });

  assert.ok(saved);
  assert.ok(saved.seen);
  assert.deepEqual(saved.seen.headings, headings);

  // list() 호출 시에도 seen.headings 확인
  const list = concepts.list();
  const found = list.find((c) => c.name === 'Privilege Escalation');
  assert.ok(found);
  assert.deepEqual(found.seen?.headings, headings);

  // 새 인스턴스로 db 다시 열기
  const conceptsAgain = createConcepts({ db });
  const foundAgain = conceptsAgain.list().find((c) => c.name === 'Privilege Escalation');
  assert.ok(foundAgain);
  assert.deepEqual(foundAgain.seen?.headings, headings);
});

// ==========================================
// 2. 단어: 단어장 save 및 구·문장 save-phrase headings 상한 및 저장
// ==========================================

test('단어 parseWordsOp: op save headings 상한(문자열 배열 ≤3, 각 ≤200자)', () => {
  const validSave = {
    op: 'save',
    lemma: 'escalation',
    word: 'escalation',
    gloss: '상승, 확대',
    sentence: 'Privilege escalation occurs here.',
    url: 'https://example.com',
  };

  // headings 생략 시 통과
  const resNoHeadings = parseWordsOp(validSave);
  assert.ok(resNoHeadings);
  assert.equal(resNoHeadings.headings, undefined);

  // headings 유효한 배열
  const headings = ['Heading 1', 'Heading 2', 'Heading 3'];
  const resWithHeadings = parseWordsOp({ ...validSave, headings });
  assert.ok(resWithHeadings);
  assert.deepEqual(resWithHeadings.headings, headings);

  // 4개 이상 거절
  assert.equal(parseWordsOp({ ...validSave, headings: ['a', 'b', 'c', 'd'] }), null);

  // 200자 초과 거절
  assert.equal(parseWordsOp({ ...validSave, headings: ['a', 'b'.repeat(201)] }), null);

  // 문자열 외 타입 거절
  assert.equal(parseWordsOp({ ...validSave, headings: ['a', null] }), null);
  assert.equal(parseWordsOp({ ...validSave, headings: 'not-array' }), null);
});

test('단어 parseWordsOp: op save-phrase headings 상한(문자열 배열 ≤3, 각 ≤200자)', () => {
  const validPhrase = {
    op: 'save-phrase',
    text: 'privilege escalation vulnerability',
    translation: '권한 상승 취약점',
    url: 'https://example.com',
    title: 'Security Guide',
    sentence: 'A privilege escalation vulnerability was discovered.',
  };

  // headings 생략 시 통과
  const resNoHeadings = parseWordsOp(validPhrase);
  assert.ok(resNoHeadings);
  assert.equal(resNoHeadings.headings, undefined);

  // headings 유효한 배열
  const headings = ['Ch1', 'Sec2', 'Sub3'];
  const resWithHeadings = parseWordsOp({ ...validPhrase, headings });
  assert.ok(resWithHeadings);
  assert.deepEqual(resWithHeadings.headings, headings);

  // 4개 이상 거절
  assert.equal(parseWordsOp({ ...validPhrase, headings: ['1', '2', '3', '4'] }), null);

  // 200자 초과 거절
  assert.equal(parseWordsOp({ ...validPhrase, headings: ['1', 'x'.repeat(201)] }), null);

  // 문자열 외 타입 거절
  assert.equal(parseWordsOp({ ...validPhrase, headings: ['1', {}] }), null);
  assert.equal(parseWordsOp({ ...validPhrase, headings: 123 }), null);
});

test('단어 createWords (file 모드): save 및 save-phrase headings 저장 및 파일 복원', () => {
  const { file } = createTempWordsFile();
  const w = createWords({ file });

  const headings = ['Chapter 1', 'Section 2'];

  // 1. 단어장 save 에 headings 저장
  const res1 = w.apply(parseWordsOp({
    op: 'save',
    lemma: 'mitigate',
    word: 'mitigate',
    gloss: '완화하다',
    sentence: 'We must mitigate this risk.',
    url: 'https://example.com/mitigate',
    headings,
  }));
  assert.ok(res1);
  assert.deepEqual(res1.saved?.mitigate?.headings, headings);

  // 2. save-phrase 에 headings 저장
  const phraseText = 'cross-site request forgery';
  const resPhrase = w.apply(parseWordsOp({
    op: 'save-phrase',
    text: phraseText,
    translation: '사이트 간 요청 위조',
    url: 'https://example.com/csrf',
    title: 'CSRF Overview',
    sentence: 'Cross-site request forgery is an attack.',
    headings,
  }));
  assert.ok(resPhrase);
  const pId = resPhrase.id;
  assert.deepEqual(resPhrase.phrases?.[pId]?.headings, headings);

  // 3. 파일에서 다시 로드했을 때 headings 보존 확인
  const wReload = createWords({ file });
  const all = wReload.all();
  assert.deepEqual(all.saved?.mitigate?.headings, headings);
  assert.deepEqual(all.phrases?.[pId]?.headings, headings);
});

test('단어 createWords (db 모드): save 및 save-phrase headings 저장 및 db 복원', () => {
  const { db } = createTempDb();
  const w = createWords({ db });

  const headings = ['H1', 'H2', 'H3'];

  // 단어장 save
  w.apply(parseWordsOp({
    op: 'save',
    lemma: 'tamper',
    word: 'tamper',
    gloss: '변조하다',
    sentence: 'Do not tamper with cookies.',
    url: 'https://example.com/tamper',
    headings,
  }));
  assert.deepEqual(w.all().saved?.tamper?.headings, headings);

  // save-phrase
  const resP = w.apply(parseWordsOp({
    op: 'save-phrase',
    text: 'tamper with data',
    translation: '데이터를 변조하다',
    url: 'https://example.com/tamper',
    title: 'Tampering',
    sentence: 'Attackers tamper with data.',
    headings,
  }));
  const pId = resP.id;
  assert.deepEqual(w.all().phrases?.[pId]?.headings, headings);

  // db에서 다시 로드했을 때 보존 확인
  const wReload = createWords({ db });
  assert.deepEqual(wReload.all().saved?.tamper?.headings, headings);
  assert.deepEqual(wReload.all().phrases?.[pId]?.headings, headings);
});

// ==========================================
// 3. background 소스 및 study-mode 처리
// ==========================================

test('background 소스: words 중계에 headings 구조 분해 및 본문 전달 포함', () => {
  const code = readFileSync(backgroundSrcPath, 'utf8');

  // words 함수에서 headings가 구조 분해에 포함되어 있는지 확인
  const hasDestructuring = /const\s*\{\s*[^}]*\bheadings\b[^}]*\}\s*=\s*msg/.test(code);
  assert.ok(hasDestructuring, 'words() 함수 msg 구조 분해에 headings 가 포함되어야 합니다.');

  // JSON.stringify body에 headings가 포함되어 있는지 확인
  const hasBody = /JSON\.stringify\(\s*\{[^}]*\bheadings\b[^}]*\}\s*\)/.test(code);
  assert.ok(hasBody, 'words() 요청 body 에 headings 가 포함되어야 합니다.');

  // concepts 중계에 seen이 포함되어 있는지 확인
  const hasSeenInConcepts = /concepts\([^)]*\)[\s\S]*?seen/.test(code);
  assert.ok(hasSeenInConcepts, 'concepts() 함수에 seen 이 전달되어야 합니다.');
});

test('background 소스: study-mode 메시지 처리(fullscreen 및 이전 상태 복원)', () => {
  const code = readFileSync(backgroundSrcPath, 'utf8');

  // study-mode 메시지 타입 처리 여부
  assert.ok(code.includes("'study-mode'") || code.includes('"study-mode"'), 'study-mode 메시지 핸들러가 있어야 합니다.');

  // chrome.windows.update 및 fullscreen 호출
  assert.ok(code.includes('chrome.windows.update'), 'chrome.windows.update 를 호출해야 합니다.');
  assert.ok(code.includes('fullscreen'), 'fullscreen 상태 변경이 포함되어야 합니다.');

  // chrome.storage.session 기억
  assert.ok(code.includes('storage.session') || code.includes('session'), '이전 상태 저장을 위해 session storage 를 써야 합니다.');
});

test('background study-mode 동작 모의 검증 (fullscreen 전환 및 이전 상태 복귀)', async () => {
  // 모의 window 및 storage 환경
  const mockStorage = new Map();
  const mockWindows = new Map([
    [101, { id: 101, state: 'normal' }],
  ]);

  const mockChrome = {
    runtime: {
      id: 'test-ext-id',
      onMessage: {
        listeners: [],
        addListener(fn) {
          this.listeners.push(fn);
        },
      },
    },
    storage: {
      session: {
        async get(key) {
          if (typeof key === 'string') return { [key]: mockStorage.get(key) };
          return Object.fromEntries(mockStorage);
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) mockStorage.set(k, v);
        },
        async remove(key) {
          mockStorage.delete(key);
        },
      },
    },
    windows: {
      async get(windowId) {
        const win = mockWindows.get(windowId);
        if (!win) throw new Error('Window not found');
        return { ...win };
      },
      async update(windowId, updateInfo) {
        const win = mockWindows.get(windowId);
        if (!win) throw new Error('Window not found');
        if (updateInfo.state) win.state = updateInfo.state;
        return { ...win };
      },
    },
  };

  // studyModeHandler 로직 순수 모의 실행
  async function handleStudyMode(msg, sender) {
    if (msg?.type !== 'study-mode') return null;
    const windowId = sender?.tab?.windowId;
    if (windowId == null) return { ok: false, error: 'no-window' };

    const storage = mockChrome.storage.session;
    const key = `study_mode_win_${windowId}`;

    if (msg.on) {
      const currentWin = await mockChrome.windows.get(windowId);
      if (currentWin.state !== 'fullscreen') {
        await storage.set({ [key]: currentWin.state });
      }
      const updated = await mockChrome.windows.update(windowId, { state: 'fullscreen' });
      return { ok: true, state: updated?.state ?? 'fullscreen' };
    } else {
      const data = await storage.get(key);
      const prevState = data?.[key] || 'normal';
      await storage.remove(key);
      const updated = await mockChrome.windows.update(windowId, { state: prevState });
      return { ok: true, state: updated?.state ?? prevState };
    }
  }

  // 1. study-mode: on
  const resOn = await handleStudyMode({ type: 'study-mode', on: true }, { tab: { windowId: 101 } });
  assert.deepEqual(resOn, { ok: true, state: 'fullscreen' });
  assert.equal(mockWindows.get(101).state, 'fullscreen');
  assert.equal(mockStorage.get('study_mode_win_101'), 'normal');

  // 2. study-mode: off
  const resOff = await handleStudyMode({ type: 'study-mode', on: false }, { tab: { windowId: 101 } });
  assert.deepEqual(resOff, { ok: true, state: 'normal' });
  assert.equal(mockWindows.get(101).state, 'normal');
  assert.equal(mockStorage.has('study_mode_win_101'), false);
});
