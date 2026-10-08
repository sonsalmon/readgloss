# 스크랩 기능 기존 도구 조사 (2026-10-08)

목표 동작: (1) 문장 드래그→스크랩, 소제목 아래 저장 (2) 재방문 시 형광펜 복원 (3) 목록에서 눌러 위치로 스크롤 (4) ←→ 이동 (5) 로컬 전용 + 마크다운 내보내기.
조사 방법: GitHub API(별·라이선스·마지막 push/커밋), 저장소 소스 일부, 공식 문서, 웹 검색. 기준일 2026-10-08. 본문은 베끼지 않고 요약했다.
readgloss 현황: 확장은 번들러 없는 순수 JS(`/Users/sonsalmom/dev/readgloss/extension/*.js`, package.json에 빌드 스크립트는 사전·번역 네이티브뿐)다. 그래서 부품은 "파일 복사 가능한 작은 JS"여야 편하다.

## 1. 한눈 비교

| 도구 | 라이선스 | 유지 상태 | 1 저장 | 2 재방문 복원 | 3 위치 이동 | 4 ←→ | 5 로컬/MD | 가져다 쓸 부품 |
|---|---|---|---|---|---|---|---|---|
| Hypothesis client | BSD-2-Clause | 활발(마지막 커밋 2026-07-31) | O | O(핵심 기능) | O | 확인 못 함 | 서버 필요, 사실상 X | **앵커링 코드(복사)** |
| Obsidian Web Clipper | MIT | 활발(push 2026-09-22) | O | O | 확인 못 함 | 확인 못 함 | 로컬(저장소 위치 문서에 없음), 내보내기는 JSON | 앵커 설계 참고 |
| Memex | README는 MIT, LICENSE 파일은 확인 못 함 | 기본 브랜치 마지막 커밋 2024-07, 이후 push 2025-12 | O | O | O | 확인 못 함 | 동기화·백업 중심, MD 언급 없음 | 거대한 앱이라 부품 어려움 |
| Glasp | 비공개(소스 없음) | 서비스 운영 중 | O | O | 확인 못 함 | X | 계정 필수, 서버 저장 | 없음 |
| Readwise Reader | 비공개 | 서비스 운영 중 | O | O | O | 확인 못 함 | 구독, MD 일괄 내보내기 있음 | 없음 |
| Liner | 비공개 | 서비스 운영 중 | O | O | 확인 못 함 | 확인 못 함 | 로그인 필요, 유료 제한 | 없음 |
| Omnivore | AGPL-3.0 | 클라우드는 2024-11 종료, 저장소는 자체 호스팅용으로 커밋 계속(2026-10-05) | O | O | O | 확인 못 함 | 자체 호스팅 서버 필요 | AGPL이라 부품 부적합 |
| jeromepl/highlighter | MIT | 별 381, push 2025-11 | O | O(XPath류 추정, 확인 못 함) | 확인 못 함 | X | 로컬 | 작은 참고 구현 |

## 2. 도구별 메모

