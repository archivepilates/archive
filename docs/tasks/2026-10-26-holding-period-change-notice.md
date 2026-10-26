# Holding Period Change Notice

- Lane: existing promoted holding-allowance-notice.
- Worktree: `/Users/archivepilates/codex-worktrees/holding-period-change-notice-20261026`.
- Branch: `codex/mini/holding-period-change-notice-20261026`; base `6e50653f`.
- User approved one automatic notice per period change, explicitly requested reuse of the exact existing approved holding v2 template, and approved validation, runtime/CORE adoption, deployment, scoped commit and push.
- State: implementation and offline verification complete; independent final re-review and release pending. No policy activation, new member dispatch or memo write yet.

## Boundaries

- Keep original registration identity, original 48-hour age gate, original sent variables, candidates, sends and claims unchanged. A period-update notice has a distinct action identity and explicit internal purpose.
- Reuse the pinned approved template exactly. Its fixed text says registered, not changed; the user chose this existing status-notice wording. Do not edit the template or claim it is a new change-purpose template.
- Canonical source remains a fresh, complete native StudioMate ticket read. Excel only discovers reads; workLanes/member360 are not dispatch sources.
- Only an original notice with confirmed delivery permits a subsequent update. Never retry accepted or ambiguous attempts.
- Activation is prospective. One exact native change identified by member, issuance, original creation and change fingerprint is the user's one-off preactivation exception. No historical bulk replay.
- Latest saved current/future period only, native change within 48 hours, all predecessors accounted for. Unnotified intermediate changes require review, not sending misleading intermediate periods.
- Keep hourly Excel/holding and existing 300-second memo worker, shared browser lock, exclusions, canonical claims, provider duplicate safeguards and [09:00,23:00) KST window. No manual sync/queue/send run.
- New memo ID per change, append-only StudioMate copy through the existing durable queue. Old memos are immutable.
- No ticket/holding/member/reservation writes, Functions deployment, Firestore rules/index/schema deployment, credential changes or new scheduler.

## Evidence

- Read-only native collector at 2026-10-26T08:16:11.253Z confirmed one saved current period October16-November1: total allowance30, used17, remaining13. Native edit October26 14:48 KST changed the previous October28 end. Original issuance150days, original creation unchanged.
- Exact original stored send/claim shows COMPLETE/4000 and was observed October15. This inspection is stored delivery evidence, not a new provider GET.
- Private evidence and contacts remain outside Git in the owner-only operations/report folders. No contacts, full raw history, message bodies or tokens in Git.
- Related unresolved operations queue was read only; no unrelated queue items were changed.

## Work Ownership

- Main: reconstruction, dispatcher, automatic canonical event validation, actual production activation/release and final judgment.
- Policy subagent: pure stable identity/policy modules and synthetic tests only.
- Memo subagent: existing memo adapter and synthetic change-memo tests only.
- Worker subagent: actual scheduled worker selection integration and synthetic harness only.
- Subagents must not run production writes, provider requests, deploy, commit or push.

## Required Verification

- Exact existing template contract approval GET; source-bound plan, stable change identity and existing original ledger preservation.
- Repeated/concurrent attempts, unknown acceptance, missing/cancelled/changed source, staff exclusions, quiet hours, configuration races, old edits and multiple-change predecessors.
- Existing full holding Node and TypeScript regressions, receipt and memo queue/source roundtrip checks; syntax and diff checks.
- Independent review; origin/main conflict check; scoped commit; main/runtime safe idle fast-forward; CORE Hosting guards/dry-run/deploy/live SHA/canary; affected Functions and CI.
- Policy update only after reviewed code is adopted in an idle runtime; preserve unrelated settings and verify original candidate/send/claim digests.
- Actual natural next-run acceptance/delivery/memo is separate from deployment and read-only verification. Do not claim actual dispatch until exact new canonical/provider evidence exists.

## Validation Before Release

- Node22.23.4 holding/source regressions: 1,553 passed, failures/skips0. New purpose/claim, concurrency, repeated/unknown acceptance, multiple changes, map-order and midnight-resume cases are included.
- TypeScript queue/provider/scheduling/roundtrip/selection:236 passed. Dispatcher/worker focused subset64 passed before the last minute-precision case; counts overlap.
- Existing CORE 320/390/768/1440/1920 responsive check95, rollback guards, Hosting validation, ticket-liability price5, diff and TypeScript transpilation passed.
- SOLAPI GET-only verification at08:21:50Z confirmed exact existing template APPROVED and original message/recipient/variables/ledger COMPLETE4000. Provider completion timestamp was not inferred from this lookup time.
- Read-only live collector08:29:12Z and proposed policy dry-run08:31:10Z confirmed the exact approved current change, total30/used17/remaining13, new action ID distinct from original. No POST, queue run or original record changes.
- Independent review found three boundary defects, fixed before release: direct receipt polling now binds change metadata across records; zero-transport quiet deferrals resume only with full proof and remain pending; neutral source selection permits eligible prospective edits of delivered older registrations without relaxing registration cutover. Additional guard verifies original sent dates before interpreting a minute-precision edit as already included.
- One source read encountered the existing shared browser lock and deferred normally; another dry-run correctly rejected stale evidence. Fresh collection/dry-run then passed. No lock removal, original job reset or retry dispatch.
- Latest origin/main gained unrelated video-share policy commit6eb1d40e. Preserve it and merge before release; no unrelated changes belong to this feature commit.
