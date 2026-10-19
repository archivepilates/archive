# Holding Delivery Memo

- Lane/worktree: holding-delivery-memo; branch codex/mini/holding-delivery-memo; base origin/main 5e0ad5ac.
- User approved implementation, validation, runtime adoption, scoped Hosting release, commit and push. New delivered notices only; no historical backfill, real test notices or test writes to actual members.
- Main owns canonical delivery/memo policy, writer integration, operating rules and release. Bounded worker owns scripts/tests/holding-delivery-memo.test.mjs only. Independent reviewer is read-only.

## Contract
- Existing native-readback holding dispatcher stamps holding_delivery_memo_v1 plus a small sent-calculation range snapshot only on newly created send records. No global enable/cadence/recipient/duplicate policy changes.
- Provider acceptance remains waiting_delivery. Only matching COMPLETE/4000 delivery atomically marks the outbox ready. Existing receipt reconciliation cannot enroll unmarked historical sends.
- Existing five-minute memo worker reads at most ten ready sends. A transaction revalidates canonical candidate/send/claim, immutable send key, receipt ID, non-test source, identity, template variables, original-period 20% floor and used-range arithmetic; it creates memberMemos and the same-key studiomateMemoWriteJobs together.
- Stable memo ID derives from the original send key. Retries/concurrent projection never reset an existing job, attempts, sync status or timestamps. Partial or conflicting pairs require review, not automatic overwrite.
- Before downstream writing, the worker revalidates the canonical memo, receipt and member link. Writes remain append-only under the shared browser lock; full normalized content plus the unique event marker is required for readback, including retry detection.
- A memo failure cannot requeue, retry or modify the Alimtalk transport/claim. The existing retry limit and failure reporting apply only to the memo. Separate outbox failure reporting is isolated so unrelated memo jobs continue.
- Displayed data is an audit copy of the original sent calculation, not a balance source. Future holding notices still re-read full StudioMate issuance/holding evidence, including cancellations/early releases.
- No new canonical collection, scheduler, Cloud Function, provider POST or bulk member scan. New optional source fields live on existing alimtalkSends; memberMemos remains canonical and StudioMate is the downstream copy.

## Validation
- Node holding and operations-email suites: 758 passed, zero failed/skipped; includes synthetic delivery, pending/unknown/failure, no backfill, identity/date/arithmetic mismatch, atomic rollback, concurrent/repeated enqueue, unchanged done/retry jobs and exact memo readback.
- Review follow-ups: non-self native redirects rejected before projection and write; invalid outbox rows quarantined without altering delivery evidence; transient projection errors stop after three checks; pre-claim writer failures count correctly and deterministic identity changes require operator review. Worker-level query failures use the shared report sender with a stable daily key. Added synthetic regressions for these boundaries.
- Production read-only compound query passed with zero marked ready records before activation; no historical record was enrolled or changed.
- Quarantine is checked again inside the enqueue transaction and cannot be overridden by a stale ready scan. Quarantine alerts use a separately drained durable pending marker and the shared stable-event report sender, so a notification failure does not erase the required follow-up. Source delivery evidence remains unchanged.
- Existing CORE responsive runner: 95 local checks passed at 320/390/768/1440/1920px.
- Syntax and diff checks passed. Affected Functions: zero; no Functions build/deployment required.
- Independent review closed with no remaining findings after the bounded follow-up fixes and their regressions. No actual member notice or memo has been created for testing. Release verification pending.

## Release
- Targets: Mac mini archive-in-runtime on origin/main; existing com.archive.studiomate-memo-write-queue interval remains 300 seconds; CORE Hosting operating rules only (existing shared Hosting mirror deployment contract preserved).
- Production account: archive-codex-operator@archive-pilates.iam.gserviceaccount.com; project archive-pilates.
- Pending: commit/main promotion, runtime fast-forward, Hosting live release/canary/CI and read-only runtime marker/config check. A natural future end-to-end delivery/write is not implied by unit or deployment checks.
