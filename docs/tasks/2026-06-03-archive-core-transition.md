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

## Handoff Rule

Subthreads should be instructed by lane, not repeated long context:

```txt
archive-core-transition 워크라인 기준으로 [담당 파트]만 진행해줘.
```
