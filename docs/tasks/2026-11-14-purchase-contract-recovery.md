# Purchase-Scoped Contract Recovery

- User scope: revalidate October and November purchases against native identities, current issuances, complete contract history and canonical claims; repair confirmed omissions and dispatch only necessary contracts after 09:00 KST. Keep refunded, signed, closed-review and ambiguous actions non-replayable. No member/profile/pass/payment changes or blanket history replay.
- Branch/worktree: `codex/mini/contract-purchase-recovery-20261114`, dedicated managed checkout. Source base `b4f44e21`; active runtime remains `~/dev/archive-in-runtime`.
- Private evidence: `~/ArchiveIN/operations/contract-receipt-audit-20261114/`. Member-specific plans, names, source rows, hashes and native records remain outside Git. Native reads are GET-only, under the existing shared lock with finally cleanup; no session headers or credentials are saved.

## Verified Findings

- The November 1-14 cumulative sales workbook was available and exactly equals November 1-13 in all 48 rows including header. October/November incomplete candidates span 49 purchase rows; names are not purchase identities.
- Revalidated 46 distinct displayed-name candidates; 45 resolved to a unique current native member and full-phone uniqueness. One displayed name remains unresolved and is not selected for any write.
- Native ticket product IDs, issuance days and titles bind the purchase rows. Payment settlement timestamps can change after issuance; they are not a reliable substitute for the issuance date.
- Black Friday 50-session product `475797` is absent from the configured regular-product allowlist. Relevant hints were previously marked `no_fresh_native_issuance`. A strictly scoped config addition is planned after independent purchase verification; other products/settings and old ignored hints remain unchanged.
- Verified native paid historical regular products `364319`, `388592`, `412180` establish prior purchase only. They are not new send targets. Preserve current title/exclusion checks, native grade checks and stable purchase job keys.
- Other real blockers include trial/instructor/consultation grades, missing native required profile fields, inactive purchases and starter package product-policy ambiguity. Do not infer missing identity information or reclassify those members.
- Four unsigned expired contracts require per-current-expiry source/claim/provider verification before another native request. Two operator-closed contracts remain closed/no-replay. One refunded old purchase remains excluded. The existing pending contract is not an initial-send target; the other pending contract has a five-day native-ticket/contract period mismatch and remains held.

## Implementation And Verification

- Added an explicit exact-purchase recovery evaluator with member/issuance/product/time binding, source row and source/manifest hashes, a bounded purchase period and approval interval no longer than 24 hours. It bypasses only historical age/discovery gates, not identity, payment, classification, existing-contract or canonical claim checks. Ordinary eligibility is unchanged.
- Native selection surfaces fresh unregistered regular products as review; excluded trial/outdoor/one-session products remain outside this alert.
- Initial preflight: 21 purchase rows pass selection and payload construction; 19 remain held. This is preparation only, not native creation or dispatch. The final private v2 preflight includes the historical-purchase classification fix and remains the execution reference.
- Initial synthetic contract/reminder regressions: 1,258 pass, zero failures/skips. Final Node 22 checks, independent review, runtime adoption, scoped CORE rules publication, CI and scheduled execution are recorded below when actually observed.
- Final Node 22 contract/reminder regressions: 1,284 pass, zero failures/skips; the exact-purchase set contains 56 checks, including pre-existing/competing journal stages and legacy unbound overlap/date failures. Functions TypeScript no-emit, CORE Hosting/catalog and rollback validation passed. Private executor actual-source mock probes passed 22 schedule/revocation/source checks without auth or transport.
- Independent review identified and corrected legacy unbound duplicate-contract ambiguity, duration/whitespace alert gaps, malformed schedule fail-open, and final settings-revocation checks. The exact recovery journal now refuses every pre-existing job atomically, including safe deferred stages, without resetting or replaying the original job.
- Static-only changed-rule fixture passed widths 320/390/768/1440 with no text overflow. This does not claim an authenticated production browser session. No UI/API callable or deployed Functions handler changed; the added TS evaluator is consumed by the local operator adapter and normal server eligibility remains unchanged. Affected-codebase detection was run for validation; no unrelated Functions rollout is required for this runtime/operating-rule change.
- Quiet hours were already active at task start. No live writer call, native draft or member-facing request was made during this preparation. Existing creation function defers before creating claims outside its dispatch window; preparation must not be represented as saved native drafts.

## Remaining Execution

- Refresh the exact private v2 plan, approval expiry and policy hashes. After 09:00 KST, execute only still-eligible exact purchases through the canonical journal/writer, one at a time; retain every accepted/unknown outcome and read back each created contract and provider result independently.
- Existing expired-contract recovery must reuse the exact original contract and a new current-expiry claim, not reset prior requests. Existing pending contracts use only the already-approved, once-only reminder path if eligible; no duplicate initial invitation.
- Preserve the pending period mismatch and unresolved profile/product/identity cases. The final user report must separate prepared, created, requested, delivered, signed and held.
