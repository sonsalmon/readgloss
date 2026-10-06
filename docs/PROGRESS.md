# readgloss 진행 기록

정본 명세: `docs/spec.md`. 이 파일은 이어 가기용 상태판이다.

## 순서(작업 단위 = 티켓)

T1 → (T1b ∥ T2) → T3 → T5. 각 티켓은 `~/dev/readgloss-worktrees/<티켓>` 워크트리에서 Sonnet 워커가 구현하고, verifier가 원자료만 받아 검증한 뒤 main에 합친다. 원격 없음, push 없음. 10-06 2차 요청으로 순서가 바뀌었다(spec.md "변경 기록 2").

| 티켓 | 상태 | 브랜치 | 메모 |
|---|---|---|---|
| T1 더블클릭 → AI 한국어 뜻 | 완료, 사용자가 Aside에서 사용(delves·module 조회됨) | main 036f7ca | 테스트 51개. 더블클릭 경로는 T1b가 사전으로 바꾸고, AI 뜻은 카드의 버튼으로 남는다 |
| T1b 더블클릭 → 맥 영한사전 카드 | 완료(Aside 수동 확인 대기) | main 21da4b2 | Swift 도우미 + `/dict` + Relingo식 카드 |
| T2 문단 클릭 → 왼쪽 버튼 → 페이지에 번역 삽입 | 완료(Aside 수동 확인 대기) | main 2ea1ebf | 합칠 때 server.mjs·background.js 충돌 해소(둘 다 살림). 테스트 105개 |
| T3 어려운 단어 위 자동 주석(판정+ruby, 옛 T3·T4 합침) | 완료(Aside 수동 확인 대기) | main d46332a | 10-06 결정: 뜻 = 사전 첫 뜻. T1b·T2 합친 뒤 시작(사전 도우미 필요). spec "변경 기록 3" |
| T5 상시 실행·켜기/끄기·수준 고르기 | 대기 | — | T3 뒤. launchd 등록은 승인 뒤 |
| T6s 설정값 뼈대(settings-core.js) | 완료 | main 3641c0f | |
| T6a 주석 그리기 개편(설정 반영·CSS 변수·걷기·끄기·오른쪽 위치) | 완료(통합 확인 중) | main | verifier 통과, P2 3건 |
| T6b 떠 있는 버튼·퀵 메뉴·패널·설정 탭·미리보기·사이트·테마 | 완료(통합 확인 중) | main 15d0c3d | verifier 통과, 합칠 때 manifest·background·테스트 충돌 해소 |
| T7 내 단어: 단어장 추가·아는 단어·최근 찾은 단어(35,36) | 완료(통합 확인 중) | main | verifier 통과, 테스트 합계 226 |
| T8 어휘량 추정(6) | 대기 | — | T6·T7 합친 뒤 |
| T9 분야 용어집(수학·ML·보안, HTB 최적화) | 진행 중(task wruhw4o7x) | feat/t9-glossary | spec "변경 기록 5" |

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
- 통합 확인 워크플로 wato0ui0i(세 조각 맞물림) 진행 중.

## 다음 한 걸음

사용자가 Aside에서 확장을 새로고침해 사전 카드·문단 번역·자동 주석을 시험하고 거슬리는 점을 말한다. 그 뒤 고칠 것 묶음(P2 + 사용자 피드백) 또는 T5(상시 실행·켜기/끄기·수준 고르기)로 간다. 다리를 새로 받은 사람은 `npm run build:dict`를 한 번 해야 사전이 켜진다.
