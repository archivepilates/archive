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
  This was the pre-release checkpoint; final completion evidence follows below.

## Live Verification

- First main release: 276dc442. Only functions-social:approveYoutubeReel created;
  Firebase reported successful deployment and GET returned HTTP 200.
- Malformed/missing-token approval rejected with HTTP 403.
- Test email 1a1361e4585d3438 independently re-read from Sent: approval button,
  test-only copy and no-reply-required copy present. No raw tokens in this record.
- Controlled fixture test-live-reel-button-20261014 stayed pending after GET and
  inspector loading. Explicit mobile button click persisted approved/email-button.
- Approved test fixtures are excluded from the production publication query.
  Production approved queue count zero; no new real publication or media upload.
- Responsive live QA at 320, 390, 768, 1440: no horizontal overflow/clipping;
  approve touch target 52.4px, tokens absent from displayed text and cleaned URL.
- Task-owned approval tabs 10/11 closed and viewport reset; user tabs preserved.
- com.archive.youtube-reel-approval installed with 300-second interval. Initial
  scheduled run exited 0; stderr empty. Manual no-op also succeeded.
- Private journal preserves five existing clips and one recorded release; new
  2026-10-14 publication count is zero. Button-background mode recorded separately.
- Initial CI run 38431394250 succeeded. The new 6 JS / 16 Python gate tests were
  added explicitly to CI after its read-only review found they were not invoked.
- New-page fragment reuse reload added; it only reinspects and never auto-approves.
- No production-approved new reel was available. Real unlisted-to-public API path
  remains from the prior verified release; button dispatch retries/caps/matching
  use the offline 16-case fixture rather than publishing an unapproved real reel.

## Final Release Readback

- Release source ea4b1e95 pushed to origin/main and runtime fast-forward aligned.
- Scoped Functions update and hosting:archive-pilates-core deploy completed.
- Live approval endpoint HTTP 200, CSP/no-store and fragment-reuse fix present.
- CORE /rules/ HTTP 200 with button approval and detached background policy.
- CI 38434280356 completed success; added reel guard step passed, not skipped.
- Cron ACTIVE at 09:00 KST, no thread target; local worker interval 300 seconds,
  two scheduled runs exited 0 and error log empty. Production approval queue zero.
- Existing five clips and one publication retained; no new real video published.
- User-owned browser tab retained; all task-owned tabs closed and override reset.
- Deploy required clean main exactly equal to origin/main; scoped source promotion
  and push therefore preceded deploy. This final record is documentation-only.
