# ARCHIVE PILATES Referral Read Alert

## Scope

- Stop isolated pre-award member-scan failures from producing repeated failure/recovery email pairs.
- Keep failed execution state, canonical ledger, reward amounts, exclusions, duplicate protection and scheduled cadence unchanged.
- Do not retry point writes, create test rewards, reset production alert state or alter historical records.

## Evidence

- The 2026-10-12 19:40:36 KST failure was `IMWEB_REQUEST_FAILED`, `member_list`, `member_scan`, with null summary and no reward processing started.
- The next regular 19:45:42 KST execution completed successfully: 116 members, 3 pages, no point-send attempts.
- Generic read failures previously bypassed the threshold. Successful recovery reset state, rearming the next isolated alert.
- The historical raw CLI response was not retained; the upstream failure cause is unconfirmed.

## Implementation

- Share strict pre-award read eligibility between the scheduled referral wrapper and system-health deferral.
- Alert only after 3 consecutive eligible scans. Auth, malformed response, source, ledger and point failures stay immediate.
- Preserve exact-run/freshness checks and distinguish newly failing stages even when the generic error code is unchanged.
- Validate CLI response envelopes and retain only sanitized attempt/kind/status diagnostics; verified transient reads retry once, writes never retry.
- Update ARCHIVE CORE operating rules in `core/rules/index.html`.

## Verification

- Run notification, referral, read-adapter, instructor-order and system-health regression tests with injected sources and local fixtures only.
- Validate scoped release and CORE Hosting rollback guards before promotion.
- Adopt the committed source in the canonical Mac mini runtime and observe the next scheduled execution without manually dispatching the worker.
- Verify published CORE rules and clean Git status. No paid-video access or member records are changed.

## Pre-release Results

- 286 notification/referral/read-adapter/instructor-order/system-health tests passed; provider calls and rewards were mocked.
- CORE static layout QA passed 95 route/viewport checks, including 320, 390, 768, 1440 and 1920 widths. This is not an authenticated data test.
- Hosting, onsite-retirement, ticket-price and live-release rollback guards passed. Worktree dependencies were linked from the canonical runtime after an initial missing-dependency check.
- Updated read-only CLI scan completed: 116 members, 3 pages, complete source; no reward calls.
- Independent review caught and repaired same-code alert identity collisions and conflicting-status deferral; both have dedicated regressions.
