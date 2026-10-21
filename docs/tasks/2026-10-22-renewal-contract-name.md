# Renewal Contract Title

- Request: rename the StudioMate renewal template and future renewal contracts to `아카이브 재등록`.
- Worktree: `renewal-contract-name-20261022`; branch: `codex/mini/renewal-contract-name-20261022`.
- Keep template ID 1341, first-purchase template 608, terms, fields, signing flow, source identity, issuance keys and schedules unchanged.
- Never edit, recreate or resend existing contracts; do not send test messages or create member contracts for testing.
- Owner: main thread handles source edits, StudioMate title-only save, canonical readback, runtime rollout, commit/push and CORE Hosting. Bounded reviewer verifies the diff and synthetic regressions only.
- Baseline and title-only before/after audit: `workLanes/renewal-contract-name/reports/template-1341-20261022`. Compare all template fields except the title and provider-generated update timestamp; compare terms and template 608 independently.
- Stage tested source first. Serialize the production title change and runtime fast-forward with the shared StudioMate browser lock so no scheduled writer runs against a mismatched template name.
- CORE operating rule: section `#welcome`. Functions are not affected by this Mac mini script/title and Hosting documentation change.
- Independent review: a historical renewal job with the old title must not be replayed under a new payload hash. Preserve the old hash and contract; intentionally keep a mismatched manual replay at `job_payload_mismatch` for operator review, without resetting claims. Added realistic persisted-journal tests for complete/created/signature_requested stages. Existing signature observation continues using each contract's persisted binding title, not the new template title.
- Read-only canonical audit before cutover found zero renewal jobs and zero renewal source records (both scans uncapped); no interrupted historical renewal job needs migration. No old source or job is changed.
