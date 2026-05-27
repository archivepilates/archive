# 2026-05-27 StudioMate 회원 이용내역 백필 수집기

## Scope

- New script: `scripts/collect-studiomate-member-usage-excels.mjs`
- 목적: 멤버별로 StudioMate 회원 상세 → 이용내역 → `전체` 탭 → 사용 내역 엑셀 다운로드
- 대상 다운로드 위치: `~/ArchiveIN/emergency/archive/member-usage/YYYY-MM-DD/`
- 공통 실행 규칙: 공유 브라우저 프로필 `~/ArchiveIN/automation/browser-profile` + lock 사용

## 주요 옵션

- `--apply` / `--dry-run`
  - 기본은 dry-run.
- `--query=이름1,이름2` 또는 `--name=...`
- `--phone=...`
- `--limit=N`
- `--source=<경로>` (선택)
- `--all` (라이브 전원 적용 허용)
- `--resume`
- `--resume-state=<경로>`

## 안전 가드

- `--apply`는 `--all`, `--limit`, `--query`, `--phone` 중 하나 없이는 자동 전체 멤버 실행을 차단.
- 샘플 dry-run에서 멤버 소스 전체가 있을 때도 기본으로 5명 샘플을 사용.

## 출력

- 진행 로그: `${runDir}/*-progress.jsonl`
- 실패 로그: `${runDir}/*-failures.json`
- 실행 요약(manifest): `${runDir}/*-manifest.json`
- 런 로그(앱/일괄): `~/ArchiveIN/emergency/runs/member-usage/member-usage-runs.jsonl`

## 다음 단계

- 운영자가 `--apply`로 실제 런을 돌릴 때는 `--query` 또는 `--phone` 또는 `--limit`로 우선 범위를 제한해 테스트 후, 필요 시 `--all`로 확장한다.
- Firestore 반영은 `scripts/apply-studiomate-member-usage-backfill.mjs`를 사용한다.
  - 기본은 dry-run이며 Firestore에 쓰지 않는다.
  - 실제 쓰기는 `--apply --confirm-studiomate-usage-backfill`가 모두 있어야 실행된다.
  - 적용 전 기존 booking 변경 대상은 JSONL 백업으로 저장한다.
  - `--limit`, `--member-id`, `--name`, `--phone`, `--start-date`, `--end-date`로 부분 적용을 먼저 검증할 수 있다.

## 승인 전 검토 산출물

- 원본 기준 결정: StudioMate 회원별 이용내역 엑셀을 과거 예약/출석 이력 백필의 최종 원본으로 사용한다.
- 기존 ARCHIVE IN `bookings`와 상태가 충돌하는 경우 StudioMate 이용내역을 우선한다.
- 검토 스크립트: `scripts/prepare-studiomate-member-usage-backfill-dry-run.mjs`
- 실행일: 2026-05-27
- Firestore 작업: `memberProfiles`, `bookings` 읽기만 수행. 쓰기/삭제/교체 없음.
- 수집 커버리지: 942/942명, 누락 0명
- 정규화 결과: 65,767건, 기간 2023-03-06 ~ 2026-06-30
- 기존 bookings 대조: 동일 후보 12,181건, 상태 충돌 262건, 백필 후보 53,324건
- 승인 리포트: `docs/reports/2026-05-27-studiomate-member-usage-backfill-dry-run.html`
- 원본 정규화 CSV: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-normalized-2026-05-27.csv`
- 요약 JSON: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-dry-run-summary-2026-05-27.json`
- 완료 보고 메일: `[동기화][확인필요] 이용내역 백필 승인자료 · 5/27`

## 반영 스크립트 dry-run

- 스크립트: `scripts/apply-studiomate-member-usage-backfill.mjs`
- 100건 샘플 dry-run: 정상
  - selectedRows 100
  - bookingCreates 100
  - lectureCreates 43
  - plannedWrites 143
- 전체 dry-run: 정상
  - selectedRows 65,767
  - existingBookingsRead 12,346
  - bookingCreates 53,301
  - bookingUpdates 396
  - lectureCreates 11,815
  - unchanged 12,070
  - skipped memberNoMatch 0, invalidStatus 0
  - plannedWrites 65,512
