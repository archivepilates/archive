# Reel Button Approval and Background Separation

- Branch/worktree: codex/mini/reel-button-approval-20261014, based on origin/main.
- Canonical runtime: ~/dev/archive-in-runtime; clean main release worktree:
  ~/codex-worktrees/system-hardening-20260914. Preserve other lanes.
- Source policy, template, original cap and daily cap remain unchanged.
- Existing 2026-10-13 reel 6_O3gietFfA is already public with explicit email approval
  and logged-out full playback proof. Do not re-request or republish it.
- Implemented: fragment-token confirmation page, GET/inspect non-mutating gate,
  exact snapshot binding, transaction-time expiry, one approval per snapshot,
  local worker with intent/readback/daily cap and idempotent completion email.
- Approval replies are historical evidence only. New requests use buttons.
- Implemented LaunchAgent template: five-minute checks, common run lock, separate
  worker lock, no browser/profile manipulation, three-failure deduplicated notice.
- Shared manifest classification conservatively affects all codebases; all five
  built successfully. Actual runtime changes belong only to functions-social.
- Checks passed: TS typecheck, six gate/transaction tests, 38 release guard/email
  regression tests, Python syntax, JS syntax, all-codebase build and boundary check.
- Sixteen offline worker/publisher checks additionally cover strict timestamp
  typing, exact video schema, scope/hash rejection, daily release caps, recovery
  without republishing and confirmation receipt ordering. No network/credentials.
- Existing automation-6 converted in place to detached local cron with the same
  name, every day at 09:00 KST. target_thread_id was cleared; no duplicate task.
  The registered ARCHIVE project is legacy, so its prompt explicitly uses the
  canonical runtime source and forbids edits/deploys in the legacy cwd.
- Deployment approved by operator. Pending: scoped release, live marked-test
  approval, responsive QA, cron conversion, worker installation and final readback.
