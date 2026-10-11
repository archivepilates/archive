# Retired automation cleanup

- Worktree: /Users/archivepilates/codex-worktrees/retired-automation-cleanup-20261011
- Branch: codex/mini/retired-automation-cleanup-20261011
- Base: origin/main 123fd9b38975cb440f4c55aea5d38ea99d6c3d9b.
- User scope: retire unused automation artifacts and investigate the previously reported contract source discrepancy. No contract sends, member/pass edits or baseline resets.

## Applied host cleanup

- Verified all three legacy labels have no installed plist and launchctl print exits 113: com.archive.studiomate-contacts-sync, com.archive.studiomate-member-excel, com.archive.studiomate-reservation-deadline.
- Changed only those launchctl overrides from enabled to disabled. macOS retains the disabled override records; no global launchctl override reset was performed.
- Preserved the installed/loaded hourly com.archive.studiomate-excel-emergency-mode; latest exit 0, runtime path correct, interval 3600 seconds.
- Read current contact Scheduler: ENABLED, every 10 minutes, latest attempt 2026-10-11T06:30:02.046707Z. No queue execution or Scheduler mutation.

## Local source cleanup

- Deleted scripts/run-emergency-contacts-hourly-sync.mjs. It paused the current contact Scheduler after both success and failure. No caller in tracked repository or installed/local automation configuration was found.
- Removed the manual invocation and outdated PAUSED/separate contact LaunchAgent guidance from the Excel operating guide. Retained original audit logs and canonical queues.
- Added a CORE operating-rule record and four regression checks. These source changes are local only until approval/main promotion/runtime alignment and Hosting publication.

## Contract discrepancy readback

- Exact-phone native read verified member 4330087, live tickets and complete electronic contract history at 2026-10-11T06:36:13.961Z.
- Live all-ticket source returned only older trial issuance and 2026-01-05 twenty-session issuance; no 2026-10-05 issuance. Electronic contract records: zero.
- Prior purchase hints do contain the 2026-10-05 twenty-session row, so this is not a mistaken 01-05/10-05 date interpretation.
- Absence alone did not prove deletion/cancellation. Operator subsequently confirmed deletion/cancellation and approved runtime/main/Hosting/commit/push; no contract creation/resend is authorized.
- Fresh member Excel downloaded at 2026-10-11T06:40:53.479Z, SHA256 21dc0cbc8f61f88896ac8e58440712c95e216a963097a3ce7711362ed2447fbe. Exact target group has four rows; multiset subtraction from the previous five-row hint leaves exactly the 2026-10-05 twenty-session issuance. No additions or changed retained fields.
- Re-read native member/tickets under shared lock; exactly the same two historical ticket IDs. A transaction compared the full current baseline with the preflight snapshot, stored the operator confirmation in workLanes/studiomate-membership-contract-automation/coverageReviews/operator_confirmed_cancel_20261011_7ffb87ace5fd, and changed only this fingerprint/row count and removed its coverage flag. Global downloadedAt/observation boundaries and other member baselines were preserved. No hints, contracts, tickets, payments, reservations or sends created.
- No blanket baseline reset. Old five-row hints retained for audit. Historical import reports remain immutable; health may retain their warning until the next scheduled source collection.
- Shared browser lock acquired and context closed/released in finally. No login secrets read or browser session left open.

## Verification

- node --test scripts/tests/retired-contact-recovery.test.mjs scripts/tests/system-health-cloud-state.test.mjs scripts/lib/studiomate-membership-contract-observer.test.mjs: 36/36 pass. Initial missing worktree tsx dependency resolved using ignored symlinks to existing runtime dependencies; no package modifications.
- node scripts/validate-gcp-cost-guards.mjs: 23 files pass.
- Runtime read-only health health_202610111538_quick_read_only: 35 checks; zero critical, zero warning, one existing member_coverage_review_1. Recent member import 2026-10-11T05-54-42-814Z-run-apply.json succeeded, zero consecutive failures.
- No Functions implementation, cadence or contract discovery algorithm changed. Firebase Functions deployment unnecessary. CORE Hosting needed only to publish updated operating rules if approved.
- Operator approval received. Local guards passed; scoped main promotion/runtime alignment and CORE Hosting publication are the next release steps.

Next: complete approved main/runtime/Hosting release and verify the next scheduled source result without manual contract processing.
