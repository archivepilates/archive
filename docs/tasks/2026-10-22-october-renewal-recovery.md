# October renewal contract recovery

## Approved Scope

- User requested eligibility hardening, October regular renewals, and one Kim operator test before recovery.
- Existing native member/pass/payment records are read-only. Only new contract creation, approved center seal, and signature requests are written.
- No member signature, pre-agreed terms, pass restoration, payment, welcome resend, or broad scheduled backfill.
- Lee Ji-min and Ju Hyeon-ji are explicitly held by the user until required native profile fields are available.
- After the test and seven real requests were accepted at 01:55 KST, the user confirmed the test opens correctly and instructed genuine sends only after 09:00 KST. No additional sends are permitted before 09:00; the seven accepted requests are never replayed. There are no remaining verified, uncontracted, non-held targets in this reviewed batch, so no duplicate 09:00 job is created.

## Sources And Identity

- Canonical discovery: complete StudioMate member export, 2026-10-22 01:34 KST, SHA256 ed4236829cd869f1da0e3627a31ec846ab4c22ffc767ab8a95ee2cdced56e64a.
- Read-only population: 3,444 rows; 43 full-phone groups with October issuance rows. Native exact-phone identity, complete issuance and contract histories are decisive, not Excel labels or a CRM mirror.
- Canonical permanent key: native member ID plus native user-ticket ID through membershipContractJobKey. Contract sources and send journals are retained.
- Retired regular native product IDs validated from paid purchase history establish prior purchase only. They never expand the current target-product allowlist.
- workLanes/october-renewal-recovery/reports contains audit receipts only; it is not a target source.
- Private detailed audit artifacts stay local, outside Git and Hosting. No full contacts, birthday, credentials, or signature contents enter public reports.

## Fix

- Native purchase history determines first purchase versus renewal. An old electronic signature is not required to request a new independent renewal agreement.
- Same-issuance existing contracts, unknown-binding unsigned contracts, duplicated bindings, incomplete sources, cancelled/refunded/inactive passes, and excluded/unknown grades remain blocked.
- Native issuance IDs/timestamps, not exact Excel product-name equality, identify a fresh issuance.
- Historical grants without positive verified payment are not prior paid regular purchases.
- Ordinary automatic issuance age stays two hours. The explicit recovery wrapper is bound to October native issuance dates, exact member/pass, canonical export digest, and the operator approval expiring at 2026-10-22T15:00:00Z. It does not invent a baseline or alter issuance dates.
- Renewal recovery keeps immutable approval metadata for downstream exclusion from newcomer welcome messages.
- Operator test is restricted to one native member/pass/product, immutable test key, fixed test title and disclaimer, real zero-price ledger, and this day's approval. It is not inserted into normal contract/welcome/reminder sources.

## Verification And Release

- Focused synthetic tests cover exclusions, unknown grades, exact native identity, source freshness, real payment amounts, same-issuance contracts, incomplete histories, month/approval bounds, ambiguous responses, and stable idempotency.
- Independent review found null/blank amount coercion on zero-price test evidence. Required native amount fields now reject null, blank and boolean values; real numeric zero is opt-in for the exact approved test only.
- Actual test, member recovery, source/runtime promotion, scoped Functions/CORE Hosting, and live verification are reported separately in docs/reports/2026-10-22-october-renewal-recovery.html.
- Signatures remain pending until each member completes them; signature request acceptance is not delivery or consent proof.

## Common Member Dispatch Window Follow-Up

- User decision: all member-facing communication is forbidden daily in KST 23:00-08:59:59, with no operator, approval, urgency or real-phone test bypass. Internal reports and read-only preparation are separate.
- Recorded first in the host/project AGENTS instructions and ARCHIVE CORE operating rules. Shared runtime policy is `member_dispatch_kst_0900_2300_v1`.
- Preserve canonical keys, approval, queued work and audit records. Proven pre-transport deferrals do not consume attempts. Accepted or ambiguous requests remain blocked from replay. Revalidate the current source after 09:00 through the existing workers; do not add another scheduler.
- A native contract drafted just before cutoff retains its same-issuance guard and may require operator reconciliation. Date-bound instructor approvals retain their original expiry.
- Offline verification: membership contract suite 1,074 Node tests and 623 TypeScript tests; quiet-hour/shared queue regression 208 tests; holding/native script integration 238 tests; refund UI and execution parity 23 tests. Counts overlap and are not additive. Both affected Functions codebases compile. Responsive verification covers 320, 390, 768, 1440 and 1920 widths.
- Final integrated quiet-hours/requests/queue/instructor/refund/parity run: 261 passed. Independent review found and closed two request-lifecycle gaps: queued request outcomes now reconcile from exact canonical candidate/send records; resumed meal invitations validate current expiry, submission, cancellation, recipient, token and both short links. Candidate/request creation is atomic and submitted answers are preserved. Operator-only recovery also preserves a neutral deferred outcome if its native write crosses the cutoff.
- No member-facing test sends are permitted to verify this follow-up. Implementation deployment and live evidence are tracked in `docs/reports/2026-10-22-october-renewal-recovery.html`.
- Release 1798a86b: origin/main promoted; both affected Functions codebases deployed, 39 refreshed functions ACTIVE; CORE Hosting archive-pilates and archive-pilates-core deployed. Live responsive checks 95 and canary checks 10 passed. GitHub affected-functions run 39645685525 succeeded. Runtime current quiet policy and natural refund SMS/agreement deferred reports were read back; actual morning member dispatch is not claimed as verified. No duplicate scheduler or member test send was introduced.
