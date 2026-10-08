# 스크랩 고리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드래그 → [스크랩] → 지금 할 일·페이지·소제목 아래 저장 → 다시 오면 형광펜 → 스크랩북에서 그 문장으로 이동·← → 넘김, 그리고 학습 폴더로 밀린 날 따라잡기.

**Architecture:** 정본은 다리의 `data/scraps.json` 하나(`bridge/scraps.mjs`, `words.mjs`와 같은 임시 파일→rename 저장). 할 일 짐작은 다리가 학습 폴더 `roadmap.json`·`NOTES.md`를 읽기만 해서 한다(`bridge/task-guess.mjs`). 확장은 순수 함수(`extension/scrap-core.js`, node 시험 가능)와 화면 접착(`extension/scrap.js`, `extension/panel-scraps.js`)으로 나눈다.

**Tech Stack:** Node(의존성 0, `node --test`), MV3 classic content script, CSS Custom Highlight API, `approx-string-match` 2.0.0(MIT) 파일 복사.

**Spec:** `docs/spec.md` "변경 기록 10"(이 계획보다 우선). 그림: `docs/show-me-scrap-loop.html`.

## Global Constraints

- 새 npm 의존성 0개. `approx-string-match`는 `extension/vendor/approx-string-match.js`로 복사, 머리에 MIT 고지.
- `task`는 `^S\d-\d{2}$` 또는 `null`. `exact` 1~1000자, `prefix`·`suffix` ≤64, `headings` ≤3×≤200, `title` ≤300, `url` ≤2000, `translation` ≤2000, `memo` ≤1000. 넘으면 400(자르지 않음).
- 주소 정규화: `#` 뒤 버림, `utm_*` 쿼리만 지움, 끝 `/` 뗌.
- 일반 호스트(짐작에서 제외): `github.com`, `www.youtube.com`, `notebooklm.google.com`, `www.yes24.com`, `nostarch.com`, `claude.ai`.
- 다리는 학습 폴더에 쓰지 않는다. `export:scraps -- --to`만 학습 폴더에 쓰며 사람/에이전트가 실행한다.
- 포트 47831은 사용자 상시 다리. 시험은 `createBridge`로 임시 서버. 세션에서 `node bridge/server.mjs`를 띄우지 않는다.
- 문구: 버튼 "스크랩"/"스크랩됨", 탭 "스크랩북", 확인 메시지 "스크랩했어요", 질문 "지금 하는 '<card_title>'에 넣을까요?" [넣기][인박스], 막대 "스크랩 n / N", 못 찾음 "페이지에서 못 찾음", md 머리 "자동 생성 — 고치려면 확장 스크랩북에서".
- 시간·날짜는 로컬(서울) 기준 — 기존 `dateOf`(`scripts/export-day.mjs`) 재사용.

## Review Focus

1. 같은 문장이 한 페이지에 여러 번 나올 때 앞뒤 문맥으로 맞는 위치를 칠한다 → Task 3 시험.
2. 페이지 글이 조금 바뀌었을 때(단어 하나 추가) 근사 일치로 찾고, 너무 다르면 못 찾음으로 표시(엉뚱한 곳을 칠하지 않음) → Task 3 시험.
3. `roadmap.json`·`NOTES.md`가 없거나 깨져도 다리가 죽지 않고 인박스로 → Task 2 시험.
4. 다리가 꺼져 있을 때 [스크랩]을 누르면 조용히 사라지지 않고 기존 "다리 꺼짐" 안내가 뜬다 → Task 4 시험.
5. `scraps.json`이 깨져 있으면 빈 목록으로 시작하되 원본을 `.bad-<ts>`로 보존(덮어써서 잃지 않음) → Task 1 시험.

---

### Task 1 (T23-a): 다리 저장소 `scraps.mjs` + `/scraps`

