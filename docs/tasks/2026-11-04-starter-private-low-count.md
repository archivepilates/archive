# Starter private introductory ticket low-count exclusion

## Scope And Evidence

- Request: investigate low-count notices for the starter package's initial two private sessions.
- Worktree: `/Users/archivepilates/.codex/worktrees/starter-private-notice-20261104/ARCHIVE-IN`.
- Branch: `codex/mini/starter-private-notice-20261104`; reviewed base `b4f527076496`.
- Read-only canonical inspection on 2026-11-04 found one today's private-count candidate recorded sent at 11:30:35 KST, with a completed send ledger and SOLAPI message ID. Its payload names `스타터 패키지 OT 2회권`, remaining two. The stored member profile agrees: private class, initial total two, remaining two, plus a separate group six-session ticket. This is stored-source evidence, not a fresh StudioMate UI check or independent final-delivery confirmation.
- Cause: the regular private threshold (remaining <= 3) also selected the introductory two-session product immediately.
- No member names, phone numbers, credentials, or production record identifiers are committed here.

## Implementation

- Pure `isStarterPrivateIntroTicket` requires starter identity, private/OT purpose, and initial total two. An explicit total takes precedence; an explicit two-session title is fallback only when the total is absent. Remaining count alone is never product identity.
- Candidate generation suppresses only the low-count branches. Real expiry can still produce the existing expiry notice; missing expiry cannot turn an empty string into zero days.
- The final renewal guard rechecks the freshly matched canonical ticket for both `private_count_low` and legacy `remaining_low`. Existing queued candidates therefore do not bypass the exclusion after release.
- Normal private/duet products, starter-plus four-session products, starter group tickets, other tickets held by the same member, expiry thresholds, templates, dedupe, approval, quiet hours, contracts, and welcome flows remain unchanged.
- CORE rules and generated catalog are updated in source only, pending deployment.

## Verification

- 593 focused TypeScript tests passed: ticket facts, renewal, member exclusions, safeguards, dedupe, welcome readback/queue/history.
- 75 catalog/release-policy/target-validation/CORE visibility tests passed.
- Expanded final suite including the pinned parity audit, attendee preflight and meal-test window passed: 1,011 tests, zero failures.
- Full five-codebase local build and function-boundary validation passed; 107 exports retained.
- Generated catalog validation passed (34 rows). Affected deployment targets: `functions-alimtalk`, `functions-sync`, and CORE Hosting for rules/catalog.
- Shared-policy parity initially had one pre-existing failure. Review traced all six differing function bodies to already-released `8088b8686f3a8a3625dba38374f958964bc5f5ea` (allocation preflight) and `b4cc07b6039022fb363facaae1e66e77c1fe204d` (one approved test exception). The test now pins only those six bodies to the latter commit, retaining all other original execution hashes and the existing fixture. All 12 parity checks pass. Runtime dispatch code was not changed.
- Catalog fingerprints now include the shared renewal policy containing the new predicate, preventing helper changes from escaping catalog drift detection.
- New coverage includes remaining 2/1/0, normalized titles, explicit total conflicts, missing totals/expiry, source-vs-stale-payload checks, ambiguous identity, regular/group coexistence, legacy queued candidates, expiry D14/D0/D15, and future/exhausted/expired source checks.
- No production mutation, candidate reset, sync/queue run, message send/replay, or browser session was performed.

## Release State

- User approved validation, scoped deployment, commit and push on 2026-11-04. Existing sends, duplicate protection and schedules must remain untouched; no member resend.
- Preparing guarded release from latest `origin/main`. Deployment targets remain `functions-alimtalk`, `functions-sync`, and `hosting:archive-pilates-core`; no other Hosting site or codebase is requested.
- Next: complete main promotion, scoped release and independent live verification, then record the actual release identifiers and final Git/CI state below.
