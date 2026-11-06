# Existing contract recovery and current writer verification

- Date: 2026-11-06. Worktree `/Users/archivepilates/codex-worktrees/ops-monitor-accuracy-20261104`, branch `codex/mini/contract-settlement-recovery-20261106`, initial source `2edf9960`.
- Scope: user approved source checking the eight stored review contracts, appropriately re-requesting unsigned/expired contracts or creating genuinely missing contracts, and restoring the automatic writer. No duplicate contract, member consent/signature, source purchase change, blanket historical send, scheduler, permission change or replay of unknown results.
- Account: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`, project `archive-pilates`. Native browser work is serialized under the existing shared lock and cleaned up in finally blocks.

## Independent source findings

- All eight exact native identities, complete contract histories, current ticket/payment reads and exact contract UI states were verified.
- Six unsigned expired contracts retained current matching regular purchases. One other contract had a member signature image/time but expired native/UI state, so it remains review-only with no new message. The final old private purchase was refunded; its expired contract was not re-requested.
- The refunded member has a different current regular purchase `11854377`, discovered by the existing 11/3 canonical hint. Exact prior discovery timestamps, current native purchase/payment/history and missing canonical job were verified. Only that purchase received a seven-day one-off age exception; global two-hour eligibility was unchanged.

## Actual requests and remaining blocks

- Five existing expired contracts were re-requested once through the native contract SMS flow, not the retired general-text route. Canonical contract/job claims were recorded per prior expiry; original claims, selection times and old receipts were preserved. Readbacks verified the exact new messages/recipients and request expiries. Provider records report transmission success, not human reading.
- One of those members independently signed after the new request. Current native and DOM sources agree on signature completion. Source receipt and normal existing-member welcome exclusion are recorded only after independent source validation.
- Existing contract `15a985fa8ce66f44ede3f61941a9b275e27b784df31486b5e59e53884cdccc3a` reached a UI confirmation path without a final provider response. The first helper used the wrong final-confirmation selector. Its consumed canonical intent is retained as unknown/no-replay; native state remains expired and no new native message receipt was found. Absence alone is not treated as historical non-dispatch. The correct two-dialog path was verified with all writes blocked before applying it to other approved targets. No repeat of the uncertain first intent occurred.
- Contract `b0993895344f20716b9d8ab75bcef2541b5449b7696d66bda2661cef1dcea5d7` retains signature-state conflict. A signature image is not sufficient to mark complete, and no signature/consent or status was forged.

## Current creation verification

- One real missing purchase was processed through the existing canonical writer/journal, not by replaying the earlier operator test fixture. Native create returned HTTP 201 with exact contract ID `59f4f104382dcd45390bbb8614e967ad9ca0d4d04731e419db7ccd9e17be76d2`.
- Strengthened raw readback passed before approved seal storage and signature request. Fresh UI verified request-pending with a center seal, member unsigned and unchecked terms. Current member and purchase hashes and the prior refunded contract were unchanged; exact history increased from one to two, with no extra record.
- New request provider record `774591` independently reports transmission success. The original fixture creation intent is still consumed/no-replay and its historical server error remains unconfirmed.
- The new creation proof is bound to schema/policy, studio, category/sign type, contract ID, request hash, times, independent reload, source preservation and unchecked consent. It proves the shared current endpoint/category, not independent live tests of every template variant. Audit: `workLanes/studiomate-membership-contract-automation/reports/current-create-e2e-20261106`.

## Code changes and rollout

- Strict raw readback compares member/profile, ticket identity/dates/counts/payment splits and exact terms; draft consent cannot be prechecked. Signed/resumed reads retain member consent and no-replay handling.
- The ordinary processor and explicit recovery now require separate creation proof in addition to seal proof, at entry and before remote actions. Changed/revoked proof fails closed; proof recording alone does not enable the writer.
- Node 22 combined contract/native/proof/reminder regression: 1,459 passed, zero failures/skips. Independent bounded code review found no actionable replay/privacy/authorization regression. Processor callback mutation remains a focused integration-test gap; existing writer checkpoint/authorization tests and the actual bounded run are separate evidence.
- CORE rules updated. Required targets: Mac mini runtime and CORE Hosting only; no Functions source or configuration changed. Main/source promotion, Hosting live hashes, CI and actual writer activation readback are recorded after release.

## Private evidence

- `/Users/archivepilates/ArchiveIN/operations/contract-eight-recovery-20261106/`: current native audit, canonical receipts, message readbacks, per-expiry claims/transport records, source closure and create proof. Private files remain outside Git with restricted permissions.
- Do not copy phone numbers, profile data, amounts, contract contents, session headers, signatures, tokens or message bodies to Git or this report.
