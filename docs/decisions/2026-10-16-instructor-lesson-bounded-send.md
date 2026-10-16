# 강사레슨 승인 대상 한정 발송

## 목적과 결정

- 18:00 승인 발송은 전체 후보 재생성을 호출하지 않는다. 승인 문서의 후보 ID를 순차 조회하고 승인 당시 수신자와 콘텐츠 계약을 확인한다.
- 2026-08-24 결정 중 "승인 뒤 예약자 증감은 18:00 최신 명단에 반영"을 대체한다. 승인 이후 새 수신자는 자동 추가하지 않는다. 추가 대상은 운영자가 별도 확인·승인해야 하며 이번 수정은 재승인 도구를 새로 만들지 않는다.
- 취소·누락·변경·오래된 원천은 안전하게 보류한다. 예약 원천은 기존 24시간 이내 예약 Excel 스냅샷이며 실시간 StudioMate 조회로 표현하지 않는다.

## 원천과 중복 처리

- canonical: instructorLessonAlimtalkApprovals, alimtalkCandidates, alimtalkSends, bookings, lectures, memberProfiles, instructorLessonRegistrations, opsState/studiomateReservationExcelEmergency.
- 승인 경계: candidateIds, approvedTargetKeys, contentFingerprint, studioId, sourceDate, lessonDate, managementNumber, templateCode.
- 후보 원본 전체가 선점 직전까지 같아야 하며 회원·예약·수업 ID와 연락처도 일치해야 한다. 회원 미러와 workLanes는 발송 원천이 아니다.
- 취소 등록 ID는 실제 lessonDate로 계산한다. sourceDate는 D-1 발송일이므로 취소 원장 키에 사용하지 않는다.
- 기존 템플릿 승인·회원 제외·날짜별 중복방지·주차 링크·자료 링크 검증을 유지한다. 후보 선점 시 기존 발송 원장이 있으면 상태와 관계없이 자동 재시도하지 않는다.
- approved -> sending 선점에 성공한 실행만 처리한다. 기존 sending/processing/failed는 재개하지 않는다. 공급자 호출은 트랜잭션 밖에서 1회만 수행한다.

## 검증과 배포 경계

- 오프라인 가짜 원장으로 실제 발송 함수의 제한된 조회, 동시 실행, 원천 변경, 중복 차단을 검증한다.
- scripts/audit-instructor-lesson-approved-send.ts는 기존 승인 후보와 원장을 읽기만 한다. 회원 정보나 발송 상태를 변경하지 않는다.
- 512MiB 설정은 유지한다. 시작·완료 로그의 process.memoryUsage로 다음 정상 정기 실행에서 운영 메모리를 재검증한다. 로컬 테스트 통과를 운영 메모리 개선 실측으로 대신하지 않는다.
- 이번 수정은 중단된 2026-10-16 발송을 재실행할 권한을 포함하지 않는다.
- 구현·배포·검증 상태는 같은 날짜의 작업 기록과 HTML 보고서에 별도 기록한다.
