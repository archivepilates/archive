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
