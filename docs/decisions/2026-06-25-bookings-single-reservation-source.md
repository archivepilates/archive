# Bookings Single Reservation Source

Date: 2026-06-25

## Decision

ARCHIVE PILATES private lesson session counting uses `bookings` as the single reservation source.

`memberUsageEvents` remains only as legacy audit/backfill evidence. It must not be used as a live source for private lesson round calculation, Alimtalk target selection, Notion chart state, or report generation.

## Why

StudioMate itself presents reservation history as one reservation source with member/class filters. ARCHIVE CORE should follow the same shape instead of introducing another competing reservation source.

The previous mixed model allowed old `reserved / unchecked` bookings and usage-history rows to affect private session rounds differently. That made cases such as rescheduled or stale private lessons drift between Firestore, Notion charts, and teacher survey links.

## Operating Rule

1. StudioMate reservation Excel is imported as a date-range snapshot.
2. Within the imported range, missing existing bookings are marked `missing_from_latest_reservation_import`.
3. `bookings` is reconciled and then used for member, staff, lesson-type, Alimtalk, private chart, and ARCHIVE CORE views.
4. Yesterday-or-older `reserved / unchecked` private bookings are not counted as confirmed private rounds.
5. Today-or-future `reserved / unchecked` private bookings may be counted as scheduled rounds.
6. `privateSessionLedger` is computed from `bookings` only.
7. `privateLessonChartRequests`, `privateLessonChartRecords`, Notion pages, and `memberUsageEvents` are not round sources.

## Verification Guard

`npm run validate:data-source-policy` prevents `nextSessionNumberFromUsageEvents` from returning to private chart code or repair scripts.

`npm run validate:live-release-rollback-guards` checks the bookings single-source markers in:

- `scripts/recompute-private-session-ledger.mjs`
- `firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts`
- `scripts/validate-data-source-policy.mjs`
- `core/rules/index.html`

## Rollout Notes

Run ledger recompute in dry-run first for affected members, then apply scoped members or current month only.

Do not delete legacy `memberUsageEvents` until all reports, dashboard cards, and historical audits no longer reference it.
