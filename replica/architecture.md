# 짜임새: readgloss 영상 인풋 (랭플릭스 인풋 고리를 readgloss에 다시 짓기)

자세한 동작·문구·상한은 `docs/spec.md` 변경 기록 27이 정본이다. 이 문서는 어디에 무엇을 붙이는지만 적는다.

## 쓰는 것 (새로 고르지 않는다)

| 층 | 고른 것 | 이유 |
| --- | --- | --- |
| 화면 | 크롬 확장 MV3 content script(classic script, 닫힌 shadow) | readgloss가 이미 이렇게 돈다. 빌드 도구 없음 |
| 페이지 쪽 엿듣기 | content script `world: "MAIN"`, `run_at: document_start`, 유튜브만 | 플레이어가 받는 자막을 보려면 페이지 쪽 fetch·XHR을 감싸야 한다 |
| 다리 | 맥 로컬 `bridge/server.mjs`(127.0.0.1:47831, 토큰) | 사전·맥 번역·AI(구독)·단어장이 다 여기 있다 |
| 저장 | `data/readgloss.db`(SQLite, nodes 표) — 없으면 JSON | 구 항목 data에 `clip`만 더한다. 새 표 없음 |
| 번역 | 한국어 줄 = 맥 번역(`/mt`), 줄 풀이 = AI(`/translate-context`, 누를 때만) | 무료·기기 안이 기본, 구독 한도는 사람이 고를 때만 |
| 소리 | 같은 영상이면 그 구간 재생, 아니면 브라우저 음성(TTS) | 원본 음성은 영상에만 있다 |

## 데이터

새 표 없음. 바뀌는 것:

```
구 항목(phrase, words.mjs)  + clip?: { start, end }   초, 0 ≤ start < end ≤ 86400, 길이 ≤ 60
                            (url 은 이미 있음 — 장면 주소 https://www.youtube.com/watch?v=<id>&t=<초>s)
낱말 항목(saved)            그대로. url 에 장면 주소가 들어간다(사전 카드 source)
복습 큐 카드                + url(낱말·구), + clip(구)
설정(chrome.storage 'settings') + video{subs, ko, hard, hoverPause, autoCC, fontPct, hide, pauseEach}, + reviewMode
세션 저장소                 + pendingClip { id, start, end, ts } (새 탭에서 구간 재생, 2분)
```

자막·번역은 저장하지 않는다. 영상 페이지가 늘 자막을 가지고 있고, 맥 번역은 다리가 2000개까지 기억한다.

## 주고받기

| 무엇 | 하는 일 | 누가 | 입력 | 출력 | 흐름 |
| --- | --- | --- | --- | --- | --- |
| `window.postMessage` readgloss-yt/timedtext | 플레이어가 받은 자막을 넘김 | yt-hook.js → video-subs.js | url, body | — | F01 |
| `window.postMessage` readgloss-yt/replay | 들고 있던 자막을 다시 보내 달라 | video-subs.js → yt-hook.js | — | timedtext 여러 개 | F01 |
| `readgloss:lookup`(window 이벤트) | 사전 카드 열기 | video-subs.js → content.js | word, sentence, rect, context, source | — | F01 |
| `readgloss:card-closed`(window 이벤트) | 카드가 닫혔다 | content.js → video-subs.js | — | — | F01(마우스 멈춤 풀기) |
| `mt` → POST /mt | 한국어 줄 | video-subs.js·panel-video.js | text | translation | F01 |
| `annotate` → POST /annotate | 어려운 단어 | video-subs.js·panel-video.js | words(≤300), level | items | F01·F03 |
| `translate-context` → POST /translate-context | 줄 풀이 | video-subs.js | text, context(앞뒤 3줄, 제목) | translation, note, expressions | F01 |
| `words` save-phrase → POST /words | 줄·표현 저장 | video-subs.js·panel-video.js | text, translation, kind, url, title, **clip** | id, phrases | F01 |
| `words` review-queue → GET /words/review | 복습 큐 | panel-words.js | — | due(+url, clip), counts | F04 |
| `video-open`(background) | 새 탭에서 장면 재생 | panel-words.js | url, clip | ok | F04 |
| `video-pending`(background) | 기다리는 장면 꺼내기 | video-subs.js | — | pending | F04 |

## 파일

```
extension/yt-hook.js       새  MAIN world. fetch·XHR 감싸기, 최근 8개 보관, replay
extension/video-core.js    새  순수 함수(globalThis.readglossVideo): 자막 읽기·줄 묶기·지금 줄·낱말 나누기·가리기·장면 주소·키
extension/video-subs.js    새  유튜브에서만. 자막 층·막대·키·번역·칠하기·저장·풀이·CC 켜기·구간 재생 + readglossVideoUi
extension/panel-video.js   새  패널 [영상] 탭(유튜브에서만 등록)
extension/content.js       고침 카드·확인 메시지를 전체 화면 요소 안에, card-closed 알림, readgloss-subs 더블클릭 무시
extension/panel-words.js   고침 복습 방식(뒤집기·고르기·듣기), 장면·TTS 단추
extension/settings-core.js 고침 video·reviewMode
extension/panel.js         고침 설정 탭 "영상 자막" 칸, 표(TOGGLES·RANGES·CHOICES)
extension/background.js    고침 words 중계에 clip, video-open·video-pending
extension/manifest.json    고침 MAIN world 항목, 새 파일 셋
bridge/words.mjs           고침 save-phrase clip, 복습 카드 url·clip
```

## 아픈 곳

- 유튜브 구조: 플레이어가 자막을 XHR로 받는지 fetch로 받는지 모른다 → 둘 다 감싼다. CC 단추·전체 화면 요소·광고 클래스가 바뀌면 그 판정만 고친다(한곳에 모음).
- 자동 생성 자막: 문장 부호가 거의 없다 → 쉼·길이로 줄을 묶는다(숫자는 video-core 상수).
- 시각 경쟁: 맥 번역은 다리에서 한 줄씩 차례로 돈다 → 확장은 한 번에 하나만 묻고, 지금 줄에서 가까운 것부터.
- 마우스 멈춤과 카드: 카드로 마우스를 옮기면 자막을 떠난다 → 카드가 열려 있으면 다시 재생하지 않고, 카드가 닫힐 때 판단.
- 전체 화면: 문서 맨 위에 붙인 카드는 안 보인다 → 전체 화면 요소 안에 붙이고 좌표는 화면 기준.
- 키: 유튜브 단축키와 안 겹치는 글자만, 입력칸·고른 글·우리 다른 화면 안에서는 안 먹게.

## 짓는 차례

1. 세로 한 조각: yt-hook → video-core → 자막 층(영어 줄) → 낱말 누르면 사전 카드 → 단어장 저장(장면 주소). 시험: 자막 읽기·줄 묶기·지금 줄.
2. 반드시: 한국어 줄, 칠하기 둘, 가리기, 줄 이동·멈춤, 줄 저장(clip), 풀이, CC 켜기 도움, 전체 화면, 복습에서 장면 듣기.
3. 하면 좋음: 고르기·듣기·TTS, [영상] 탭(대본·어려운 단어), 마우스 멈춤, 줄마다 멈춤, 자막 크기.
4. 다음 회차: 넷플릭스(자막 표시·낱말·저장부터), 숙어 칠하기.
