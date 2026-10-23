# Holding DOM serialization repair

- Request: diagnose and repair the holding readback errors; user approved scoped runtime/CORE release, commit and push. No manual queue run or member sends.
- Worktree: `~/codex-worktrees/holding-dom-serialization-20261024`; branch `codex/mini/holding-dom-serialization-20261024`; base `origin/main` `354223f3`.
- Main owns reader, CORE rules, release and final judgment. Turing owns only the new serialization regression test. Independent workers review safety and run offline holding regressions.

## Cause / repair

- The hourly launcher invokes the TypeScript worker through tsx. Name-preserving transformation inserts module-scoped `__name` into locally assigned callback helpers. Playwright serializes a browser callback without its module closure, so the history callback fails in the page. The registered-holds callback has the same latent failure, including its assigned date helper.
- Inline the visible-node callbacks and compute both UTC dates with an inline map callback. No browser globals, helper injection, string replacements or compiler configuration changes. Keep DOM schema, complete histories, two-read consistency and inclusive day calculation unchanged.
- Test the real tsx-imported function serialization and the name-preserving transform, with the previous implementation as a failing negative control.

## Source / safety

- Source remains the live StudioMate ticket/history and canonical member/event/candidate/send/claim/memo collections. No new collection, source migration, queue mutation or baseline reset.
- A read-only live verification may open the five affected members under the shared StudioMate profile lock and close the task-owned context in finally. Print only scoped counts/status; do not store full history, health details or credentials.
- The existing hourly Excel run is the only discovery/retry driver. Preserve delivery receipts and ambiguous claims. New unhandled records older than 48 hours stay subject to review; this repair is not approval to backfill them.
- Quiet hours remain 23:00 through 08:59:59 KST. Verification never invokes a send worker, provider POST or member write.

## Release

- Targets: Mac mini runtime scripts and `hosting:archive-pilates-core` only. No Functions, Firestore rules/indexes, API credentials, DNS or scheduler changes.
- CORE rule source updated under `holding-allowance-notice`. No Notion updates.
- Deploy from clean canonical main equal to origin/main with existing guards; fast-forward runtime after reviewed release. Record exact checks, hashes, live evidence and remaining natural-run follow-up in the HTML report.
- Verification: 1,094 Node + 236 TypeScript tests passed, including 56 new transformed-callback regressions; no skips/failures. Existing 82-test focused run is a subset, not additional coverage. CI runs the new credential-free regression after installing dependencies. The workflow itself triggers all-codebase check scope; no Functions runtime/source change or Functions deploy.
- Scoped live reads: all five affected members passed under actual tsx loader, 2026-10-24 04:00:59 through 04:01:08 KST. Only readLatest was called; no DB or provider calls, no worker run, full browser/lock cleanup completed.
