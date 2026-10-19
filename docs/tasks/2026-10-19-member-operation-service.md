# Member Operation Service

## Scope
- Dedicated worktree `member-operation-service`, branch `codex/mini/member-operation-service`, base `f0344773`.
- Existing shared target inspector remains a read-only preflight, never authorization. Existing specialized source checks, approvals, exclusions, claims and transport dedupe remain mandatory.
- First execution adapter: holding-notice memo projection only. No new sender, collection, scheduler, duplicate pipeline or mirror.
- Exact-ID progress inspection shared by CORE and MCP separates detection, source observation, provider acceptance, delivery, canonical memo queue and StudioMate memo readback. Stored evidence is never advertised as a fresh StudioMate/provider read.
- Future adapters: membership contract/welcome and survey/report memo handoff; reservation/refund mutations remain out of scope and require separate design/approval.

## Acceptance Memo Policy
- New sends opt into `holding_acceptance_memo_v2`. Existing immediate provider identity/content verification is reused; no wait for terminal delivery and no extra provider request for memo processing.
- Exact message, recipient, template and variables must match before a canonical acceptance marker is recorded atomically on send and claim. Unknown/rejected/terminal-failed outcomes do not make a memo ready.
- Existing five-minute memo worker creates the canonical memo and same-key job atomically. Source/member identity, original 20% floor calculation and full history ranges remain validated.
- Stable memo ID depends on immutable holding send ID, not template/policy/retry date. Existing pairs and completed/retrying jobs are never reset. No historical bulk backfill.
- Memo says `발송 접수`, never claims delivery. Later delivery status stays independent. Memo cannot send/retry an Alimtalk or alter a member/pass/holding/payment/reservation.
- Legacy `holding_delivery_memo_v1` keeps its delivery-only evidence contract. Reconciliation cannot reopen a queued or quarantined memo.

## One-Off Member Completion
- User explicitly requested completion of the pending memo before implementation.
- Existing exact holding notice receipt re-read and reconciled via provider GET only; provider POST count zero.
- One memo pair created 2026-10-19 18:31:42 KST, exact existing worker `--job-id` completed 18:31:58 KST.
- Independently reread canonical memo synced and same job done, attempt 1, matching content hashes. Existing writer requires full normalized content plus immutable marker to be visible after save.
- No notice resend or StudioMate pass/holding change. Task-owned browser closed, shared lock absent. Completed observation heartbeat removed.
- Private one-off script is ignored under artifacts and must not be committed.

## Release
- User explicitly approved runtime adoption, necessary Functions/Hosting release, scoped commit and push in this chat. No real test notices or source member/pass/holding changes.
- Pre-release checks: all 770 holding tests, 173 shared-validator/approved-send/CORE regressions, 13 backend inspector tests, 266 MCP tests and 22 new UI checks passed. Existing responsive suite passed 95 checks at 320/390/768/1440/1920.
- All five TypeScript codebases built; 98 exports have one owner. New callable belongs to functions-alimtalk. Exact new-policy ready/alert production queries passed read-only with existing indexes.
- New progress CLI/fresh stdio MCP read the completed one-off operation and returned six confirmed stages, unchanged canonical documents and nine read-only tools. No browser/provider call from progress lookup.
- Independent holding review found receipt-recovery gaps: both fixed and regressed through the real existing-attempt wrapper. Final review required before release. Source quarantine/completed jobs and independently confirmed delivery survive late responses.
- CORE operating rules describe the first holding adapter and source/approval boundaries. Deployment and post-release proof are recorded after actual release below.
