# ARCHIVE PILATES 프라이빗 차트 자동화

## 목표

프라이빗 회원 수업 전/후 강사 기록을 ARCHIVE IN 입력폼으로 받고, Firestore와 Notion 개인레슨 차트에 회차별로 저장한다.

## 결정

- 입력폼은 Notion/Google Form이 아니라 ARCHIVE IN 정적 페이지와 Firebase Functions API로 운영한다.
- 알림톡 버튼은 수업 전 계획, 수업 후 기록 2개로 분리한다.
- 링크에는 회원 정보와 예약 정보를 직접 노출하지 않고 `requestId`와 토큰만 포함한다.
- Notion은 기존 `개인레슨 차트` 페이지의 회차별 문서 흐름을 참고한다.
- GPT 요약은 OpenAI API 과금 호출 없이 Mac mini Codex 자동화 작업 큐로 처리한다.

## 구현 구조

- `privateLessonChartRequests`: 예약별 입력 요청, 버튼 링크, 제출 상태, 사전설문 요약
- `privateLessonChartRecords`: 수업 전 계획, 수업 후 기록, Notion 동기화 상태
- `privateLessonChartGptTasks`: 수업 후 기록 제출 뒤 생성되는 회원용 초안 작업
- `privateLessonChartApi`: 강사용 입력폼 조회/제출 HTTP API
- `scheduledCreatePrivateLessonChartRequests`: 매일 18:00 KST에 다음날 프라이빗 예약의 차트 요청 생성
- `/private-chart/`: 강사용 모바일 입력 화면

## Notion 반영

- 기존 `개인레슨 차트` 페이지 하위에 `ARCHIVE PILATES 프라이빗 차트 자동화` 운영 페이지를 생성했다.
- 같은 위치에 `자동화 회차 차트 템플릿`을 생성했다.
- `Private Session Records DB`에 자동화용 속성을 추가했다.
  - `Chart Request ID`
  - `Session Number`
  - `Pre Status`
  - `Post Status`
  - `GPT Status`
  - `GPT Draft Summary`
  - `GPT Draft Next Direction`

## 알림톡 템플릿 초안

템플릿명: `강사용_프라이빗 차트 작성 안내 v1`

본문:

```text
[ARCHIVE PILATES]
내일 프라이빗 수업 차트 작성 안내

회원: #{회원명}
회차: #{회차}회차
수업: #{수업일시}

수업 전 계획은 하루 전 작성하고,
수업 후 기록은 수업 종료 후 작성해주세요.

사전설문 요약은 입력 화면 상단에 함께 표시됩니다.
```

버튼:

- 수업 전 계획 작성: `#{수업전계획URL}`
- 수업 후 기록 작성: `#{수업후기록URL}`

## 남은 운영 단계

- 알림톡 템플릿 승인 후 `template_pending` 상태의 요청을 실제 발송 큐와 연결한다.
- Mac mini Codex 자동화가 `privateLessonChartGptTasks`의 `pending` 작업을 읽어 회원용 초안을 작성하고 Notion/Firestore에 반영한다.
- 첫 운영 전에는 실제 예약 1건으로 수업 전/후 제출과 Notion 회차 페이지 생성을 확인한다.