- 전체 dry-run 산출물:
  - 요약: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/apply-plan/2026-05-27T10-34-21-939Z-usage-backfill-dry-run-summary.json`
  - 계획 샘플: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/apply-plan/2026-05-27T10-34-21-939Z-usage-backfill-plan.json`
- 회원 단위 dry-run 예시: 양세실리아 `memberId=3605094`
  - selectedRows 232
  - bookingCreates 109
  - bookingUpdates 1
  - lectureCreates 108
  - unchanged 122
  - skipped 0
  - plannedWrites 218

## 2026-05-27 부분 적용 결과

- 적용 대상: 양세실리아 `memberId=3605094`
- 적용 범위: `--end-date=2026-05-26`, 실제 선택된 이용내역 기간 2025-02-11 ~ 2026-05-24
- 적용 명령: `node scripts/apply-studiomate-member-usage-backfill.mjs --member-id=3605094 --end-date=2026-05-26 --apply --confirm-studiomate-usage-backfill`
- 1차 적용 결과:
  - bookingCreates 109
  - bookingUpdates 1
  - lectureCreates 108
  - unchanged 110
  - skipped 0
  - plannedWrites 218
- 후속 보정:
  - 같은 회원/날짜/시간에 취소와 출석이 모두 남는 이용내역은 `usageBackfillRowKey`로 별도 예약 행을 매칭하도록 수정했다.
  - 2026-03-13 19:00 양세실리아 행은 `cancel/unchecked`와 `reserved/attended`가 각각 별도 booking으로 유지되는 것을 확인했다.
  - 적용 시 영향받은 회원의 `attendanceSummaries` 30일 요약도 함께 재계산하도록 추가했다.
- 최종 재드라이런 검증:
  - bookingCreates 0
  - bookingUpdates 0
  - lectureCreates 0
  - unchanged 220
  - skipped 0
  - plannedWrites 0
- 확인된 요약 문서:
  - `attendanceSummaries/3605094_20260524`
  - attended 11, absent 1, cancel 3, waitCancel 0, total 12

## 반영 스크립트 추가 안전장치

- 실제 쓰기는 `--apply --confirm-studiomate-usage-backfill`가 모두 있어야 실행된다.
- 실제 쓰기 시 범위 필터 없이 전체 적용하려면 `--all`이 필요하다.
- 실제 쓰기 시 `--end-date`가 없으면 거부한다. 미래 예약까지 의도적으로 포함할 때만 `--include-future`를 사용한다.
- 기존 `lectures`가 있는 미래/현재 수업은 재사용하고, 과거에 수업 문서가 없는 이력만 `usage_lecture_...` 문서로 생성한다.
- 기존 백필 행은 `usageBackfillRowKey`를 우선 매칭해 재실행 시 같은 행을 덮거나 중복 생성하지 않는다.

## 실제 적용 권장 순서

1. 특정 날짜 구간 또는 소수 회원으로 추가 부분 적용한다.
2. 적용 후 해당 회원의 ARCHIVE IN 회원카드, 마지막 출석일, 알림톡 후보 제외/포함 상태를 확인한다.
3. 문제가 없으면 날짜 범위를 넓히고 마지막으로 전체 적용한다.
4. 전체 적용 후 member insights, 알림톡 후보 재계산을 실행한다.

## 수강권 구매/회원권 이력 dry-run

- 원본 기준: 회원목록 엑셀의 수강권 구매/상태 정보와 회원별 이용내역의 `사용된수강권` 통계를 결합한다.
- 검토 스크립트: `scripts/prepare-studiomate-ticket-history-dry-run.mjs`
- Firestore 작업: `memberProfiles` 읽기만 수행. 쓰기/삭제/교체 없음.
- 수강권 이력 행: 2,903건
- 대상 회원: 830명
- 활성 수강권 행: 232건
- 현재 `memberProfiles` 매칭: 340명
- `memberProfiles`는 없지만 StudioMate 회원 ID 확인됨: 490명
- 프로필 완전 미매칭: 0명
- 승인 리포트: `docs/reports/2026-05-27-studiomate-ticket-history-dry-run.html`
- 정규화 CSV: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-ticket-history-normalized-2026-05-27.csv`
- 요약 JSON: `~/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-ticket-history-dry-run-summary-2026-05-27.json`
