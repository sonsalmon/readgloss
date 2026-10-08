# Text Fragments / Custom Highlight API 조사 (2026-10-08)

목적: Aside(Chromium 계열)용 개인 확장에서 "스크랩 문장으로 이동+형광펜", "재방문 시 다시 칠하기"를 브라우저 기본 기능으로 할 수 있는가. 웹 조사만 했고 실제 브라우저·확장에서 돌려 보지는 않았다. 확인 못 한 것은 "확인 안 함"으로 표시했다.

## 한 줄 결론
추천 조합은 "이동은 Text Fragment" 단독이 아니라 **"저장은 TextQuote(exact+prefix+suffix), 이동과 다시 칠하기는 둘 다 콘텐츠 스크립트가 직접 문장을 찾아(Range) scrollIntoView + CSS Custom Highlight API"**이다. Text Fragment는 보조(주소 복사, 간단 열기)로 둔다. 이유는 6절.

## 1. Text Fragments 문법·지원·형광펜 수명
- 문법: `#:~:text=[prefix-,]textStart[,textEnd][,-suffix]`. textStart만 필수. start만 있으면 정확 일치, end가 있으면 start부터 다음 end까지 범위. prefix/suffix는 일치 구간 바로 앞뒤 문맥이며 공백이 사이에 있어도 된다. 값은 퍼센트 인코딩, 특히 `-` `&` `,`는 반드시 인코딩. `&`로 여러 `text=`를 이을 수 있다. 근거: https://wicg.github.io/scroll-to-text-fragment/ (§3.2, §3.3), https://web.dev/articles/text-fragments
- 매칭: 각 파라미터(prefix, start, end, suffix)는 한 블록(block) 안에서만 일치해야 한다. start,end 범위 일치는 여러 블록에 걸칠 수 있다. 대소문자 구분 없음(web.dev). 단어 경계에서만 일치(WICG README). 같은 문장이 여러 번이면 첫 일치만 쓰고, prefix/suffix로 가려낸다. 근거: 위 두 URL, https://github.com/WICG/scroll-to-text-fragment/blob/main/README.md
- Chromium 지원 버전: 출처마다 다름. web.dev 표는 Chrome 89, caniuse는 Chrome 81(74~80은 기본 꺼짐)로 표기. 어느 쪽이든 현재 Aside(최신 Chromium 가정)에서는 문제없다. Aside의 Chromium 버전 자체는 확인 안 함. 근거: https://web.dev/articles/text-fragments, https://caniuse.com/url-scroll-to-text-fragment
- 형광펜 유지: 스펙은 표시 방식도 수명도 규정하지 않는다("highlighting, scrolling, find-in-page 등 UA 재량", 언제 지우는지는 미정 TODO). 근거: WICG 스펙 §3.1. web.dev도 언제 사라지는지 설명하지 않는다. 별도 검색 결과(W3C CSSWG 토론 아카이브)는 Chrome에서 페이지를 클릭/탭하면 즉시 사라진다고 적는다(2차 출처, 소스 코드로 확인 안 함): https://lists.w3.org/Archives/Public/public-css-archive/2020Oct/0204.html. 스크롤만으로 사라지는지는 확인 안 함. 즉 "한 번 보여 주는 표시"로 보는 게 안전하다. 색은 `::target-text`로 바꿀 수 있다(web.dev).

