# Holding Period Change Notice

- Lane: existing promoted holding-allowance-notice.
- Worktree: `/Users/archivepilates/codex-worktrees/holding-period-change-notice-20261026`.
- Branch: `codex/mini/holding-period-change-notice-20261026`; base `6e50653f`.
- User approved one automatic notice per period change, explicitly requested reuse of the exact existing approved holding v2 template, and approved validation, runtime/CORE adoption, deployment, scoped commit and push.
- State: reviewed code promoted and deployed as38b9f1f3; runtime adopted while both workers idle. Policy activated20:44:04KST with saved configuration and original-ledger preservation readback. No manual member dispatch or memo write. Natural next-run delivery/memo verification remains pending.

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

- Node22.23.4 holding/source regressions: 1,554 passed, failures/skips0. New purpose/claim, concurrency, repeated/unknown acceptance, multiple changes, map-order and midnight-resume cases are included.
- TypeScript queue/provider/scheduling/roundtrip/selection:236 passed. Dispatcher/worker focused subset64 passed before the last minute-precision case; counts overlap.
- Existing CORE 320/390/768/1440/1920 responsive check95, rollback guards, Hosting validation, ticket-liability price5, diff and TypeScript transpilation passed.
- SOLAPI GET-only verification at08:21:50Z confirmed exact existing template APPROVED and original message/recipient/variables/ledger COMPLETE4000. Provider completion timestamp was not inferred from this lookup time.
- Read-only live collector08:29:12Z and proposed policy dry-run08:31:10Z confirmed the exact approved current change, total30/used17/remaining13, new action ID distinct from original. No POST, queue run or original record changes.
- Independent review found three boundary defects, fixed before release: direct receipt polling now binds change metadata across records; zero-transport quiet deferrals resume only with full proof and remain pending; neutral source selection permits eligible prospective edits of delivered older registrations without relaxing registration cutover. Additional guard verifies original sent dates before interpreting a minute-precision edit as already included.
- Follow-up review extended those fixes through the post-promotion worker recheck and immediate post-acceptance transaction, not just the selection helper and later receipt poller. Immediate candidate/claim mutation after mock POST cannot make a memo ready; two zero-POST reconciliation passes still permit one safe resume.
- One source read encountered the existing shared browser lock and deferred normally; another dry-run correctly rejected stale evidence. Fresh collection/dry-run then passed. No lock removal, original job reset or retry dispatch.
- Latest origin/main gained unrelated video-share policy commit6eb1d40e. Preserve it and merge before release; no unrelated changes belong to this feature commit.

## Repeated Holding Review Mail Follow-Up

- Exact latest Gmail messages and the scheduled run confirm two ended-holding discoveries and one genuine allowance overage, not three provider send failures.
- Live read-only native ticket/history verification at11:37:57Z-11:38:00Z: a retrospective Oct17-25 hold is finished; another hold shortened from Oct31 to Oct25 is finished; a separate current Oct26-31 hold makes total used28 against allowance24, overage4. No ticket, holding, reservation, message or memo changes.
- The worker treated finished ticket-change discoveries as missing-current-controls review. Restrict the new no-send exclusion to ticket_changed, full fresh native calculation, no current controls and no noncancelled current/future period. Missing or inconsistent evidence still fails closed.
- Existing report dedupe relied on Gmail RFC message IDs; received headers contain provider-generated IDs and identical reviews repeated despite stable job/reason identities. Add an internal-only durable reviewAlerts claim under the existing lane, binding job/reason/native observation independently of import time. Claim before the mail child; mark sent only with explicit confirmed message ID. Ambiguous attempts stay claimed and cannot replay. These records never authorize member-facing actions.
- The user asked to investigate continued emails. This scoped follow-up preserves the already-approved holding release, original allowance/duplicate guards and natural schedules. No manual queue/sync/send, override or allowance extension.

## Release Receipt

- Code commits9b1d3fbb/70ebdca, main integration38b9f1f3730c6fccd8fcc4274de831e994ec78cd. Newer unrelated origin/main sale-opening/video-notice rules preserved through clean merge; no unrelated local work included.
- Latest Node22 holding suite1,560 passed0failed/skipped; TypeScript236 passed. Independent final dispatcher review743 focused tests, follow-up notification review139 overlapping tests, no actionable findings. Syntax/diff, rollback, hosting, price5 and local/live responsive95 checks passed.
- Hosting dry-run and deploy succeeded forarchive-pilates/archive-pilates-core only. Live rules marker and release.json exact38b9f1f3 verified atcore.archivepilates.com; ARCHIVE IN retired entry remainsHTTP200. No Functions/rules/index deployment.
- Runtime fast-forward performed with no StudioMate/memo worker PID and no shared browser lock. LaunchAgent intervals unchanged3600/300seconds; no manual invocation or restart.
- SOLAPI GET20:43:33KST rechecked original receipt COMPLETE4000 and exact unchangedAPPROVEDtemplate. Fresh native20:43:34KST, configuration dry-run20:44:02KST, activation20:44:04KST. One exact approved preactivation change; all other historical changes excluded.
- The settings update and internal activation audit are the only direct production mutations. Original event/candidate/send/claim hashes unchanged. ProviderPOST0, manualqueue0, member/ticket/holding/reservationwrites0. Existing memo queue untouched.
- Feature branch pushed after live verification. Release/main/runtime were clean. Task-owned native collector and responsive browsers closed; shared lock absent.
- GitHub Actions40317153233 for deployed code38b9f1f3 completed successfully. The Ubuntu runner migration notice is informational, not a failed check. This closeout changes only task/report documentation and does not require another Hosting release.
- Actual next scheduled exclusion/report suppression and new change notice delivery/memo are not yet verified; deployment is not proof of those stages. Existing unresolved allowance overage remains blocked. Dependency audit warnings were not changed.
