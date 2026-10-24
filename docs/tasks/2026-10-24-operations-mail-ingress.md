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

Historical initial rollout below is superseded for the Codex schedule by the event handoff verification section at the end.

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

## Gmail event handoff verification

- User requested deleting the 10-minute poll and verifying Gmail event execution plus delivery to the existing CORE command chat. automation-7 deletion returned deleteStatus=deleted; do not recreate it.
- Existing cloud task 6abe630c58648191948928760b8c5158, '아카이브 업무 메일 확인', is active with Gmail new-email trigger. Reused it rather than creating a duplicate. Its broader operator-mail scope is distinct from the metadata ingress allowlist.
- Preserved existing read-only diagnosis, no-secret, no member action, deduplication and official-tool-only handoff instructions. Added an exact, one-message internal test exception and saved it through the official UI.
- Internal test marker ops-mail-e2e-20261024-1120; Gmail accepted one home-to-home message 1a16ba98501595db at 2026-10-24T02:07:13Z (tool observation). Labels UNREAD/SENT/INBOX. No member recipients, operational failure or secret content. No resend or Run now.
- Actual automatic run and target-chat receipt remain pending; do not infer them from active state, accepted email or manual tool calls.
- Cloud Functions/watch/5-minute maintenance, canonical records, member automations and DNS remain unchanged. CORE rules copy is being updated; deployment and verification will be recorded separately.
- Parallel verification spawn was attempted but the existing agent limit prevented creation; main performs scoped verification without interrupting unrelated agents.
- Exact Gmail metadata confirms receipt at 2026-10-24T02:07:14Z (11:07:14 KST), home sender/recipient and INBOX/SENT labels. This supersedes the approximate send-tool observation time.
- Manual, explicitly non-event diagnosis in the existing task reply returned: target cloud automation not found/access denied in that session, including a direct exact-ID lookup; local Codex lookup/delivery tools unavailable. UI still shows active Gmail event task. The manual diagnostic conversation is 6adc1382-4ca0-83ee-8762-fcabd4a38e05; it is not proof of automatic execution or handoff.
- No automatic event-run or CORE handoff receipt has been confirmed. Task-context access and local-tool availability are concrete blockers; do not infer deletion/inactivity from the scoped lookup failure or promise that enabling one setting alone fixes both.
- Mac desktop access is blocked by screen lock. Asked user to unlock for official local-connection inspection; no account/workspace permission changes or bypasses performed.
- Focused checks passed: metadata/triage/core operator tests 104, ingress/policy tests 109, Hosting guards, release rollback guards, diff whitespace, and isolated rules/report responsive screenshots at 320/390/768/1440 (8 combinations). Broader existing full-page mobile overflow is unchanged and outside this copy-only release.
- Rules source 18c4c802 was committed/pushed to the lane and main, then deployed from clean main to archive-pilates and archive-pilates-core Hosting only. Both live rules URLs returned HTTP 200 with exact source match; CORE release.json reports 18c4c80/clean/exactOriginMain. Functions, IAM, member operations and DNS were not deployed/changed.
- Post-deploy section-only responsive QA uses live rules HTML with repository CSS at 320/390/768/1440; 8 rules/report combinations pass. Artifacts are outside Git at /tmp/archive-operations-mail-event-20261024. No production login or member data was used for layout QA.
- Internal operational blocker report Gmail 1a16bb0ccc0d350b was sent once to the operator; it is distinct from the single connection-test mail and is not automatic-event proof. The 10-minute scheduler stays deleted, cloud metadata maintenance remains healthy, and the real automatic handoff is still blocked/unverified pending official local access inspection.
