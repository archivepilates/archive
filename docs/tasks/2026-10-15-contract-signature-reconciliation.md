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

## Release Evidence

- Deployed implementation: `0f890bfb73822c405edd1dd9e5a19f79d86d17fc`, promoted to `origin/main`; feature branch pushed. Clean main deployment checkout: `system-hardening-20260914`.
- Runtime fast-forwarded to the implementation while the hourly LaunchAgent was idle. Existing enabled hourly schedule and completion-worker environment retained; no manual apply/queue execution or new schedule.
- Runtime `--dry-run`: idle, checked/completed/review/sent/StudioMate writes all zero. No canonical data was modified by this check.
- CORE root Firebase Hosting dry-run and actual deployment succeeded for `hosting:archive-pilates,hosting:archive-pilates-core` with the operator service account on `archive-pilates`. No Functions, rules, or indexes deployed.
- Validation: 878 contract/welcome/registration tests; five ticket-price guard tests; Hosting/catalog and rollback guards; 95 local and 95 live responsive checks across 320/390/768/1440/1920px. Release canary passed all ten checks for the exact deployed implementation SHA.
- Authenticated existing manager readback at 390px and 1440px: both repaired contracts render signature complete and welcome review with the new Korean explanation. No horizontal overflow, page errors, or Firestore write attempts. Browser and contexts closed.
- Target contract document versions and welcome candidate/send ledgers matched the pre-release snapshot exactly. No contract regeneration/resend or Alimtalk test.
- Public app/rule files belong to the implementation commit. This evidence-only documentation follow-up does not change deployed assets or require another Hosting release.
- Independent review: no release-blocking findings; 155 bounded local checks passed. Functions affected detection: none. Local full Functions build was not rerun because no deployed Functions source changed.
- Implementation CI: run `38692699926` succeeded, including affected-codebase detection, contract/generated-codebase build, boundaries, safety and rollback guards: https://github.com/archivepilates/archive/actions/runs/38692699926.
