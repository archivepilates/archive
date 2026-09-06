# Private Chart Notion Background Projection

Updated: 2026-09-06

## Scope And State

- Implemented in `codex/mini/private-notion-event-sync-20260906`, based on `origin/main` at `951aa7a`.
- Local implementation and regression verification only; not deployed or pushed.
- No production Firestore/Notion writes, real member fixtures, sends, or StudioMate actions during verification.
- Notion remains a read-only general-page projection in the existing instructor/member location, with the existing chart body format.
- Member intake's separate 22:40 Notion schedule is unchanged.

## Data Contract

- Canonical inputs: `privateLessonChartRecords/{recordId}` and its `privateLessonChartRequests/{requestId}`. Current record IDs use request IDs.
- Destination: the existing Notion instructor/member child page, referenced by `notionSync.instructorPageId`.
- Identity: record ID; projection version is the hash of rendered title and body, not timestamps or queue metadata.
- Processing metadata: existing `notionSync` plus an independent `notionProjectionLease` map on the record. Source writers do not own this lease.
- Scan checkpoint: existing `syncStates/privateLessonNotionReconciliation`, containing the next lane and document-ID cursor per lane. No new business-source collection.
- Allowed reader: Notion display/archival review. Sync metadata is used only by the projection/reconciliation workers.
- Forbidden effects: report generation, short-link creation, approvals, Alimtalk, reservation/attendance/round changes, source-content writes, or treating Notion as the operational source.

## Processing

1. Existing APIs commit Firestore source and pending intent without awaiting Notion.
2. Record/request Firestore events wait five seconds, then read current canonical data. This is a coalescing window, not a guaranteed five-second Notion SLA.
3. A transaction acquires a ten-minute per-record lease, longer than the 540-second handler lifetime. Record/request workers and nightly repair share it.
4. Same rendered content is skipped only when no uncertain expired attempt remains. Metadata-only acknowledgments do not loop.
5. Page creation is checkpointed before/after the external request. Unknown creation outcomes are searched using the original title; an unresolved outcome is held instead of creating another page.
6. New body blocks are appended before old blocks are removed. A failed append preserves the old body; partial delete failure can temporarily show both versions until reconciliation succeeds.
7. Completion rechecks lease ownership and the current source version. A concurrent edit retains pending intent and wakes a follow-up. Stale workers cannot acknowledge a later worker's output.
8. At 22:20, pending, failed, and unfiltered full-record lanes alternate. The cursor advances durably before external processing, preventing permanent failures from starving later records. Full-record scans also find old missing statuses and request-only revision changes.
9. A nightly run starts work for up to 450 seconds and visits at most 300 unique records. An in-flight provider operation may extend beyond the scan budget, subject to the 540-second handler timeout. Remaining work resumes on the next run.

## Retry And Cost Boundaries

- Notion requests have a 20-second timeout and per-process pacing. Only explicit 429 rejection is retried, at most twice with a bounded Retry-After wait.
- Other failures retain failed/pending state for nightly repair. Identical event redelivery does not repeatedly call a failing provider.
- Event handlers use minimum zero, maximum one instance, concurrency one each. This does not guarantee integration-wide rate limiting across separate Functions; 429 handling remains necessary.
- The full sweep may take multiple nights for large backlogs. The bounded sweep replaces frequent polling and does not rescan all source documents on every save.
- No claim of measured production latency or cost reduction is made before deployment.

## Verification

- `npm run test:private-flow`: existing 25 flow tests plus 17 projection/reconciliation regressions.
- `tsx --test scripts/tests/private-session-delivery-state.test.ts`: 17 existing delivery-state tests.
- `npm run build:function-codebases`: all five codebases.
- Guards: private-flow contract, data-source policy, function boundaries, GCP cost guards, ARCHIVE CORE hosting, and `git diff --check`.
- Independent read-only review found and prompted fixes for scan starvation, age-out, and A-to-B-interrupted-to-A acknowledgment.
- In-memory tests replace Firestore/provider writes. The changed transaction adapter, real trigger delivery, and Notion provider timing still require scoped live verification after deployment approval.

## Release And Rollback

- Pending targets: `functions-private-chart` and ARCHIVE CORE operating-rules Hosting, using the canonical release/main promotion procedure. Do not deploy another worktree's stale source.
- Before release, rerun guards against latest main; verify the two new exports and existing 22:20 scheduler. No template update or member send is part of this release.
- After release, use an isolated synthetic chart/page to verify save response, provider read-back, source version, lease clearance, retry, and cleanup. Preserve unrelated member data and do not send any test Alimtalk.
- Update CORE's implementation/deployment status only after the corresponding proof exists.
- Rollback should remove the two event handlers explicitly and retain/restore a working nightly processor. Merely redeploying an older handler export set is not proof that event triggers are removed. Never restore old canonical report data to roll back a display-only worker.
