# ARCHIVE IN StudioMate Excel Emergency Mode

작성일: 2026-05-19

## 목적

StudioMate API 접근이 403으로 막혔을 때, 브라우저 자동화로 내려받은 StudioMate 회원목록 엑셀을 임시 원천으로 사용해 ARCHIVE IN 회원카드의 현재 수강권/연락처 정보를 갱신한다.

이 비상 모드는 StudioMate API 쓰기 대체가 아니다. 메모 쓰기, 출결 쓰기, 예약 변경처럼 StudioMate에 다시 저장해야 하는 작업은 계속 일시중지한다.

## 현재 운영 기준

- Firebase Scheduler 기반 StudioMate 동기화, 연락처 동기화, 알림톡 자동 발송은 일시중지 상태로 둔다.
- 기존 23:00 회원목록 다운로드 자동화와 분리된 비상모드 전용 브라우저 자동화로 엑셀을 받는다.
- 비상모드 전용 다운로드/반영은 1시간 간격으로 실행한다.
- 브라우저 자동화로 받은 회원목록 엑셀을 회원카드/수강권 보정에 사용한다.
- 수업 예약 화면 복구에는 브라우저 자동화로 받은 수업예약내역 엑셀을 함께 사용한다.
- 회원목록 엑셀 원본은 비상모드 전용 다운로드/아카이브 폴더의 최신 `회원목록_*.xlsx`를 우선 사용하고, 없을 때만 Google Drive `회원원본데이터` 폴더의 최신 파일을 사용한다.
- 기본 실행은 dry-run이다. Firestore 반영은 `--apply`를 붙였을 때만 한다.
- 기본 반영 대상은 기존 `memberProfiles`와 전화번호, 이름이 매칭되는 회원만이다.
- 엑셀에만 있는 사람을 `excel_...` 임시 ID로 만드는 것은 `--allow-new-excel-profiles`를 붙였을 때만 허용한다.
- Google Contacts 작업 큐는 기본 생성하지 않는다. 필요할 때만 `--queue-contact-sync`를 붙여 `contactSyncJobs`를 준비한다.
- `contactSyncJobs` 생성은 Google Contacts 실제 쓰기와 다르다. 비상모드 중에는 `scheduledProcessContactSyncJobs`가 정지 상태이므로, 실제 주소록 반영은 별도 승인 후 수동 처리한다.

## 실행 명령

```bash
cd /Users/archivepilates/codex-worktrees/archivein-live-setup
source scripts/use-archivein-firebase-service-account.sh >/dev/null
node scripts/emergency-import-studiomate-member-excel.mjs
```

회원목록과 수업예약내역을 함께 점검:

```bash
node scripts/run-studiomate-excel-emergency-mode.mjs
```

비상모드 전용 브라우저 다운로드까지 함께 점검:

```bash
HEADLESS=false WAIT_FOR_LOGIN=true node scripts/run-studiomate-excel-emergency-mode.mjs --download
```

검토 후 실제 반영:

```bash
node scripts/run-studiomate-excel-emergency-mode.mjs --download --apply
```

1시간 간격 자동 실행 LaunchAgent:

```text
com.archive.studiomate-excel-emergency-mode
```

로그:

```text
/Users/archivepilates/ArchiveIN/emergency/logs/studiomate-excel-emergency-mode.out.log
/Users/archivepilates/ArchiveIN/emergency/logs/studiomate-excel-emergency-mode.err.log
```

특정 엑셀 파일을 지정:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --file "/path/to/회원목록.xlsx"
```

특정 수업예약내역 엑셀 파일을 지정:

```bash
node scripts/run-studiomate-excel-emergency-mode.mjs --reservation-file "/path/to/수업예약내역.xlsx"
```

엑셀에만 있고 기존 ARCHIVE IN 회원카드가 없는 사람까지 임시 생성:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --allow-new-excel-profiles
```