## 2. Text Fragments 한계
- 동적 페이지(SPA, JS로 늦게 그려짐): 스펙상 재시도는 "파서가 도는 동안"만이고, 파싱이 끝난 뒤 한 번 더 시도하고 대기 중 지시문을 비운다(§3.4.1). 파싱 후 늦게 그려지는 내용은 스펙으로는 보장 안 됨. Chrome이 로드 뒤 몇 초 더 기다리는지는 확인 안 함(Chromium 소스 text_fragment_anchor.cc 조회 실패). 또 SPA가 로드 시 해시를 덮어쓰면 사라질 수 있다는 보고가 있다(Mozilla 버그 맥락, 2차). 근거: WICG 스펙 §3.4.1, WICG README의 "fragment를 라우팅에 쓰는 페이지" 경고.
- 같은 문장 여러 개: 첫 일치만. prefix/suffix로 구분해야 하고, 문맥이 약하면 엉뚱한 곳에 간다. 일치 못 하면 아무 일도 없고(탐지 불가, 스펙 §3.5.3은 일치 여부를 페이지에 노출하지 못하게 함) 확장도 성공 여부를 알 수 없다.
- 링크·줄바꿈·블록 경계: 한 파라미터는 한 블록 안이어야 하므로, 여러 문단·리스트 항목·`<br>`을 가로지르는 문장은 start,end 범위로 쪼개야 한다. 링크(`<a>`) 같은 인라인 요소 사이는 한 블록 안이면 일치한다(스펙 §3.6.1의 "context may cross elements"는 문맥에 대한 서술이라 인라인 요소 걸침은 소스로 직접 확인 안 함).
- 이미 열린 탭에서 같은 URL+조각으로 이동: 스펙은 사용자 활성화(user activation) 플래그가 있을 때 스크롤을 허용하고, 사용자 활성화는 한 번 쓰면 소진된다. 브라우저 UI가 시작한 이동은 항상 허용(§3.5.4). 또 최상위 탐색만, 이력 이동·새로고침은 새 스크롤을 허용하지 않는다. 같은 문서 안에서 해시만 바꾸는 이동은 지시문이 없으면 이전 지시문 상태를 유지한다. 그러나 "이미 열린 탭에 동일 URL+동일 조각을 다시 주면 다시 스크롤하는가"는 문서로 답이 안 나온다: 확인 안 함. (아래 4개 판정 모두 실측 필요, 7절 참고)
- 확장의 chrome.tabs.update / chrome.tabs.create: 공식 tabs 문서에 조각·사용자 제스처 언급 없음(https://developer.chrome.com/docs/extensions/reference/api/tabs). 스펙 §3.5.4가 "브라우저 UI 시작 이동은 허용"이라 확장 API(브라우저 프로세스 시작)도 동작할 가능성이 크지만 이는 추정이고, 실제 Chrome 구현이 확장 시작 이동을 브라우저 UI 시작으로 취급하는지는 확인 안 함. 리다이렉트가 있으면 조각이 떨어질 수 있다(Mozilla 버그 사례, 2차).
- 그 밖의 제약: iframe 안은 안 됨(메인 프레임만), 사이트가 `Document-Policy: force-load-at-top`으로 끌 수 있고, 엔터프라이즈 정책 `ScrollToTextFragmentEnabled`로도 꺼진다(web.dev, 검색 결과 2차). 일치는 렌더된 가시 텍스트 기준이라 접힌 영역(`display:none`) 안 문장은 못 찾는다(스펙 취지, 직접 확인 안 함).

## 3. 견고한 조각 주소 생성
- 모듈: GoogleChromeLabs/text-fragments-polyfill의 `src/fragment-generation-utils.js`. 폴리필 본체는 이 모듈을 쓰지 않는 별개 모듈이다. 라이선스 Apache-2.0, 비공식 Google 제품. 근거: https://github.com/GoogleChromeLabs/text-fragments-polyfill
- API(파일 읽은 요약): `generateFragment(selection)`, `generateFragmentFromRange(range)`, `isValidRangeForFragmentGeneration(range)`, `setTimeout(ms)`(기본 500ms), 상태 SUCCESS/INVALID_SELECTION/AMBIGUOUS/TIMEOUT/EXECUTION_FAILED. 근거: https://raw.githubusercontent.com/GoogleChromeLabs/text-fragments-polyfill/main/src/fragment-generation-utils.js
- 알고리즘: 범위 양끝을 단어 경계(Intl.Segmenter)로 확장 -> 300자 이하·블록 경계 없음이면 textStart만(20자 이상이고 유일하면 즉시 반환) -> 아니면 textStart/textEnd로 나눔 -> prefix/suffix와 start/end 단어를 하나씩 늘리며(embiggen) 유일해질 때까지 반복, 끝까지 유일하지 않으면 AMBIGUOUS. 입력 필드·contenteditable·교차 출처 iframe은 거부. 같은 파일 출처.
- 의존: 같은 폴더의 `text-fragment-utils.js` 등(실제로는 두 파일을 함께 가져가야 함). 파일 크기는 약 1,000줄/35KB로 추정(요약기의 추정치, 확인 안 함). npm 패키지 `text-fragments-polyfill` 최신 6.7.0, Apache-2.0, 풀린 크기 약 165KB(6.1.0 기준 수치, 6.7.0은 확인 안 함). 유지: GitHub 최근 커밋 2025-11-10 "Bump version number"(PR #178), 저장소 push 2026-06-22. 아카이브 아님. 근거: https://registry.npmjs.org/text-fragments-polyfill, https://api.github.com/repos/GoogleChromeLabs/text-fragments-polyfill
- 크롬 "강조 표시 링크 복사": Chromium 안의 Blink 생성기 구현이다. 소스 조회에 실패해 알고리즘 상세는 확인 안 함. Chromium의 third_party에 폴리필이 같이 들어 있고 iOS에서는 이 JS를 주입해 쓴다는 README.chromium 항목은 확인(https://trac.godzil.net/starfive-tech/chromium.src/src/v106.0.5249.13/third_party/text-fragments-polyfill/README.chromium, 2차 미러). 같은 Google의 Link to Text Fragment 확장(Apache-2.0, 457 stars, 2026-06 push)은 폴리필의 fragment-generation-utils.js를 복사해 쓰는 구조(파일 목록 근거: https://github.com/GoogleChromeLabs/link-to-text-fragment). 이 확장의 생성 결과가 Chrome 기본과 동일한지는 확인 안 함.
- 한계: 스크랩 순간(사용자가 선택한 상태)에 live DOM이 필요하다. 저장된 문장만으로 나중에 조각을 만들 수는 없다. 따라서 스크랩 때 조각 문자열을 같이 저장하는 정도로 쓴다.

## 4. CSS Custom Highlight API
- 사용: `new Range()` -> `new Highlight(range1, range2…)` -> `CSS.highlights.set(이름, highlight)` -> CSS `::highlight(이름){…}`. 삭제는 `CSS.highlights.delete/clear`. DOM을 건드리지 않는다. 근거: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
- 지원: Chrome 105+(caniuse), Safari 17.2, Firefox 140. MDN은 Baseline 2025(2025-06부터 신형 브라우저 전부). Aside는 Chromium 계열이므로 버전만 105 이상이면 된다. 근거: https://caniuse.com/mdn-api_highlight
- 스타일 가능한 속성(제한): color, background-color, text-decoration 계열, text-shadow, -webkit-text-stroke-color/-fill-color/-width. background-image는 무시. 레이아웃에 영향 주는 속성(패딩·테두리 등)은 불가. 근거: https://developer.mozilla.org/en-US/docs/Web/CSS/::highlight, https://drafts.csswg.org/css-highlight-api-1/ (속성 목록은 CSS Pseudo-Elements 4 §3.2 참조)
- 우선순위: `Highlight.priority`(정수, 기본 0). 같으면 나중에 등록한 쪽이 위. `type`은 접근성 의미만 지정. Shadow DOM 경계는 제한 없음(Range가 경계를 넘을 수도 있음). 다른 document에 속한 노드의 Range는 칠해지지 않음 -> iframe 안은 그 iframe의 content script가 따로 해야 한다. 근거: CSSWG 초안.
- 접근성: 의미를 추가하지 않는다. 중요한 정보라면 `<mark>` 같은 의미 요소나 다른 단서가 필요하다(MDN). 개인용이면 무시 가능.
- 장점: 페이지 DOM 불변이라 SPA의 재렌더·프레임워크 하이드레이션과 충돌하지 않음, 정리(clear)가 쉬움. 단점: DOM이 갈아엎히면 Range가 접히거나 끊겨서 다시 만들어야 함(Range는 라이브 객체지만 노드가 제거되면 무효), 인쇄·텍스트 복사에서의 동작은 확인 안 함, 위 속성 제한.
- 확장 content script(격리 월드)에서 쓸 수 있는가: **확인 안 함.** 검색해도 이 조합을 직접 다룬 자료는 없었다. 격리 월드는 DOM을 공유하므로 되리라 추정하나 `CSS.highlights`·`Highlight`가 월드별로 노출되는지는 미확인. `::highlight()` 규칙은 content_scripts의 `css` 항목이나 `chrome.scripting.insertCSS`로 넣는 것이 일반적이라는 것도 추정. 판가름: 최소 확장을 만들어 content script에서 아래 한 줄을 실행해 본다.

```js
// content script 콘솔 또는 코드
const r=document.createRange(); r.selectNodeContents(document.querySelector('p'));
CSS.highlights.set('rg', new Highlight(r)); // + CSS: ::highlight(rg){background:yellow}
```
다음에 쓸 문안: "이 한 줄을 격리 월드 content script로 넣어서 칠해지는지 봐줘."

## 5. 저장 문장 다시 찾기 (TextQuoteSelector)
저장 형식(W3C Web Annotation의 TextQuoteSelector): `{exact, prefix, suffix}`. 찾기는 (a) 페이지 텍스트를 한 문자열로 이어 붙이고(노드 오프셋 표 유지) (b) exact+문맥을 검색 (c) 결과 오프셋을 다시 Range로 바꾼다.

| 후보 | 하는 일 | 버전/라이선스/크기 | 유지 상태 |
|---|---|---|---|
| approx-string-match | 문자열 퍼지 검색 `search(text, pattern, maxErrors)` -> {start,end,errors}. Myers 비트병렬, UTF-16 단위 | 2.0.0, MIT, 풀린 크기 약 19.5KB, 의존 없음, 월 다운로드 약 21만 | GitHub push 2026-04-08, 아카이브 아님 (npm 2.0.0은 2021-11 배포) |
| @apache-annotator/dom (describeTextQuote, createTextQuoteSelectorMatcher) | Range -> 선택자 생성, 선택자 -> Range 찾기. **일치는 정확 일치만**(문자 단위, 공백·대소문자 민감, 퍼지 아님). 여러 일치는 async generator | 0.2.0, Apache-2.0, 풀린 크기 약 200KB(+ @apache-annotator/selector 약 200KB, 의존 optimal-select 등) | 저장소 **2025-08-13 아카이브(읽기 전용)**, npm 마지막 배포 2021-09, 월 다운로드 약 2.5만 |
| dom-anchor-text-quote | Hypothesis식 텍스트 인용 앵커(내부 diff-match-patch) | 4.0.2, MIT | npm 2017-02, 저장소 push 2023-07로 사실상 정체 (월 약 4.6만) |

근거: https://registry.npmjs.org/approx-string-match, https://registry.npmjs.org/@apache-annotator/dom, https://registry.npmjs.org/dom-anchor-text-quote, https://github.com/robertknight/approx-string-match-js, https://github.com/apache/incubator-annotator (아카이브 표시), https://unpkg.com/@apache-annotator/dom@0.2.0/lib/text-quote/match.d.ts (정확 일치 주석), npm 다운로드 API.
- 판단: 개인용이면 외부 의존을 최소로 하고 직접 구현이 현실적이다. 1단계 정확 일치(`indexOf`, prefix/suffix로 후보 선택, 공백은 정규화), 실패 시 2단계로 approx-string-match(오류 허용 길이의 10~20% 정도 등은 내 제안일 뿐 근거 없음, 튜닝 필요). Apache Annotator는 아카이브돼 있고 퍼지가 없어 비추천(참고 구현으로 코드만 읽기에는 좋음).
- 주의: 공백·줄바꿈·NBSP 정규화와 보이는 텍스트만 대상(`display:none`, script/style 제외) 처리가 복잡도의 대부분이다. 저장 시와 복원 시 같은 규칙으로 텍스트를 이어 붙여야 한다.

## 6. 조합 판단
"이동=Text Fragment, 다시 칠하기=Custom Highlight + 문장 찾기"는 동작은 하겠지만 최선은 아니다.
- 문장 찾기(TextQuote 매처)를 어차피 만들어야 하므로, 이동도 그 결과 Range에 `scrollIntoView({block:'center'})`를 하면 한 경로로 해결된다. Text Fragment 쪽의 불확실성(수명 불명, 클릭하면 사라짐[2차], SPA 늦은 렌더, 일치 성패를 알 수 없음, 같은 URL 재이동 미확인, 확장 시작 이동의 활성화 조건 미확인)을 안 떠안는다.
- 형광펜은 Text Fragment의 기본 표시가 아니라 우리 쪽 `::highlight`라 색·유지 시간을 통제할 수 있다.
- SPA 대응: content script가 못 찾으면 MutationObserver로 몇 초간 재시도(예: 최대 약 10초, 값은 내 제안)하고, 그래도 없으면 "이 페이지에서 못 찾음" 표시를 우리가 낼 수 있다. Text Fragment는 이 피드백이 불가능하다.
- Text Fragment를 쓸 자리: (1) 스크랩 순간 `generateFragmentFromRange`로 조각 주소를 하나 만들어 같이 저장하고, 사용자에게 "링크 복사"로 제공 (2) 확장이 꺼져 있는 환경이나 다른 사람에게 줄 때. 이동 기본값으로는 비추천.
- 기본안: 저장 {url(해시 제외), exact, prefix(32자 안팎), suffix(32자 안팎), 선택적 fragment 문자열} -> 페이지 로드 시 content script가 매칭해 `Highlight`로 칠하고, 목록에서 이동하면 해당 탭으로 가서 같은 매처로 스크롤 -> 못 찾으면 퍼지 -> 그래도 없으면 fragment 주소로 폴백 시도. (prefix/suffix 길이는 내 제안, 근거 없음.)

## 7. 확인 안 함 목록과 판가름 방법
1. Highlight API가 격리 월드 content script에서 칠해지는가 — 4절의 한 줄 테스트. 문안: "이 한 줄을 확장 content script로 넣어서 칠해지는지 봐줘."
2. 확장 `chrome.tabs.update/create({url:'…#:~:text=…'})`로 열 때 스크롤·형광펜이 되는가, 이미 열린 같은 탭에 같은 URL을 또 줄 때 다시 스크롤되는가 — 명령으로는 안 됨. 대신 절차: 빈 확장(service worker)에서 위 API로 `https://en.wikipedia.org/wiki/Web_browser#:~:text=…`를 열고, 이미 열린 탭에 같은 호출을 반복해 본다. 문안: "확장에서 tabs.update로 text fragment 주소를 열었을 때 스크롤되는지 Aside에서 시험해 봐줘."
3. Aside의 Chromium 버전 — `aside://version` 또는 `chrome://version` (Aside가 해당 주소를 지원하는지도 확인 안 함). 문안: "Aside 버전 화면의 Chromium 버전을 알려줘."
4. Chrome이 클릭·스크롤 때 text fragment 형광펜을 지우는 정확한 조건 — Chromium 소스(`text_fragment_anchor.cc`)가 필요하나 이번 조사에서 raw URL 접근 실패. 문안: "chromium 소스에서 TextFragmentAnchor가 언제 dismiss되는지 찾아줘."
5. SPA에서 로드 뒤 늦게 그려지는 문장에 Chrome이 얼마나 오래 재시도하는가 — 같은 소스 필요.
