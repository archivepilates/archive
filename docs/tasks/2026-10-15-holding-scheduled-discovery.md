# Holding Scheduled Discovery

## Scope
- Preserve the existing hourly Excel sync and canonical dispatch policy.
- Read-only recent ticket modification hints supplement the held-member roster.
- Future saved holds qualify only with a unique uncancelled native registration and matching saved list.
- Preserve staff exclusions, actual registration cutoff/48-hour limit, canonical claim/send/provider deduplication, original-period proof and incomplete-history blocks.

## Source Policy
- Canonical: fresh StudioMate issue/change history and saved current/future holding periods; approved member identity linkage.
- Provisional hints: existing workLanes/holding-allowance-notice/readbackJobs; never a send source.
- Identity: existing member/product read-job key; dispatch retains issue/hold creation fingerprint.
- No new balance/history mirror, scheduler, baseline reset or manual queue run.
- Date-only Excel modification cannot prove event time. Recheck recent hints on each newer successful import; same import is ignored.
- Missing native identity or duplicate product remains review-only.

## Verification
- Fresh task-owned Excel export: 3,428 rows. Read-only native future-hold verification succeeded with empty current date controls and one exact saved future registration.
- Private proofs remain outside Git in the task's automation report directory; no member details or raw exports committed.
- Node holding tests: 677 passed; TypeScript holding tests: 236 passed. Independent scoped review: 403 passed, no confirmed findings.
- Release rollback guards and canonical data-source validation passed; no affected Functions codebase.
- Runtime adoption and Hosting release are separate from actual Alimtalk delivery.
