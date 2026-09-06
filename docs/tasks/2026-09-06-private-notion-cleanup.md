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
- Page processing metadata also tracks generated block IDs and content hashes. Only unchanged owned blocks are replaced; new manual blocks and manual edits to nested generated content are retained. First migration archives legacy leaves before replacement, including text added after an older archive.
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

- Focused source/rendering/replacement tests: 76 passed, including first-migration partial failure, duplicate delivery, manual nested edits, last-moment edits and server/local ICU time normalization.
- Full function-codebase build, source policy, boundaries, cost guards, private-flow contract and rollback guards passed.
- Release 5d5fb3a: all 24 private-chart Functions updated. Direct record event Function revision syncprivatelessonnotionfromrecord-00005-paj read back ACTIVE; GitHub Actions run 34035480836 succeeded.
- Isolated deployed canary passed all five stages and preserved manual paragraphs, same-title toggles and edited children. Source save 106 ms; Notion first reflection 10.5 s, latest edit/request-only change/recovery 15.2-15.3 s. The first post-deploy attempt exposed a test-fixture error: after adding lessonStartAt, changing lessonDate alone no longer changed the rendered projection. The fixture now changes both date and time; no production sync defect was found. Test documents, page ownership and Notion pages from both attempts were removed/archived after verification.
- Navigation: 20 member parents, 279 older child pages folded with exact child URL preservation. The root was reduced to three current workflow steps; existing sharing settings were retained.
- Maintenance verifier: 64 isolated offline cases passed against the extracted executable verification branch. Source ID sets/hashes, protected bindings, planned new pages, aliases, active/malformed leases, body/title/parent read-back and second-read changes fail closed. Moving a planned older page inside the verified archive toggle is allowed only under its original member page.
- Browser proof: root, member navigation and a recent chart were inspected live. The local HTML report URL was blocked by browser policy, so no workaround or visual-verification claim is made for that report. Task-owned tabs were closed.
- Sharing read-back: the operator confirmed the root publication was disabled. Notion API checks of the root plus 20 member parents found five member pages with individual public_url metadata still present. No permission was changed by maintenance.
- ARCHIVE CORE operating rules were deployed to the custom domain and web.app target. Live responsive verification passed 85 route/viewport combinations and the release canary matched the promoted Git commit.
- During verification, the existing scheduled reservation reconciler legitimately replaced one booking reference. Canonical supersession, member and round equality were verified; unchanged protected fields and exact before/after source hashes were recorded separately without replacing the original baseline. The Notion cleanup did not write the canonical correction.
- The actual server exposed ICU AM/PM output while the Mac mini used Korean day periods. Normalize Notion-only time display, add the regression case, and require Korean time in the deployed canary. Final maintenance verification includes the independently reviewed concurrent source update.
- Production cleanup: 188 bodies refreshed, 272 additional titles corrected, 26 missing chart links created. Independent read-only verification completed at 2026-09-06T13:20:21Z: 484 records and 484 requests, 469 provider titles, 188 provider bodies, nine allowlisted archive-toggle parent moves and one independently reviewed concurrent reservation reference update. Every discrepancy array is empty; no unexpected source/binding changes, stale projections, active leases or owner drift were found.
