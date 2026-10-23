# Holding browser coordination

- Request: apply the browser stability improvements following three readback lock-contention alerts. No member send or manual queue replay is authorized by this repair.
- Lane: holding-browser-coordinator; branch `codex/mini/holding-browser-coordinator-20261024`; base `origin/main` b64cee6a.
- Source/runtime: `~/dev/archive-in-runtime`. Isolated source: `~/codex-worktrees/holding-browser-coordinator-20261024`.
- Main owns session lifecycle, holding runner, final review and release. Bounded workers own retry/roster state and lock/Excel cleanup. Independent review is read-only.

## Implemented scope

1. A lazy, serial, batch-owned browser session reuses the existing dedicated automation profile under the existing cross-process lock. Each read uses a fresh page; no source data is cached. The pre-claim live recheck remains required.
2. Lock contention waits up to 15 seconds, then becomes a typed pre-event deferral, not a provider attempt or ambiguous delivery. Keep pending with 5/10/20/30-minute eligibility backoff and preserve retry state across fresh Excel hints for the same resolved member/ticket only.
3. Existing hourly execution is the only retry driver. No daemon, scheduler, profile, token, source-of-truth collection or provider is added. First internal alert after two hours of continued contention; stable alert key and acknowledged-alert marker prevent spam. Failed internal alert attempts remain eligible for reconciliation/retry using that same key.
4. Abort/timeout must close the owned context before release. If closure cannot be established, retain the lock; never kill user browser processes or override a live owner. Excel result-write failures cannot bypass browser cleanup.
5. Existing receipts/claims, canonical source verification, 48-hour registration rule, staff exclusions, send window and memo pipeline are unchanged. Do not reset historical baseline, edit live jobs, resend notices or backfill memos.

## Source policy

- Canonical source: live StudioMate ticket/history plus existing canonical member, notice-event, send and claim records.
- Provisional retry state: existing `workLanes/holding-allowance-notice/readbackJobs` only, never an authority for a send. No new CRM mirror or new send source is created.
- Retry identity: existing job key, native member ID, memberKey and ticketName. Fresh sourceImportId/discoveryVersion are never carried from an old job.
- Allowed consumers: existing hourly holding worker only. No direct browser/API invocation from mirrors, no new scheduling.

## Verification and release

- Tests use synthetic pages/contexts, isolated temporary lock paths and fixture queues. No operational browser or live member data is mutated.
- CORE rule: `core/rules/index.html#holding-allowance-notice` updated in this change; Notion is not changed.
- Release target: runtime scripts + CORE Hosting operating-rule page only. Functions and Firestore rules/indexes are not changed.
- Exact commands/results, release revision and live checks belong in `docs/reports/2026-10-24-holding-browser-coordinator.html`.
- Remaining stage: a permanent central browser owner for Excel/memo/MCP is not claimed. Existing legacy workers keep using the shared lock. Natural next-run contention/recovery remains a post-release observation, not a synthetic-test result.
