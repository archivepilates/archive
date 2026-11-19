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

Prepared; physical migration and live verification pending. CORE rules and final report will record independently observed completion and any unverified ordinary-run outcomes.
