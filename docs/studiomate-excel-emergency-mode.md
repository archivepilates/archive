# ARCHIVE IN StudioMate Excel Sync Default Mode

작성일: 2026-05-19
운영 기준 변경: 2026-05-22

## 운영 결정

2026-05-22부터 ARCHIVE IN의 기본 StudioMate 동기화 방식은 API가 아니라 StudioMate 웹에서 내려받은 엑셀 다운로드/반영 방식이다. 기존 파일명과 내부 식별자에 남아 있는 `emergency` 표현은 호환을 위해 유지하지만, 운영상으로는 더 이상 임시 비상운영으로 보지 않는다.

StudioMate API 모드는 ARCHIVE PILATES 자사 사이트 운영 전까지 사용하지 않는다. 메모 쓰기, 출결 쓰기, 예약 변경처럼 StudioMate에 다시 저장해야 하는 작업은 계속 일시중지한다.

## 현재 운영 기준

- Firebase Scheduler 기반 StudioMate API 동기화와 연락처 동기화는 사용하지 않는다.
- 알림톡 후보 원천은 엑셀 동기화가 갱신한 `memberProfiles.activeTickets`이며, 실발송은 운영자 승인과 중복/제외 최종 확인 뒤 처리한다.
- 기존 23:00 회원목록 다운로드 자동화 `com.archive.studiomate-member-excel`는 실패 메일 혼선을 막기 위해 삭제했다. 회원목록 엑셀은 엑셀 동기화 전용 브라우저 자동화가 받는다.
- 엑셀 다운로드/반영은 1시간 간격으로 실행한다.
- 브라우저 자동화로 받은 회원목록 엑셀을 회원카드/수강권 보정에 사용한다.
- 수업 예약 화면 복구에는 브라우저 자동화로 받은 수업예약내역 엑셀을 함께 사용한다.
- 수업예약내역과 삭제된 수업 로그는 `오늘 ~ 예약오픈 종료일` 범위로 받는다. 예약오픈 종료일은 ARCHIVE IN 액션 기준과 동일하게 이번 주를 포함한 다음 주 일요일이다.
- 수업예약내역 엑셀은 기존 수업과 매칭되면 기존 StudioMate 강사 ID를 사용한다. 같은 수업이 기존 강사 ID와 `excel_staff_...` 임시 강사 ID로 동시에 보이면 안 된다.
- 최신 재직 강사명단은 수업예약내역 엑셀만으로 판단하지 않는다. 주 1회 Mac mini Playwright가 StudioMate `강사` 탭(`/staffs`)을 스캔해 `staffs` 기준명단을 보정한다.
- 강사탭 스캔에서 확인된 강사는 `staffs.active=true`로 보강한다. 기존 active 강사가 강사탭에서 빠졌고 미래 수업/예약이 없으면 퇴사 후보로 보고 `active=false`로 내린다. 미래 수업/예약이 남아 있으면 자동 비활성화하지 않는다.
- 수업 화면은 최신 수업예약내역 엑셀에 포함된 수업만 기준으로 재생성한다. 이전 API 동기화에서 남은 수업이 최신 엑셀에 없으면 화면에서는 제외한다.
- 수업예약내역 엑셀에는 신뢰할 수 있는 수업 정원 원천이 없다. 화면에서는 최대정원과 정원 기반 예약저조 판단을 사용하지 않고 현재 예약 인원만 표시한다.
- StudioMate `수업 > 삭제된 수업` 영역의 삭제 로그는 예약내역 엑셀과 별도 원천이지만, 별도 23:40 자동화는 사용하지 않는다. 1시간 엑셀 동기화에 포함해 같은 예약가능 기간 범위로 받고 `studiomateDeletedClassLogs`에 적재한다.
- 회원목록 엑셀 원본은 엑셀 동기화 전용 다운로드/아카이브 폴더의 최신 `회원목록_*.xlsx`를 우선 사용하고, 없을 때만 Google Drive `회원원본데이터` 폴더의 최신 파일을 사용한다.
- 기본 실행은 dry-run이다. Firestore 반영은 `--apply`를 붙였을 때만 한다.
- 기본 반영 대상은 기존 `memberProfiles`와 전화번호, 이름이 매칭되는 회원이다.
- 1시간 엑셀 동기화 runner는 `--allow-new-excel-profiles --new-excel-profile-max-age-days 3`을 붙여 실행한다.
- 엑셀에만 있는 사람은 등록일이 3일 이내이고 활성 수강권이 있을 때만 `excel_...` 임시 ID로 회원카드를 만든다. 수강권 없는 상담고객은 회원카드를 만들지 않는다.
- `excel_...` 임시 ID로 만든 신규회원은 `studiomateMemberIdLookupJobs` 큐를 함께 만든다. StudioMate 메모쓰기 같은 후행 작업은 전화번호/이름으로 StudioMate 실제 회원 ID를 먼저 찾아 `memberProfiles.studiomateMemberId`에 보강한 뒤 진행한다.
- 단, `등급=상담회원`이고 활성 수강권이 없는 사람은 회원카드는 만들지 않고 Google 연락처만 `이름 상담 YYMMDD` 형식으로 동기화한다. `YYMMDD`는 메모의 상담일을 우선 사용하고 없으면 등록일을 사용한다.
- Google Contacts 작업 큐는 회원 엑셀 반영과 분리한다. 연락처 LaunchAgent만 `--queue-contact-sync`를 붙여 `contactSyncJobs`를 준비한다.
- `contactSyncJobs` 생성은 Google Contacts 실제 쓰기와 다르다. 엑셀 동기화 기본모드에서는 Firebase Scheduler `scheduledProcessContactSyncJobs`를 평소 `PAUSED`로 두고, 연락처 LaunchAgent가 필요할 때만 잠깐 실행한 뒤 다시 `PAUSED`로 되돌린다.
- 연락처 예외 스탭은 회원목록 엑셀에 있더라도 회원 연락처 큐를 만들지 않는다. 현재 예외는 김기효, 김민지, 김아영, 배민진, 이초림, 정은영이다.
- ARCHIVE IN 앱 안의 출석, 결석, 메모 작성은 버튼과 저장 로직에서 모두 차단한다. 화면 확인과 읽기 전용 운영만 허용한다.

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

