# StudioMate 이용내역 백필 원본 기준

## 결정

2026-05-27부터 회원별 과거 예약/출석 이력 백필은 StudioMate `회원 > 회원정보 > 이용내역 > 전체 > 엑셀 다운로드` 파일을 최종 원본으로 본다.

## 적용 범위

- ARCHIVE IN `bookings` 과거 이력 백필
- 회원별 수강권 구매/회원권 이력 백필
- 회원카드 예약/출석 이력 정합성 복구
- 마지막 출석일, 미출석 일수, 출석/결석/취소 이력 검증의 원천 데이터

## 처리 기준

- StudioMate 이용내역 엑셀과 기존 ARCHIVE IN `bookings` 상태가 충돌하면 StudioMate 이용내역을 우선한다.
- 회원권/수강권 이력은 StudioMate 회원목록 엑셀의 수강권 구매/상태 필드를 원본으로 하고, 회원별 이용내역 엑셀의 `사용된수강권` 통계로 사용 이력을 보강한다.
- 기존 ARCHIVE IN `bookings`는 백업 후 교체/보정 대상으로 본다.
- 기존 ARCHIVE IN `memberProfiles.activeTickets`와 충돌하면 StudioMate 회원목록 엑셀의 수강권 상태, 기간, 잔여횟수를 우선한다.
- 실제 Firestore 반영 전에는 항상 dry-run 리포트를 만들고 운영자 승인을 받은 뒤 적용한다.
- 적용 스크립트는 기본값을 dry-run으로 두고, 실제 쓰기는 명시적인 `--apply`와 별도 확인 옵션을 요구한다.
- 상태 매핑은 현재 기준으로 유지한다.
  - `출석` -> `appStatus: reserved`, `attendanceStatus: attended`
  - `결석`, `노쇼` -> `appStatus: reserved`, `attendanceStatus: absent`
  - `취소` -> `appStatus: cancel`, `attendanceStatus: unchecked`
  - `예약`, `예약 확정` -> `appStatus: reserved`, `attendanceStatus: unchecked`
  - `예약 대기` -> `appStatus: wait`, `attendanceStatus: unchecked`

## 2026-05-27 승인 전 검토 수치

- 수집 커버리지: 942/942명, 누락 0명
- 정규화 이용내역: 65,767건
- 기간: 2023-03-06 ~ 2026-06-30
- 기존 bookings와 동일 후보: 12,181건
- 상태 충돌: 262건
- 백필 후보: 53,324건
- 회원 미매칭: 0건

## 산출물

- 승인 리포트: `docs/reports/2026-05-27-studiomate-member-usage-backfill-dry-run.html`
- 정규화 CSV: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-normalized-2026-05-27.csv`
- 요약 JSON: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-dry-run-summary-2026-05-27.json`

## 수강권 이력 승인 전 검토

- 승인 리포트: `docs/reports/2026-05-27-studiomate-ticket-history-dry-run.html`
- 정규화 CSV: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-ticket-history-normalized-2026-05-27.csv`
- 요약 JSON: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-ticket-history-dry-run-summary-2026-05-27.json`
- 수강권 이력 행: 2,903건
- 대상 회원: 830명
- 활성 수강권 행: 232건
- 현재 `memberProfiles` 매칭: 340명
- `memberProfiles`는 없지만 StudioMate 회원 ID 확인됨: 490명
- 프로필 완전 미매칭: 0명
