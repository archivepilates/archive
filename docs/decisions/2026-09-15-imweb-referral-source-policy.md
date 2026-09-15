# ARCHIVE PILATES Referral Source Policy

Status: local prototype, not promoted or deployed. Updated 2026-09-15.

## Approved Benefit

Inviter-only KRW 3,000 after a new signup, at most KRW 30,000 per inviter per KST calendar month. No purchase or phone authentication. The native campaign and custom worker must never award simultaneously. Existing members and prior-month backfills are excluded until explicitly approved.

## Sources And Identity

- Canonical source: a complete, scope-checked Imweb member API scan, including immutable member code, join timestamp, own recommendation code and signup recommendation target code.
- Stable identity: `siteCode + unitCode + memberCode`. Email is an additional self-referral guard only. Names, browser hashes, submitted member IDs, CORE mirrors and `workLanes` cannot authorize an award.
- Native recommendation codes are public link tokens, not authentication credentials. Do not put email, phone, member UID or API credentials in links or browser storage.
- Local ledger: `ReferralLedger` requires one absolute SQLite path in an existing owner-only directory outside Git. Activation must record the final path, owner and backup procedure. No production ledger has been created.
- The ledger is the canonical award-attempt and budget record; Imweb points logs are canonical provider-outcome evidence. Neither is a replacement for the member source.
- No Firestore/CRM mirror collection is introduced. There is no public award endpoint or browser-to-Firebase member impersonation route.

## Dedupe And Failure Behavior

- Unique SHA-256 identity per new member across policy versions. First recorded inviter remains bound.
- SQLite immediate transactions reserve identity and month budget together. Pending, dispatching, paid and uncertain awards consume the reserved budget.
- A dispatch claim is single-use. Unknown provider outcomes are held for reconciliation, never automatically re-sent or released.
- Paid status requires an independently verified provider log matching recipient, reason and amount. An HTTP success or balance change alone is insufficient.
- The live point-log API has no log ID. The proof adapter requires a complete consistent scan and exactly one matching row, then uses a derived fingerprint of its fixed fields. Identical duplicate rows, missing pages, changed totals, other recipients or invalid timestamps stop reconciliation. This fingerprint is not a provider-issued ID.
- Log proof confirms the original award occurred, not that its current net balance remains positive. A separate approved test reversal leaves a negative log and must be verified independently.
- Monthly-cap rejection is terminal for that signup. No carry-over. A delayed event from an earlier month requires operator review.
- Complete-source failure stops before any award. Large member growth beyond scan bounds must be handled explicitly, not by awarding from partial pages.
- Different emails do not prove different people. Without phone authentication, person-level multi-account abuse cannot be fully prevented.

## Allowed Readers And Forbidden Actions

- Private Mac mini worker and authorized operator only. SQLite contains pseudonymous member keys and must remain private.
- Public widget reads only a native public recommendation code and stores only that code for the current browser tab.
- No browser/UI content may choose a points recipient or amount. No customer messages, order changes, group changes, classroom changes, or enrollment changes are part of this lane.
- Logs/reports contain aggregate counts and fixed reason codes only. Do not store raw provider responses or member data in Git.

## Promotion Gate

1. Required signup terms approved and user completed test signup. Native signup field observed as `#join_form input#recommend_code[name="recommend_code"]`. Automatic invite-link wiring and social signup remain pending.
2. Completed: read new member's native `recommendTargetCode` from the full Imweb scan and uniquely resolved the intended ordinary test inviter.
3. Provider operation and signup-worker checks completed 2026-09-15 in two separately approved test cycles. Each returned inviter balance 0 -> 3,000 -> 0 with exact positive/reversal logs; both members' groups unchanged. The worker used real canonical signup attribution, a private durable test ledger and real log verification. No signup scheduler or production activation is implied.
4. Duplicate prevention passed before and after reopening the ledger: zero additional prepare/send attempts. Keep the historical paid test record after reversal. Existing ordinary-member video access regression remains pending; no entitlement groups changed.
5. Run responsive browser QA. The local file URL was blocked by browser policy on 2026-09-15; no workaround was attempted and preview visual QA remains pending.
6. Approve start timestamp, production ledger path/backup, one award engine, deployment scope and worker schedule. Update CORE rule state only after live verification.

Unit tests and the generated preview are not proof of native signup attribution or real points payout.

The home Chrome admin session was verified. Required terms consent and user-completed new test signup are confirmed; the third-party disclosure still contains example placeholder text requiring separate review. Existing administrator autofill was not used as a substitute for a newly created ordinary member. No supplied password was stored.
