# 2026-11-02 Operations Health Errors

## Scope And Approval

User approved no-send verification, runtime and CORE rules updates, necessary deployment, commit and push. No member resend, permission change, contract re-request, settlement amount change, baseline reset or schedule change.

Worktree: `/Users/archivepilates/codex-worktrees/ops-health-errors-20261102`; branch: `codex/mini/ops-health-errors-20261102`; base: `0e04cda52f0359118afa1634ffa83b0342a840f7`. Managed worktree creation failed with mmap cancellation against the historical repository; standard Git worktree creation from the active runtime succeeded. Unrelated historical and payroll worktrees remain untouched.

## Observed Sources

- Gmail `1a1997c6c4b586e6`: 08:40 KST health report, five findings; canonical `systemHealthRuns/health_202611020840_quick` and matching local JSON.
- Gmail `1a1987d88740b131`: 04:02 KST staff video transient read failure. Later full scheduled apply independently verified access, with alert-state failure count zero at 08:42 KST. No manual permission action.
- Runtime dirty state was only untracked Python bytecode; tracked source matched origin/main. Preserve the cache and ignore its generated directory, not all untracked files.
- November 1 monthly settlement failed reading the local Drive reference pointer before financial calculation. October review documents exist, but the canonical final index does not. Do not relabel review documents or regenerate payroll under this approval.
- Contract discovery retained three groups after ticket-row coverage decreased. This is a real safety hold, not permission to reset or replay. A separate warning bug omitted a zero-candidate signature recovery approval/hint blocker; surface it without changing selection.
- Exactly three canonical private chart records and linked requests were read: future November 3/5/6 lessons, no submissions or content, no provider page/creation intent, inactive lease, failed missing-folder submission identity guard. Their failure timestamp incorrectly populated syncedAt. No health answers or contact values were exported.

## Repairs

- Ignore generated Python cache only.
- Carry proven transient-read classification and allowlisted failure metadata to the existing staff-video notifier: three consecutive temporary read failures, immediate auth/unknown-write failures, only full-run verified recovery.
- Retry only bounded local transient pointer reads. Reject malformed, conflicting and ambiguous pointers; preserve financial calculations.
- Preserve all contract holds and report concurrent reasons instead of hiding recovery-only holds.
- Missing-parent unsubmitted Notion charts use explicit submission waiting; preserve trusted-parent projection, identity, lease and uncertain-create protection. Failure metadata must not claim a new successful sync. Health distinguishes explicit waiting and uses valid status-aware timestamps.
- Exact incident metadata repair requires a fresh fingerprint, canonical request identity checks, empty content, future lesson, matching known failure, no page/intent/lease, one transaction and independent business-field hash readback. No Notion/provider write is performed by the repair.

## Release Gates

Focused no-network tests; Functions build/boundaries/affected detection; main-thread diff review; clean main equal to fresh origin/main; only affected Functions deployment; current-live CORE manifest clone replacing rules HTML only; independent live readback; runtime fast-forward; CI and final Git status. Do not claim October final settlement or contract reviews complete.

Release and live results are recorded in `docs/reports/2026-11-02-ops-health-errors.html`.

## Follow-Up Verification Blocker

The read-only full health check stalled inside `git status --porcelain` for a historical non-runtime worktree. The task-owned diagnostic and child were interrupted and their PIDs verified absent. Auxiliary worktree inventory now has a 750ms per-command timeout and 5-second total budget; optional Git index locks are disabled and unavailable worktrees are explicitly counted, never reported clean. The operational runtime dirty-source guard is unchanged. A live isolated read returned timeout for that historical checkout and clean for runtime in 819ms. No historical worktree was altered. This is a diagnostic implementation repair, not a change to staff or member rules.

Final normal internal health run `health_202611020909_quick` completed at 09:09 KST in about 19 seconds with no repairs, worker restarts or additional email. Runtime was clean and equal to origin/main. Notion sample coverage was complete: eight aliases, three explicit waiting records, no overdue pending/failed records. Three genuine findings remain: contract coverage review and the failed/missing final October settlement. No financial regeneration or source-hold reset was performed.
