# ARCHIVE PILATES Reservation Mirror Retirement

## Approval And Scope

The operator requested a current-use check, followed by deletion and service
shutdown only if unused. Exact resources: Firestore `reservation-mirror`,
Cloud Run `archive-reservation-mirror` in `asia-northeast3`, and dedicated
Hosting site `archive-pilates-booking-test`. Preserve `(default)`, shared Auth,
CORE/ARCHIVE IN, official sales website and all operational automations.

Sources remain as historical development material, not an active service.
Do not recreate/import/redeploy this lane without new approval.

## Current-Use Verification

At 2026-10-28 19:26 KST, seven-day Cloud Monitoring and paginated Cloud Run
request-log queries completed without pagination gaps or API errors. Last
successful authenticated data request: 2026-10-24 11:59:25 KST. Last nonzero
hourly read bucket ended October 24 12:26 KST; last write bucket October 23
22:26 KST. Later requests included public configuration and rejected access,
not successful member-data reads. No successful data request was found during
the final 72-hour pre-write recheck. Logs establish service requests, not human
identity or intent; telemetry may have ingestion delay.

Cloud Scheduler: 22 Seoul jobs, zero in Tokyo and Iowa; no matching target.
No matching readable local LaunchAgent/Daemon was found. Three unrelated
system plists were unreadable; this is not a forensic proof of every local
process. No mirror database backup schedule existed. Read-only source audit
found no production writer or GitHub scheduling dependency on the mirror.

## Execution

Private intent/receipt evidence:
`/Users/archivepilates/ArchiveIN/operations/reservation-mirror-retirement-20261028/`.
Contains aggregate audit, metadata plan and exact operation receipts, not member
payloads or credentials. Uses the existing operator account; no role increase.
The dedicated Hosting release is `SITE_DISABLE`; both test hostnames return
404. The dedicated Cloud Run service returns 404 after its delete operation
completed. The mirror database returns 404 and is absent from active database
listing. A separate `showDeleted=true` metadata query matched the original
database UID and creation time and verified native `deleteTime` of
2026-10-28T10:31:06.381603Z (19:31:06 KST). Only `(default)` remains active.

The bounded database long-running-operation wait did not receive its terminal
done flag. This does not replace the independent deleted-state evidence above;
physical provider cleanup completion remains unconfirmed. The delete request
was not replayed. Preserve both the wait result and native deleteTime evidence.

Operating database identity/configuration matched the pre-write baseline.
Official sales homepage, CORE and ARCHIVE IN each return HTTP 200. CORE and
ARCHIVE IN Hosting releases changed concurrently under another work stream;
this task did not publish those releases. The latest `origin/main` was fetched
and adopted, and its CORE rules bytes matched the live rules before editing.
Do not claim globally unchanged Hosting versions across concurrent work.

No DNS, shared Auth, IAM, operational Functions, member records or scheduler
was changed. Dedicated service account, old deployment images, Hosting site
ownership and source history remain. No new copy of member data was made.

## Checks And Operating Rules

`node --test apps/reservation-mirror/test/release-hosting.test.mjs`: 20 passed.
`npm run detect:affected-functions -- --base origin/main --head HEAD`: no
Functions codebases affected. `npm run validate:archive-core-hosting` passed
with `NODE_PATH` pointing to the runtime Functions dependencies; the fresh
worktree initially lacked TypeScript. No dependency/source files were changed.
`git diff --check` passed. Standalone report layout was checked at 320, 390,
768 and 1440 pixels with no horizontal document overflow. Task-owned headless
browser contexts were closed. No live login, message, reservation or full
Functions build was needed for this documentation-only release.
The existing release helper allows only the CORE rules file while preserving
the full current Hosting manifest/config; it must run from clean exact-main
source. CORE rules retirement text and final release evidence are scoped to
that surface only. No operational Functions deployment is required.

No member notification or source-data mutation is part of this task.

## Final CORE Rules Release

Published at 2026-10-28 19:44:21 KST from clean exact-main source
`43cb3d1f08a43744e4e02aef6d8e267af6e8755d`. Release:
`sites/archive-pilates-core/releases/1793184261560000`.
Only `/rules/index.html` changed; all other 62 Hosting files and the complete
live Hosting configuration were preserved. Public `https://core.archivepilates.com/rules/`
returned 200 and exactly matched source SHA-256
`ff32a327fb6d3968b33446afd9e42baa37b400018a52f72a9049a4b51b339dde`.
The following receipt-only documentation update does not require another
Hosting or Functions deployment.
