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
- Legacy Notion planning page: `ARCHIVE CORE 시스템 설계와 Codex 워크라인 운영`
- Current operating-rules hub: ARCHIVE CORE `/core/rules/`
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

## 2026-06-05 Transition Step 1-7 Result

Implemented the first safe ARCHIVE CORE data-transition package.

Completed:

- Added `scripts/prepare-archive-core-transition-data.mjs`.
- Added `npm run prepare:archive-core-transition`.
- Extended ARCHIVE CORE contracts for:
  - `memberTickets`
  - `memberPaymentEvents`
  - `lessonOccurrences`
  - `reservations`
  - `memberUsageEvents`
  - `privateSessionLedger`
- Ran dry-run and apply for the 6-member sample:
  - 방지숙 `3045390`
  - 구아름 `2047962`
  - 정숙자 `1985970`
  - 조민정 `3030691`
  - 박정인 `3574953`
  - 김아영 `4081797`

Applied CORE-only documents:

```txt
memberUsageEvents      2,530
memberTickets             80
memberPaymentEvents       80
lessonOccurrences      2,237
reservations           2,530
privateSessionLedger     307
```

Firestore operation records:

```txt
sourceImports/12caabd6535d48d1a1a794f60e758d2f
sourceImports/1deda1b1c7947b52f8a2c6cc1b980b93
automationStatus/archive-core-transition-ledger
dataQualityIssues: 2 open warnings
```

Shadow compare result:

```txt
selectedUsageRows          2,620
usageEvents                2,530
duplicateCanonicalRows        90
existingBookingsRead          628
existingSameLoose             516
statusConflictLoose             1
missingFromBookings         2,013
```

Important interpretation:

- The current `bookings` collection is not complete enough for cumulative private-session counting.
- Member usage history Excel is a better first source for cumulative usage and private ledger reconstruction.
- The current normalized member-usage source is the `2026-05-27` snapshot, so it is too stale for final production source switching on `2026-06-05`.
- 방지숙 sample ledger currently ends at:
  - `2026-05-28 12:00`
  - cumulative private round `178`
  - current ticket round `18/20`
  - `computation.stale = true`

Guardrails enforced by the script:

- Writes only ARCHIVE CORE collections.
- Does not write `bookings`, `lectures`, `alimtalkCandidates`, `contactSyncJobs`, StudioMate, or Google Contacts.
- Requires `--apply --confirm-archive-core-transition` for Firestore writes.
- Full apply additionally requires `--all --allow-full-apply`.
- External sends and writes must keep using existing canonical sources until operator-approved full shadow compare.

Reports:

```txt
docs/reports/2026-06-05-archive-core-transition-dry-run.html
docs/reports/2026-06-05-archive-core-transition-apply.html
/Users/archivepilates/ArchiveIN/automation/reports/archive-core-transition/2026-06-05-archive-core-transition-dry-run.json
/Users/archivepilates/ArchiveIN/automation/reports/archive-core-transition/2026-06-05-archive-core-transition-apply.json
```

Remaining gate before full transition:

1. Re-run StudioMate member usage download/normalization with a current source snapshot.
2. Run full dry-run shadow compare.
3. Review duplicate canonical rows and status conflicts.
4. Apply in a larger controlled batch.
5. Rebuild derived summaries if needed.
6. Switch one read-only CORE page first.
7. Only after approval, switch Alimtalk/private-chart selection rules.

## Handoff Rule

Subthreads should be instructed by lane, not repeated long context:

```txt
archive-core-transition 워크라인 기준으로 [담당 파트]만 진행해줘.
```

## 2026-06-04 Command Thread And Worktree Split

ARCHIVE CORE now uses one main command thread for requirements, priority, final judgment, and release approval.

Feature-specific work happens in lane worktrees and reports back to the main command thread before it becomes project direction.

```txt
command / integration
  worktree: /Users/archivepilates/codex-worktrees/archive-core-transition
  branch:   codex/mini/archive-core-transition

ui
  worktree: /Users/archivepilates/codex-worktrees/archive-core-ui
  branch:   codex/mini/archive-core-ui

data
  worktree: /Users/archivepilates/codex-worktrees/archive-core-data
  branch:   codex/mini/archive-core-data

functions
  worktree: /Users/archivepilates/codex-worktrees/archive-core-functions
  branch:   codex/mini/archive-core-functions

alimtalk
  worktree: /Users/archivepilates/codex-worktrees/archive-alimtalk
  branch:   codex/mini/archive-alimtalk

studiomate automation
  worktree: /Users/archivepilates/codex-worktrees/studiomate-automation
  branch:   codex/mini/studiomate-automation

docs
  worktree: /Users/archivepilates/codex-worktrees/archive-core-docs
  branch:   codex/mini/archive-core-docs
```

Lane ownership:

- `archive-core-transition`: command coordination, integration review, release readiness, and emergency shared fixes only.
- `archive-core-ui`: `/core` UI, routing, responsive layout, visual states, and operator UX.
- `archive-core-data`: `members`, `member360Cards`, source import logs, data quality issues, read-model rebuilds, and shadow-compare reports.
- `archive-core-functions`: Firebase Functions, contracts, Firestore rules/indexes, affected deploy boundaries, and API surfaces.
- `archive-alimtalk`: Kakao Alimtalk candidates, sends, templates, dedupe, approval flow, and communication logs.
- `studiomate-automation`: StudioMate Excel download/import, Playwright automation, staff scan, memo write queue, and LaunchAgent-facing scripts.
- `archive-core-docs`: Notion drafts, decision docs, handoff summaries, operating rules, and transition checklists.

Cross-lane rules:

- One worktree equals one functional lane.
- Do not mix Alimtalk, StudioMate automation, CORE UI, Functions, and data mirror changes in one commit.
- Any feature thread or subagent must report changed files, behavior change, checks run, skipped checks, and remaining risks back to the main command thread.
- External sends, StudioMate writes, Contacts writes, payment/reservation decisions, and data source switching still require explicit main-thread approval.