Google Contacts 동기화 큐까지 준비:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --queue-contact-sync --apply
```

## 반영 데이터

- `memberProfiles/{memberId}`
  - 이름, 전화번호, 이메일, 성별, 생년월일
  - 활성 수강권명, 활성 수강권 수, 활성 수강권 배열
  - 등록일 기준 신규회원 여부
  - 비상 엑셀 원천 파일 경로
- `memberContactIndex/{memberId}`
  - 연락처 동기화용 이름/전화번호/등록일/수강권 요약
  - 기본 상태는 Google Contacts 큐 미생성
  - `--queue-contact-sync` 사용 시 `home@archivepilates.com` 주소록용 pending 상태와 `contactSyncJobs`를 생성
- `contactSyncJobs/{jobId}`
  - `target: home_archivepilates`
  - 전화번호/표시명/등록일/수강권 요약이 바뀐 회원만 생성
  - 기존에 같은 연락처 해시가 `synced`인 회원은 중복 큐 생성하지 않음
- `opsState/studiomateExcelEmergency`
  - 마지막 비상 엑셀 반영 상태
- `lectures/{lectureId}` / `bookings/{bookingId}`
  - 수업일, 시간, 수업명, 강사, 예약자, 예약상태, 출결상태
  - 기존 수업과 시간/강사/수업명이 매칭되면 기존 `lectureId`를 유지
  - 새 수업은 `excel_lecture_...` 임시 ID 사용
- `instructorViews/{staffId}_{date}`
  - ARCHIVE IN 일간 수업 화면용 수업/예약 목록
- `attendanceSummaries/{memberId}_{yyyymmdd}`
  - 수업예약내역 엑셀로 확인 가능한 범위의 30일 출결 요약
- `opsState/studiomateReservationExcelEmergency`
  - 마지막 수업예약내역 비상 반영 상태

## 분리 원칙

- 기존 `com.archive.studiomate-member-excel` 자동화는 그대로 둔다.
- 비상모드는 기존 다운로드 자동화와 별도 명령/LaunchAgent/다운로드 폴더/로그/실행 기록을 사용한다.
- StudioMate 로그인 세션은 중복 로그인을 피하기 위해 기존 Mac mini 브라우저 프로필을 읽어 사용한다.
- 비상모드 다운로드가 실패하거나 회원목록 엑셀을 받지 못하면 그 시간대 Firestore 반영을 건너뛴다.

## 제한

- 엑셀에는 StudioMate 회원 ID가 없으므로 전화번호와 이름이 매칭 기준이다.
- 동명이인 또는 동일 전화번호 다중 프로필은 자동 반영하지 않는다.
- 수강권 상태가 만료, 환불, 취소, 정지, 양도인 행은 활성 수강권에서 제외한다.
- 상품 판매 행은 활성 수강권으로 보지 않는다.
- 상담 일정, 기타 일정, StudioMate 메모 쓰기는 이 비상 모드로 보완하지 않는다.
- 수업예약내역 엑셀이 없으면 수업/예약 화면은 갱신하지 않고 회원카드만 갱신한다.
- 수업예약내역 엑셀에 StudioMate 수업 ID/예약 ID가 없으면 시간, 강사, 수업명, 회원 전화번호/이름으로 기존 데이터에 최대한 맞춘다.
- 알림톡 대상자 선정 자동화는 Scheduler 재개 전까지 계속 수동 검토 기준이다.

## 정상화 조건

StudioMate API 접근이 다시 안정화되면:

1. StudioMate API 로그인, 회원 조회, 수업 조회, 메모 쓰기 smoke test를 통과시킨다.
2. 비상 엑셀 반영을 멈추고 API 원천 동기화를 재개한다.
3. Firebase Scheduler를 필요한 작업부터 순차적으로 ACTIVE로 돌린다.
4. Notion 운영 규칙에 정상화 일시와 남은 제한을 기록한다.
