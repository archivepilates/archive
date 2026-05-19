# ARCHIVE IN StudioMate Excel Emergency Mode

작성일: 2026-05-19

## 목적

StudioMate API 접근이 403으로 막혔을 때, 브라우저 자동화로 내려받은 StudioMate 회원목록 엑셀을 임시 원천으로 사용해 ARCHIVE IN 회원카드의 현재 수강권/연락처 정보를 갱신한다.

이 비상 모드는 StudioMate API 쓰기 대체가 아니다. 메모 쓰기, 출결 쓰기, 예약 변경처럼 StudioMate에 다시 저장해야 하는 작업은 계속 일시중지한다.

## 현재 운영 기준

- Firebase Scheduler 기반 StudioMate 동기화, 연락처 동기화, 알림톡 자동 발송은 일시중지 상태로 둔다.
- 브라우저 자동화로 받은 회원목록 엑셀만 사용한다.
- 엑셀 원본은 Google Drive `회원원본데이터` 폴더에 보관된 최신 `회원목록_*.xlsx`를 사용한다.
- 기본 실행은 dry-run이다. Firestore 반영은 `--apply`를 붙였을 때만 한다.
- 기본 반영 대상은 기존 `memberProfiles`와 전화번호, 이름이 매칭되는 회원만이다.
- 엑셀에만 있는 사람을 `excel_...` 임시 ID로 만드는 것은 `--allow-new-excel-profiles`를 붙였을 때만 허용한다.
- Google Contacts 작업 큐는 기본 생성하지 않는다. 필요할 때만 `--queue-contact-sync`를 붙인다.

## 실행 명령

```bash
cd /Users/archivepilates/codex-worktrees/archivein-live-setup
source scripts/use-archivein-firebase-service-account.sh >/dev/null
node scripts/emergency-import-studiomate-member-excel.mjs
```

검토 후 실제 반영:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --apply
```

특정 엑셀 파일을 지정:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --file "/path/to/회원목록.xlsx"
```

엑셀에만 있고 기존 ARCHIVE IN 회원카드가 없는 사람까지 임시 생성:

```bash
node scripts/emergency-import-studiomate-member-excel.mjs --allow-new-excel-profiles
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
- `opsState/studiomateExcelEmergency`
  - 마지막 비상 엑셀 반영 상태

## 제한

- 엑셀에는 StudioMate 회원 ID가 없으므로 전화번호와 이름이 매칭 기준이다.
- 동명이인 또는 동일 전화번호 다중 프로필은 자동 반영하지 않는다.
- 수강권 상태가 만료, 환불, 취소, 정지, 양도인 행은 활성 수강권에서 제외한다.
- 상품 판매 행은 활성 수강권으로 보지 않는다.
- 출결 30일, 수업 예약, 상담 일정, StudioMate 메모 쓰기는 이 비상 모드로 보완하지 않는다.
- 알림톡 대상자 선정 자동화는 Scheduler 재개 전까지 계속 수동 검토 기준이다.

## 정상화 조건

StudioMate API 접근이 다시 안정화되면:

1. StudioMate API 로그인, 회원 조회, 수업 조회, 메모 쓰기 smoke test를 통과시킨다.
2. 비상 엑셀 반영을 멈추고 API 원천 동기화를 재개한다.
3. Firebase Scheduler를 필요한 작업부터 순차적으로 ACTIVE로 돌린다.
4. Notion 운영 규칙에 정상화 일시와 남은 제한을 기록한다.