**Files:**
- Create: `bridge/scraps.mjs`, `test/scraps.test.mjs`, `test/scraps-server.test.mjs`
- Modify: `bridge/server.mjs`(`createBridge`에 `scrapsFile = join(dirname(cacheFile),'scraps.json')`, `learningDir` 인자, 라우트 `/scraps`), `bridge/study.mjs:5`(KINDS에 `'scrap'`)

**Interfaces:**
- Produces: `normalizeUrl(u: string) -> string`; `scrapId(url, exact, prefix) -> string`(sha1 앞 12자); `parseScrapOp(v) -> op | null`; `createScraps({file, now}) -> { all(): Scrap[], forUrl(url): Scrap[], apply(op): Scrap[] | null }`(memo·move·remove 대상 없으면 null→404).
- HTTP: `GET /scraps` → `{scraps, tasks}`; `GET /scraps?url=` → `{scraps}`; `POST /scraps` ops `save|remove|memo|move|guess`(guess는 Task 2가 붙임). `save` 성공 시 `study.record({kind:'scrap', text: exact, url})`.

- [ ] **Step 1: 실패하는 시험** — `test/scraps.test.mjs`
```js
test('normalizeUrl', () => {
  assert.equal(normalizeUrl('https://a.com/x/?utm_source=t&q=1#h'), 'https://a.com/x?q=1');
});
test('같은 문장 다른 페이지는 다른 id', () => assert.notEqual(scrapId('https://a/1','s','p'), scrapId('https://a/2','s','p')));
test('save 두 번이면 memo·ts 유지', ...);           // 첫 save ts=1, memo 'm', 다시 save(now=2) → ts 1, memo 'm'
test('상한 넘으면 parseScrapOp null', ...);          // exact 1001자, task 'S1-4', headings 4개 각각 null
test('task null 허용(인박스)', ...);
test('깨진 파일은 .bad-<ts>로 보존하고 빈 목록', ...); // Review Focus 5
test('move/memo 없는 id → null', ...);
```
`test/scraps-server.test.mjs`: 토큰 없으면 401, save→GET ?url= 에 1건, GET `tasks`는 스크랩에 나온 할 일만, study-log에 `kind:'scrap'` 한 줄.

- [ ] **Step 2:** `npm test -- test/scraps.test.mjs test/scraps-server.test.mjs` → FAIL(모듈 없음)
- [ ] **Step 3:** 구현. 저장 방식·Map 키 처리는 `bridge/words.mjs` `createWords`·`persist` 그대로 따른다. `tasks`의 `card_title`은 Task 2의 `loadRoadmap`이 아직 없으므로 이 단계에선 `{}` 고정, Task 2가 채운다.
- [ ] **Step 4:** `npm test` 전체 → 기존 507 + 새 시험 PASS
- [ ] **Step 5:** `git commit -m "feat(bridge): scraps store and /scraps (T23)"`

### Task 2 (T23-b): 할 일 짐작 `task-guess.mjs` + `guess` op

**Files:**
- Create: `bridge/task-guess.mjs`, `test/task-guess.test.mjs`, `fixtures/learning/curriculum/roadmap.json`, `fixtures/learning/NOTES.md`
- Modify: `bridge/server.mjs`(`learningDir = process.env.READGLOSS_LEARNING_DIR ?? ~/dev/learning/security-career`, `guess` op, GET `tasks` 채우기)

**Interfaces:**
- Consumes: `normalizeUrl`, `createScraps().all()`.
- Produces: `loadLearning(dir) -> { nodes: [{id, card_title, urls: string[]}], next: string|null }`(파일 없음·깨짐 → `{nodes:[], next:null}` + `console.error` 한 줄); `guessTask({url, nodes, next, lastToday}) -> { task: string|null, ask: boolean, candidates: [{id,title}], matches: string[] }`; `lastTaskToday(scraps, now) -> string|null`.

