# Sequence Mobile Layout

## Scope

- Worktree: /Users/archivepilates/codex-worktrees/sequence-mobile-layout.
- Branch: codex/mini/sequence-mobile-layout; base origin/main 27d09824.
- User screenshot shows manager account controls consuming a left column beside the sequence iframe.
- Live sequence.css confirmed sequence-main was a horizontal flex container. renderManagerAccount prepends its account bar inside that container.
- Fix only sequence layout: vertical flex, full-width nonshrinking account toolbar and flexible iframe consuming remaining height.
- No changes to authentication, owner UID, saved documents, editor, PDF renderer, Functions, Firestore rules or external automation.

## Verification

- Chromium isolated geometry at 320/390/768/1440px reproduced the old side-by-side layout. At 390px the iframe moved from x=91.72 / width=298.28 to x=0 / width=390.
- Geometry report: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/sequence-mobile-geometry-sJiy7Q/report.json.
- WebKit engine unavailable locally; no actual iPhone Safari proof claimed.
- Instructor access unit suite: 224 passed. Hosting source validator: passed.
- Added manager sequence full-app scenarios, including account/iframe alignment, inner overflow, mobile menu open/close, logout and role gates.
- Legacy sequence QA initially timed out because its mock rejected the now-required getCoreAccessSession callable. This was a fixture incompatibility, not evidence of production save failure. The task-owned browser was stopped and runner cleanup executed; new tests must complete before release readiness.
- Full-app synthetic SDK suite: 154/154 passed without retries, including 8 manager sequence scenarios on root and /core surfaces. All 154 contexts, browser, server and fixtures cleaned.
- UI report: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-4qNtaQ/report.json. Visually checked 390px full-app screenshot: account above studio, iframe x=0 / width=390 / height=719.
- Repaired only test fixture to permit the required synthetic getCoreAccessSession manager response while rejecting unknown callables and signed-out sessions. Unique output directory avoids stale PDF evidence.
- Sequence regression rerun: 26/26 passed, no skipped checks; save/new/copy/import/date/delete/tombstone/multiple contexts/UID isolation/image/PDF checks. PDF Korean text and raster checks used this run's newly generated files. Fake SDK only, no real Firestore claim.
- Sequence report: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/archive-core-sequence-cloud-qa-jZurdj/results.json.
- Rerun cleanup: browser disconnected, contexts/subscriptions/open transactions zero, server stopped. No production writes.

## Release

- User approved scoped Hosting commit/deploy/push on 2026-10-11. Implementation, Hosting release and live verification complete.
- Source release: 60d3ec7a290bfc286b8d94492e06bc2a8d73421b. npm run deploy:archive-core-live exited 0 from clean main equal to origin/main.
- Project archive-pilates; service account archive-codex-operator@archive-pilates.iam.gserviceaccount.com; targets hosting:archive-pilates and hosting:archive-pilates-core only.
- Rollback/source guards, Hosting dry-run and local static responsive 95 checks passed. Live static responsive 95 and canary 10 checks passed. These static operator checks do not prove real manager authentication.
- 14 live asset hashes and both release.json source IDs match the deployed source. Live CORE rule includes the mobile alignment record.
- Live synthetic sequence suite: 26/26 passed on https://core.archivepilates.com and 26/26 on https://archive-pilates.web.app/core, no skipped checks. Actual deployed files; isolated Auth/Firestore SDK, no production writes.
- Live reports: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/archive-core-sequence-cloud-qa-jbAOMr/results.json and /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/archive-core-sequence-cloud-qa-21tEKb/results.json. Browser disconnected, contexts/subscriptions/transactions zero, servers stopped.
- Independent anonymous sequence page checks at 390px on both domains: login visible, shell hidden, iframe src absent, no horizontal overflow. Browser and contexts closed. Initial probe used an incorrect test label; corrected to the actual 휴대폰번호 label and both probes passed.
- GitHub ARCHIVE IN Functions Affected Check run 38141978066 succeeded; codebases=[], deployOnly empty, allCodebasesAffected=false. https://github.com/archivepilates/archive/actions/runs/38141978066.
- Completion audit changes docs only; core/ remains byte-identical to the deployed source, so no repeat Hosting release is needed.
- CORE sequence operating rule updated locally with verification and refresh instructions; included in approved Hosting release only.
- Close every task-owned context, browser and test server; preserve user browser state.
