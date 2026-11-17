# Contract Display Name Reconciliation

- Scope: correct the remaining reminder live-name comparison without changing contract authentication names or native member names. Audit native contract creation dates from 2026-10-17 through 2026-11-17 KST. Preserve signed contracts. Pending native requests cannot be edited in place while requested; cancellation/edit/re-request is a separate approval boundary.
- Worktree: `~/.codex/worktrees/contract-name-reconciliation-20261117/archive-in-runtime`; branch `codex/mini/contract-name-reconciliation-20261117`; base `1ef91290`.
- Read-only native evidence is private under `~/ArchiveIN/operations/2026-11-17-contract-name-reconciliation/`. No raw member data or contract content belongs in Git.

## Implemented Locally

- Keep original canonical `memberName`, contract signer name, source binding, request history and reminder fingerprint unchanged. A separate versioned `memberNameReadback` binds the exact current display name to original studio/member/issuance/product/job identity, full-phone hash, original name, signer name and observation time.
- Reconciliation requires unique fresh native member lookup, same ID and full phone, unchanged provider/DOM signer, active exact ticket, payment/refund checks and original job in signature-requested stage. Only numeric-suffix-related display changes qualify. Existing reminders/re-requests, holds and signature contradictions are not reset.
- The existing completion observer can save verified proof in the same source-version-checked transaction as its observation. No extra worker or schedule. The reminder separately compares the proof digest and fresh native source at preclaim; proof removal/replacement blocks dispatch even though the old fingerprint is retained.
- Legacy signed-contract observation behavior is preserved. Welcome remains independently guarded; display proof alone does not authorize welcome delivery.

## Native Audit

- The native date-filtered list had 49 unique contracts; detail creation dates place 47 within the requested month. Four contracts have numeric signer suffixes: one independently signed and three unsigned requested. All four resolve to the same exact current native member ID/phone and matching normalized name. No missing/duplicate detail IDs occurred; pagination metadata is retained privately.
- The signed contract was preserved. All three unsigned contracts have disabled name fields and expose request cancellation, not direct editing. No native request was cancelled, no contract edited/created and no member message sent during the audit.

## Verification And Pending Release

- Declared membership-contract command: 1,354 native/membership checks and 629 TypeScript welcome checks passed. Reminder/window/browser checks: 269 passed after independent-review follow-up. No real member dispatch occurred.
- Independent review found that treating an intentional proof skip as an observation failure could prevent legacy monitoring. The skip now preserves the existing observation path. A fresh fully verified native source may recover a transient read-review only; holds, signature conflicts and all existing claims remain protected.
- Proof is canonical metadata on the existing contract document, not a new member mirror or action selector. Source: current StudioMate native member/contract/ticket plus original contract and job. Destination: top-level `studiomateMembershipContracts/{contractId}.memberNameReadback`. Readers: existing completion/reminder workers only. Forbidden: member merge, ticket/profile changes, welcome authorization, contract edits or sends selected solely from the proof. Exact contract/studio/member/purchase/job identity and full-phone hash bind each proof; a second conflicting proof is not overwritten.
- An additional broad ad-hoc scan included a pre-existing failing welcome entrypoint source-shape assertion. The identical failure reproduces on clean runtime `origin/main`; no unrelated Functions source/test was changed. This is not a newly introduced contract-name regression, and it must not be described as an all-tests-green result.
- Initial review ended with local proposals only. The operator subsequently approved runtime adoption, CORE rules release, commit/push and the proposed same-document correction of three unsigned contracts. Final read-only review passed; no production release is claimed until independent release evidence is recorded below.

## Approved Execution And Native Restriction

- The user explicitly approved both the scoped go-live set and three same-contract corrections. Fresh native/member/ticket/provider-history checks found two exact period matches and one contract/current-ticket end-date conflict, held pending a separate operator decision.
- Before any cancellation transport, the native confirmation states that cancelling prevents recipient viewing/signing and makes the contract impossible to edit or resend. The modal was inspected under a deny-mutations route; no native cancellation/save/send was allowed. All three original requests remain intact. This contradicts the earlier assumption that cancellation would unlock editing.
- New-contract replacement requires separate operator approval; do not interpret the approved same-contract correction as permission to create a new document. The additional period-conflict case remains blocked independently.
- Code/rules release and exact display-name proof restoration are still authorized and continue independently. No contract creation, cancellation or signature message is authorized merely by deploying the new comparison logic.
