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
   - 일상어라 분야 뜻으로 덮으면 오히려 틀리는 낱말은 뺐다(수학 52개, ML 12개). HTB 후보 용어는 이 거르기에서 보호했다.
3. 조사에 없던 HTB 모듈 용어 19개는 표준 용어로 직접 보충했다: euclidean, summation, subscript, superscript, manhattan, regression(수학) / classification, clustering, cluster, dimensionality, margin, support, classifier, testing, perceptron, tanh(ML) / spam, fraud, intrusion(보안). 복수형(matrices·features·weights·layers 등)은 키로 넣지 않고 코드가 복수 규칙(`bridge/glossary.mjs` 의 `variants`)으로 단수를 찾는다.
4. 통계 용어는 수학, 딥러닝 용어는 ML 파일에 합쳤다(파일은 세 개뿐).
5. 같은 낱말이 여러 분야에 있으면(vector=벡터/벡터(경로), kernel=핵(커널)/커널 등) 활성 분야 순서의 앞쪽이 이긴다. 순서는 페이지가 알려 준 힌트(수식이 있으면 math)가 앞, 사이트 규칙이 뒤다.

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
