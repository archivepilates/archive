# Holding Period Edit Readback

- Date: 2026-10-26; lane: holding-allowance-notice (existing promoted operational lane).
- Worktree: `/Users/archivepilates/codex-worktrees/holding-period-edit-20261026`.
- Branch: `codex/mini/holding-period-edit-20261026`; base `057387e82525950db5bbb799b76730cd03936729`.
- Request: inspect an ongoing hold's changed period and apply the Alimtalk logic.
- Current status: parser fix and offline verification complete; runtime adoption and CORE Hosting pending.

## Evidence And Cause

- Exact native member identity selected in live StudioMate. The read-only full ticket collector completed two matching history/list/control reads at `2026-10-26T05:54:55.743Z`.
- The current hold changed from October 16-28 (13 inclusive days) to October 16-November 1 (17 days). The native edit was recorded October 26 14:48 KST as `수강권정지`, not `수강권정지수정`, with an existing end-date before/after delta.
- The old parser treated every row with that label as a new creation and threw `live_hold_creation_required` because this row has no pair of `내역없음` values.
- Private source remains in the owner-only automation holding-source report directory, outside Git. Do not copy member contacts, source histories or survey access values into the repository/report.
- Canonical stored holding candidate/send/claim indicate the original registration notice is already delivered with COMPLETE/4000; this is stored evidence, not a fresh provider GET. Its sent variables were 13 used / 17 remaining and must not be rewritten as though sent with the changed period.
- At `2026-10-26T06:04:18.327Z`, the latest hourly roster was still from `05:19:32.623Z`, before the native edit. Its existing job was observed with `holding_prior_attempt_no_resend`. No manual collection/import/queue run or production job edit is part of the fix.

## Implementation

- Shared pure `holdingHistoryOperation` classifies real creation, existing-date edit and cancellation. Both explicit edit and mislabeled registration rows follow the same validated date chain.
- Validate duplicate fields, supported holding date fields, partial/mixed creation data, real date deltas and optional companion expiry dates. Original allowance still comes only from issuance, never extended expiry.
- Live reconstruction tracks last history time per holding and rejects equal-time mutation chains instead of guessing DOM order. Distinct pre-start cancellation and new creation can still share a displayed minute because their identities differ.
- Shadow reconciliation uses the same classifier. Original native/UUID identity and creation evidence remain unchanged across edits.
- No changes to dispatch, provider requests, canonical claim IDs, cutover, 48-hour registration-age gate, schedules, settings, baseline, member/ticket/hold/reservation data, or existing memos.

## Verification

- Saved-source replay (not a fresh live check): original contract 150 days; total allowance 30; one current hold 17 days; remaining 13. Original creation identity and October 15 registration time remain unchanged.
- Node MJS holding/source regression: 1,215 passed, zero failures/skips. New period-edit suite: 172 passed on Node 22 (included in the 1,215, not additive).
- TypeScript holding queue/provider/scheduling/roundtrip/selection regressions: 236 passed, zero failures/skips.
- Focused original-plus-new parser/dispatcher subset: 398 passed. Syntax/diff checks and mandatory rollback guards passed. Counts overlap; do not sum them as unique cases.
- Dependency installation initially missing in the isolated worktree caused a local test setup failure; lockfile install resolved it. No dependency/lockfile changes.
- Independent read-only reviewer reran six files, 405/405 passed, with no remaining actionable findings. Explicit-edit first-notice behavior already existed; this fix only normalizes the native mislabeled row, not an additional-notice policy.
- Affected Functions detection for the two runtime modules: none. No Functions, Firestore rules/index/schema deployment needed.
- Required remaining release evidence: independent review, clean origin/main promotion, safe idle runtime fast-forward, fresh read-only native collection using adopted code, unchanged send/claim evidence, existing LaunchAgent intervals, CORE Hosting release and exact public file/manifest checks, CI and final Git state.

## Additional Change Notice Policy

- User was asked separately whether to add one automatic notice per period change after the original notice. Awaiting answer; do not infer approval from this parsing fix.
- The existing approved first-registration path already supports an explicit period edit before its first notice, within the original 48-hour window and all source/claim guards. The fix makes the mislabeled native row equivalent; it does not add a resend key or a new trigger.
- Additional notices after an accepted/delivered original require a separately approved purpose, stable change identity, duplicate handling and suitable approved template. Existing registration text must not be presented as a change-specific template.
- Current member's original delivered notice is preserved. No new member-facing notice or memo is sent/written during verification.
