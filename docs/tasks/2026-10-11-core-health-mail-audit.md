# CORE health and operations email audit

## Scope
- Holiday/weekend preceding-day 21:00 cancellation applies only to ordinary group lessons. Private and instructor lessons are excluded; no StudioMate lesson settings were changed.
- Audit current CORE surfaces and Mac mini automation; standardize operational notifications without changing recipients, monetary rules, send thresholds, or member-facing deduplication.
- Dedicated branch: codex/mini/core-health-mail-audit-20261011, based on origin/main df3e9052.

## Evidence
- home@archivepilates.com Gmail: current daily health notification, referral failure and subsequent recovery reviewed. Bodies still called the active operation ARCHIVE IN; health subject emphasized zero repairs rather than the one actionable finding.
- Read-only health health_202610111214_quick_read_only: 34 checks, zero critical/warning findings, one member_coverage_review_1. Latest source 2026-10-11T02-48-05-874Z-run-apply.json retains the affected member baseline; other new-member discovery continues.
- 15 installed/loaded ARCHIVE jobs, 13 periodic last exit codes zero, two persistent MCP services running. Retired onsite intake and Hohoyoga workers absent/unloaded. No exact duplicate commands or runtime-path mismatch confirmed.
- CORE public shells: 15 routes and three active member/teacher/legacy-contract routes all HTTP 200 with expected markers. Public shell success does not prove authenticated workflows.

## Implemented
- Report subjects expose actual issue counts. System failures and recoveries include context, outcome, KST time, source cause, impact, verification, caution, next action and detail links.
- Both mail transports use ARCHIVE CORE identity and matching quiet single-column default HTML plus plain text, domain/status labels. Preserve supplied approval HTML and actual member-facing in-domain links.
- Post-send Gmail label errors do not invalidate confirmed delivery. Stable existing reconciliation keys remain unchanged.
- Holding review mail IDs were prefixed strings rejected by the 64-hex sender contract. Use namespaced SHA-256 hashes; receipt review order is normalized. No member holding/Alimtalk resends were performed.
- Public health probes require 2xx and page-specific markers with a 15-second timeout. Retired operator root is excluded. Weekly permission verifier now defaults to CORE without changing identity/claims or persisted auth state.
- CORE operating rules and legacy contract clarification updated; private cancellation discrepancy remains unresolved and unchanged.

## Verification
- Final combined system-health/retention, notification, Imweb classification/referral, report-format and Cloud transport test run: 170/170 passing.
- Cloud mail transport subset: 18/18 passing. Functions typecheck and CORE Hosting/catalog validation passed.
- Local CORE fixture: 95 viewport/route combinations, zero pageerror. Expanded cancellation rule at 320/390/768/1440px: no overflow/clipping.
- Local email preview at 320/390/768/1440px: 16px text, no horizontal overflow, link retained; no actual mail sent.
- Browser contexts and local QA server closed by the verification harnesses.

## Remaining Review / Rollout
- The single contract coverage discrepancy needs native source reconciliation; do not reset its baseline or resend contracts to silence the alert.
- Three enabled launchctl overrides have no installed/loaded worker: studiomate-contacts-sync, studiomate-member-excel, studiomate-reservation-deadline. Establish replacement/retirement ownership before removing overrides or restoring services.
- Settlement cumulative stderr contains historical errors although latest month succeeded. Recommend timestamped run-scoped failure/recovery evidence; current failure not established.
- Weekly authenticated verifier and actual mail-client delivery/rendering were not executed in this read-only audit.
- User approved scoped runtime rollout, affected deployment, commit and push. No member sends, contract resends or reservation changes are included. Source/runtime/Functions and Hosting rollout completed; final operating-rule and release-manifest alignment is recorded below.

## Release Evidence
- Functional source 235af444d3992bf6fef76456d46ec8a9311632ef promoted to origin/main by fast-forward; no force push. Final Hosting and CORE operating-rule source is 8adaffb2430aa56b1e1ac067f692e4ac3da5471e; clean main deployment checkout and archive-in-runtime match the promoted source. Subsequent evidence-only documentation commits do not require a Functions or Hosting redeploy.
- Hosting archive-pilates and archive-pilates-core deployed; CORE canary matched source 235af444, 95 local and 95 live fixture viewport/route checks passed. These fixtures do not prove authenticated business workflows.
- GitHub affected-functions run 38110912743 succeeded, including all-codebase builds, boundaries, data-source and live rollback guards.
- All four affected Functions dry-runs and deployments passed: alimtalk 13, app 43, private-chart 24, sync 8 successful updates. Metadata readback confirms 94 ACTIVE, 88 updated, all six social records unchanged. All 21 Scheduler records ENABLED; names, schedules and time zones unchanged across rollout.
- Runtime read-only recheck health_202610111314_quick_read_only: 35 checks, 18 public shells HTTP 200 with matching markers, zero critical/warning, one pre-existing member_coverage_review_1. Latest source 2026-10-11T03-49-50-849Z-run-apply.json. No state persistence, repairs, emails or member actions executed.
- getCoreAccessSession and getCoreInstructorWorkspace reject anonymous calls with HTTP 401/UNAUTHENTICATED. No custom token or authenticated session was created for these probes.
- Additional Hosting archive-pilates-in deployment was required: memberSignup is a static page on its separate site, not the contract API response. Both custom-domain and web.app path contain the ordinary-group-only/exclusion text. The first extra-site canary detected a stale web.app archivein release manifest (not stale contract copy). Regenerated both manifests and published all three affected Hosting sites together: final archivein + CORE canary passed at 8adaffb2, all four release JSON addresses matched, and another 95 live viewport/route combinations passed. No Firestore rules or retired intake reactivation was included.
- Final read-only health health_202610111325_quick_read_only: 35 checks, zero critical/warning, one pre-existing contract coverage review. Source state was not persisted or changed.
- Evidence: /tmp/core-health-mail-functions-dry-20261011.log, /tmp/core-health-mail-functions-deploy-20261011.log, /tmp/core-health-mail-final-hosting-20261011.log, /tmp/core-health-mail-functions-after-20261011.json and /tmp/core-health-mail-final-health-20261011.json. QA browser contexts/servers close in finally; no task-owned user browser was left open. Actual email delivery/rendering and authenticated business workflows remain deliberately unexecuted.
