# 단어 등급 데이터 출처

받은 날짜: 2026-10-06
받은 곳: GitHub `openlanguageprofiles/olp-en-cefrj` (master), raw.githubusercontent.com 에서 파일 그대로 받았다(수정 없음).

| 파일 | 내용 | 라이선스 |
| --- | --- | --- |
| `cefrj-vocabulary-profile-1.5.csv` | CEFR-J Vocabulary Profile 1.5 (A1~B2) | CEFR-J 이용 조건: 연구·상업 목적 모두 무료, 단 데이터셋을 정확히 인용해야 한다. 저작권은 도쿄외국어대 Tono Laboratory 에 있다. 데이터의 부정확함이나 사용으로 생긴 손해에 CEFR-J 와 Open Language Profiles 는 책임지지 않는다. |
| `octanove-vocabulary-profile-c1c2-1.0.csv` | Octanove Vocabulary Profile C1/C2 1.0 (Octanove Labs) | Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) |

## 인용

- The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html on 1/20/2020.
- Octanove Vocabulary Profile C1/C2 (ver 1.0), Octanove Labs, CC BY-SA 4.0. https://github.com/openlanguageprofiles/olp-en-cefrj

## 쓰는 방식

- 열: `headword,pos,CEFR,...`. `headword` 칸의 `a.m./A.M./am/AM` 처럼 `/` 로 묶인 변형은 모두 펼쳐 쓴다.
- 같은 단어가 여러 품사·등급이면 가장 낮은 등급(쉬운 쪽)을 쓴다. 두 파일을 합칠 때도 같다.
- 이 저장소는 개인용이며 배포하지 않는다. 배포할 일이 생기면 위 인용·CC BY-SA 조건(출처 표시, 같은 조건으로 공유)을 다시 확인한다.
