# ARCHIVE PILATES Cloud Cost Efficiency

## Scope

User approved implementation, production deployment, scoped commit and push.

- Preserve Alimtalk, contact, parking and private survey ten-minute cadence.
- Preserve member/booking canonical sources, cancellation reconciliation, backup and PITR.
- Remove only already-paused scheduledProcessWriteQueue, scheduledSyncDashboardDaily and scheduledAttendanceReminder. Preserve historical queues and manual entrypoints.
- Narrow only independently traced function secret bindings. Do not destroy secrets.
- Avoid redundant booking reads when there are no active lecture IDs; retain full reservation-window verification.
- Query due social jobs before limiting, recheck lease at claim time, and retain ambiguous-publish manual review.

## Survey Checkpoint Contract

- Source: existing Google survey spreadsheet and sheet.
- Optimization metadata: syncStates/privateSurveySheet_<stable hash of spreadsheet ID and sheet name>.
- Identity: exact spreadsheet and sheet, with pre-read Drive version.
- Duplicate policy: existing sheet response ID/status handling is unchanged.
- Reader/writer: syncPrivateSurveyResponsesFromSheet only.
- Forbidden use: recipient selection, member identity, attendance, booking or payment decisions.
- A fresh identical revision skips the body. Missing/changed metadata, read errors or age of 24 hours forces a full scan. Invalid/incomplete processing cannot advance the checkpoint. Writes to the sheet change its version and cause a subsequent rescan.

## Rollout

1. Focused and regression tests, all codebase builds, CORE responsive checks.
2. Create only two socialPublishJobs indexes, wait for READY before new query deployment. Never remove unrelated live indexes.
3. Scoped commit, guarded main promotion, deploy affected sync/private-chart/app/social codebases and CORE Hosting. Alimtalk source is unchanged.
4. Verify removed jobs by 404, remaining schedules, ACTIVE functions, exact secret metadata, index/query readiness and live CORE rules. Do not manually run queues or send messages.
5. Fast-forward the clean Mac mini runtime for importer and health-check changes.

## Evidence

Results: docs/reports/2026-09-27-cloud-cost-efficiency.html.
The booking patch is a small proven saving, not attribution of all Firestore growth. Empty social queries still incur minimum reads; due queries prevent future jobs from crowding out executable work. Secret binding reduction does not reduce stored secret-version charges. Actual post-release savings require equal-window usage comparison.
