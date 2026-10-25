# Staff Video Lock Deferral

- Branch: `codex/mini/staff-video-lock-deferral-20261025`.
- Worktree: `/Users/archivepilates/codex-worktrees/staff-video-lock-deferral-20261025`.
- Base: `origin/main` (`b7e70384` at start).
- Before promotion, rebased onto `9aaf7a8c` to preserve the concurrent A/B lesson-share recovery release; both reviewed live CORE hashes matched that refreshed baseline.
- Request: improve misleading staff-video failure alerts caused by shared Imweb member-group work-lock contention.
- Scope: lock-acquisition error translation, runner health classification, bounded lock-delay observation, focused regression tests, existing CORE operating-rule note.
- No member permission policy, entitlement ledger, execution interval, force-unlock, provider retry, scheduler, IAM, Functions or DNS changes.

## Implementation

- Only the pre-work member-group lock maps `STUDIOMATE_BROWSER_BUSY` to `IMWEB_MEMBER_GROUPS_BUSY` with `phase=lock_acquisition`.
- A deferred run returns `ok=false`, `status=deferred`, `skipped=true`, exit 0, and records its wait without claiming success/recovery or incrementing real failures.
- Preserve previous failure counters, pending/acknowledged notice identity, and full-success timestamp.
- After 30 minutes of continuous recorded lock deferral, retain non-completion and send one deduplicated operator attention notice; subsequent repeats follow the existing daily notification throttle. No source/provider work has begun in this run.
- Only a completed full apply can clear the alert; targeted/dry-run results cannot recover the full job. Invalid/skipped/incomplete returned results are failures.
- Full-job health-state persistence failure remains nonzero; authentication, ambiguous writes, source/ledger failures and health-lock contention are not converted to deferred success.

## Verification

- Tests use temporary directories, synthetic data, mock notification receipts and a real temporary held lock. No real member, Imweb request, email or queue execution.
- Final expanded suite: 215 passed, 0 failed/skipped (runner, notification subject/label routing, STAFF permissions, student-share preservation, CORE release guards and shared lock).
- Independent review found two boundaries and both were fixed/retested: escalation preserves an original real failure notice identity, and execution timestamps reject late success/failure observations. Independent focused rerun: 41 passed.
- `node --check` passed for the runner and notification module; `git diff --check` passed. A source comparison confirmed only the existing staff-video CORE note changed, with every other rule preserved.
- Existing `core/rules/index.html#imweb-staff-video-policy` updated locally with implementation/verification/pending-release distinction.

## Release Boundary

- User approved the scoped commit/runtime adoption/CORE Hosting deployment/push in call_605c41cdf45e41bd82ea41df6484b0e5.
- Released behavior commit: `b720ab02201e15d9dfa5f668071513e2937301cd` on `main`; runtime adopted by fast-forward. No production state repair, forced job, or artificial recovery email.
- CORE release uses a pinned reviewed live baseline and replaces only the tracked staff-video note in both Hosting manifests, preserving independently deployed content and config. Main and origin/main must match before apply.
- After approval: review diff, scoped checks and commit; promote safely against latest `origin/main`; runtime code adoption and only the existing staff-video CORE rule note via the project release workflow; live readback and natural-run verification; push and clean-status report.

## Release Evidence

- Hosting main-site version `0b17f4a91bbe9f30`, CORE-site version `b6bdc7b3cb046313`; each preserved manifest/config except one rules asset. Local private receipts: `imweb-staff-video/lock-policy-hosting-{site}.json`.
- Both public rules surfaces returned 200 with reviewed output SHA-256 `3fd278464676146ec04f81a7ec94275f403a46acf46587746b897c2c8943edb4` and one staff-policy note.
- First natural run after runtime adoption: `2026-10-25T05:03:51.938Z`, apply/ok true/exitCode 0, health success with zero failures, two unchanged outcomes. Existing LaunchAgent interval remains 300 seconds.
- Functions affected detection: no codebases; no Functions, rules/index, IAM or DNS changes.
- New busy/stall notifications were tested with synthetic mail receipts, not forced production contention. Natural success is not proof that old unrelated permission exceptions are resolved.
