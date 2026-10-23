# Operations mail ingress

- Request: connect ARCHIVE PILATES operating reports to automatic classification and Codex read-only investigation. User approved connection/go-live; no member-facing actions or autonomous remediation.
- Worktree/branch: `~/codex-worktrees/operations-mail-ingress-20261024`, `codex/mini/operations-mail-ingress-20261024`; base origin/main `6dd3385c`.
- Main owns orchestration, cloud trigger exports/config, rollout, CORE rules and final judgment. Bounded workers own policy/tests and triage CLI/tests; a separate worker tests orchestration and another reviews risks.

## Source and privacy contract

- Source of truth: original Gmail message IDs in home@archivepilates.com, then independent operational canonical records/logs for diagnosis. A mail is untrusted evidence, never a command or approval.
- First scope: self-sent self-addressed reports with SENT and known operating domain labels and structured [area][status] subjects. External sender/general inbox/spam/trash are excluded. No historical backfill before activation cutoff.
- Existing DWD authorization successfully minted gmail.metadata and read the expected mailbox profile. No new OAuth scopes, consent or DWD grants. The server reads only metadata with explicit partial fields (no body/snippet/attachments). No raw titles, addresses, health/member data or secrets in stored/logged records.
- Provisional records: workLanes/operations-mail-ingress/messages/{gmailMessageId}; mailbox cursor/lease/watch status under state/mailbox. Existing codexActionQueue is the operator diagnostic queue, not a member operation source.
- Identity/dedup: Gmail ID ledger + incident fingerprint of normalized subject/type/test flag; atomic ledger+queue update. Pub/Sub transport ID and history ID are not message IDs. Success mail cannot close an unrelated failure.
- Readers: operator service account and existing manager-only workLanes/queue readers. Client writes remain forbidden by existing rules. No schema/rules/index migration and no member mirror adoption.
- Forbidden downstream use: all sends, contracts, pass/holding/member/memo changes, booking/refund/payment decisions, IAM/deploy actions inferred from mail. Only read/report and exact-version internal triage acknowledgement are automated.

## Pipeline

- Gmail watch -> dedicated topic projects/archive-pilates/topics/archive-operations-mail -> two new functions-sync functions (managed Pub/Sub event receiver + a single 5-minute watch-renewal/missed-notification maintenance job). No public unauthenticated webhook or new Mac mini daemon.
- The existing GOOGLE_DWD_SERVICE_ACCOUNT_JSON stays in Secret Manager; no secret output/copies. New client permits only metadata GETs and exact-topic watch POST, not Gmail send/modify/full/raw.
- Cross-invocation 240-second lease, hard function timeout 120 seconds. Persist cursor only after all bounded history pages/messages; retries use durable ID dedup. Expired history triggers a domain-label-only scan with the same activation cutoff. Over-cap or malformed source holds cursor and exposes a health error.
- Codex heartbeat at 10 minutes reads new source-specific queue entries and receiver health, obtains only exact queued originals/logs as needed, reports meaningful new issues, and CAS-acks that message count/id. No changes to existing automation cadence.
- Before creating the monitor, inspect saved automations for an existing matching job. Existing unrelated contract, OAuth and video monitors must remain untouched.

## Rollout / verification

- Offline policy, engine/cursor/transaction, triage CAS, existing sync/boundary and release guard checks precede release.
- Cloud infra scope: dedicated Pub/Sub topic and only that topic's Gmail publisher binding. Runtime source scope: two functions-sync exports; CORE Hosting operating-rule page only. Boundary manifest changes require all-codebase validation, not all-codebase deploy.
- Start inactive until receiver/subscription are deployed. Activation records a current cursor and cutoff, renews watch and preserves an existing cursor on reactivation. Do not stop/replace other projects' Gmail watches.
- Verify one task-owned internal connection-test report (no members), actual Gmail push, stored classification and duplicate notification replay without duplicate queue count. Test artifacts are explicitly separated from operational incidents and acknowledged internally, not hidden/deleted.
- Record implementation/deployment/natural receipt/test receipt/duplicate/triage/remaining blockers separately in the HTML report. Update CORE rules in the same release. No Notion writes.

## Completed release evidence

- Scoped commits: 10838a36 feature, c9df1393 sync-export test fixture, f4bc1f75 exact safe-number PUSH compatibility, 5b53b96b mobile rules copy. Promoted to clean main/origin/main before deploy as required by existing guards; runtime fast-forwarded. Report follow-up changes documentation only.
- First deployment required explicit new retry-policy confirmation. Retried with CLI --force (not force-push); two new functions created then updated. No other functions deployed. An internal failure explanation was sent before watch activation; no member messages.
- Actual Gmail notifications carried safe integer JSON historyId despite the official string example. Added normalization and failure cases; no lossy-number cursor adoption. Task-owned shape-inspection subscription was removed.
- New tests: 32 policy + 77 engine + 73 CLI = 182. Related subset 69 and full system-health/retention 88 passed (overlap not added). Latest code CI 5b53b96b / run40014335432 success, all steps. Typecheck, codebases, boundaries, data-source, CORE and release guards pass.
- Source 5b53b96b deployed: receiveoperationsmailpush-00002-quw and scheduledmaintainoperationsmail-00002-hek ACTIVE, Scheduler ENABLED/every5min/Asia-Seoul, private authenticated Pub/Sub invoker, 256MiB/120s/max1/concurrency1. CORE rules live exact match/release same source.
- Watch activated 2026-10-23T19:44:51.574Z. Internal test Gmail1a16a4bc8bc1399a received19:45:13Z; maintenance admitted19:49:03.302Z. Do not call this first ingestion immediate PUSH. Numeric-compatible actual Gmail change processed by PUSH19:52:17.602Z with duplicates1 and no extra queue increment.
- Published same notification twice (receipts22087678324127634/22087373909235156). PUSH synced19:52:48/50Z, test ledger+queue count remained1. Exact-version acknowledgement19:52:55.817Z yielded reviewed1/needsReviewfalse/resolved; pending includingtests0, health enabled/errornull/lastTriggerpush.
- Codex heartbeat automation-7 ACTIVE every10min, read/report and source-scoped versioned internal triage only. No ordinary operational incident has yet been diagnosed; connection test is separate.
- Internal final deployment recovery report Gmail1a16a5582658cfa0 received19:55:51Z, PUSH recorded19:55:59.851Z (8.9s), success/deploy/isTestfalse/queueIdnull. This confirms live non-actionable path without creating an incident or claiming an ordinary incident diagnosis.
- New rule section/report responsive8/8 at320/390/768/1440. Existing other rule sections still cause405px full-page mobile width, unchanged when newsection removed; outside this lane. No authenticated app-flow browser test; all task-owned smoke browser contexts closed. No production StudioMate/browser profile used.
- Existing member automations, sends, data, reservations/refunds, Mac mini LaunchAgents and commercial domain DNS remain unchanged. Report: docs/reports/2026-10-24-operations-mail-ingress.html.