- [ ] **Step 1: 실패하는 시험** — 설계서 10-3 ①~⑤ 각각 하나 + 예시:
```js
test('PortSwigger 접근 통제, 오늘 첫 스크랩, next S1-03 → S1-04', () => {
  const r = guessTask({ url: 'https://portswigger.net/web-security/access-control', nodes, next: 'S1-03', lastToday: null });
  assert.deepEqual([r.task, r.ask], ['S1-04', false]);
});
test('① 오늘 마지막 S1-18이 맞는 할 일 안이면 S1-18', ...);
test('② next가 맞는 할 일 안이면 next', ...);
test('④ 밖 페이지(developer.mozilla.org), lastToday S1-04 → task S1-04, ask true', ...);
test('⑤ 밖 페이지, 후보 없음 → task null, ask false', ...);
test('일반 호스트 github.com 은 맞춤에서 빠진다', ...);
test('NOTES 다음 한 걸음 절 첫 S\\d-\\d\\d 만 읽는다(다른 절 무시)', ...);
test('roadmap 없음/깨짐 → 인박스, 던지지 않음', ...);   // Review Focus 3
```
fixtures는 실제 `roadmap.json`에서 S1-03·S1-04·S1-11·S1-15·S1-18 노드의 `id·card_title·resources`만 복사(회사 낱말 없는지 확인).
- [ ] **Step 2:** 시험 실행 → FAIL
- [ ] **Step 3:** 구현. 정렬: 경로 앞부분이 겹치는 글자 수 내림차순, 같으면 roadmap 순서. `guess` 응답에 `candidates`(오늘 쓴 할 일들 + next + 맞는 할 일, 중복 제거, `{id, title: card_title}`).
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5:** `git commit -m "feat(bridge): task guess from roadmap and NOTES (T23)"`

### Task 3 (T24-a): 문장 다시 찾기 `scrap-core.js` + 부품 복사

**Files:**
- Create: `extension/vendor/approx-string-match.js`(npm 2.0.0 `dist` 내용을 classic script로, `globalThis.readglossApprox = { search }`), `extension/scrap-core.js`, `test/scrap-core.test.mjs`

**Interfaces:**
- Produces(`globalThis.readglossScrap`): `quoteOf(fullText, start, end) -> {exact, prefix, suffix}`(앞뒤 32자); `findQuote(fullText, quote, posHint) -> {start, end} | null`; `MAX_ERRORS_RATIO = 0.1`.

- [ ] **Step 1: 실패하는 시험**
```js
test('정확 일치', ...);
test('같은 문장 두 번 → prefix/suffix 맞는 쪽', ...);          // Review Focus 1
test('단어 하나 끼어들어도 근사 일치', ...);                    // Review Focus 2
test('절반이 바뀌면 null(엉뚱한 곳 안 칠함)', ...);              // Review Focus 2
test('posHint가 가까운 후보를 고른다(문맥 점수 같을 때)', ...);
```
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 순서: `indexOf` 정확 일치 후보 전부 → 있으면 prefix·suffix 일치 길이 + 위치 근접으로 점수 → 없으면 `search(text, exact, floor(exact.length*0.1))` 후보에 같은 점수. Hypothesis `match-quote.ts`의 점수 방식(BSD-2, 고지 주석).
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5:** `git commit -m "feat(ext): quote anchor core with approx-string-match (T24)"`

### Task 4 (T24-b): 카드 [스크랩]·형광펜·다시 칠하기

**Files:**
- Create: `extension/scrap.js`(페이지 접착: 형광펜 칠하기/걷기, 열 때 다시 칠하기, 10초 재시도), `test/scrap-wiring.test.mjs`
- Modify: `extension/selection.js:407-411`(버튼 줄에 `ui.scrapBtn`, 할 일 줄·바꾸기 목록·밖 페이지 질문, ⌥S는 카드 열렸을 때만), `extension/selection-core.js`(`scrapMessage(...)`), `extension/background.js:139-155`(`type:'scraps'` → `/scraps` 중계), `extension/manifest.json`(content_scripts에 `vendor/approx-string-match.js`, `scrap-core.js`, `scrap.js` 순서대로), `extension/content.js`(토스트 문구 재사용)

