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

## Final operating result and release

- Source `694aec3e6084370f7f6280e49fc82252ad75813b` promoted/pushed to main and the scoped branch; runtime fast-forwarded cleanly. No worker restart, second scheduler or manual source sync was used.
- CORE Hosting `archive-pilates-core` deployed from clean main using root config and the existing operator service account. Both `https://core.archivepilates.com/rules/` and `https://archive-pilates-core.web.app/rules/` returned 200 with source SHA-256 `38a5c0cdc12b32fa4293da0cc3e80c9425e20c4643850d64d1b71b7245011ba9`. No Functions affected/deployed.
- Main GitHub checks succeeded: CORE MCP `42203744819`, Functions Affected Check `42203744901`; feature Functions check `42203801044` also succeeded. Local CORE rules browser checks passed 22 tests at 320/390/768/1440px. Existing unrelated whole-page overflow is not claimed repaired.
- At `2026-11-06T10:35:56.635Z`, only `contractWriterEnabled` changed from false to true after the current create/seal proofs, clean runtime/source and existing enabled worker environment were verified. All other settings, including the two-hour cutoff, reminder activation timestamps and completed old recovery approval, are unchanged. No historical batch was resumed.
- The initial order-sensitive JSON checksum warning during activation was reconciled by an independent normalized deep comparison of every field and the immutable activation audit. No setting update was retried or reset. A fresh source-gated empty-discovery check returned idle with zero writes; this is not a claim that a future natural hourly run or every template variant has already executed successfully.
- Six exact native outgoing records independently report transmission success: five existing-contract re-requests plus one current-purchase contract. One original member completed signing. CORE stored readback at `2026-11-06T10:38:23Z` shows five signature-waiting contracts and two review contracts, with no pagination. The old refunded purchase is excluded; its historical root update time, native contract and original job stage were preserved so it does not replace the newer current purchase in the member card.
- The completed member's authoritative signature-only receipt and independently validated existing-member welcome disposition were persisted without a welcome resend. Four re-requested unsigned sources retain waiting status, released old observation holds and their verified per-expiry receipt for the existing observer. New current-purchase source remains waiting.
- Two review blocks remain explicit: conflicting native signature/expiry and the consumed first UI-confirmation attempt. Neither was marked complete or replayed. The operations attention email records both exact source references and no-resend instructions.
- Task-owned native contexts and local browser-test contexts are closed; shared profile lock is absent. User tabs and production sessions are preserved. Final documentation-only completion evidence does not change the published rule bytes.

## Operator-requested review closure

- The operator explicitly requested removing the two remaining review items, then resumed the interrupted read-only preparation. At `2026-11-06T10:55:15.302Z`, an exact-contract/member/purchase compare-and-set transaction recorded `operator_contract_review_closed_v1` on both original canonical contracts and jobs. Independent readback verified only the approved exclusion fields changed; original job stage, binding, timestamps, transport claims and receipts were preserved. All automation settings remained unchanged.
- This closes operational follow-up only. Neither contract was deleted, signed, cancelled or resent. Unknown and accepted requests remain non-replayable. The immutable audit is `workLanes/studiomate-membership-contract-automation/reports/review-closed-20261106`; private intent/readback evidence remains outside Git.
- CORE suppresses only a strictly validated exact closure and explicitly related older records. Same-phone other members, anonymous or ambiguous records, mismatched contracts/purchases/jobs, future hints and other contracts remain visible. The existing processor rejects the exact closed job without resetting its stage or claims. No new scheduler or member send is added.
- Local validation, runtime promotion, CORE Hosting verification and CI results are recorded after release. Functions source and configuration are unchanged.
- Local validation passed 1,649 contract/notification/dashboard tests, six CORE rules tests and synthetic 320/390/768/1440px registration browser QA. Hosting validation passed after mechanically refreshing the app-source catalog fingerprint; no Alimtalk policy or template changed. A bounded read-only canonical projection independently confirmed both exact closed contracts are absent and both targets have zero active/review items. Anonymous Excel-only hints remain observation-only; the old review hint was linked using its existing exact contract/member/purchase/job recovery receipt without changing that hint.