주간 강사탭 스캔:

```bash
cd /Users/archivepilates/codex-worktrees/archivein-live-setup
source scripts/use-archivein-firebase-service-account.sh >/dev/null
node scripts/sync-studiomate-staffs-from-browser.mjs
node scripts/sync-studiomate-staffs-from-browser.mjs --apply
```

엑셀 동기화 전용 브라우저 다운로드까지 함께 점검:

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

운영자 수동 동기화 요청 처리 LaunchAgent:

```text
com.archive.archivein-admin-emergency-sync
```

ARCHIVE IN 운영자 모드의 동기화 버튼은 StudioMate API 동기화를 직접 실행하지 않는다. `adminSyncRequests`에 `requestMode: emergency_excel` 요청을 만들고, 맥미니 LaunchAgent `com.archive.archivein-admin-emergency-sync`가 최대 30초 안에 요청을 받아 `scripts/run-studiomate-excel-emergency-mode.mjs --download --apply`를 실행한다. 앱 버튼은 요청 완료 전까지 잠기며 Firestore의 `progressPercent`, `progressLabel`을 기준으로 진행률을 보여준다.

1시간 간격 연락처 동기화 LaunchAgent:

```text
com.archive.studiomate-emergency-contacts-sync
```

삭제된 수업 로그는 `com.archive.studiomate-excel-emergency-mode` 안에서 회원목록, 수업예약내역과 함께 받는다. 원본 파일은 `~/ArchiveIN/emergency/archive/deleted-class/YYYY-MM-DD/`에 보관하고, 엑셀 행은 `studiomateDeletedClassLogs`에 원본 컬럼과 함께 적재한다.

삭제된 수업 분류 규칙:

| 분류 | 자동 기준 | 폐강 집계 |
| --- | --- | --- |
| 폐강 | 그룹 수업이고 삭제이유가 `최소 수강인원 미달` | 포함 |
| 폐강 | 그룹 수업이고 삭제이유가 `클래스 폐강`이며 수업일 7일 미만 전에 삭제됐고 수업명이 시간표 템플릿명이 아님 | 포함 |
| 수업 조정 취소 | 그룹 수업이지만 `원장님`, `부원장님`, `오픈클래스`, `강사님`, `쌤` 같은 시간표 템플릿명으로 삭제됨 | 제외 |
| 수업 조정 취소 | 그룹 수업이지만 수업일 7일 이상 전에 `클래스 폐강` 또는 `수업 삭제`로 삭제됨 | 제외 |
| 휴일/운영일정 조정 | 삭제이유가 `휴일 설정` | 제외 |
| 개인수업 취소/조정 | 개인 수업 삭제 전체 | 제외 |
| 예약/수강권 사유 취소 | 삭제이유가 `예약취소`, `수강권 환불`, `수강권 사용불가 처리`, `예약 실패` 등 | 제외 |
| 그룹 삭제수업 확인필요 | 그룹 수업이고 삭제이유가 일반 `수업 삭제`이며 수업일 7일 미만 전에 삭제됨 | 운영자 확인 후 결정 |