**Interfaces:**
- Consumes: Task 1 HTTP, Task 2 `guess`, Task 3 `findQuote/quoteOf`, 기존 `headingsAbove`(`selection.js:156`), `readglossToast.show({text,onMemo})`.
- Produces: `globalThis.readglossScrapPage = { paint(scraps), unpaint(id), scrollTo(id) -> boolean, found: Set<id> }`(Task 5가 씀). 하이라이트 이름 `readgloss-scrap`(노랑 `#FAEEDA` 배경), 깜빡임 `readgloss-scrap-flash`.

- [ ] **Step 1: 격리 환경 시험(사람 확인 필요)** — `scrap.js` 첫 판은 `CSS.highlights.set('readgloss-scrap', new Highlight(range))`만. 사용자에게 Aside에서 확장 ↻ 후 PortSwigger 페이지 문장 하나 스크랩 요청. 칠해지면 진행, 안 칠해지면 `<mark data-readgloss="scrap">` 감싸기로 바꾸고 주석·문단 번역과 겹침 시험 추가. 결과를 설계서 10-9 1번에 한 줄 기록.
- [ ] **Step 2: 실패하는 시험** — `test/scrap-wiring.test.mjs`(linkedom 없이 기존 t17b 방식: 소스 문자열 검사 + 순수 함수)
```js
test('scrapMessage 모양: {type:"scraps", op:"save", url(정규화), title, headings≤3, quote, pos, translation, task}', ...);
test('⌥S 처리기는 카드 열림 조건 안에만 있다', ...);
test('다리 꺼짐이면 기존 꺼짐 안내를 쓴다', ...);          // Review Focus 4
test('밖 페이지 답은 chrome.storage.local 키 scrapAsk:<날짜>:<정규화 주소>', ...);
```
- [ ] **Step 3:** FAIL 확인
- [ ] **Step 4:** 구현. 저장 성공 → 칠하기 + 토스트 "스크랩했어요"(메모 → `{type:'scraps', op:'memo', id, memo}`) + 선택 해제·카드 닫기. 이미 스크랩된 문장이면 "스크랩됨", 누르면 `remove` + 걷기. 페이지 로드 때 `GET /scraps?url=` → 칠하기, 못 찾으면 MutationObserver로 10초까지 재시도.
- [ ] **Step 5:** `npm test` PASS
- [ ] **Step 6:** `git commit -m "feat(ext): scrap button, highlight, repaint on load (T24)"`

### Task 5 (T25): 스크랩북 탭·이동·넘김 막대

**Files:**
- Create: `extension/panel-scraps.js`, `test/panel-scraps.test.mjs`
- Modify: `extension/scrap-core.js`(트리·순서 순수 함수 추가), `extension/scrap.js`(막대·← →·대기 이동), `extension/background.js`(다른 페이지 이동: 보낸 탭 `chrome.tabs.update(sender.tab.id,{url})` + `chrome.storage.session` `pendingScrap`), `extension/manifest.json`(panel-scraps.js), `extension/panel.js`(퀵 메뉴 [스크랩 보기]), `extension/panel-study.js:6-12`(KINDS에 "스크랩")

**Interfaces:**
- Consumes: Task 4 `readglossScrapPage`, Task 1 `GET /scraps`.
- Produces(`readglossScrap` 추가): `buildTree(scraps, tasks) -> [{task, title, count, pages:[{url, title, depth, sections:[{headings, items}]}]}]`(인박스는 마지막, `task:null`); `orderInTask(scraps, task) -> Scrap[]`(ts 오름차순); `pageDepth(url, urlsInTask) -> number`(다른 페이지 경로 아래면 +1).

