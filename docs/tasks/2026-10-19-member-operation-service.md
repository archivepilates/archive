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
- Independent holding review found receipt-recovery gaps: both fixed and regressed through the real existing-attempt wrapper. Final review closed with no remaining blockers. Source quarantine/completed jobs and independently confirmed delivery survive late responses.
- CORE operating rules describe the first holding adapter and source/approval boundaries. Deployment and post-release proof are recorded after actual release below.

## Released And Independently Verified
- Source commit `d51f540293d0bc1c59184ab23bcddc55839fc501` pushed to `codex/mini/member-operation-service` and promoted to `origin/main`. Existing clean main deployment checkout and `archive-in-runtime` fast-forwarded. Deployment guard requires exact origin/main before release, so source promotion preceded deployment.
- Runtime reopened, compiled backend built and 770 holding tests passed there. Existing memo worker still points at that runtime, interval 300 seconds, last exit 0. Holding detection remains the existing hourly job; no reload, second scheduler or manual send run was added.
- Scoped Functions dry-run and deploy succeeded for **only** `functions-alimtalk:getMemberOperationProgress`, not existing senders or other endpoints. Independently described ACTIVE Node 22 revision `getmemberoperationprogress-00001-mit`, memory 256MiB, concurrency 1, max instances 2, no secret bindings.
- Fresh runtime stdio MCP reported nine read-only tools and completed six-stage evidence for the repaired legacy notice in about 1.3 seconds, without browser/provider calls. Candidate/send/event/claim/memo/job records unchanged before/after. Existing target validation fresh MCP still returns the expected not-found result without writes.
- Live callable: unauthenticated 401, existing active owner 200 with exact matching stage output, unsafe ID 400. No new account, role or password changes; temporary tokens remained in memory only.
- Mac mini Codex registered runtime path confirmed via CLI. Its explicit enabled-tools list now includes only the new ninth read-only progress tool; write flags remain false/read-only true. Local config was not committed. Existing cached MCP clients may need reconnecting; no unrelated server/app process was killed.
- Root `deploy:archive-core-live` completed for `archive-pilates-core` and existing `archive-pilates` mirror. Local/live responsive checks each passed 95; release canary matched source SHA d51f540 exactly. Automation HTML, new progress JS/CSS, app JS and operating-rules HTML all returned 200 with exact local SHA-256 equality.
- Independent live-UI worker fetched those exact live bytes and ran the 22-case synthetic-runtime UI suite again at 320/390/768/1440, zero failures/skips. No production auth/data access from this browser fixture; main separately verified the authenticated callable. Browser/pages/context/server closed.
- GitHub Actions main run `39233127308` succeeded for exact source SHA (27 steps, no failed steps), independently re-read by main. Shared boundary/detector edits caused all five build checks; deployment remained the single new endpoint. Nonblocking notices: existing SDK-version/ADC-quota warnings and GitHub ubuntu-latest image transition; no configuration upgrades or unrelated changes performed.
- Natural new-policy sends remain zero at final read-only check; legacy memo stays queued in its outbox and independently synced/done in the actual memo/job records. No synthetic notice was sent and no historical batch backfill occurred. Current holding settings remain live_readback_auto/autoSendEnabled/canonicalSourcePromoted with original v2 template and cutover policy.
- Source test totals: holding 770, shared validator/approved sender/CORE 173, progress backend 13, MCP 266, new UI 22, existing responsive 95 local + 95 live. All five codebases and 98-export ownership checks passed. Syntax, cost guards, catalog, rollback guards and diff checks passed. Optional baseline UI browser mode initially skipped one fixture; explicitly enabled final run passed all 22 with zero skips.
- Task-owned browsers, contexts, fixture servers and stdio children closed; one-off StudioMate worker exited and released its lock. User/production-owned browser state was preserved. No failure email required because production actions succeeded and local findings were fixed within this session.
- Results-only task/report/README follow-up does not change deployed code, assets, configuration or policies, so no additional Hosting/Functions deployment is required.