실행 내용:

```bash
node scripts/run-emergency-contacts-hourly-sync.mjs
```

동작:

1. 최신 회원목록 엑셀을 `--apply --queue-contact-sync`로 반영한다.
2. `scheduledProcessContactSyncJobs` Scheduler job을 잠깐 `resume`/`run`한다.
3. `home_archivepilates` 연락처 큐가 0건이 될 때까지 필요한 횟수만 반복 실행한다.
4. 작업 후 Scheduler job을 다시 `PAUSED`로 돌린다.

로그:

```text
/Users/archivepilates/ArchiveIN/emergency/logs/studiomate-excel-emergency-mode.out.log
/Users/archivepilates/ArchiveIN/emergency/logs/studiomate-excel-emergency-mode.err.log
/Users/archivepilates/ArchiveIN/emergency/logs/archivein-admin-emergency-sync.out.log
/Users/archivepilates/ArchiveIN/emergency/logs/archivein-admin-emergency-sync.err.log
/Users/archivepilates/ArchiveIN/emergency/logs/studiomate-emergency-contacts-sync.out.log
/Users/archivepilates/ArchiveIN/emergency/logs/studiomate-emergency-contacts-sync.err.log
```

특정 엑셀 파일을 지정:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --file "/path/to/회원목록.xlsx"
```

특정 수업예약내역 엑셀 파일을 지정:

```bash
node scripts/run-studiomate-excel-emergency-mode.mjs --reservation-file "/path/to/수업예약내역.xlsx"
```

엑셀에만 있고 기존 ARCHIVE IN 회원카드가 없는 신규 등록 회원까지 임시 생성:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --allow-new-excel-profiles --new-excel-profile-max-age-days 3
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
  - Google 연락처 메모 동기화용 StudioMate 회원카드 메모
  - 기본 상태는 Google Contacts 큐 미생성
  - `--queue-contact-sync` 사용 시 `home@archivepilates.com` 주소록용 pending 상태와 `contactSyncJobs`를 생성
- `contactSyncJobs/{jobId}`
  - `target: home_archivepilates`
  - 전화번호/표시명/등록일/수강권 요약/회원카드 메모가 바뀐 회원만 생성
  - 상담회원은 `sourceReason: consultation_member_excel`로 생성하며 정규 회원 등록 시 회원 연락처 형식으로 승격된다
  - 기존에 같은 연락처 해시가 `synced`인 회원은 중복 큐 생성하지 않음
- `opsState/studiomateExcelEmergency`
  - 마지막 비상 엑셀 반영 상태
- `studiomateMemberIdLookupJobs/{jobId}`
  - 엑셀 기반 신규회원의 `excel_...` 임시 ID를 StudioMate 실제 회원 ID로 보강하기 위한 큐
  - 전화번호/이름으로 StudioMate 웹 회원검색을 수행하고, 성공 시 `memberProfiles.studiomateMemberId`를 저장
- `lectures/{lectureId}` / `bookings/{bookingId}`
  - 수업일, 시간, 수업명, 강사, 예약자, 예약상태, 출결상태
  - `lectures.lessonType`: 수업 자체의 그룹/프라이빗 성격
  - `bookings.lessonType`: 예약 import 시 저장하는 수업 성격 캐시
  - `bookings.ticketClassType`: 예약 수강권이 회원카드 `activeTickets.classType`과 매칭될 때 저장하는 수강권 성격
  - 기존 수업과 시간/강사/수업명이 매칭되면 기존 `lectureId`를 유지
  - 새 수업은 `excel_lecture_...` 임시 ID 사용
- `instructorViews/{staffId}_{date}`
  - ARCHIVE IN 일간 수업 화면용 수업/예약 목록
- `attendanceSummaries/{memberId}_{yyyymmdd}`
  - 수업예약내역 엑셀로 확인 가능한 범위의 30일 출결 요약
- `opsState/studiomateReservationExcelEmergency`
  - 마지막 수업예약내역 비상 반영 상태
- `studiomateDeletedClassLogs/{logId}`
  - StudioMate `삭제된 수업` 엑셀 행 원본
  - 수업일, 시간, 강사, 수업명, 룸, 수업구분, 삭제일시/삭제자/사유 컬럼이 있으면 정규화
  - 폐강과 수업 조정 취소를 구분하기 위한 월별 리포트 원천
- `opsState/studiomateDeletedClassExcelEmergency`
  - 마지막 삭제된 수업 로그 수집 상태

## 분리 원칙

- 기존 `com.archive.studiomate-member-excel` 자동화는 삭제 상태로 둔다. 회원목록 다운로드는 `com.archive.studiomate-excel-emergency-mode`에 포함한다.
- 엑셀 동기화는 기존 다운로드 자동화와 별도 명령/LaunchAgent/다운로드 폴더/로그/실행 기록을 사용한다.
- StudioMate 로그인 세션은 중복 로그인을 피하기 위해 기존 Mac mini 브라우저 프로필을 읽어 사용한다.
- 주간 강사탭 스캔 자동화는 `com.archive.studiomate-staff-browser-scan`이며 매주 월요일 07:20에 실행한다.
- 엑셀 다운로드가 실패하거나 회원목록 엑셀을 받지 못하면 그 시간대 Firestore 반영을 건너뛴다.

## 제한

- 엑셀에는 StudioMate 회원 ID가 없으므로 전화번호와 이름이 매칭 기준이다.
- 동명이인 또는 동일 전화번호 다중 프로필은 자동 반영하지 않는다.
- 수강권 상태가 만료, 환불, 취소, 정지, 양도인 행은 활성 수강권에서 제외한다.
- 상품 판매 행은 활성 수강권으로 보지 않는다.
- 상담 일정, 기타 일정, StudioMate 메모 쓰기는 이 비상 모드로 보완하지 않는다.
- 수업예약내역 엑셀이 없으면 수업/예약 화면은 갱신하지 않고 회원카드만 갱신한다.
- 수업예약내역 엑셀에 StudioMate 수업 ID/예약 ID가 없으면 시간, 강사, 수업명, 회원 전화번호/이름으로 기존 데이터에 최대한 맞춘다.
- 알림톡 대상자 선정은 엑셀 동기화로 갱신된 회원카드 수강권을 기준으로 한다.
- 알림톡은 엑셀 동기화 기본모드 기준으로 운영하며, 실발송 전 운영자 승인, 중복 발송 차단, 제외 회원 검토를 유지한다.
- 프라이빗/그룹 사전설문 제출 내용은 ARCHIVE IN `memberMemos`에 먼저 저장하고, StudioMate 회원카드 메모 쓰기는 `studiomateMemoWriteJobs` 큐와 Mac mini Playwright LaunchAgent가 처리한다. StudioMate 로그인 만료, 화면 변경, 메모쓰기 실패로 작업이 `failed`가 되면 `home@archivepilates.com`으로 실패 메일을 보낸다.
- ARCHIVE IN Firestore 메모가 원본이고, StudioMate 메모는 Playwright로 후행 복사하는 편의 기록이다. StudioMate에는 기본적으로 새 메모 추가만 수행한다. 단, 자동화 오판으로 동일 메모가 중복 저장된 것이 확인된 경우 운영자 승인 후 StudioMate 화면 UI에서 중복 메모만 삭제할 수 있으며, API 삭제는 사용하지 않는다.
- StudioMate 메모쓰기 Playwright는 저장 전에 동일 메모가 이미 보이면 추가 저장하지 않고 성공 처리하며, 저장 후 화면 검증은 공백/줄바꿈을 정규화해 확인한다.
- StudioMate 엑셀 다운로드, 매출 다운로드, 회원메모 쓰기처럼 `~/ArchiveIN/automation/browser-profile`을 여는 Playwright 작업은 공통 락 `~/ArchiveIN/automation/locks/studiomate-browser-profile.lock`으로 직렬화한다. 한 작업이 실행 중이면 다른 작업은 최대 30분 기다리고, 45분 이상 오래된 락은 stale로 보고 정리한다.
- StudioMate 로그인 세션이 만료되면 Playwright 작업은 저장된 자격증명을 `STUDIOMATE_LOGIN_ID`/`STUDIOMATE_LOGIN_PASSWORD` 환경변수, macOS Keychain, Firebase Secret Manager 순서로 찾아 재로그인을 시도한다. 캡차, 보안문자, 인증번호 화면이 나오면 자동 로그인하지 않고 실패 리포트를 남긴다.

## API 모드 재검토 조건

ARCHIVE PILATES 자사 사이트 운영 전까지는 StudioMate API 모드로 전환하지 않는다. API 모드를 다시 검토하려면:

1. StudioMate API 로그인, 회원 조회, 수업 조회, 메모 쓰기 smoke test를 통과시킨다.
2. 자사 사이트에서 예약/회원/출결 원천을 어디까지 직접 보유할지 결정한다.
3. 엑셀 동기화 결과와 API 기반 결과를 충분히 대조한다.
4. 운영자가 전환을 승인하기 전까지 API 원천 동기화는 재개하지 않는다.
5. Notion 운영 규칙에 전환 일시와 남은 제한을 기록한다.
