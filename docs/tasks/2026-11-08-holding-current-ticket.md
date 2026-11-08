# Holding current-ticket discovery

- Approval: fix historical same-name false duplicate review, validate without member sends, promote runtime/CORE rules/commit/deploy/push. No manual send, queue reset or re-run for the investigated member.
- Branch: `codex/mini/holding-current-ticket-20261108`.
- Source: raw complete applied member export; Excel is discovery-only. Native member binding, unique ticket card, full issuance/hold history and pretransport reread remain authoritative downstream.
- Change: retain all rows/product counts for coverage; exclude only positively expired historical rows from readback ambiguity counts. Expired rows require valid ordered start/end dates and an end strictly before the KST observation day. Cancellation/refund handling is unchanged. Unknown, current, future and contradictory rows remain ambiguous.
- No schema, discovery/job key, claim/send key, baseline, dispatch policy, schedule, function, IAM or credential changes. Existing review jobs are not edited manually. A fresh normal observation may replace a review job with the same stable key.
- Scope limitation: this patch does not introduce a new numeric native ticket-ID extractor. Existing native current-card uniqueness and immutable issuance/history fingerprints remain unchanged; an ambiguous native page still stops processing.
- Browser: official inventory returned `Local browser use is disabled in Work settings` even after the user enabled it. Native app inventory later recovered; local browser inventory remained empty. This proves a bridge-level block, not its underlying cause. No permission bypass, browser restart, credential access or settings mutation was performed.
- Verification and release evidence: `docs/reports/2026-11-08-holding-current-ticket.html`. Local test success, runtime adoption, Hosting and actual member processing are distinct states.
