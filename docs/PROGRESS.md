# readgloss 진행 기록

정본 명세: `docs/spec.md`. 이 파일은 이어 가기용 상태판이다.

## 순서(작업 단위 = 티켓)

T1 → (T1b ∥ T2) → T3 → T4 → T5. 각 티켓은 `~/dev/readgloss-worktrees/<티켓>` 워크트리에서 Sonnet 워커가 구현하고, verifier가 원자료만 받아 검증한 뒤 main에 합친다. 원격 없음, push 없음. 10-06 2차 요청으로 순서가 바뀌었다(spec.md "변경 기록 2").

| 티켓 | 상태 | 브랜치 | 메모 |
|---|---|---|---|
| T1 더블클릭 → AI 한국어 뜻 | 완료, 사용자가 Aside에서 사용(delves·module 조회됨) | main 036f7ca | 테스트 51개. 더블클릭 경로는 T1b가 사전으로 바꾸고, AI 뜻은 카드의 버튼으로 남는다 |
| T1b 더블클릭 → 맥 영한사전 카드 | 대기 | — | Swift 도우미 + `/dict` + Relingo식 카드 |
| T2 문단 클릭 → 왼쪽 버튼 → 페이지에 번역 삽입 | 대기 | — | T1b와 병렬 |
| T3 어려운 단어 판정·주석 뜻 | 보류 | — | 주석 뜻 출처(사전 첫 뜻 vs AI 문맥) 재결정 뒤 |
| T4 ruby 주석 그리기 | 대기 | — | T3 뒤 |
| T5 상시 실행·켜기/끄기 | 대기 | — | T4 뒤 |
| (후보) 단어장 저장 | 미정 | — | 원래 바람(단어·문장 저장해 외우기), 요청 오면 |

## 미리 정해 둔 것

- T1은 npm 의존성 0개. 화면 접착 코드는 얇게, 순수 함수는 `node --test`로 시험한다.
- `wink-lemmatizer`는 T3에서 들인다. T1의 캐시 키는 소문자 원형 단어다(T3에서 표제어로 바꾼다).
- T4의 `<ruby>` 그리기 테스트용 devDependency(`linkedom`)는 T4에서 정한다. 그 전에 들이지 않는다.
- T5의 launchd 등록은 지속 설정이라 사용자 명시 승인 뒤에만 한다. 워커는 plist 파일만 쓰고 `launchctl load`·`bootstrap`은 하지 않는다.
- Relingo가 같은 Aside 프로필에 깔려 있다. readgloss는 그냥 더블클릭으로 동작하므로, 시험 전에 Relingo를 끄라고 안내한다.
- 구독 호출 상한: 구현 워커 10회, 검증 워커 5회(벤치 포함). 테스트는 가짜 AI만 쓴다.

- 다리는 자식 claude 의 env 에서 CLAUDE*·ANTHROPIC_* 를 모두 지운다(Claude 앱 셸의 ANTHROPIC_BASE_URL 등을 물려받지 않게, ANTHROPIC_API_KEY 로 과금이 새지 않게). 깨끗한 env 에서 구독 로그인으로 도는 것 확인(10-06, 3.25초).
- 확장 ID: bmkoabpndmngeoibdfeoidhedhepmchd (manifest key 에서 파생). 개인키는 저장소에 없다.

## 다음 한 걸음

T1b(사전 카드)와 T2(문단 버튼·삽입 번역)를 워크트리 두 개에서 병렬로 돌리고, 끝나면 main에 합쳐 사용자에게 Aside에서 확장 새로고침 뒤 시험을 안내한다.
