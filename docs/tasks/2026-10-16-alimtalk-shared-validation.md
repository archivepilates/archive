# Shared Alimtalk Target Validation

- Lane: existing promoted Alimtalk canonical pipeline, narrow shared-validation patch.
- Worktree: `/Users/archivepilates/codex-worktrees/alimtalk-shared-validation`.
- Branch: `codex/mini/alimtalk-shared-validation`.
- Base: `49f617ec76973b25cb2cf3e33bee156ea79cd527`.
- Authority: user approved implementation, validation and deployment; no real sends or retries authorized.
- Primary operator: main thread owns review, commit, promotion, deploy, push and live proof.

## Design

Use existing Firestore canonical `alimtalkCandidates`, `alimtalkSends`, `memberProfiles`, `bookings`, requests and template-state records. No new collection, source migration, mirror, scheduled worker or sender. Shared checks retain original eligibility, member exclusions, source guards and historical dedupe. Existing send ordering and final transactional claims are unchanged. CORE and MCP share the same backend inspector; inspection cannot approve or send.

## Scope And Safety

- Exact candidate IDs only, maximum ten per callable, one per MCP call, sequential inspection.
- CORE callable: existing authenticated active staff plus owner/manager guard, studio 5330; no new auth bypass.
- MCP: existing per-call active operator guard, fixed child CLI and compiled backend, configured service credential; no shell or arbitrary path/tool execution.
- Read-only mode never refreshes SOLAPI template state, persists candidate state or executes a queue. Old/missing ten-minute template evidence is unknown, not eligible.
- Candidate identity and existing attempt ledger are checked before business rules. Prior/unknown attempts remain reconciliations, never retry permissions.
- Specialized final readback/approval/claims remain mandatory. `allowedForExternalActions=false`, `liveReadback=false` on every inspection result; no raw payload, survey response, phone or error text.
- Real StudioMate access, reservations, pass changes and test Alimtalk sends forbidden in this task.

## Delegated Ownership

- MCP agent: `services/archivepilates-mcp/**`, `scripts/read-alimtalk-target-validation.mjs`.
- UI agent: `core/messages/index.html`, new `core/assets/alimtalk-target-validation.*`, UI test.
- Read-only review: validation source, rule parity, hidden writes, auth and privacy boundaries.
- Main: backend, regression tests, catalog fingerprint, CORE rules, documents, production execution.

## Verification

- Added isolated VM tests for missing/foreign records, ID binding, prior attempts, input limits, eligibility/source/duplicate failures, private-result redaction, stale template evidence, specialized final checks and no-write/no-fetch template mode.
- Existing 83-case strict approved-send runtime test still passes: no full source reads, canonical ownership, cancellation, transaction races, single provider attempt and unknown outcomes.
- Build, cross-codebase boundaries, catalog and mandatory rollback guards required before release.
- Pending: final MCP/UI evidence, live callable auth and read-only proof, Hosting hashes, CI and clean Git status.

## Remaining Boundaries

11:30 candidate preparation and global stale-candidate cleanup still have the pre-existing full-read architecture. This patch does not claim to optimize those or to guarantee current StudioMate state from cached Firestore records. Exact recipient parity is preserved by reusing existing policies, not by changing date windows or shortening lifetime duplicate history.
