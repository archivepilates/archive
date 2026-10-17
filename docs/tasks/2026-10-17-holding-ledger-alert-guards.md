# Holding And Provider Ledger Alert Guards

## Scope
- Dedicated worktree: `holding-ledger-alert-guards`; branch: `codex/mini/holding-ledger-alert-guards`.
- Preserve hourly discovery, eligibility, staff exclusions, canonical identity, atomic claims and one-attempt sends.
- No member messages, queue invocation, StudioMate writes, baseline reset or manual resend.
- Operator approved scoped runtime adoption, affected Functions/Hosting release, commit and push.

## Confirmed Causes
- The worker applied the 48-hour creation-age gate before consulting exact existing attempts. Hourly roster rechecks therefore raised stale-registration warnings for a completed holding.
- Receipt reconciliation rewrote successful candidate/send timestamps even when the final delivery was unchanged.
- The provider audit selected Firestore ledgers by mutable `updatedAt`, but SOLAPI selection used provider creation time. Subsequent receipt checks could move the ledger out of its original audit day.

## Implementation
- Fresh native holding readback identifies the same immutable issuance/creation key before the send-age gate.
- Match candidate, send and claim by exact member/recipient/issuance/creation identity. Terminal completion is a no-write no-provider-call duplicate result; pending known receipts are GET-only. Partial or mismatching attempts remain blocked.
- Every new automatic attempt still passes `automaticHoldingEvidence` and the existing claim-time checks, including the unchanged 48-hour gate.
- Receipt reconciliation is transaction-guarded and idempotent; retain existing `sentAt`.
- Provider audit resolves the day's provider message IDs against indexed canonical send references, with bounded legacy group-ID compatibility. No collection-wide rebuild or ledger mutation.
- CORE operating rules record the completion-vs-new-send distinction.

## Verification
- Node holding/source suites: 690 passed. TypeScript holding/safeguards: 243 passed. Provider ledger/email suites: 48 passed. Total 981, none skipped.
- All five Functions codebases built; boundaries: 97 exports. Rollback and canonical-source guards passed. Initial fresh-worktree dependency/build setup failures were resolved before reruns.
- Read-only actual completed-attempt check: duplicate blocked, delivery complete, provider calls 0, writes 0, three ledgers unchanged.
- Read-only audit of the previously flagged day: provider 9 / ledger 9 / missing 0. No notification or member send invoked.
- Local responsive QA: 95 passed at 320/390/768/1440/1920px. Independent review found concurrent receipt and terminal-failure edge cases; both were fixed with regression tests. Independent re-review: both reproductions resolved, 159 targeted tests passed, no remaining scoped blocker.
- Pending: scoped release and live code/config readback.
- Natural hourly outcome will be reported separately from no-send simulation; do not run the production worker manually for verification.
