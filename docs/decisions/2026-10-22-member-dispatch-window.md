# Member communication quiet hours

Status: approved by the operator on 2026-10-22; deployment evidence is recorded separately.

All member-facing dispatches use KST [09:00, 23:00), without an operator/test override. This includes Alimtalk, SMS/LMS, member email and electronic-contract signature requests, whether scheduled, recovered, manual or through MCP/Codex. A stricter per-channel window remains effective. Internal operator/system messages and source reads are not member dispatch.

The authoritative clock is checked before claims where possible and again immediately before the irreversible external action. Nighttime is a neutral deferral, not an attempt, failure, successful dispatch, or consent. Invalid clocks fail closed. Candidates and canonical keys remain unchanged; the existing worker revalidates source/exclusions/cancellations/signatures/previous sends at or after 09:00. No duplicate scheduler or replay of accepted/ambiguous outcomes is permitted.

Contract issuance freshness retains its existing daytime budget; quiet hours do not consume that budget. Current source freshness, native ID, complete history, product/classification, approval, and duplicate checks are not relaxed. October recovery remains separately bounded and cannot override quiet hours.

Shared implementation: memberSignup/memberDispatchWindow.ts with a Node bridge. Upper-level guidance: ~/.codex/AGENTS.md and repository AGENTS.md. Staff-facing rule: CORE > Rules, first section.

No test or member notification is dispatched to prove the nightly restriction. Boundary, preclaim, last-mile, resume, and idempotency verification use deterministic mocks and read-only runtime evidence.

An already-created StudioMate draft remains subject to the same-issuance contract guard. If a workflow crosses 23:00 after drafting, retain its native contract and journal for exact operator reconciliation; do not hide the existing contract or create another one to force automatic resumption. Date-scoped instructor approvals retain their original date and expiry, rather than becoming an unbounded next-day send.

The code enforcement covers ARCHIVE-owned senders and CORE actions; the upper-level rule also governs manual MCP/Codex work. Unrelated direct use of an external provider's own administrator UI is an operator rule, not a network-wide technical lock.
