# ARCHIVE PILATES 프라이빗 차트 자동화

## 목표

프라이빗 회원 수업 전/후 강사 기록을 ARCHIVE IN 입력폼으로 받고, Firestore와 Notion 개인레슨 차트에 회차별로 저장한다.

## 결정

- 입력폼은 Notion/Google Form이 아니라 ARCHIVE IN 정적 페이지와 Firebase Functions API로 운영한다.
- 알림톡 버튼은 수업 전 계획, 수업 후 기록, 사진·영상 업로드 3개로 분리한다.
- 링크에는 회원 정보와 예약 정보를 직접 노출하지 않고 `requestId`와 토큰만 포함한다.
- Notion은 기존 `개인레슨 차트` 페이지의 회차별 문서 흐름을 참고한다.
- 회원용 리포트 문장은 Notion Formula나 Mac mini GPT 에이전트가 아니라 Firebase Function에서 Gemini API로 즉시 생성한다.
- Gemini 실패 시 `gptStatus=failed`로 저장하고, 수업 후 링크의 리포트 변환 버튼으로 재시도한다.

## 구현 구조

- `privateLessonChartRequests`: 예약별 입력 요청, 버튼 링크, 제출 상태, 사전설문 요약
- `privateLessonChartRecords`: 수업 전 계획, 수업 후 기록, Gemini 생성 결과, Notion 동기화 상태를 저장한다.
- `privateLessonChartApi`: 강사용 입력폼 조회/제출 HTTP API
- `scheduledCreatePrivateLessonChartRequests`: 매일 18:00 KST에 다음날 프라이빗 예약의 차트 요청 생성 후 강사용 차트 알림톡 발송
- `scheduledGeneratePrivateLessonChartReports`: 10분마다 수업 후 기록이 있는데 리포트 생성이 누락된 records를 재확인
- `GEMINI_API_KEY`: Gemini Developer API 호출용 Secret Manager 값. Generative Language API 전용 제한 키를 저장한다.
- `회원용_프라이빗 수업 리포트 안내 v1`: 수업 후 HTML 리포트를 회원에게 전달하는 별도 알림톡. 강사용 입력 알림톡과 분리한다.
- `/private-chart/`: 강사용 모바일 입력 화면
- 수업 하루 전 요청 생성 시점에 `Private Session Records DB` 회차 원본을 만들고, 해당 페이지 URL을 사진·영상 업로드 버튼에 연결한다.
- 강사용 기존 회원 페이지에는 `YYYY.MM.DD HH:mm · n회차(자동화)` 일반 페이지를 추가한다.
- 사진·영상 업로드 버튼은 DB 원본이 아니라 강사용 일반 페이지로 연결한다. DB 원본은 웹훅/발송 상태 관리를 위해 내부용으로 유지한다.
- StudioMate Excel 보강 데이터로 같은 수업이 숫자 예약 ID와 `excel_booking_...` ID에 중복 존재하면 숫자 예약 ID 요청만 canonical로 사용한다.
- 강사용 차트 알림톡은 `template_pending` 또는 `queued` 요청만 발송한다. `sent`, `skipped`, 수동 테스트 상태는 자동 발송하지 않는다.

## Notion 반영

- 기존 `개인레슨 차트` 페이지는 강사용 진입점으로 유지한다.
- 기존 강사별 회원 페이지 아래에 오늘 이후 자동화 회차 일반 페이지를 붙인다.
- 강사별 진입 페이지는 `이초림 수석강사`, `배민진 원장님`, `정은영 부원장님`, `김기효 강사` 기준으로 운영한다.
- StudioMate/Firestore 강사명은 직함 없이 `이초림`, `배민진`, `정은영`, `김기효`로 들어올 수 있어 자동화 매핑에 별칭을 함께 둔다.
- `자동화 회차 차트 템플릿`은 `개인레슨 차트` 바로 아래에 둔다.
- 운영 기록, DB, 웹훅, Gemini 리포트 생성 규칙은 `아카이브 운영 규칙 > ARCHIVE PILATES 프라이빗 회원 차트 시스템` 아래로 분리한다.
- `ARCHIVE AI` Notion 연결은 `Private Session Records DB` 접근은 정상이다. 기존 강사별 회원 페이지에 자동 링크를 붙이려면 `개인레슨 차트` 루트 페이지도 `ARCHIVE AI` 연결에 공유되어야 한다.
- `Private Session Records DB`에 자동화용 속성을 추가했다.
  - `Chart Request ID`
  - `Session Number`
  - `Pre Status`
  - `Post Status`
- `GPT Status` (기존 속성명 유지, Gemini 생성 상태 표시)
- `GPT Draft Summary` (기존 속성명 유지, Gemini 요약문 저장)
- `GPT Draft Next Direction` (기존 속성명 유지, Gemini 다음 수업 방향 저장)
- `회원 리포트`
- `발송`
- `발송상태`

## 알림톡 템플릿 초안

템플릿명: `강사용_프라이빗 차트 작성 안내 v2`

Template ID: `KA01TP260527182741301uIuSTL01YQ1`

