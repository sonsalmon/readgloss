# readgloss 핸드오프 (2026-10-20)

작업실(workroom) 학습노트 v2 작업에서 readgloss 쪽에 남은 것만 적는다. 작업실 쪽 일은 작업실 v2 Aside 세션과 따로 진행한다.

## 오늘 바뀐 것 (main에 합쳐짐)
- `bf610fd` 할 일 짐작 고침(R1): HTB 학습 주소 `app/module/<n>/section/<id>`를 작업실 `cli/workroom_cli/study_places.json` 모듈 표로 할 일에 붙인다. `remembered`(사용자가 옮긴 기록)가 여전히 먼저다. 표가 없으면 옛 규칙으로 조용히 돌아간다. `npm run -s tasks:recheck`는 읽기 전용 드라이런이다.
- 다리는 10-20 13:15에 새 코드로 다시 켜졌다. 앞으로 main에 커밋하면 작업실 자동 실행이 30분 안에 `com.sonsalmom.readgloss-bridge`를 `launchctl kickstart -k`로 다시 켠다(작업실 설계서 30-14, 같은 프로그램은 2시간에 한 번).
- 옛 스크랩 26줄을 옳은 할 일로 옮겼다(`npm run -s scraps -- move`): `ml-foundations`→`http-and-proxy` 23, `inbox`→`ml-foundations` 2(Linear/Logistic Regression), `inbox`→`http-and-proxy` 1.
- 학습노트 md(`learning/security-career/notes/`·`concepts/`)는 작업실 자동 실행이 db의 `max(nodes.ts)`·`count(*)`가 바뀔 때만 `scripts/export-notes.mjs`·`export-concepts.mjs`로 다시 만든다. 커밋은 하지 않는다(learning HANDOFF ②·②-1 고침, learning `54487d1`).

## 남은 일
1. **메모의 할 일을 옮길 수 없다.** `tasks:recheck`에 메모 7줄이 남아 있다(HTTP 페이지 메모, `ml-foundations`→`http-and-proxy`). `bridge/memos.mjs`의 작업은 save·edit·remove뿐이고 할 일 바꾸기가 없다. 스크랩처럼 `op:'move'`(id, task)를 더하고 `scripts/scraps-cli.mjs`(또는 새 CLI)에서 부를 수 있게 하면 된다. 그 뒤 `tasks:recheck`로 남은 7줄을 옮긴다. 작업실 지도는 주소로 자리를 잡아 이미 제자리에 보이지만, md 폴더(`notes/<할일>/`)는 옛 할 일 폴더에 남는다.
2. **단어만 저장한 페이지에는 제목이 없다.** 단어 저장(`words.mjs`의 `save`)은 페이지 제목을 남기지 않는다(구절 `save-phrase`는 `title`을 남긴다). 그래서 단어만 있는 페이지는 `export-notes.mjs`가 제목을 `host/path`로 만든다(예: `academy.hackthebox.com/app/module/290/section/3288`). 지금은 작업실이 `cli/workroom_cli/page_titles.json`(손으로 확인한 제목표)과 경로 말 바꾸기로 덮고 있다. 근본 해결은 확장에서 단어 저장 때 `title`도 보내고 다리가 남기는 것, 또는 export가 같은 주소의 다른 노드 제목을 빌려 쓰는 것.
3. **개념 "테스트1".** 시험 삼아 만든 것으로 보이는 내 개념이 있고, 작업실 폰 카드로 올라가 있다. 원하지 않으면 readgloss에서 지운다. 다음 자동 실행 때 작업실 카드도 사라진다.

## 참고
- 작업실이 readgloss를 읽는 방식: `data/readgloss.db`를 읽기 전용(`mode=ro`)으로만 연다. 쓰기는 다리(`127.0.0.1:47831`)를 거친다(개념 정의 제안 적용 때 `/concepts` `op:save`).
- 작업실 설계서: `~/dev/workroom/docs/spec.md` 29절(학습노트 v2), 30절(실시간 사서), 30-14(상주 프로그램 다시 켜기).
