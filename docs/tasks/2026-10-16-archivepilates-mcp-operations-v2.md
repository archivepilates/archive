# archivepilates-mcp operational upgrade

- Worktree: /Users/archivepilates/codex-worktrees/archivepilates-mcp-operations-v2.
- Branch: codex/mini/archivepilates-mcp-operations-v2 from origin/main 2c7a5238.
- Request: fix missing/slow member lookup; support conditional ticket lists; assess operational workflows including monthly fixed bookings and class copy.
- Approval: user approved tested operational MCP connection, CORE rules Hosting, scoped commit/push on 2026-10-16. No booking/class/member/message writes authorized by these examples.

## Confirmed causes and implemented scope

- Kim Seowon failed LIVE_IDENTITY_MISMATCH even though name/full phone matched because member grade was blank. Grade is now nullable metadata, not identity.
- Search no longer depends on ticket layout. First exact search result is clicked directly; overview uses the verified native ID directly. Name/full phone/URL checks and two independently loaded overview views remain.
- Search uses DOM readiness without redundant networkidle. Overview keeps positive same-member ticket request completion (fixed api.studiomate.kr origin, status/finished only, no body/headers), networkidle and DOM readiness before two independent views. Shared browser lock, method guard, cancellation, bounded close and no-fallback remain.
- Add members_list_expiring with typed numeric/enum/boolean args; bounded scoped Firestore projection, coalesced five-minute process memory cache, KST 0..N inclusive filter and explicit quality/coverage metadata. Refresh failure invalidates cache. No disk copy/new collection/scheduler.
- Normalize actual displayed known statuses such as using and Korean remaining-days suffixes; never use the displayed day count to calculate expiry.
- This is snapshot analysis only, not an exhaustive native roster or action target. Current memberProfiles 626 vs latest successful member Excel 991 grouped members establishes a coverage gap, not a 365-member missing count (populations differ). Of 626 records, 67 lack activeTickets arrays, 2 lack usable full phone, 2 inactive/merged. Counts may overlap conceptually; result coverage reports disjoint exclusions.

## Source policy

- Source: canonical memberProfiles.activeTickets for analysis; rendered StudioMate native detail for individual live checks.
- Destination: private process memory <=300seconds only, studio5330/project archive-pilates.
- Identity/dedupe: exact profile ID/studio; explicit merged/deleted exclusions; all same-full-phone identities (including different names) ambiguous unless native/Excel pair has matching done lookup receipt/IDs/name/phone/resolution timestamp. Up to20 pairs checked per refresh, no ticket union. Native incomplete/rich alias remains ambiguous. Stored ticket rows may have upstream lossy dedupe; count is ticketRowCount, not purchased-pass count.
- Allowed readers: active owner/manager every call, even cache hits.
- Forbidden: downstream sends/writes/reservation/refund decisions from this list. Existing automations and queue intake unchanged.
- Dry-run/live-read evidence: self-contained HTML report; no raw member inventory or full phone stored in Git.
- Verification: synthetic tests, candidate SDK stdio real source reads, registered-config SDK smoke after operational promotion; CORE local/live static QA and canary after Hosting.

## Actual candidate proof

- 2026-10-16 01:39 KST: Kim Seowon search 2553/1827ms, overview2556/2196ms, blank grade permitted, 1 displayed ticket; Jung Yuri search1769ms/overview2316ms, 2 displayed tickets.
- Final normalized-status candidate at01:41KST: Kim search4439ms cold/1679ms warm and overview2198/2188ms; Jung1699+2022ms. Cold/lock/network variation retained, no universal latency guarantee.
- 0..10 days =2026-10-16..26 inclusive: snapshot33members/34stored rows, first466ms/cache106ms, coverage stored_profiles_only, not live whole roster. No member/message changes.
- Independent review found3 P2: positive ticket loading completion, different-name shared phone collision, verified native/Excel pair handling. All fixed with regression tests. Candidate161/161 pass; final01:50KST original reads: Kim2795/1804ms search,2994/2972ms overview; Jung1682+2939=4621ms vs prior9430ms (~51% reduction, sample not SLA). Snapshot33members/34rows first490ms/cache94ms.
- CORE local static QA95/95, browser lock7/7, npm audit0. Initial Hosting guard lacked the ignored functions/node_modules symlink; after linking existing runtime dependencies Hosting/catalog validators passed. No dependency lockfile changes.

## Follow-up, not implemented

1. Whole-roster source: reuse existing hourly native Excel before deletion; validate source membership manifest, exact import coverage, freshness, absent/retired rows and canonical linkage. Incubate read-only and compare native samples before promotion. Do not trigger contacts/contracts/holding queues by re-running imports for a query.
2. Monthly fixed bookings: harden/promote historical runner ab38183b from October lane, adapt plan schemas, honor exclusions/session limits, bind independent human approval to immutable plan hash/actor/month/expiry. Durable job idempotency, shared lock, uncertain-outcome stop/reconcile. Finish only after full-month native reservation export and exact-once expected/excluded/unexpected comparison.
3. Monthly group class copy: implement missing native source-reader/create/readback executor, weekday/week mapping and holiday exceptions, retain room/duration/capacity/pricing/settings; exclude private/instructor lessons; weekend/holiday previous-day21:00 applies only ordinary group lessons. No arbitrary request URL/script tool.
4. Only then add approved individual reservation/cancel/refund workflows using existing canonical jobs, separated from financial payment execution.

## Release state

Pending final independent review, commit/main promotion, stable runtime fast-forward, Codex allowlist update, scoped Hosting deploy, registered read-only recheck and GitHub CI. No claim that monthly operations are available.
