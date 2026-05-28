# 프라이빗 차트 강사용 알림톡 3버튼 요청안

## 목적

강사가 프라이빗 수업 하루 전 같은 알림톡에서 수업 전 계획, 수업 후 기록, 사진·영상 업로드를 모두 처리할 수 있게 한다.

## 템플릿명

`강사용_프라이빗 차트 작성 안내 v2`

## 발송 대상

다음날 프라이빗 또는 세미프라이빗 예약의 담당 강사.

## 발송 시점

수업 하루 전 18:00 이후.

Firebase Scheduler `scheduledCreatePrivateLessonChartRequests`가 요청 생성과 강사용 알림톡 발송을 같은 실행 안에서 처리한다.

## 본문

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

## 버튼

1. `수업 전 계획 작성`
   - URL 변수: `#{수업전계획URL}`
   - 값 예시: `https://in.archivepilates.com/s/pc-xxxxxxxxxxxx/`

2. `수업 후 기록 작성`
   - URL 변수: `#{수업후기록URL}`
   - 값 예시: `https://in.archivepilates.com/s/pc-xxxxxxxxxxxx/`

3. `사진·영상 업로드`
   - URL 변수: `#{사진영상업로드URL}`
   - 값 예시: `https://in.archivepilates.com/s/pc-xxxxxxxxxxxx/`
   - 연결 대상: 해당 회차 Notion 강사용 차트 페이지

## 데이터 매핑

- `#{회원명}`: `privateLessonChartRequests.memberName`
- `#{회차}`: `privateLessonChartRequests.sessionNumber`
- `#{수업일시}`: `lessonDate + lessonStartAt`
- `#{수업전계획URL}`: `privateLessonChartRequests.preShortUrl`
- `#{수업후기록URL}`: `privateLessonChartRequests.postShortUrl`
- `#{사진영상업로드URL}`: `privateLessonChartRequests.mediaUploadShortUrl`

## 변수 생성 규칙

### 예약 식별

- 원천 예약은 Firestore `bookings/{bookingId}`입니다.
- 프라이빗/세미프라이빗 예약만 대상입니다.
- 같은 회원, 같은 강사, 같은 날짜, 같은 시작시각의 예약이 웹 예약과 엑셀 보강 데이터에 중복 존재하면 실제 알림톡은 1건만 생성합니다.
- 중복 예약이 있으면 숫자 StudioMate 예약 ID를 우선 사용하고 `excel_booking_...` 요청은 `skipped`로 표시합니다.
- 요청 문서 ID는 `privateLessonChartRequests/plc_{bookingId}` 형식을 사용합니다.

### 토큰과 원본 URL

- 접근 토큰은 서버 secret으로 `requestId`를 HMAC 처리해 생성합니다.
- URL에는 회원명, 전화번호, 예약 정보가 직접 들어가지 않습니다.
- 수업 전 원본 URL:
  - `https://in.archivepilates.com/private-chart/?mode=pre&r={requestId}&t={token}`
- 수업 후 원본 URL:
  - `https://in.archivepilates.com/private-chart/?mode=post&r={requestId}&t={token}`
- 사진·영상 업로드 원본 URL:
  - 해당 회차 Notion 강사용 차트 URL
  - 수업 하루 전 요청 생성 시 Notion 회차 차트를 먼저 만들고 `notionSync.pageUrl`로 저장합니다.

### 짧은 링크

- 모든 버튼 URL은 `shortLinks` 컬렉션을 통해 `https://in.archivepilates.com/s/pc-xxxxxxxxxxxx/` 형태로 변환합니다.
- `수업 전 계획 작성`:
  - `sourceId = {requestId}_pre`
  - 저장 위치: `privateLessonChartRequests.preShortUrl`
- `수업 후 기록 작성`:
  - `sourceId = {requestId}_post`
  - 저장 위치: `privateLessonChartRequests.postShortUrl`
- `사진·영상 업로드`:
  - `sourceId = {requestId}_media`
  - 저장 위치: `privateLessonChartRequests.mediaUploadShortUrl`
- 짧은 링크 prefix는 `pc-`입니다.
- 허용 target origin:
  - `https://in.archivepilates.com`
  - `https://www.notion.so`

### 알림톡 변수 채움

```text
#{회원명} = privateLessonChartRequests.memberName
#{회차} = privateLessonChartRequests.sessionNumber
#{수업일시} = KST 기준 MM.DD 요일 HH:mm
#{수업전계획URL} = privateLessonChartRequests.preShortUrl
#{수업후기록URL} = privateLessonChartRequests.postShortUrl
#{사진영상업로드URL} = privateLessonChartRequests.mediaUploadShortUrl
```

### 발송 전 필수 조건

- `preShortUrl`, `postShortUrl`, `mediaUploadShortUrl` 세 값이 모두 있어야 합니다.
- `mediaUploadShortUrl`은 302로 실제 Notion 회차 차트로 이동해야 합니다.
- Notion 회차 차트에는 `사진·영상 업로드` 섹션이 있어야 합니다.
- 알림톡 템플릿 승인 전에는 요청 문서의 `alimtalk.status`를 `template_pending`으로 유지합니다.
- 자동 발송 대상 상태는 `template_pending` 또는 `queued`로 제한합니다. 수동 테스트 상태와 이미 `sent/skipped`된 요청은 제외합니다.

## 운영 조건

- 3번째 버튼을 쓰기 위해 수업 하루 전 요청 생성 시점에 Notion 회차 차트 페이지를 미리 생성한다.
- Notion 회차 차트에는 `사진·영상 업로드` 섹션이 있어야 한다.
- 자동화는 Notion 페이지 갱신 시 기존 사진·영상 업로드 블록을 삭제하지 않는다.
- 회원에게 발송되는 최종 결과물은 Notion 페이지가 아니라 HTML 회원 리포트다.
