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

- User approved scoped Hosting commit/deploy/push on 2026-10-11. Local implementation and verification complete; release in progress.
- CORE sequence operating rule updated locally with verification and refresh instructions; included in approved Hosting release only.
- Close every task-owned context, browser and test server; preserve user browser state.
