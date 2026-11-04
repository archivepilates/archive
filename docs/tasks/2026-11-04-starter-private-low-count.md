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
- CORE rules and generated catalog are deployed and independently verified against the tracked source.

## Verification

- 593 focused TypeScript tests passed: ticket facts, renewal, member exclusions, safeguards, dedupe, welcome readback/queue/history.
- 75 catalog/release-policy/target-validation/CORE visibility tests passed.
- Expanded final suite including the pinned parity audit, attendee preflight and meal-test window passed: 1,011 tests, zero failures.
- Additional approval/queue-window suite passed: 66 tests. Its older isolated claim harness initially lacked the already-existing candidate-window dependency; added a bound ordinary-candidate adapter to the real clock policy, explicitly rejecting meal-exception markers. Runtime code is unchanged. Total selected regressions: 1,077 passing.
- Full five-codebase local build and function-boundary validation passed; 107 exports retained.
- Generated catalog validation passed (34 rows). Affected deployment targets: `functions-alimtalk`, `functions-sync`, and CORE Hosting for rules/catalog.
- Shared-policy parity initially had one pre-existing failure. Review traced all six differing function bodies to already-released `8088b8686f3a8a3625dba38374f958964bc5f5ea` (allocation preflight) and `b4cc07b6039022fb363facaae1e66e77c1fe204d` (one approved test exception). The test now pins only those six bodies to the latter commit, retaining all other original execution hashes and the existing fixture. All 12 parity checks pass. Runtime dispatch code was not changed.
- Catalog fingerprints now include the shared renewal policy containing the new predicate, preventing helper changes from escaping catalog drift detection.
- New coverage includes remaining 2/1/0, normalized titles, explicit total conflicts, missing totals/expiry, source-vs-stale-payload checks, ambiguous identity, regular/group coexistence, legacy queued candidates, expiry D14/D0/D15, and future/exhausted/expired source checks.
- No member-data mutation, candidate reset, sync/queue run, message send/replay, or browser session was performed. Only the approved software/Hosting release was applied.

## Release State

- User approved validation, scoped deployment, commit and push on 2026-11-04. Existing sends, duplicate protection and schedules must remain untouched; no member resend.
- Source release `2b78d67b14eba18b4edd70de8564f0d587bcff5c` includes behavior commit `281a6e99`, merge of latest `origin/main`, and test-harness commit `2b78d67b`. Main and `codex/mini/starter-private-notice-20261104` were pushed before deployment because the existing predeploy guard requires clean main exactly equal to origin/main.
- Deployed from clean `/Users/archivepilates/dev/archive-pilates-release` main, project `archive-pilates`, using the existing `archive-codex-operator` account. Both affected-codebase dry-runs and actual deployments passed, one codebase per Firebase process. CORE-only Hosting release passed. No other Hosting site or Functions codebase was deployed.
- Remote inventory after release: all 15 `functions-alimtalk` and 12 `functions-sync` functions ACTIVE.
- Daily sender revision `scheduledqueueandsendalimtalkdaily-00153-jat`, update time `2026-11-04T03:15:44.161248221Z`, source generation `1793762079453456`.
- Sync revision `adminsynclecturesrange-00120-viq`, update time `2026-11-04T03:17:36.195584438Z`, source generation `1793762249118489`.
- Independently downloaded both exact Cloud Functions source generations. SHA-256 comparisons passed for the predicate, candidate generator and final guard in both TypeScript source and executable JavaScript (six files per codebase). Temporary downloaded archives were removed in finally blocks. Final sync comparison completed `2026-11-04T03:18:18.192Z` (12:18 KST).
- Live `https://core.archivepilates.com/rules/`, its catalog JSON, and the Firebase rules URL returned HTTP 200 and byte-matched the source. Rules SHA-256 `16c78c789f810b3a3d0cbf10ab9f71c4ba78c905b33d93e16fbd0cc8b6cb1c04`; catalog SHA-256 `07d273a17d914b642b1ce4c305257a3a356732e20962fc1cb848126848b41597`.
- Scheduler readbacks retain Asia/Seoul, daily `30 11 * * *`, queue `every 10 minutes`, both ENABLED. No manual job invocation was used.
- Exact source-release CI: Functions Affected Check [41765649871](https://github.com/archivepilates/archive/actions/runs/41765649871) and CORE MCP Check [41765649766](https://github.com/archivepilates/archive/actions/runs/41765649766) both passed. A separate read-only reviewer confirmed the runs and the 66 approval/queue-window tests.
- Runtime checkout was fast-forwarded to the released source. Worktrees were clean after release; the final documentation-only commit records this evidence without changing deployed bytes.
- No actual member-facing send test or post-release scheduled batch was run. The next natural scheduled execution has not yet been observed; it is not presented as completed. Existing accepted/unknown sends remain untouched. No new monitor or scheduler was created.
