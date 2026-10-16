# 강사레슨 승인 발송 메모리 압박 수정

## 상태

- 전용 worktree: instructor-send-bounded-memory / codex/mini/instructor-send-bounded-memory.
- 기준 origin/main: 6b814bc5427a2f55323b3a7d1f98ef8120f73405.
- 구현·오프라인 검증·독립 리뷰 완료. 사용자가 관련 Functions·CORE 운영규칙 배포·커밋·푸시를 승인하여 운영 배포 준비 중.
- 실제 발송과 기존 승인·후보·발송 원장 수정은 하지 않는다.

## 확인된 사실

- archive-pilates / asia-northeast3 / scheduledSendApprovedInstructorLessonAlimtalk, 512MiB, ACTIVE.
- 2026-10-16 09:00:41Z: 513MiB로 종료. 2026-09-17 09:00:52Z: 516MiB로 종료.
- 전체 후보 재생성은 회원 626명, 예약 95,722건, 수업 16,153건을 읽는 구조다. Firestore count()로 같은 수를 재확인했다.
- 2026-10-16 승인 5명 묶음은 sending 상태다. 후보 2건 sent + 원장 done/메시지 ID, 1건 failed/원장 없음, 2건 candidate/원장 없음. 원장 부재만으로 SOLAPI 미접수를 확정하지 않는다.
- 읽기 전용 원본 감사에서 5건의 승인 계약, 예약·수업·회원 일치, 스냅샷 최신성, 취소 없음이 확인됐다. 감사는 발송 가능 승인이나 실제 전달 증거가 아니다.
- SOLAPI GET 조회(18:00~18:02 KST)에서 위 성공 2건의 COMPLETE/4000과 메시지 ID가 일치했다. 페이지 누락 없음. 재발송 없음.

## 변경

- 18:00 전체 재생성 제거, 승인 후보만 순차 조회.
- 모든 후보의 승인 ID·수신자·콘텐츠를 검증하고 선점 시 원본 변경 차단.
- 실제 수업일로 취소 원장 조회 수정, 예약·수업·회원·기존 발송 원장 트랜잭션 검증.
- sending/failed 자동 재개 없음, 1회 시도 및 기존 중복 차단 유지.
- 메모리 관측 로그, 오프라인 테스트, 읽기 전용 감사 도구, CORE 운영규칙·결정 기록 추가.
- 기존 후보가 failed/processing 등 미확인 상태이면 묶음 자체를 보류한다. 선점 직전 원천 변경이나 기존 발송 원장은 확인필요 건수·사유로 기록하고 성공으로 보고하지 않는다.
- 재생성과 발송이 같은 강사레슨 수강권 분류 함수를 사용한다. 해당 함수 추출에 맞춰 기존 순수 함수 검사 도구도 갱신했다.

## 검증 결과

- 승인·원천 단위 테스트 15/15, 실제 발송 함수의 오프라인 VM 테스트 83/83 통과. 실제 네트워크·Firestore·SOLAPI 발송은 가짜 의존성으로 차단했다.
- 주차 13/13, 강사레슨 등록·일정 45/45, CORE 운영 흐름 80/80 통과.
- TypeScript 타입 검사, 5개 Functions 코드베이스 빌드, 릴리스 회귀 방지(신규 VM 테스트 필수 포함), CORE Hosting 정합성 검사, git diff --check 통과.
- 독립 리뷰의 2개 보완 사항을 반영하고 재검토에서 추가 문제 없음. 운영 RAM 개선 실측은 미완료다.
- 실제 영향 코드베이스는 functions-alimtalk만이며 Hosting은 CORE 운영규칙 문구다. package.json/의존성/메모리 설정/스케줄/DB schema 변경 없음.
- 브라우저·공유 StudioMate 프로필·잠금은 사용하지 않았다. runtime 원본 Git 상태는 clean이며 작업 파일은 전용 worktree에 미커밋 상태로 보존했다.

## 남은 절차

- 승인 범위의 scoped 커밋·main 승격·functions-alimtalk 및 CORE 운영규칙 Hosting 배포·라이브 검증·푸시.
- 실제 신규 정기 실행 전까지 운영 RAM 개선 실측은 미완료다.
- 중단된 오늘 건은 별도 공급자 원장 대조와 발송 승인이 필요하다. 이번 수정으로 재발송하지 않는다.
