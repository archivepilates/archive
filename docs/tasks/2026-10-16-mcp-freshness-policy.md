# StudioMate MCP Live Read Policy

- Worktree: `/Users/archivepilates/codex-worktrees/mcp-freshness-policy`
- Branch: `codex/mini/mcp-freshness-policy`; base: `9f8f54a3`.
- User approval: live read improvements, existing MCP runtime adoption, CORE rules Hosting, commit/main promotion/push. No member/pass/booking/message mutations or scheduled job changes.
- Implemented: existing seven read tools; default live inventory and booking history; explicit snapshot only; fail closed without silent fallback; source observation/query/cache timing separated.

## Data Contract

- Source: StudioMate center 5330 authenticated UI. Search/overview use rendered DOM. Inventory/booking history project minimal fields from UI-generated GET responses; no arbitrary private API calls, header extraction, or framework-state scraping.
- Destination: per-request memory only; bounded identity selection cache (200 identities/10 minutes). Explicit snapshot uses existing private 5-minute inventory cache. No new Firestore collection, index, mirror, or worker.
- Canonical identity: native member and issued-ticket/booking IDs, center, name and full phone. Phone returned masked. No temporary-ID inference.
- Duplicate policy: page totals/IDs/row counts/order checked; duplicates fail. Inventory rereads first page; booking history rereads traversed pages. No source rows merged/deleted.
- Coverage: complete means traversal, not an atomic snapshot. `pointInTimeComplete=false`, `atomicSnapshot=false`, source window and stability check disclosed. Current userTickets only, not deleted/ended passes or payment ledger. Invalid identities excluded with explicit counts.
- Allowed readers: active canonical owner/manager rechecked per call.
- Forbidden downstream: no member-facing writes/sends/reservation/refund decisions; `allowedForExternalActions=false`. No import/queue/manual run, baseline reset, schedule changes or production fixtures.
- Limits: 45-second live budget including shared lock wait, 5-second lock wait; inventory 2,000 profiles/200 matches; booking 31-day window, 2,000 scanned/200 returned. Resource closure before shared lock release.

## Verification

- Native-model/freshness/service tests and isolated Chromium UI fixtures, no production writes.
- Live read-only source: 1,036 members/21 pages/508 ticket rows; first inventory 27,952ms, SDK inventory 16,123ms. 10-day expiry 33 matching members/34 rows, 45 invalid identity profiles disclosed.
- SDK name search 1,792-2,493ms; overview 3,041-3,094ms. Selected native member's existing October cancellation history: 2 records; 1,430ms. No repeat cancellation.
- Candidate SDK verified live vs explicit snapshot freshness. Stored inventory 626 profiles is not same coverage as live 1,036-member roster.
- Independent review identified non-atomic page shifts; booking traversed-page reread added, inventory stability limitation exposed rather than promising a single snapshot.
- Detailed report: `docs/reports/2026-10-16-mcp-freshness-policy.html`.
- Final local checks: MCP 234/234; shared browser lock 7/7; npm audit 0 vulnerabilities; CORE Hosting validator and rollback guards passed; responsive static CORE 95 checks (320/390/768/1440/1920), HTML report 320/390/768/1440 overflow checks passed.
- Live candidate stdio smoke passed all seven read tools, date indexes, and unknown write tool rejection; inventory 13,569ms, selected member bookings 2,378ms. No production fixtures or data changes.
- Pagination cancel/deadline tests verify no pending waits and close-before-lock-release ordering for both new readers.

## Release Status

- Implemented/verified locally; runtime adoption and Hosting pending final validation.
- Required: scoped commit/main promotion, clean main Hosting deploy, runtime fast-forward, fresh registered SDK checks, CI and final clean status.
- No Functions, IAM, Firestore rules, member records or schedules are release targets.
