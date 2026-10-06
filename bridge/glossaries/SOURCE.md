# 분야 용어집 데이터 (T9)

작성일 2026-10-06. 사전 첫 뜻보다 먼저 쓰는 분야별 번역어다. 런타임에 AI 는 쓰지 않고, 이 파일들을 그대로 읽는다.

## 파일

- `math.json`·`ml.json`·`security.json`: `{"원형(소문자 한 단어)": "짧은 한국어"}`. 쓰는 파일이다.
- `phrases-math.json`·`phrases-ml.json`·`phrases-security.json`: 두 단어 이상(dot product, privilege escalation 등). 이번엔 저장만 하고 코드가 읽지 않는다(다음 단계 후보). 수학·ML 문구는 조사 결과에 분야 표시가 없어 낱말 몇 개로 갈랐다(어긋날 수 있음).

## 만든 방법

1. 조사 에이전트 두 개가 웹 자료로 수학·ML 용어(530건)와 보안 용어(402건)를 {term, ko, confidence(high·medium·low)} 로 모았다.
2. 거른 것
   - confidence `low` 5건은 뺐다: stationary(수학), module(수학, 보안 `module`=모듈은 high 라 남김), loot, detonate, tarpit.
   - 값에 한글이 없는 약어 14건(DNS·TLS·VPN 등)은 뺐다. 번역어가 아니라 원문 그대로라 "용어:" 줄이 의미 없다.
   - 일상어라 분야 뜻으로 덮으면 오히려 틀리는 낱말은 뺐다(수학 54개, ML 12개). HTB 후보 용어는 이 거르기에서 보호했다.
3. 조사에 없던 HTB 모듈 용어 24개는 표준 용어로 직접 보충했다: euclidean, summation, subscript, superscript, manhattan, regression, binary(수학; binary 는 ML·수학 글에서 보안의 "바이너리"보다 앞서게) / classification, clustering, cluster, dimensionality, margin, support, classifier, testing, perceptron, tanh, gradient, kernel, parameter, domain(ML; 보안 뜻과 겹치는 낱말을 ML 글에서 "보안"으로 표시하지 않게) / spam, fraud, intrusion(보안). 복수형(matrices·features·weights·layers 등)은 키로 넣지 않고 코드가 복수 규칙(`bridge/glossary.mjs` 의 `variants`)으로 단수를 찾는다.
4. 통계 용어는 수학, 딥러닝 용어는 ML 파일에 합쳤다(파일은 세 개뿐).
5. 같은 낱말이 여러 분야에 있으면(root=근(루트)/루트(최고 권한), binary=이진/바이너리, kernel=핵(커널)/커널 등) 활성 분야 순서의 앞쪽이 이긴다. 순서는 페이지가 알려 준 힌트(ML 글이면 ml, 수식이 있으면 math)가 앞, 사이트 목록 힌트(security, ml, math)가 뒤다. 사이트 목록은 다리가 아니라 확장 설정 `glossarySites`(패널의 "용어집을 켤 사이트", 기본 19개)에 있다(2026-10-06 T11). 그래서 HTB 의 ML·수학 글에서는 binary 가 이진, 보안 글에서는 바이너리로 나온다.
6. 보안 파일의 `vector` 는 조사 값 `벡터(경로)` 를 `벡터` 로 바꿨다(공격 벡터도 "벡터"라 괄호 설명이 오히려 ML·수학 글에서 틀린 뜻으로 보였다).
7. 2026-10-06 용어 검토 반영: HTB 본문 문맥과 표준 표기에 맞춰 값 15개를 고쳤다. cross=교차(외적은 phrases 의 cross product), tangent=탄젠트, metric=지표(거리 함수), cardinality=농도(원소의 개수), outcome=결과, critical=임계(중요한), significant=유의한(통계)·상당한, dimensionality=차원, capability=능력(역량), handle=처리하다(핸들), origin=원점(오리진), symbol=기호(심볼), key=키(암호 키), apt=APT(지능형 지속 공격), xss=XSS(크로스 사이트 스크립팅).
8. 2026-10-06 T13 보충: HTB 본문 1892 후보 낱말 중 사전 첫 뜻이 분야 뜻과 다른 것(multiplication 증가→곱셈 등)을 조사 에이전트가 모아 122개를 더했다(수학 51·ML 66·보안 5, 기존 키 변경 없음). `trade-off` 는 키가 한 단어(영문 소문자)가 아니어서 뺐고, `intercept` 는 보안의 가로채기 대신 수학·ML 글용 `절편` 을 두 파일에 새로 넣었다. 사전 분야 표시 뜻을 고르는 규칙(`bridge/annotate.mjs` 의 `pickSense`)이 엉뚱하게 고르는 낱말 4개는 용어집으로 막았다: vertical=수직의(수학), explicit=명시적인·loop=루프·functionality=기능(ML).
9. 알려진 한계(다음 단계 후보): 활용형(-ed/-ing)은 용어집이 직접 풀지 않고 사전이 준 원형으로 찾는다. 사전 도우미가 악센트 표제어를 주는 낱말(transposed 등)은 원형을 못 찾아 사전 뜻이 남을 수 있다.
10. 2026-10-06 T13 검토 반영: translation 은 HTB 본문에서 기계 번역 뜻(text generation, translation services)이라 ML 파일에 `번역`, 수학 파일에 `평행 이동`을 둬서 힌트 순서(ML 글=ml 먼저)로 가른다. measure 는 본문에서 동사로 더 자주 쓰여 `척도(측정)` 를 `측정(척도)` 로 바꿨다(수학의 측도는 범위 밖). 티켓에 없던 규칙 2건: 흔한 낱말(A1~B1)과 표시 뒤에 쓰임 제한이 붙은 뜻은 분야 표시 뜻에서 뺀다(`bridge/annotate.mjs` 의 `COMMON_MAX`).

