# 내 개념 표시 + SQLite 이전 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 정범이 정의한 개념을 페이지에 회색으로 표시하고, 모든 저장 데이터를 SQLite 하나로 옮긴다.

**구조:** 다리가 `data/readgloss.db`를 연다. 점 표(`nodes`)와 선 표(`edges`)를 둔다. 기존 저장 모듈은 겉 함수를 그대로 두고 속만 db로 바꾼다. 확장은 개념 목록을 받아 Highlight API로 칠한다.

**기술:** Node 26 내장 `node:sqlite`(`DatabaseSync`). 새 npm 의존성 0개.

**정본:** `docs/spec.md` 변경 기록 11. 그림: `docs/show-me-my-concepts.html`, `docs/show-me-my-concepts-plan.html`.

## 지킬 것 (모든 작업 공통)

- 새 npm 의존성을 넣지 않는다.
- `createWords`·`createMydict`·`createScraps`의 반환 모양과 HTTP 응답 모양을 바꾸지 않는다.
- 기존 시험은 고치지 않는다. 기존 시험은 모두 통과해야 한다.
  - 예외(10-13 메인 세션 결정): 저장 정본이 JSON에서 db로 바뀌어 "디스크의 JSON 파일을 읽는" 단언 3곳(`test/words-server.test.mjs:95`, `test/mydict-server.test.mjs:35`, `test/phrases.test.mjs:123`)은 `scripts/data-source.mjs`의 `loadData`로 읽게 바꿨다(커밋 fcb7ca9). 독립 검증이 다른 동작을 숨기지 않는다고 판정했다. 시간 재는 시험(dict-server·claude-client·annotate·mt-live)이 부하로 흔들리면 따로 다시 돌려 확인한다.
- 개념 이름 1~80자. 별칭 0~5개, 각 1~80자. 정의 1~500자. 관련 개념 0~10개.
- 개념 key = 이름을 소문자로 바꾸고 공백을 하나로 줄인 값. key는 유일하다.
- 회색 표시 이름 `readgloss-concept`, 배경 `rgba(136,135,128,0.18)`.
- 포트 47831을 쓰지 않는다. `node bridge/server.mjs`를 띄우지 않는다. 실제 `data/`와 `~/dev/learning`에 쓰지 않는다.

## 검토 초점 (사람이 실제로 부딪힐 것)

1. 옮기는 중에 다리가 꺼진다 → 다음 시작 때 다시 옮긴다. JSON은 남아 있다. → 작업 1 시험.
2. 같은 이름 개념을 다시 만든다 → 새로 만들지 않는다. 409와 기존 id를 준다. → 작업 3 시험.
3. 개념을 지운다 → 그 개념의 선도 모두 지운다. 관련 개념 쪽 선도 지운다. → 작업 3 시험.
4. 개념어가 링크·코드 안에 있다 → 링크 안은 칠한다. pre 안은 칠하지 않는다. 클릭은 링크 동작을 막지 않는다. → 작업 4 시험.
5. 개념이 많다(300개) → 페이지 하나에서 표시가 0.2초 안에 끝난다. → 작업 4 시험.

---

### 작업 1 (T26-a): db 열기와 한 번 옮기기

**파일:**
- 만들기: `bridge/db.mjs`, `test/db.test.mjs`
- 고치기: `bridge/server.mjs`(`createBridge`가 db를 연다)

**연결:**
- 내놓는 것:
  - `openDb(file) -> db` — 표가 없으면 만든다.
  - `db.put(node: {id, kind, key, data, ts})`, `db.get(id)`, `db.byKind(kind) -> node[]`, `db.byKey(kind, key)`, `db.del(id)` — del은 그 점의 선도 지운다.
  - `db.link(src, dst, kind, ts)`, `db.unlink(src, dst, kind)`, `db.out(src, kind?) -> edge[]`, `db.in(dst, kind?) -> edge[]`.
  - `migrateJson({db, dataDir, log}) -> {ok, counts}`.
- `kind` 값: `word`, `phrase`, `mydict`, `scrap`, `concept`, `task`. 선 `kind` 값: `in_task`, `from_scrap`, `related`.

- [ ] **1단계: 실패하는 시험을 쓴다.**
  - `옛 JSON 3개를 옮기면 개수가 같다` — 단어장·아는 단어·최근·구·내 사전·스크랩 개수를 비교한다.
  - `옮긴 뒤 JSON은 .migrated-<ts>로 남는다`
  - `db가 이미 있으면 다시 옮기지 않는다`
  - `개수가 다르면 db 파일을 지우고 JSON을 그대로 둔다` — 가짜로 한 건을 버리는 hook을 넣어 확인한다.
  - `옮기는 중 예외가 나면 다음 시작 때 다시 옮긴다` — 검토 초점 1.
  - `del은 들어오는 선과 나가는 선을 모두 지운다`
