# ARCHIVE CORE Transition Work Lane

Date: 2026-06-03

## Lane

`workLanes/archive-core-transition`

## Objective

Move the current ARCHIVE IN operator direction into ARCHIVE CORE, an operator-only web platform for ARCHIVE PILATES operational data, automation status, Alimtalk approval, source import quality, private session ledger, and business dashboards.

## Current Phase

Phase 1: read-only operations console foundation.

## Phase 0 Scope

- Create a dedicated worktree and branch for ARCHIVE CORE work.
- Add ARCHIVE CORE collection contracts.
- Add `workLanes` contracts in this branch.
- Add `/core` operator-console shell.
- Add architecture and lane documents.
- Create/update `workLanes/archive-core-transition` in Firestore.

## Phase 0 Result

- Dedicated worktree: `/Users/archivepilates/codex-worktrees/archive-core-transition`
- Branch: `codex/mini/archive-core-transition`
- Firestore lane: `workLanes/archive-core-transition`
- Notion page: `ARCHIVE CORE 시스템 설계와 Codex 워크라인 운영`
- Hosting route prepared: `/core/** -> /core/index.html`

## Phase 1 Scope

- Make `/core` a read-only operator console, not a static sketch.
- Read these Firestore collections when permissions allow:
  - `workLanes/archive-core-transition`
  - `automationStatus`
  - `sourceImports`
  - `dataQualityIssues`
- Keep the UI safe when Firestore auth is unavailable by showing static fallback states.
- Add contracts for source imports, automation status, data quality issues, member usage events, and private session ledger entries.

## Explicit Non-Scope

- Do not change existing Alimtalk source selection.
- Do not change StudioMate Excel import behavior.
- Do not migrate production data.
- Do not deploy without user approval.
- Do not rename the live ARCHIVE IN URL yet.
- Do not use ARCHIVE CORE read models as send/write sources until shadow compare is approved.

## Initial Product Areas

- Home
- Members
- Lessons
- Private
- Messages
- Automation
- Business
- Imports
- Rules
- Settings

## First Data Priorities

1. `sourceImports`
2. `automationStatus`
3. `dataQualityIssues`
4. `memberUsageEvents`
5. `privateSessionLedger`
6. `memberTickets`
7. `memberPaymentEvents`
8. `memberSummaries`

## Current Implementation Notes

- `/core` loads `archivein/firebase-config.js` and uses Firebase Web SDK read calls only.
- `/core/assets/app.js` catches permission or missing-data failures and does not write to Firestore.
- `sourceImports`, `automationStatus`, and `dataQualityIssues` are currently read surfaces. They are not yet connected to live import scripts in this branch.
- Existing Alimtalk and StudioMate automations remain on their current canonical collections and scripts.
- `core.archivepilates.com` is connected to Firebase Hosting site `archive-pilates-core`.
- Firebase Auth authorized domains include `archive-pilates-core.web.app` and `core.archivepilates.com`.
- Business reads `dashboardSnapshots/current` read-only and shows a CORE-style monthly summary after operator login.
- Imports, Members, and Private pages now use the shared operator login/read flow.
- Members reads the existing `members` mirror read-only and shows recent member, ticket, visit, and revenue summary rows.
- Private reads existing `privateLessonChartRequests` and `privateLessonChartRecords` read-only. `memberUsageEvents` and `privateSessionLedger` remain empty/preparation surfaces until the usage-history pipeline is applied.
- Firestore browser writes remain blocked for the added CORE read surfaces.
- Members list now links to `/members/detail/?id={memberId}`.
- Member detail reads `members/{memberId}`, `member360Cards/{memberId}`, `members/{memberId}/summary/current`, and member subcollections read-only.
- Automation and Imports pages distinguish “collection connected but no status/source documents yet” from permission failure.
- Business page also reads `member360Cards` by `totalRevenue` for member-level business insight display.

## 2026-06-04 Data Work Result

- Rebuilt ARCHIVE CORE member read-model data from existing canonical source collections.
- Applied read-only mirror writes:
  - `members`: 852 docs
  - `member360Cards`: 852 docs
  - `members/{memberId}/summary/current`
  - `members/{memberId}/tickets/{ticketId}`
  - `members/{memberId}/purchases/{purchaseId}`
  - `members/{memberId}/bookings/{bookingId}`
  - `members/{memberId}/memos/{memoId}`
  - `members/{memberId}/alimtalkLogs/{logId}`
  - `members/{memberId}/tags/{tagId}`
- Verified sample `members/3045390`:
  - name: 방지숙
  - purchases: 15
  - bookings: 52
  - totalRevenue: 11200000
- Deployed Firestore index required for date-filtered `bookings` reads:
  - `bookings`: `studioId ASC`, `lectureDate ASC`
- Ran StudioMate member usage booking backfill dry-run through 2026-06-03.
  - selectedRows: 65521
  - bookingCreates: 53191
  - bookingUpdates: 683
  - lectureCreates: 11579
  - plannedWrites: 65453
  - memberNoMatch: 0
- Did not apply the 65453-write `bookings` backfill yet. This changes canonical source records and needs separate approval after sample verification.

## 2026-06-04 UI/Data Step 1-4 Result

- Step 1 Members: added member detail route and linked the recent member list to detail pages.
- Step 2 Private: added private chart health, submission count, correction count, and usage-history backfill dry-run status.
- Step 3 Imports/Automation: added status KPI cards and clearer empty states for not-yet-connected `automationStatus`, `sourceImports`, and `dataQualityIssues` documents.
- Step 4 Business: added member revenue insight panel based on `member360Cards` read-model data.
- External sends, StudioMate writes, Contacts writes, and Alimtalk candidate selection remain on existing canonical sources. ARCHIVE CORE displays mirrors only.

## 2026-06-04 Automation/Import/Quality Step 1-3 Result

- Added shared logging helper: `scripts/lib/archive-core-ops-logging.mjs`.
- Connected StudioMate member Excel import to:
  - `sourceImports`
  - `dataQualityIssues`
- Connected StudioMate reservation Excel import to:
  - `sourceImports`
  - `dataQualityIssues`
- Connected deleted-class Excel import to:
  - `sourceImports`
- Connected `scripts/run-studiomate-excel-emergency-mode.mjs` to:
  - `automationStatus/studiomate-excel-sync`
- Verified on the actual LaunchAgent worktree path:
  - `/Users/archivepilates/codex-worktrees/archivein-live-setup`
- Dry-run result:
  - member source import: `e44c00be488037c6f10da266adc04649`
  - reservation source import: `846f95c7f856f6d57639e9db78459c9c`
  - automation status: `studiomate-excel-sync`, status `healthy`
- Fixed a source-selection bug:
  - reservation import previously allowed `수업매출` sales files because the filename filter accepted `수업`.
  - reservation import now requires reservation/booking filenames and excludes sales/매출 paths.
  - wrong dry-run source import `37905d7070e83cb767a5e78e5bc52b99` was marked `superseded`.

## Handoff Rule

Subthreads should be instructed by lane, not repeated long context:

```txt
archive-core-transition 워크라인 기준으로 [담당 파트]만 진행해줘.
```
