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
- Shared inspector/policy parity 60, MCP 252, controlled UI 17, existing CORE 80 and renewal 24 checks passed. All five codebases built; ownership 97 exports passed. No-mock AST comparisons prove both senders' execution bodies match the released baseline.
- Backend source `26dcb8f82c43569d85e70c1c8e2493576bfb37ae` promoted and pushed to main/feature; `functions-alimtalk` 14 endpoints deployed (one new read-only callable). Other four codebases were validated but not deployed; the boundary-manifest edit alone conservatively flags all five in affected detection.
- New callable ACTIVE, revision `getalimtalktargetvalidation-00001-fud`, 256MiB, concurrency 1, max instances 2, no secret bindings. Downloaded deployed source generation `1792153944735141`: exact SHA256 matches for inspector, shared checks, eligibility, normal queue and approved sender.
- Live unauthenticated request rejected 401; existing owner temporary authentication succeeded, unsafe ID rejected 400. No new account, password or role changes; tokens not persisted. Candidates/send records unchanged before and after live inspection; fresh stdio tool set has eight read-only tools.
- Existing four main schedules remain ENABLED at 11:30, Monday 12:30, 18:00 and every ten minutes. GitHub affected-codebase CI `38901035696` succeeded.
- Hosting source `5c60190e962ee931b987051b70bf73599038086f`: archive-pilates + archive-pilates-core deployed. Release canary exact source passed, local/live responsive checks each 95 passed across 320/390/768/1440/1920. Ten live hashes (messages HTML, inspector JS/CSS, app and rules across custom/web.app URLs) match local.
- Live inspector module SHA256 `0b21d1494f576ba7bedceb0fd6a6655def07e34a9d2fc8c55087ce22a79e1fc8`; CORE inspector JS `1e6c7c8298cbb700021244d78973e91de0cb191a8dacb96a9da79632dd404b26`; CORE rules `60e3813f547c1d2b8c6324629f92dad391755b41dc1e7b5c981fafb9aff0c3d5`.
- All task-owned test contexts/browsers and mock servers closed in finally blocks. Fresh MCP clients/child validators and temporary credential-bearing in-memory sessions closed without persisting tokens; no StudioMate browser or shared production lock was opened.
- Final record is documentation-only: no further runtime deployment required. Existing Codex chats may cache the old MCP tool catalog; reconnect to expose the eighth tool.

## Remaining Boundaries

11:30 candidate preparation and global stale-candidate cleanup still have the pre-existing full-read architecture. This patch does not claim to optimize those or to guarantee current StudioMate state from cached Firestore records. Exact recipient parity is preserved by reusing existing policies, not by changing date windows or shortening lifetime duplicate history.