- [ ] **2단계:** `node --test test/db.test.mjs`를 돌린다. 실패를 확인한다.
- [ ] **3단계:** 구현한다. 옮기기는 트랜잭션 하나로 한다. 끝까지 성공하고 개수가 같을 때만 COMMIT하고 JSON 이름을 바꾼다. 실패하면 ROLLBACK하고 db 파일을 지운다.
- [ ] **4단계:** `npm test`를 돌린다. 모두 통과한다.
- [ ] **5단계:** 커밋 `feat(bridge): sqlite db and one-time json migration (T26)`.

### 작업 2 (T26-b): 저장 모듈 속을 db로 바꾼다

**파일:**
- 고치기: `bridge/words.mjs`, `bridge/mydict.mjs`, `bridge/scraps.mjs`, `bridge/server.mjs`, `scripts/export-day.mjs`, `scripts/export-pending.mjs`, `scripts/export-scraps.mjs`
- 만들기: `test/db-backed.test.mjs`

**연결:**
- 쓰는 것: 작업 1의 `openDb`, `db.*`.
- 내놓는 것: `createWords({db, now})`, `createMydict({db, now})`, `createScraps({db, now})`. `file` 인자도 계속 받는다. `db`가 없으면 지금처럼 JSON을 쓴다.
- 내놓는 것: `scripts/data-source.mjs`의 `loadData(dataDir) -> {words, mydict, scraps}`. db가 있으면 db를, 없으면 JSON을 읽는다. 세 export 스크립트가 이것을 쓴다.

- [ ] **1단계: 실패하는 시험을 쓴다.**
  - `같은 요청을 JSON판과 db판에 보내면 응답이 같다` — words·mydict·scraps 각각 save·memo·remove를 보낸다.
  - `export-day 출력이 db에서도 같다`
  - `스크랩 move는 in_task 선을 바꾼다`
- [ ] **2단계:** 시험을 돌린다. 실패를 확인한다.
- [ ] **3단계:** 구현한다. 스크랩 저장 때 `task`가 있으면 `task:<id>` 점을 만들고 `in_task` 선을 잇는다.
- [ ] **4단계:** `npm test`를 돌린다. 기존 시험이 모두 통과한다.
- [ ] **5단계:** 커밋 `feat(bridge): words, mydict, scraps on sqlite (T26)`.

### 작업 3 (T27): 개념 저장과 `/concepts`, 문서 만들기

**파일:**
- 만들기: `bridge/concepts.mjs`, `scripts/export-concepts.mjs`, `test/concepts.test.mjs`, `test/concepts-server.test.mjs`, `test/export-concepts.test.mjs`
- 고치기: `bridge/server.mjs`, `package.json`(`export:concepts`)

**연결:**
- 내놓는 것:
  - `parseConceptOp(v) -> op | null`
  - `createConcepts({db, now}) -> { list(), terms(), apply(op) }`
  - `list()` → `[{id, name, aliases, definition, related:[{id,name}], appears:[{scrapId, task, taskTitle, url, title, exact}], ts}]`
  - `terms()` → `[{id, term}]`, 이름과 별칭 전부, 긴 것 먼저.
- HTTP `/concepts`(토큰 필요):
  - `GET` → `{concepts}`. `GET ?names=1` → `{terms}`.
  - `POST {op:'save', id?, name, aliases, definition, related:[이름], task?, scrapId?}` → `{concept}`. id 없이 같은 key가 있으면 409 `{id}`.
  - `POST {op:'remove', id}` → `{ok:true}`. 없는 id는 404.
  - `POST {op:'link', id, scrapId}` → `{concept}`.
- `scripts/export-concepts.mjs --to <폴더>`: `<이름>.md`를 만든다. 내용은 정의, 별칭, `관련: [[다른 개념]]`, `나온 곳:`, `[[../scraps/<할일>/<페이지>]]` 링크. 첫 줄 주석, 같은 내용이면 쓰지 않기, 주석 있는 파일만 지우기, 폴더 밖 경로 거절 — 이 규칙은 `scripts/export-scraps.mjs`와 같은 함수를 쓴다(복사하지 않는다).

