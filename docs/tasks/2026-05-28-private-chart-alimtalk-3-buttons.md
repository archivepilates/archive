# 프라이빗 차트 강사용 알림톡 3버튼 요청안

## 목적

강사가 프라이빗 수업 하루 전 같은 알림톡에서 수업 전 계획, 수업 후 기록, 사진·영상 업로드를 모두 처리할 수 있게 한다.

## 템플릿명

`강사용_프라이빗 차트 작성 안내 v2`

## 발송 대상

다음날 프라이빗 또는 세미프라이빗 예약의 담당 강사.

## 발송 시점

수업 하루 전 18:00 이후.

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

## 운영 조건

- 3번째 버튼을 쓰기 위해 수업 하루 전 요청 생성 시점에 Notion 회차 차트 페이지를 미리 생성한다.
- Notion 회차 차트에는 `사진·영상 업로드` 섹션이 있어야 한다.
- 자동화는 Notion 페이지 갱신 시 기존 사진·영상 업로드 블록을 삭제하지 않는다.
- 회원에게 발송되는 최종 결과물은 Notion 페이지가 아니라 HTML 회원 리포트다.
