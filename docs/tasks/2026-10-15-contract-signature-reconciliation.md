# Contract Signature Reconciliation

- Worktree: `contract-signature-reconciliation`; branch: `codex/mini/contract-signature-reconciliation`.
- Scope: native signed contracts stuck at CORE registration signature waiting; no contract creation/resend, StudioMate writes, or test Alimtalk.
- Cause: the completion worker deleted `nextObservationAt` at 100 historical observations; both affected sources reached that limit before signing.
- Preserve the existing bounded append-only history; add `lastObservation` independently. A waiting source keeps its observation schedule. Transient read failures back off; permanent evidence conflicts are explicit holds.
- Recover missing schedules with bounded document-ID cursor scanning and reserved slots. Future scheduled retries and explicit holds are not reclaimed.
- Canonical signature truth is `studiomateMembershipContracts.signatureReceipt`, bound to native contract/member/issued-ticket/product and both signatures. It has `purpose=signature_status_only` and `sendAllowed=false`, and is not welcome `completion`.
- Do not relax the existing 7-day binding, 24-hour signature, source-freshness, recipient exclusions, provider history, or deduplication welcome gates.
- Source readback verified both Oct12 signatures, exact native identity and current tickets. Scoped status repair is backed up privately outside Git.
- Checks: native DOM/provider readback; focused adapter/retry tests; full contract/welcome regression suite; CORE registration render tests (878 passing total); no candidate/send deltas. CORE live 390px manager session independently shows both signatures complete, welcome review; zero write attempts/page errors.
- Runtime/Hosting release: human approval received 2026-10-15 for scoped validation, runtime rollout, CORE Hosting, commit and push. No Functions or Firestore rule/index deployment is needed. No manual completion queue or welcome send may be invoked by this release.
- Operator hub: CORE rules section 7, current implementation/verification/release states kept separate.
- Private audit: `~/ArchiveIN/automation/reports/contract-signature-reconciliation/2026-10-15`; never commit member sources or signatures.