- [ ] **1단계: 실패하는 시험을 쓴다.**
  - `길이 상한을 넘으면 parseConceptOp는 null`
  - `같은 이름(대소문자·공백 차이)이면 409와 기존 id` — 검토 초점 2.
  - `related는 양쪽에 선이 생긴다. 관련 이름이 없으면 그 이름은 버린다`
  - `remove는 그 개념의 모든 선을 지운다` — 검토 초점 3.
  - `terms는 별칭을 포함하고 긴 것이 먼저`
  - `appears는 scrapId 선을 따라 할 일 제목까지 준다`
  - `export-concepts: 링크 모양, 같은 내용이면 안 씀, 주석 없는 파일은 안 지움`
- [ ] **2단계:** 시험을 돌린다. 실패를 확인한다.
- [ ] **3단계:** 구현한다. `export-scraps.mjs`의 `writeIfChanged`·이름 만들기를 export해서 함께 쓴다.
- [ ] **4단계:** `npm test`를 돌린다. 모두 통과한다.
- [ ] **5단계:** 커밋 `feat(bridge): my concepts store, /concepts, export:concepts (T27)`.

### 작업 4 (T28): 확장 — [내 개념으로], 회색 표시, 개념 탭

**파일:**
- 만들기: `extension/concept-core.js`, `extension/concept.js`, `extension/panel-concepts.js`, `test/concept-core.test.mjs`
- 고치기: `extension/selection.js`(드래그 카드 버튼), `extension/content.js`(사전 카드 버튼), `extension/panel-scraps.js`(스크랩마다 버튼), `extension/background.js`(`type:'concepts'` 중계), `extension/manifest.json`

**연결:**
- 쓰는 것: 작업 3의 HTTP. 스크랩 색인 `extension/scrap.js`의 `buildTextIndex`(같은 제외 규칙). 할 일 짐작 `guess`.
- 내놓는 것:
  - `readglossConcept.findTerms(fullText, terms) -> [{id, start, end}]` — 대소문자 무시, 낱말 경계, 긴 것 먼저, 겹치면 긴 것만.
  - `globalThis.readglossConceptPage = { paint(terms), openForm(seed) }`
  - 패널 탭 id `concepts`, 제목 "개념", order 23.

- [ ] **1단계: 실패하는 시험을 쓴다.**
  - `"control"은 "controller" 안에서 찾지 않는다`
  - `"access control"과 "control"이 겹치면 "access control"만`
  - `별칭으로도 찾는다. 대소문자를 무시한다`
  - `개념 300개, 본문 20만 자에서 0.2초 안` — 검토 초점 5.
  - `링크 안 개념어는 찾고, pre 안은 찾지 않는다` — 검토 초점 4(색인 규칙 시험).
- [ ] **2단계:** 시험을 돌린다. 실패를 확인한다.
- [ ] **3단계:** 구현한다.
  1. 페이지를 열 때 `GET /concepts?names=1`을 한 번 부른다. `findTerms` 결과를 `readgloss-concept`로 칠한다.
  2. 마우스가 칠한 범위 위에 0.3초 머물면 카드를 연다. 카드는 shadow DOM이다. 카드 내용은 `GET /concepts`의 그 개념이다.
  3. 칠한 범위를 누르면 패널을 열고 "개념" 탭에서 그 개념 상세를 연다. 링크 안이면 링크 동작을 막지 않는다. ⌥ 누른 채 클릭할 때만 상세를 연다.
  4. [내 개념으로] 칸: 이름(기본 = 고른 글자), 별칭(쉼표), 정의, 관련 개념(자동완성). 저장 때 `guess`의 task와, 같은 카드의 스크랩 id를 함께 보낸다. 409면 그 개념 상세를 연다.
  5. 개념 탭: 이름순 목록, 검색 칸, 상세(고치기·나온 곳 이동·지우기). 나온 곳 이동은 스크랩북과 같은 `scrap-jump`를 쓴다.
  6. 키 처리는 `isOwnUiPath`와 입력칸 규칙을 따른다.
- [ ] **4단계:** `npm test`를 돌린다. 모두 통과한다.
- [ ] **5단계:** 커밋 `feat(ext): my concepts form, gray highlight, concepts tab (T28)`.

### 작업 5: 메인 세션 마무리 (워커 아님)

- [ ] 독립 검증자에게 설계서 11 + 이 계획 + 전체 diff를 준다.
- [ ] main에 합친다. 다리를 다시 시작한다. 다리 로그에서 옮기기 개수 한 줄을 확인한다.
- [ ] 학습 폴더 `HANDOFF.md` 3절에 `export:concepts -- --to ~/dev/learning/security-career/concepts` 한 줄을 더한다. 메모리 `readgloss-to-learning-records`를 고친다.
- [ ] 정범 5분 확인: 개념 2개 만들기 → 회색 표시 → 마우스 카드 → 클릭 → 나온 곳 이동.
