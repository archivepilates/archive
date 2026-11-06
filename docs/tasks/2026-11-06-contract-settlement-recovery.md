# Contract and settlement recovery

- Date: 2026-11-06. Worktree: `/Users/archivepilates/codex-worktrees/ops-monitor-accuracy-20261104`.
- Branch: `codex/mini/contract-settlement-recovery-20261106`; baseline `9d13da3b`.
- User scope: restore the two diagnosed operational functions. Preserve existing contracts, dispatch claims, payroll sources and amounts. No member resend, signing on behalf of members, payment, distribution, new scheduler or permission widening.

## Contract evidence and recovery

- The current served StudioMate application uses a temporary upload reservation, presigned image PUT and finalization PATCH. The retired single signature POST is not used by the current component.
- The adapter validates the exact contract, approved seal bytes/hash, HTTPS AWS S3 target and restricted headers; no StudioMate session credentials follow the image URL. Each remote step rechecks current authorization/time and persists its phase. Independent exact-contract readback is mandatory; uncertain outcomes never retry blindly.
- Official seal validation and transport capability preflight occur before creating a contract claim. Ordinary operations now also reread live settings before each write. Historical E2E flags cannot verify the replacement route; an explicit new-route proof is required before automatic writing.
- Existing operator signature claims block replay even if a signing link expires or an old job remains in review.
- Shared execution requires live authorization before any claim. The ordinary processor and bounded manual recovery reread settings; the historical October batch helper has no new-route authorization and therefore fails closed rather than reopening an old batch.
- The exact five October recovery jobs have independently checked full accepted single-attempt/no-replay native receipts. Four canonical records are signed; the remaining exact native contract is unsigned with an expired request. This task did not re-request it.
- Main applied `close-membership-contract-recovery.mjs` once after a read-only plan and synthetic tests. Transactional CAS protected settings, five jobs, five contracts and five hints. It closed only the expired batch approval and attached supplemental hint closure metadata. Writer remains disabled; source jobs/contracts and hint status/reason are unchanged. It asserts dispatch acceptance, not completion of every member signature.
- Private closure plan hash: `4b187f02ee091e0167bc4bb76e432fb102cef8ad2c8a3b661304c27645b2fb55`.
- Positive live E2E for the replacement seal path is pending. Asked permission for a separate operator test draft with no signature message; no response or test creation is recorded yet. Do not enable the writer based on synthetic tests alone.

## 202610 settlement recovery

- The corrected actual-payroll audit, eight artifact hashes, two original payroll PDFs, retained employment source, full lesson source, cached workbook amounts and four statement links were checked. The selected extra classes remain the two approved morning classes outside the confirmed weekday working hours, not the evening alternatives.
- Added an explicit reviewed-artifact finalization branch before legacy workbook creation/rebuild. It cannot recalculate payroll, overwrite existing outputs, manufacture a missing operation workbook or replay an incomplete private intent.
- The legacy generator refuses an already finalized byte-identical corrected INDEX/XLSX pair before source preparation, preventing a later generic rerun from overwriting this recovery.
- Main finalized exactly two files under the existing home-account Google Drive month folder: canonical statement XLSX and canonical INDEX. Both are byte-identical to their verified corrected sources. Original review artifacts, source PDFs, warnings and links remain unchanged. All links and source hashes were independently reread.
- Private plan hash: `699d2a87cbd5774646e84210af752f20ca86c4440d71f8271417b927904e2b12`.
- Canonical INDEX SHA-256: `23477d9845df54304caf2d9c025122555489e593dea816c3928428bb649109ec`.
- Canonical XLSX SHA-256: `3698ca24f207561958ac2af329d156b567d1bc5bdcdcb1a71638253636ffd55f`.
- This is artifact finalization, not payment approval, transfer proof or instructor distribution. The independent payroll evidence and private finalization intent remain outside Git. The monthly execution schedule and future-month calculation policy are unchanged.

## Validation and rollout

- Combined contract, closure and settlement regression: 1,306 tests passed on Node 22, including new upload safety, no-replay, historical-proof gates, real synthetic finalization and CLI no-fallback/overwrite guards. Intentional overwrite-guard rejection was also verified against current October artifacts without mutation.
- Settlement/closure tests include synthetic success, source drift, wrong links/identity, partial publication, concurrent destinations and retained unknown intents.
- CORE operating rules updated in the existing contract, health and settlement records. Functions source/config is unchanged.
- Runtime integration, scoped CORE Hosting publication, CI and fresh health evidence remain pending until the release section is appended. No positive live seal test or automatic-writer reactivation should be inferred from a code release.

## Private evidence

- `~/ArchiveIN/operations/contract-settlement-recovery-20261106/`: closure intent/verified receipt, finalization evidence and durable finalization intent.
- Prior corrected payroll sources: `~/ArchiveIN/operations/october-payroll-actual-20261102/`.
- Do not copy payroll values, member details, presigned URLs, upload tokens or full source documents into this report, public rules or Git.