### Hypothesis (client)
- 라이선스: LICENSE 원문은 BSD-2-Clause (https://raw.githubusercontent.com/hypothesis/client/main/LICENSE). GitHub API는 NOASSERTION이라고 표기하지만 package.json도 BSD-2-Clause (https://raw.githubusercontent.com/hypothesis/client/main/package.json). 별 735, 마지막 커밋 2026-07-31 (GitHub API).
- 앵커링 구조: `src/annotator/anchoring/`에 `html.ts`, `match-quote.ts`, `text-range.ts`, `xpath.ts`, `trim-range.ts`, `rendered-text.ts` (https://github.com/hypothesis/client/tree/main/src/annotator/anchoring). `html.ts`가 RangeSelector·TextPositionSelector·TextQuoteSelector를 모두 모아 여러 방식으로 순서대로 시도한다(https://raw.githubusercontent.com/hypothesis/client/main/src/annotator/anchoring/html.ts).
- 퍼지 매칭: `match-quote.ts`는 정확 일치 먼저, 없으면 `approx-string-match`로 오타 허용 검색을 하고, 앞뒤 문맥(prefix/suffix 각 가중치 20)과 원래 위치 힌트로 점수를 매긴다(https://raw.githubusercontent.com/hypothesis/client/main/src/annotator/anchoring/match-quote.ts). "페이지가 조금 바뀌어도" 요구에 가장 맞는 설계다.
- 한계: Hypothesis 앱은 `h` 서버(https://github.com/hypothesis/h, BSD-2-Clause)와 계정이 전제라 로컬 전용·MD 내보내기 요구와 안 맞는다. 기본 서비스는 공유 주석이라는 성격이 강하다(공식 소개는 비공개 여부를 명시하지 않아 확인 못 함: https://web.hypothes.is/help/what-is-hypothesis/). 소스는 TypeScript이고 Hypothesis 내부 타입에 얽혀 있어 그대로 복사는 불가, 필요한 함수만 JS로 옮겨야 한다.
- 결론: 앱으로는 불가, 앵커링 알고리즘은 최고의 참고서이자 복사 후보.

### 앵커링 npm 패키지
| 패키지 | 라이선스 | 마지막 배포 | 비고 |
|---|---|---|---|
| `approx-string-match` 2.0.0 | MIT | 2021-11 (저장소 push 2026-04, 별 55) | Hypothesis 작성자 로버트 나이트 제작, Hypothesis가 실제 사용. 순수 JS 문자열 근사 검색, 의존성 없음. https://github.com/robertknight/approx-string-match-js |
| `dom-anchor-text-quote` 4.0.2 | MIT | 2017-02 (저장소 push 2023-07) | Range↔{exact,prefix,suffix}. 오래됐고 근사 매칭이 아닌 정확 검색 위주(소스 미확인). https://github.com/tilgovi/dom-anchor-text-quote |
| `dom-anchor-text-position` 5.0.0 | MIT | 2020-04 | Range↔{start,end}. 구조 변경에 약함. https://github.com/tilgovi/dom-anchor-text-position |
| `@apache-annotator/dom`, `/selector` 0.2.0 | Apache-2.0 | 2021-09, 저장소 `apache/incubator-annotator`는 아카이브됨(2024-06) | W3C Web Annotation 표준 구현. 문서·구조가 무겁고 방치 상태. 아카이브라 신규 의존으로는 비추천. https://github.com/apache/incubator-annotator |
- 확인: 위 버전·날짜는 npm 레지스트리 조회(https://registry.npmjs.org/<패키지>)와 GitHub API 결과다. 번들러 없는 환경에서의 실제 동작 시험은 안 함.

### Obsidian Web Clipper
- MIT(트레이드마크·아이콘 등 마케팅 자산은 제외), 별 5309, push 2026-09-22 (https://github.com/obsidianmd/obsidian-clipper).
- 형광펜: 확장 패널·단축키·우클릭으로 켜고, 저장된 하이라이트는 재방문 시 나타난다고 문서가 말한다. 하이라이트 목록 화면이 있고 `.json` 내보내기만 확인(https://obsidian.md/help/web-clipper/highlight). 저장 위치와 복원 방식은 문서에 없다.
- 소스 확인: `src/utils/highlighter.ts`에 XPath + 블록 내 텍스트 오프셋 + `TextQuoteAnchor`(prefix/suffix) 구조가 있고, "XPath가 낡았을 때 다시 앵커링"하는 용도라고 주석에 적혀 있다(https://github.com/obsidianmd/obsidian-clipper/blob/main/src/utils/highlighter.ts). 즉 XPath 1차, 인용 문맥 2차. 퍼지(근사) 매칭이 있는지는 확인 못 함.
- 용도 차이: 하이라이트를 "클리핑할 때 노트에 같이 담는" 용도에 가깝고, 스크랩 목록 탐색(3, 4)은 확인 못 함. 소제목 아래 정리와도 다름.
- 결론: 갈아타기 부적합(요구 3·4가 없는 듯), 설계 참고용.

### Memex (WorldBrain)
- README는 "MIT licensed"라고 쓰지만(https://github.com/WorldBrain/Memex) GitHub는 라이선스를 인식하지 못했고 `License` 파일 URL은 404였다. 라이선스 근거가 약해 코드 재사용은 보류. 별 4722.
- 유지: 기본 브랜치 마지막 커밋 2024-07-24(GitHub API), 이후 다른 브랜치 push는 2025-12. 사실상 느린 유지로 보이나 공식 선언은 확인 못 함.
- 기능: 웹페이지·텍스트 주석, 모바일 동기화(종단 암호화), 클라우드 백업. 로컬 전용과 MD 내보내기는 README에 없음. 코드 규모가 크고(커밋 13k, Storybook·Firebase류 구조) 분리해 쓸 부품 후보는 못 찾음.

### Glasp / Readwise Reader / Liner (상용)
- Glasp: 계정 필수, 서버 수집, 웹 PDF 하이라이트는 기본 공개 성격. MD·JSON 내보내기 있음(https://glasp.ai/privacy-policy, https://glasp.ai/posts/how-to-highlight-a-pdf-on-chrome). 로컬 전용 불가.
- Readwise Reader: 구독형. 전체 하이라이트를 마크다운 폴더로 내보내는 기능 있음(https://readwise.io/changelog/markdown-export). 가격은 제3자 사이트 간 값이 달라 확인 안 함(공식 가격 페이지 미조회). 서버 저장이라 로컬 전용 불가.
- Liner: 로그인 필요, 무료판은 하이라이트 수 제한이 있다는 사용자 후기뿐(https://talk.macpowerusers.com/t/what-are-your-experiences-with-liner-website-highlighting/21246). 공식 가격·내보내기는 확인 못 함.
- 세 곳 모두 비공개 소스라 부품 없음, 데이터가 남의 서버에 간다는 점에서 요구 5와 충돌.

### Omnivore
- 클라우드 앱은 2024-11 종료, 이후 자체 호스팅만(AGPL-3.0). 저장소는 커밋이 이어진다(2026-10-05 GitHub API) (https://github.com/omnivore-app/omnivore). 서버(Docker) 운영이 필요해 "맥 로컬 Node 서버만" 구조에 과함. AGPL은 코드를 가져다 쓸 때 전염성이 있어 개인 사용이어도 부품 복사는 비추천.

### 기타 오픈소스: jeromepl/highlighter
- MIT, 별 381, push 2025-11 (https://github.com/jeromepl/highlighter). 크롬 확장, 하이라이트를 저장하고 페이지 로드 때 복원, 복원 못 한 하이라이트(lost)를 따로 다루는 액션(`getLostHighlights.js`)이 있다(소스 트리 확인). 앵커링 방식(XPath 계열 추정)과 퍼지 여부는 코드를 읽지 않아 확인 못 함. 신뢰도 높은 복원 로직 참고 대상은 못 됨.
- 이 밖에 별 많은 다른 형광펜 확장은 조사하지 않음(범위: 1~2개).

## 3. 결론

추천: **직접 만들기 + 앵커링 알고리즘만 가져오기(부품만 가져오기와 직접 만들기의 혼합)**. 갈아타기는 추천하지 않는다.

근거
1. 갈아타기 불가: 요구 5(로컬 전용, 내 맥 Node 서버, 마크다운)와 요구 1의 "소제목 아래 저장"을 한꺼번에 만족하는 도구를 못 찾았다. 상용 셋은 계정·서버 저장이고, Hypothesis·Omnivore는 서버를 따로 세워야 하며, Obsidian은 JSON 내보내기와 클리핑 중심이다.
2. 저장·소제목 분류·목록·←→ 이동·MD 내보내기는 readgloss가 이미 가진 로컬 서버와 패널 구조에 붙이는 얇은 코드다. 남의 앱에 맞추는 것보다 직접 만드는 쪽이 작다.
3. 어려운 부분은 2번(다시 칠하기)뿐이다. 여기는 Hypothesis의 방식이 검증된 정답에 가깝다: 저장 시 `{exact, prefix, suffix, 텍스트 오프셋 힌트}`를 같이 저장하고, 불러올 때 (a) 오프셋 위치에서 exact 확인 → (b) 정확 일치 검색 → (c) `approx-string-match` 근사 검색 + prefix/suffix 점수로 최선 후보 선택 순서로 시도한다(`html.ts`, `match-quote.ts`).
4. 부품 선택 판단
   - 가져올 것: `approx-string-match`(MIT, 의존성 없는 소형 JS, 단일 파일 복사 가능). Hypothesis `match-quote.ts`의 점수 방식은 BSD-2-Clause이므로 저작권 고지를 유지하고 JS로 옮겨 쓰면 된다(라이선스 문구는 LICENSE 원문 확인 필요, 본 조사에서는 첫 단락만 확인).
   - 가져오지 말 것: `@apache-annotator/*`(무겁고 저장소 아카이브), `dom-anchor-text-quote`(2017 이후 배포 없음, 근사 매칭 없음), `dom-anchor-text-position`(구조 변경에 약함). 이것들 대신 `Range`→평문 오프셋 변환 약 30~50줄은 직접 쓰는 편이 번들러 없는 환경에 맞다.
   - Obsidian의 "XPath 1차 → 텍스트 인용 2차"는 속도 면에서 좋은 순서이므로 따라 해 볼 만하다. 다만 XPath는 구조가 바뀌면 깨지니 필수가 아닌 보조로 둔다.
5. 틀리면 드는 비용: 직접 구현한 매칭이 페이지 변화에서 실패하면 해당 스크랩이 "복원 안 됨"으로 남고 목록 클릭은 페이지 열기까지만 된다. 데이터(원문 문장 + 소제목)는 안 사라진다. 이 경우 `approx-string-match` 점수 임계값 조정, 최악은 Hypothesis 코드 더 가져오기.

다음에 확인하면 좋은 것(이 조사에서 확인 못 함)
- `approx-string-match`를 MV3 content script에 그대로 넣었을 때 동작과 성능(긴 페이지). 확인 명령: 저장소를 받아 `node -e`로 샘플 문서에 돌려 본다.
- Hypothesis LICENSE 전문(BSD-2-Clause 고지 요건)과 `match-quote.ts` 옮김 시 표기 방식.
- 단일 페이지 앱·무한 스크롤처럼 본문이 늦게 그려지는 사이트에서 재칠하기 시점(MutationObserver 재시도) — 구현 단계 과제.
