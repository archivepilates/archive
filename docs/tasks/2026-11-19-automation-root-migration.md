# Automation Root Migration

## Approved Scope

Rename the real `/Users/archivepilates/ArchiveIN` directory to `/Users/archivepilates/archive-automation`, retain the exact old path as a compatibility symlink, and update automation connections without changing schedules, approvals, credentials, member actions or canonical ledgers.

## Implementation

- `archive-automation-paths.mjs` selects the existing legacy real directory before migration and the new real directory after migration. Only the exact owned root alias is normalized. Nested symlink and private-file checks remain in force.
- Active Mac mini entrypoints and their shared path defaults use this resolver. Environment overrides remain authoritative. Private referral configuration is normalized in memory; its stored contents and existing SQLite ledgers are not rewritten.
- The native macOS `RENAME_SWAP` helper exchanges the real directory and a prevalidated symlink atomically. No missing legacy path, copy, split lock tree or database recreation is introduced. Open descriptors retain their original inodes.
- The one-time migration tool backs up installed plist bytes privately, preserves schedules/flags and changes exact root path values only. It does not bootstrap, bootout, kickstart or manually invoke production workers. Loaded jobs may retain their prior textual paths until normal reload, through the compatibility alias.
- Historical executors, manifests, existing member URLs, IDs, private config contents and audit records are retained. New work uses the canonical physical root. Do not replace the compatibility alias with another real directory.

## Verification

Synthetic tests cover both root states, conflicting/unsafe roots, native atomic swap, open-file continuity, identical old/new lock exclusion, structured plist preservation, nested symlink rejection and retained old source-file paths. Existing strict identity, native follow-up and referral-runner regression tests run without provider dispatch.

Before physical migration, the compatible source must be promoted to main and fast-forwarded into the active runtime. Private migration plan/result and plist backups remain in the migrated operations directory. Physical identity checks, loaded job checks, read-only credential/config checks and next ordinary-run evidence are reported separately from implementation and Hosting deployment. No member-send or manual queue execution is part of validation.

## Status

Physical migration verified at 2026-11-19 16:06 KST. The legacy alias and all 16 protected path identities were preserved; 16 installed LaunchAgents matched the exact structured path rewrite, with unchanged schedules/flags and no forced restarts. All loaded jobs remained present and the long-lived climate receiver retained PID 1508. Referral configuration, the pinned identity registry and SMS configuration were readable after migration. The same service account performed a read-only Firestore request successfully (HTTP 200). No manual queue run, member send or secret-content change occurred.

Validation groups passed: 1,209 contract/strict-consumer/climate tests; 354 source/notification/lock/retention/worker tests; 1,093 communication/cancellation tests; 105 system-health tests. Groups overlap and are not a unique-test total. Native root tests also ran on macOS, including open-descriptor continuity and cross-alias exclusion. CORE Hosting publication, CI completion and ordinary scheduled execution observations are recorded in the final HTML report; path/configuration checks alone are not proof of a new external business transaction.

CORE Hosting deployed from clean main `52ff2438`; exact rules bytes and release metadata matched both `core.archivepilates.com` and `archive-pilates-core.web.app`. `b95d66a4` changes a portable test fixture only. Final Functions CI run `44477608671` and CORE MCP run `44477329424` succeeded. Root/configuration rechecks remained valid; the referral, refund agreement, refund SMS and staff-video ordinary runs reported success, and share expiry reported not due without an error. Long-period/hourly jobs were not forced. Layout-only checks passed at 320/390/768/1440px; task-owned browsers closed. Global host instructions were backed up privately and updated; no credentials, operational originals or logs were deleted.
