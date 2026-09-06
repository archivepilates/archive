# Private Notion Cleanup

## Scope

- Preserve canonical bookings, requests, instructor answers, report approvals and sends.
- Clean private-chart navigation, stale titles, empty fields and legacy layout.
- Keep legacy body/answers in a collapsed history toggle; preserve nested manual content, attachments and child pages.
- Resolve ten verified shared page bindings using one explicit page writer and retained aliases.
- Reuse the existing archived member page where identity is proven; connect five missing member pages.

## Display Metadata Contract

- Source: privateLessonChartRecords and privateLessonChartRequests.
- Page identity: normalized Notion UUID in syncStates/privateNotionPage_{uuid}; ownerRecordId is permanent unless explicitly reviewed.
- Per-record notionProjectionControl stores an alias writer exclusion, verified member-page parent, or display-only review reason.
- Allowed readers: Notion event projection, nightly repair and scoped maintenance.
- Forbidden effects: message targeting, sends, reservation/attendance changes, report generation, approvals, member source merging.
- Alias records and their original answers remain intact; ambiguous mappings fail closed.

## Runbook

Use the existing archive-pilates operator service account. Set PRIVATE_NOTION_CLEANUP_DIR to a private directory outside Git.

1. Run scripts/cleanup-private-notion-pages.mjs without flags for the read-only inventory.
2. Run --snapshot. Require the completion marker and recursive block backup.
3. Deploy the scoped Notion ownership/presentation protection before maintenance.
4. Run --apply-notion-cleanup --prepare to establish verified aliases and member parents.
5. Run --apply-notion-cleanup --refresh --limit=2; inspect provider title/body and unchanged source hashes.
6. Run remaining --refresh and --titles phases. Do not run concurrent maintenance processes.
7. Run --verify in a separate read-only invocation; review any discrepancy before calling the cleanup complete.

Unexpected or uncertain page creation is not automatically repeated. Maintenance uses the same independent record lease as the event/night workers. No StudioMate browser or Alimtalk send is used.

## Verification

- Focused source/rendering tests: 60 passed before release.
- Full function-codebase build, source policy, boundaries, cost guards, private-flow contract and rollback guards passed.
- Production cleanup and provider read-back: pending at code commit; final outcome is recorded in the cleanup report and CORE operating rules.