## 출처(조사 에이전트가 적은 것)

- 대한수학회 수학용어(교과서 표기) — 웹 검색으로 원문 확인 못 함, 교과서 관행으로 대체(kms.or.kr)
- 한국통계학회 통계용어 — 웹 검색으로 원문 확인 못 함, 교과서 관행으로 대체
- Google 머신러닝 용어집(한국어) https://developers.google.com/machine-learning/glossary?hl=ko — 확인됨
- 국내 ML 교재·위키독스(예: https://wikidocs.net/120163)의 과적합·경사하강법·편향·하이퍼파라미터 표기 확인
- https://www.dt.co.kr/article/10857891
- https://www.flowhunt.io/ko/용어집/adversarial-ml/
- https://www.sentinelone.com/ko/cybersecurity-101/cybersecurity/injection-attacks/
- https://www.sentinelone.com/ko/cybersecurity-101/cybersecurity/prompt-hacking/
- https://www.checkpoint.com/kr/cyber-hub/cyber-security/what-is-an-attack-surface/
- https://www.promptingguide.ai/kr/risks/adversarial

대한수학회·통계학회 표기는 웹에서 원문을 확인하지 못해 교과서 관행으로 채웠다. 확신이 낮은 값이 있으면 이 파일의 해당 키만 고치면 된다.

## 약어집 `acronyms.json` (2026-10-06 T14b)

- 모양: `{ "<소문자 약어>": { "exp": "<영어 풀이>", "ko": "<짧은 한국어 뜻>", "d": "security"|"ml"|"math" } }`. 174개(보안 114·ML 41·수학 19). 키는 소문자 알파벳·숫자 2~6자(`c2` 처럼 숫자가 낀 것도 있다).
- 만든 방법: 에이전트가 보안(HTB·OWASP·MITRE 문서에 자주 나오는 것)·ML·수학 글에서 흔한 약어를 직접 골라 영어 표준 풀이와 국내에서 쓰는 한국어 표기를 달았다. 웹 조사나 외부 데이터 복사는 하지 않았다(그래서 출처 목록이 없다). `ko` 는 글자 위에 얹는 주석이라 짧게(12자 안팎) 두었고, 긴 풀이는 `exp` 에 있다.
- 뺀 것: 일상 뜻과 많이 겹치는 약어(CIA·CA·MAP·EM·KL·RF·PDF·CV 등)는 오탐이 잦아 넣지 않았다. 필요하면 사용자가 "내 사전"에 직접 넣는다(내 사전이 약어집보다 항상 우선).
- 쓰임: `/annotate` 요청의 `acronyms`(원래 대문자 철자)는 요청의 활성 분야(domains)에 그 약어의 `d` 가 있을 때만 약어집을 쓴다. `/dict` 는 분야와 무관하게 `acronym:{exp, ko}` 를 붙인다. 사전(맥 영한사전)은 약어에 부르지 않는다.