상태: `APPROVED`

본문:

```text
[ARCHIVE PILATES]
내일 프라이빗 수업 차트 작성 안내

회원: #{회원명}
회차: #{회차}회차
수업: #{수업일시}

수업 전 계획은 하루 전 작성하고,
수업 후 기록은 수업 종료 후 작성해주세요.

사진·영상은 회차별 Notion 차트에 바로 업로드할 수 있습니다.
```

버튼:

- 수업 전 계획 작성: `#{수업전계획URL}`
- 수업 후 기록 작성: `#{수업후기록URL}`
- 사진·영상 업로드: `#{사진영상업로드URL}`

세부 요청안: `docs/tasks/2026-05-28-private-chart-alimtalk-3-buttons.md`

## 회원용 리포트 알림톡

템플릿명: `회원용_프라이빗 수업 리포트 안내 v1`

Template ID: `KA01TP260528081225871Fr92FW901Vo`

상태: `APPROVED`

용도:

- 강사용 차트 작성 알림톡이 아니라, 수업 후 생성된 회원용 HTML 리포트를 회원에게 전달한다.
- 즉시 자동 발송하지 않고, Notion 회차 차트에서 운영자 또는 강사가 리포트를 검수한 뒤 `발송` 체크를 해야 발송한다.
- 2026-06-02 기준 v2는 폐기하고 승인된 v1으로 우선 운영한다. 인바디 리포트 버튼 통합은 새 템플릿 승인 전까지 보류한다.

본문 초안:

```text
[ARCHIVE PILATES]

#{회원명}님,
오늘 프라이빗 #{회차} 수업 리포트가 정리되었습니다.

수업에서 확인한 변화와 다음 수업 방향을 아래 버튼에서 확인하실 수 있습니다.

수업 리포트는 회원님 개인 확인용으로 제공됩니다.
```

변수:

- `#{회원명}` = `privateLessonChartRecords.memberName`
- `#{회차}` = `privateLessonChartRecords.sessionNumber + "회차"`
- `#{수업일시}` = `lessonDate + lessonStartAt`을 KST 기준으로 변환
- `#{강사명}` = `privateLessonChartRecords.staffName`
- `#{리포트링크ID}` = `privateLessonChartRecords.publicReportUrl`을 `shortLinks`로 변환한 짧은 링크 ID
- `#{인바디링크ID}` = 현재 v1 템플릿에서는 사용하지 않는다.

버튼:

- 리포트 확인하기: `https://in.archivepilates.com/s/#{리포트링크ID}/`
- SOLAPI 발송 payload에는 `#{리포트URL}`을 쓰지 않고 `#{리포트링크ID}`만 전달한다.
- 원본 `publicReportUrl`은 Firestore `shortLinks/{리포트링크ID}.targetUrl`에 저장한다.
- 원본 인바디 리포트 URL은 Firestore `shortLinks/{인바디링크ID}.targetUrl`에 저장한다.

발송 후보 조건:

- `privateLessonChartRecords`에 해당 `recordId` 회차 기록이 있음.
- `postRecord` 제출 완료.
- `gptStatus`가 `draft_created`.
- `publicReportUrl` 존재.
- Notion `발송` 체크박스가 체크됨.
- Notion `발송상태`가 `대기`.
- 회원 전화번호가 있음.
- 같은 `recordId`로 성공 발송된 이력이 없음.

중복키:

- `private_lesson_report:{recordId}`

Notion 웹훅:

- Webhook URL: `https://in.archivepilates.com/api/notion/privateLessonReportWebhook`
- 이벤트: `page.properties_updated`
- 감지 속성: `발송`, `발송상태`, `회원 리포트`
- 웹훅은 신호만 받고, Function이 Notion API로 페이지를 재조회해서 조건을 최종 확인한다.
- 이벤트 ID는 `notionWebhookEvents/{eventId}`에 저장해 Notion 재전송 중복을 막는다.
- 후보 ID는 `private_lesson_report_{recordId}`로 고정해 같은 회차 중복 발송을 막는다.
- 누락 복구용 스케줄러는 10분 반복이 아니라 하루 3회만 재조회한다.

## 남은 운영 단계

- 강사용 차트 작성 알림톡은 승인 완료 상태다. 다음 단계는 실제 예약 기준 자동 후보 생성/발송 연결이다.
- 회원용 리포트 알림톡은 SOLAPI 템플릿 생성 완료 상태다. 검수 승인 후 Template ID를 코드에 연결한다.
- Firebase Function이 Gemini API로 회원용 초안을 생성하고 Notion/Firestore에 반영한다.
- Notion Formula는 리포트 생성에 사용하지 않는다. Formula는 상태 표시, 필터, 임시 요약용으로만 사용한다.
- 강사는 수업 후 링크의 리포트 섹션에서 HTML 리포트를 확인하고 회원 알림톡 발송을 승인한다.
- 첫 운영 전에는 실제 예약 1건으로 수업 전/후 제출과 Notion 회차 페이지 생성을 확인한다.