- [ ] **Step 1: 실패하는 시험**
```js
test('buildTree: 할 일→페이지→소제목, 인박스 마지막', ...);
test('IDOR 페이지는 access-control 페이지 아래 depth 1', ...);
test('orderInTask: 같은 할 일, 저장 순서', ...);
test('탭 등록 order 22, 제목 "스크랩북"', ...);
test('못 찾은 스크랩은 "페이지에서 못 찾음" 표시', ...);
```
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 문장 클릭 → 같은 페이지면 `scrollTo`, 아니면 `pendingScrap` 저장 후 탭 이동 → 새 페이지 `scrap.js`가 로드 때 꺼내 스크롤·깜빡임·막대. 막대 `스크랩 n / N ← → ✕`, 키 ← → 는 막대가 있고 입력창 밖일 때만. 스크랩마다 [할 일 바꾸기](guess의 candidates + 인박스) [메모] [지우기].
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5:** `git commit -m "feat(ext): scrapbook tab, jump, prev/next bar (T25)"`

### Task 6 (T23-c): 내보내기 명령 — 밀린 날·스크랩 문서·mark·move

**Files:**
- Create: `scripts/export-pending.mjs`, `scripts/export-scraps.mjs`, `scripts/export-mark.mjs`, `scripts/scraps-cli.mjs`, `test/export-pending.test.mjs`, `test/export-scraps.test.mjs`
- Modify: `package.json` scripts(`export:pending`, `export:scraps`, `export:mark`, `scraps`), `scripts/export-day.mjs`(재사용만, 바꿀 필요 있으면 `exportDay` 시그니처 유지)

**Interfaces:**
- Consumes: `exportDay(date, dataDir)`, `dateOf`, Task 5 `buildTree`·`pageDepth`(node에서 `extension/scrap-core.js` import).
- Produces: `pendingDays(dataDir, today) -> string[]`(state `data/export-state.json` `{lastDay}`, 없으면 `'2026-10-06'`); `renderScrapDocs(scraps, tasks) -> Map<relPath, content>`; `writeIfChanged(dir, map) -> {written: string[], removed: string[]}`.

- [ ] **Step 1: 실패하는 시험**
```js
test('처음 값으로 10-07·10-08 포함, 기록 없는 날 제외', ...);
test('mark 2026-10-07 뒤엔 10-08만', ...);
test('문서: S1-04.md에 페이지 목록·들여쓰기, S1-04/<페이지>.md에 ## 소제목, > 문장, 메모, 원문 주소, 머리 문구', ...);
test('같은 내용이면 파일 mtime 안 바뀜, 빈 할 일 문서는 지움, 인박스는 inbox.md', ...);
test('페이지 파일 이름: 제목을 소문자·하이픈, 80자, 겹치면 -2', ...);
```
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. `export:pending` 출력: 날마다 `### YYYY-MM-DD` + `exportDay` 결과 + `스크랩 N개 → scraps/<할일>.md` 줄. `scraps move <id> <할일|inbox>`는 `data/token`으로 `POST /scraps {op:'move'}`.
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5:** `git commit -m "feat: export pending days, scrap docs, mark, move cli (T23)"`

### Task 7: 메인 세션 마무리(워커 아님)

- [ ] verifier에게 설계서 변경 기록 10 + 이 계획 + `git diff <시작 SHA>...HEAD`만 주고 검증.
- [ ] `launchctl kickstart -k gui/$(id -u)/com.sonsalmom.readgloss-bridge` 후 설계서 10-9 3번 curl로 `guess` → `S1-04` 확인.
- [ ] 학습 폴더 `security-career/HANDOFF.md` 3절에 10-4 절차 한 단락 + 메모리 `readgloss-to-learning-records` 갱신.
- [ ] 첫 따라잡기: `export:pending` → 10-07·10-08 기록 파일에 붙임, `export:scraps -- --to ~/dev/learning/security-career/scraps`, 학습 저장소 커밋, `export:mark`.
- [ ] 정범 10분 확인(설계서 10-7 ①~⑤), `docs/PROGRESS.md` 표에 T23~T25 줄.
