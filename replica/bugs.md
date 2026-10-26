# 버그 기록: readgloss 영상 인풋(변경 기록 27)

시험하며 재현한 것만 적는다. 고친 커밋은 이 브랜치(`claude/langflix-video-input`)의 첫 커밋에 함께 들어갔다(아직 합치기 전이라 따로 커밋하지 않았다).

### BUG-001: 다른 영상 장면을 새 탭에서 열면, 그 영상에 자막이 없을 때 구간 끝에서 멈추지 않는다

- Severity: S2
- Flow / case: F04 / F04-E1
- Build: 작업 중 브랜치  Browser: Chromium(Playwright 1.63, headless)

Steps
1. 다른 영상(자막 없는 영상)에서 저장한 구 카드를 복습에서 연다.
2. [▶ 장면]을 누른다 → 새 탭이 열리고 그 구간 시작부터 재생된다.

Expected: clip 끝(6.5초)에서 멈춘다.
Actual: 멈추지 않고 계속 재생된다.
Evidence: e2e 단계 "F04-E1 … 자막이 없어도 구간 끝에서 멈춤: 시간 초과"
Suspected cause: `video-subs.js` tick() 이 자막 줄이 없으면 구간 확인보다 먼저 돌아가 버렸다.
Status: 고침 — 구간 확인을 줄 확인 앞으로 옮김. e2e F04-E1 통과.

### BUG-002: 유튜브에서 패널 탭 이름이 세로로 접히고 마지막 탭이 잘린다

- Severity: S3
- Flow / case: F03 / F03-E1
- Screen: 패널(340px)

Steps
1. 유튜브 영상 페이지에서 패널을 연다(탭 6개: 영상·설정·내 단어·스크랩북·개념·공부 기록).

Expected: 탭 이름이 한 줄.
Actual: "내 단 어"·"스크랩 북"처럼 접히고 "공부 기록"이 잘린다.
Evidence: e2e 화면 `4-panel-video.png`(고치기 전)
Suspected cause: 탭이 flex 로 줄어들면서 글이 접힌다. 다른 사이트(탭 5개)도 거의 꽉 찼다.
Status: 고침 — 탭 이름 한 줄(nowrap), 넘치면 탭 줄을 옆으로 넘김. 시험 `t51e … 패널 탭 이름은 한 줄`.

### BUG-003: 악센트 붙은 낱말(café·naïve)이 쪼개져서 "caf"를 누를 수 있다

- Severity: S3
- Flow / case: F01 / F01-E8

Steps
1. 자막 줄에 "A café, naïve résumé" 가 나온다.

Expected: café·naïve·résumé 는 한 덩어리, 누를 수 없음(사전은 영어 글자만 찾는다).
Actual: "caf"·"na"·"ve"·"r"·"sum" 이 낱말로 잡혀 엉뚱한 사전 카드가 열린다.
Evidence: 단위 시험 "tokenize: 악센트 붙은 낱말…" 실패
Suspected cause: 낱말 정규식이 A–Z 만 글자로 봤다.
Status: 고침 — 유니코드 글자로 끊고 영어 글자만으로 된 것만 누를 수 있게.

### BUG-004: 키보드만으로는 자막 막대([☆ 저장]·[풀이]·[한])에 갈 수 없다

- Severity: S3
- Flow / case: F02 / F02-E1

Steps
1. 유튜브 CC 단추에 포커스를 두고 Tab 을 누른다.

Expected: 자막 층에 들어가 막대가 보이고, Tab 으로 막대 단추를 차례로 간다.
Actual: 막대가 숨은 채(visibility hidden) 포커스를 받지 못한다. 줄 이동·가리기는 A·S·D·H 키로 되지만 저장·풀이·한국어 줄은 마우스로만 된다.
Evidence: e2e 단계 "F02-E1 … 막대가 보인다" 실패
Status: 고침 — 두 줄 묶음이 Tab 으로 포커스를 받고(aria-label 에 키 안내), 막대는 그 뒤 Tab 차례. 화면 차례는 CSS order 로 그대로.

## 확인할 것(재현 못 함)

- 진짜 유튜브 플레이어에서 자막을 XHR·fetch 중 무엇으로 받는지, 응답 모양(json3)이 같은지 — test-plan M1.
- 진짜 유튜브 전체 화면 요소가 플레이어를 품는지 — M5.
