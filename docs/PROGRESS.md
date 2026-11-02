# readgloss 진행 기록

정본 명세: `docs/spec.md`. 이 파일은 이어 가기용 상태판이다.

## 순서(작업 단위 = 티켓)

T1 → (T1b ∥ T2) → T3 → T5. 각 티켓은 `~/dev/readgloss-worktrees/<티켓>` 워크트리에서 Sonnet 워커가 구현하고, verifier가 원자료만 받아 검증한 뒤 main에 합친다. 원격 없음, push 없음. 10-06 2차 요청으로 순서가 바뀌었다(spec.md "변경 기록 2").

| 티켓 | 상태 | 브랜치 | 메모 |
|---|---|---|---|
| T60a–c 메모 표시 `? ` 다시 볼 것·`! ` 깨달음·`#태그`·다시 볼 것 탭(spec 변경 기록 29) | 완료(정범 실제 확인 대기) | main | DeepSeek 세 갈래 동시 구현 + 메인 background 전달·태그 중복·모드 새로고침 고침, 독립 검증 P1 0, 테스트 1445. 남은 P3: `#보안.` 끝 문장부호가 태그에 붙음, 6번째·겹친 태그는 칩만 보임, setMark 실패 알림 없음 |
| T1 더블클릭 → AI 한국어 뜻 | 완료, 사용자가 Aside에서 사용(delves·module 조회됨) | main 036f7ca | 테스트 51개. 더블클릭 경로는 T1b가 사전으로 바꾸고, AI 뜻은 카드의 버튼으로 남는다 |
| T1b 더블클릭 → 맥 영한사전 카드 | 완료(Aside 수동 확인 대기) | main 21da4b2 | Swift 도우미 + `/dict` + Relingo식 카드 |
| T2 문단 클릭 → 왼쪽 버튼 → 페이지에 번역 삽입 | 완료(Aside 수동 확인 대기) | main 2ea1ebf | 합칠 때 server.mjs·background.js 충돌 해소(둘 다 살림). 테스트 105개 |
| T3 어려운 단어 위 자동 주석(판정+ruby, 옛 T3·T4 합침) | 완료(Aside 수동 확인 대기) | main d46332a | 10-06 결정: 뜻 = 사전 첫 뜻. T1b·T2 합친 뒤 시작(사전 도우미 필요). spec "변경 기록 3" |
| T5 상시 실행 | 완료(10-06 사용자 승인) | main | launchd `com.sonsalmom.readgloss-bridge`(RunAtLoad·KeepAlive). 켜기/끄기·수준 고르기는 T6 패널에서 이미 함 |
| T6s 설정값 뼈대(settings-core.js) | 완료 | main 3641c0f | |
| T6a 주석 그리기 개편(설정 반영·CSS 변수·걷기·끄기·오른쪽 위치) | 완료 | main | verifier 통과, P2 3건 |
| T6b 떠 있는 버튼·퀵 메뉴·패널·설정 탭·미리보기·사이트·테마 | 완료 | main 15d0c3d | verifier 통과, 합칠 때 manifest·background·테스트 충돌 해소 |
| T7 내 단어: 단어장 추가·아는 단어·최근 찾은 단어(35,36) | 완료 | main | verifier 통과, 테스트 합계 226 |
| T8 어휘량 추정(6) | 대기 | — | T6·T7 합친 뒤 |
| T14a 카드: 더 넓게 보기·내 사전 추가·구 단어장·약어 카드 | 완료(통합 확인 10개 중 9 통과 → T16에서 고침) | main 2b0a508 | 입력칸 키 새는 문제·복수형 키 문제 직접 고침 |
| T14b 다리: wide·내 사전·약어집·구 단어장·공부 기록 | 완료 | main 8658373 | |
| T14c 패널: 구·문장·내 사전 탭, 공부 기록 탭 | 완료 | main 5934a22 | 테스트 412 |
| T15 하루치 내보내기 스크립트(learning-records 옮기기용) | 완료 | main e10b6da | `npm run export:day -- YYYY-MM-DD` → "## 영어 표현 (readgloss)" 마크다운. 메모리 readgloss-to-learning-records |
| T18 고침: 링크 카드 안 ★ 이동 막기, 카드 저장 뒤 패널 갱신, 내 사전 출처 | 완료 | main | DeepSeek 구현, 독립 검증 통과, 테스트 468. 남은 P2: 패널 다시 읽기 응답 순서(seq 없음), 편집 중 커서 풀림 |
| T19–T22 페이지 전체 번역·드래그 무기록·저장 확인 메시지+메모 (spec 변경 기록 9) | 완료(실제 Aside 확인 대기) | main 5047bad | DeepSeek(T19·T20·T22) + Gemini(T21) 구현, 독립 검증 3회 통과, 테스트 507. 전체 번역은 퀵 메뉴, 문단 하나씩 AI, 3연속 실패면 멈춤. 메모는 /words op memo(0~1000자). 남은 P2: 멈춘 직후 도착한 번역은 n/N 에 안 셈 |
| T17 기억할 표현·문맥 번역 우선·저장 문장 더블클릭 | 완료(통합 검증 통과, 실제 Aside 확인 대기) | main 2aa0905 | 테스트 463. 10-06 저녁부터 작업은 외부 워커: DeepSeek V4.1(opencode-worker, 테스트 실행 가능)·Gemini 3.8(gemini-worker, 헤드리스에서 셸 명령 불가 → 편집만). 지시문은 heredoc 대신 파일로(안전 훅이 긴 한국어 heredoc 차단) |
| T16 고침: 굴절 안내 항목 원형(matrices→matrix), 공부 기록 새로고침, 내보내기 원형 | 완료 | main e10b6da | 독립 검증 통과, 테스트 426 |
| T12 드래그 번역(맥 번역 + [문맥 번역] AI) | 완료(Aside 수동 확인 대기) | main 32a4632 | 테스트 320. 다리 시작 때 사전·맥 번역 미리 깨우기. 새로 받은 사람은 npm run build:native |
| T13 뜻 고르기 개선(용어집 보충 + 사전 분야 표시 뜻 우선) | 완료(Aside 수동 확인 대기) | main 464ffc9 | 용어집 +122, HTB 기준 186개 뜻 바뀜. 흔한 낱말(A1~B1)과 쓰임 제한 붙은 뜻은 분야 표시 뜻에서 제외(average·iterative 는 첫 뜻) |
| T11 용어집 사이트 목록(보안 사이트 기본 19개 + 패널 추가/삭제, 사이트 규칙은 확장 설정 한 곳) | 완료(Aside 수동 확인 대기) | main cec62ac | 사용자 결정: 보안 사이트 목록 + 패널 추가. 다리는 요청 힌트만 씀 |
| T31 메모장 v2(spec 변경 기록 14) | 완료(정범 확인 대기) | main 01e0e3e | ⌥M 토글, Enter 줄바꿈·⌘Enter 저장, 끌기·크기·기억, 소제목 문서 화면 + 스크롤 따라가기, 고른 글 ⌥M = 인용. Gemini 작게 4번(1번 시간 초과) + Haiku 마무리 2번 + 독립 검증 1번 + 지적 재확인 |
| T29 메모장 + T30 나중에 볼 것(spec 변경 기록 12·13) | 완료(정범 확인 대기) | main da0acab | 메모장 ⌥M/⌥⇧M(chrome.commands), 메모 db 점 memo, 스크랩북·학습 폴더 `## 메모`. 나중에 볼 것 = 설명 없는 개념, 점선 밑줄, [나중에] 버튼, 개념 탭 칩. 개념 탭 즉시 갱신 고침. Gemini 편집(두 번 9분 시간 초과로 끊김 → Haiku가 마무리) + 독립 검증 2회 |
| T26–T28 내 개념 표시 + SQLite(spec 변경 기록 11) | 완료(정범 5분 확인 대기) | main 2ae2d5b | 10-13 실제 데이터 옮김(단어장 21·최근 46·구 1·내 사전 3·스크랩 8, 전후 같음). 옛 JSON은 data/*.migrated-<ts>, 백업 ~/dev/readgloss-backups/data-2026-10-13-before-db. Gemini 편집 + 메인 시험 + 작업마다 독립 검증 |
| T23–T25 스크랩 고리(spec 변경 기록 10) | 완료(정범 10분 확인 대기) | main 2fb65bf | Gemini 3.8 편집 + Haiku 5.5 시험·커밋 + 작업마다 독립 검증. 형광펜(Highlight API) Aside 확인됨. 학습 폴더 따라잡기 절차는 learning HANDOFF 3절, 첫 따라잡기 10-07 완료 |
| T9 분야 용어집(수학·ML·보안, HTB 최적화) | 완료(Aside 수동 확인 대기) | main 51c86f9 + 7d638ce | HTB 모듈 290(Fundamentals of AI) 15개 섹션 기준, 용어 검토 15건 반영, transposed 원형 고침. HTB 는 수식이 평문이라 수학 감지는 사이트 규칙이 대신함 |

## 미리 정해 둔 것

- T1은 npm 의존성 0개. 화면 접착 코드는 얇게, 순수 함수는 `node --test`로 시험한다.
- 표제어 추출기(`wink-lemmatizer`)는 들이지 않는다. 원형은 맥 사전이 찾아 준 표제어를 쓴다(변경 기록 3).
- `<ruby>` 그리기 테스트용 devDependency(`linkedom`)는 T3에서 정한다. 그 전에 들이지 않는다.
- T5의 launchd 등록은 지속 설정이라 사용자 명시 승인 뒤에만 한다. 워커는 plist 파일만 쓰고 `launchctl load`·`bootstrap`은 하지 않는다.
- Relingo가 같은 Aside 프로필에 깔려 있다. readgloss는 그냥 더블클릭으로 동작하므로, 시험 전에 Relingo를 끄라고 안내한다.
- 구독 호출 상한: 구현 워커 10회, 검증 워커 5회(벤치 포함). 테스트는 가짜 AI만 쓴다.

- 다리는 자식 claude 의 env 에서 CLAUDE*·ANTHROPIC_* 를 모두 지운다(Claude 앱 셸의 ANTHROPIC_BASE_URL 등을 물려받지 않게, ANTHROPIC_API_KEY 로 과금이 새지 않게). 깨끗한 env 에서 구독 로그인으로 도는 것 확인(10-06, 3.25초).
- 확장 ID: bmkoabpndmngeoibdfeoidhedhepmchd (manifest key 에서 파생). 개인키는 저장소에 없다.

## 남은 작은 문제(검증 P2)

- li 문단에서 번역 버튼이 글머리표를 가린다. 오류 말풍선이 좁은 화면에서 문단 위에 겹친다.
- payload 처럼 사전 표제어에 강세 기호가 섞여 발음 칸이 빈다(páylòad).
- AI 버튼 aria-label 이 보이는 글자를 포함하지 않는다.
- 사전 평문 일부가 fixtures 로 저장소에 있다(로컬 전용이라 지금은 문제없음, 공개하면 다시 볼 것).

## T3 뒤 관찰(10-06)

- /annotate 18단어 0.14초. 첫 뜻 규칙의 어색한 예: exploit→영웅적 행위, vulnerability→상처받기 쉬움, payload→수익 하중, query→의문, arbitrary→수의의, kernels→인, repositories→그릇. 개선 후보: 사전의 [컴퓨터] 분야 표지가 붙은 뜻 우선, 또는 AI 문맥 뜻 일괄(한도 사용). 사용자가 써 본 뒤 고른다.
- 확인 안 함: 주석 붙은 문단을 Cmd+C 로 복사하면 뜻 글자가 섞이는지(getSelection 은 깨끗, Range.toString 엔 섞임).
- level·annotateEnabled 를 바꿔도 이미 붙은 주석은 그대로(T5에서 다시 그리기·지우기).
- 다리 시작 때 사전 도우미 예열이 없어 첫 페이지가 약 0.9초 늦을 수 있다.

## 사용자 피드백(10-06, T3 사용 뒤) — 다음 구현 회차에 반드시 넣기

- 주석이 너무 많다 → 기본 수준을 올리고 사용자가 고르게.
- 주석 글자색은 본문색과 같게(기본), 글자는 더 작게.
- 모양 세부(글자 크기·색 등)를 사용자가 값으로 조정할 수 있게.
- Relingo처럼 화면 오른쪽에 떠 있다가 클릭하면 펼쳐지는 설정 패널.
- Relingo 기능 번호 목록을 받아 사용자가 고른 것을 더해 한 번 더 구현 루프(조사 워크플로 wzc8aykwz 진행 중).

## T6·T7 뒤 확인 안 한 것

- 격리 월드(content script)에서 document.adoptedStyleSheets 채택이 되는지. 안 되면 <style> 대체 경로로 들어간다(엄한 CSP 페이지에선 막힐 수 있음). 판가름: Aside 실사용.
- 툴바 아이콘 → 패널 열기가 tabs 권한 없이 되는지. 판가름: Aside 실사용.
- 통합 확인(wato0ui0i): 13개 중 12개 통과, 미리보기 빈 화면(P1)과 P2 3건은 T10(main 935ac2a)에서 고침·독립 검증 통과.
- npm test 는 하나씩 차례로 돈다(--test-concurrency=1). 머신 부하가 높을 때 시간 재는 테스트가 흔들렸기 때문.

## T9 뒤 메모

- (T11로 해결) 보안 문서 사이트 기본 목록 + 패널 "용어집을 켤 사이트". 다리는 더 이상 사이트로 판단하지 않으니, 확장을 새로고침하지 않은 옛 확장은 HTB 에서도 용어집이 안 나온다.
- 두 단어 이상 용어(phrases-*.json)는 저장만 됨. 구 단위 주석은 다음 후보.
- 위키 원자료: ~/dev/llm-wiki/raw/sources/2026-10-06-claude-p-persistent-subscription-bridge.md, 2026-10-06-macos-dictionary-services-en-ko.md

## 다리 상시 실행(launchd, 10-06 등록)

- 설정 원본: `ops/com.sonsalmom.readgloss-bridge.plist` → 설치본 `~/Library/LaunchAgents/com.sonsalmom.readgloss-bridge.plist`. 로그: `data/bridge.out.log`, `data/bridge.err.log`.
- 상태: `launchctl print gui/$(id -u)/com.sonsalmom.readgloss-bridge | grep state`
- 코드를 바꾼 뒤 다시 시작: `launchctl kickstart -k gui/$(id -u)/com.sonsalmom.readgloss-bridge`
- 끄기(등록 해제): `launchctl bootout gui/$(id -u)/com.sonsalmom.readgloss-bridge` (다시 켜기: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sonsalmom.readgloss-bridge.plist`)
- 포트 47831 은 이 상시 다리가 쓴다. 시험은 계속 임시 포트로. 세션 안에서 `node bridge/server.mjs` 를 따로 띄우지 않는다(EADDRINUSE).

## 다음 한 걸음

(10-26) 랭플릭스 인풋 고리(변경 기록 27, T51a~f)를 브랜치 `claude/langflix-video-input`에 지음 — 아직 main 아님(PR). 유튜브 영상에서 readgloss 이중자막 층(영어 줄 낱말 누르면 사전 카드, 한국어 줄 맥 번역, 어려운 단어·단어장 단어 칠하기, 가리기 H·R, 줄 이동 A·S·D, 줄마다 멈춤 P, 마우스를 올리면 멈춤, [☆ 저장]=구·문장 + 장면 clip, [풀이]=문맥 번역), 패널 [영상] 탭(대본·어려운 단어 미리 보기·한국어 모두), 복습 방식(뒤집기·고르기 4지선다·듣기, [▶ 장면]·🔊). 시험 1194(+52) · 가짜 유튜브 e2e 20/20(`node e2e/youtube.e2e.mjs`). 정범 확인 차례: 확장 ↻ 뒤 진짜 유튜브에서 `replica/test-plan.md`의 M1~M9(자막이 뜨는지, 자동 생성 자막 줄 길이, 광고, 영상 넘김, 전체 화면, 맥 번역 속도, 듣기 목소리, 한글 자판 키, 극장 모드). 다리는 다시 켜야 clip을 받는다(`launchctl kickstart -k gui/$(id -u)/com.sonsalmom.readgloss-bridge`). 안 되면 증상만 알려 주면 그 부분을 고친다. 다음 후보: 넷플릭스(자막 표시·낱말·저장부터), 숙어 칠하기. 정찰·짜임새·시험·점수: `replica/`(점수 95.8, 반드시 12/12).

(10-26 이어서) UI/UX 고치기 고리 1회차 + 코드 검토(변경 기록 27-10, T51g): Fable 감사 16건 + 코드 검토 13건 중 재현한 18건을 고침(BUG-005~022). 큰 것: 패널 탭 CSS 가 shadow root 하나에서 서로 새던 것(내 단어·공부 기록 탭에도 있던 문제 — 머리 "다리 연결됨" 색, 구·문장 칩 눌림 바탕이 같이 고쳐짐), 고르기 Enter 두 번에 다음 카드가 저절로 답해지던 것, 60초 넘는 줄 저장 14% 실패, 확인 메시지가 자막 줄을 가리던 것, 키보드로 자막 낱말 찾기(←·→·Enter·Esc). 시험 1208 · e2e 35/35(고치기 전 코드면 12/35). 정범 확인에 M10(진짜 유튜브 ←·→·360°) 추가. 2회차(27-11): 심각·높음 없음, 중간·낮음 9건 고침(BUG-023~029) — 마우스로 낱말을 누르면 포커스가 층에 남던 것, 포커스 테두리 두 겹, 공부 기록 탭 글자(12px·굵게·회색이던 것, 원래 있던 문제), 눌린 칸 글자색, 가리기 단추 폭 고정. 시험 1210 · e2e 36/36. 3회차(확인): 2회차 9건 해결 확인, 남은 3건(눌린 막대 단추 대비, 한국어 줄 고르기, 포커스 세 겹) 고침 — e2e 37/37. 심각·높음이 두 번 연속 없어서 고리를 멈춤.

(10-16 저녁) 형광펜·인용 흐름(T46~T50)을 main 2b9ce79까지 합침(시험 1138): 드래그+Tab = 스크랩+메모장 인용, 형광펜 카드 [번역]·[문맥 번역] 저장, 드래그+D = 내 개념 칸, 드래그+C = 코드 인용(언어 고르기), 표 안 드래그+Tab = 표 인용(학습노트 마크다운 표). 선택 끝이 요소일 때 위치 계산 오류(scrap-core pathOf)도 고침. 남은 작은 것: 큰 한글 표는 /memos 96KB 상한에 걸릴 수 있음, 1000자 넘는 표는 스크랩만 실패(인용은 됨), 개념 편집기 열린 동안 다른 곳에서 저장한 개념은 다음 다시 그리기 때 보임.

(10-16) 사전 링크(YouGlish·네이버·Oxford·Cambridge)·복습 고리(상자 5칸, 패널 내 단어 [복습], 옛 단어 하루 10개씩, 복습 끝 단어 주석 줄임)·글 고른 채 Tab 인용·메모장 Enter 버그를 main까지 합침(시험 1070). 다리 시작 때 옛 단어 47개에 복습 날짜 붙음(백업 data/readgloss.db.bak-2026-10-16-review). 랭플릭스 아이디어 중 가리기 연습·문장 따라 말하기는 보류.

(10-15 밤) 문장 구조(변경 기록 21: 전치사+관계사 점선, 누르면 뼈대·풀이·번역 카드, 링크 안은 ⌥클릭)를 main 0808246까지 합침(시험 1035). 설계해 둔 조각은 모두 끝. 남은 작은 것: iframe 안 공부 시간, 공부 모드 주소창(⇧⌘F 결과 대기), 입력 칸 투명도 변수, 자주 막히는 구조 숫자를 패널에 보이기(다리 GET /explain-structure/stats는 있음).

(10-15 저녁) 내게 맞춘 주석(변경 기록 20: 단어마다 모를 확률, 하루 한 번 자동 조절, 패널 내게 맞추기)을 main 621c20a까지 합침(시험 1006). 다음 조각: 문장 구조(전치사+which, 설계 그림 4절). 영어 통화 틀린 단어 반영은 세션 끝 에이전트 몫으로 남김.

(10-15 오후) 주석 겹쳐 그리기(변경 기록 18, HTB 저장 실패 고침)·화면 다듬기(T39)·섹션별 공부 시간(변경 기록 19, T40a~c)을 main ac4da22까지 합침(시험 987). 정범이 확장 ↻ 뒤 확인. 다음 조각: 내게 맞춘 주석 → 문장 구조. 남은 작은 것: iframe 안 영상·활동은 안 셈(all_frames false), 공부 모드 주소창(브라우저 설정 ⇧⌘F 결과 대기, 안 되면 팝업 창 방식).

(10-15) 학습노트(변경 기록 16)·메모장 v3(17)·할 일 기억(T35)·검증 수정 FX-A~F를 main 8c786c4까지 합침(시험 932). 정범이 확장 ↻ 뒤 확인 목록을 써 본다. 다음 조각: 내게 맞춘 주석(`docs/show-me-adaptive-annotation.html`) → 문장 구조(전치사+which). 남은 작은 것: 입력 칸 투명도 변수(`--rg-input-alpha`)를 각 화면이 쓰게, 공부 모드 켜짐 상태가 새로 고침 뒤 메뉴에서 꺼짐으로 보임. HTB module 290 기록은 10-15 정범 결정으로 ml-foundations로 옮김(백업 data/readgloss.db.bak-2026-10-15-htb290).

(10-07) 사용자가 확장 ↻ 뒤 저장 확인 메시지·메모·전체 번역을 써 본다. 남은 작은 것: 다리 꺼짐 안내 문구가 아직 "터미널에서 node ... 실행"이라 launchd 기준으로 바꿀 것.

사용자가 Aside 에서 확장을 새로고침해 패널·내 단어·용어집(HTB)을 시험한다. 다음 후보: T8 어휘량 추정, T5 상시 실행(launchd, 승인 필요), 보안 사이트 용어집 확대. 다리를 새로 받은 사람은 `npm run build:native`(사전+맥 번역 도우미)를 한 번 해야 한다.
