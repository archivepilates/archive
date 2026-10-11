# Homepage instructor lesson order read hardening

- Worktree: /Users/archivepilates/codex-worktrees/instructor-order-read-hardening
- Branch: codex/mini/instructor-order-read-hardening
- Source: origin/main, base 65464e69.
- Approval: implement, verify, update Mac mini runtime and CORE rules, scoped deploy, commit and push.
- Account/target: Imweb default profile for the fixed ARCHIVE PILATES site; Firebase archive-pilates with archive-codex-operator.

## Confirmed failure

The 2026-10-11 16:34 KST alert had IMWEB_REQUEST_FAILED but no structured diagnostics. The order helper lost top-level error metadata, did not reject zero-exit failure envelopes, and did not retry verified transient reads. The sync wrapper did not pass failureDetails to the incident observer. Token renewal coincided with the incident but cannot be established as its cause from missing historical diagnostics. The scheduled full scan recovered at 18:35:52 KST before this release.

## Scope and safety

- Retry order list/get only once after 500ms, only for verified network/429/5xx failures.
- Auth, conflicting error streams, malformed responses and source mismatches fail immediately.
- Preserve sanitized operation, phase, status/provider/transport code, failure kind and read attempt count in incident state, runner report and CORE status warnings.
- Complete source scan before admitting new work. Failed scans retain previous fingerprints and release their lock.
- Keep the existing three-consecutive-transient-failure alert and one recovery notification; skipped/manual reads cannot clear an incident.
- Preserve canonical registration transactions, member/pass/message deduplication, prices, staff exclusion, 10-minute scans and 2-minute runner scheduling.
- No live member, ticket, booking, contract, payment, points or SOLAPI writes for validation. No forced production queue run or incident reset.
- No Functions, Firestore rules, indexes or schema changes; only the Mac mini scripts and CORE Hosting rules are affected.

## Verification and release

- Focused fault-injection and existing referral/order/notification regressions: 225 passed, 0 failed, 0 skipped.
- Additional system-health current-state, queue, schedule and web-surface regressions: 59 passed. Instructor registration release validator passed.
- CORE Hosting/catalog and rollback guards: passed after linking the existing runtime dependency directory. Initial checks lacked TypeScript/tsx in the new worktree; no production failure.
- Syntax checks: passed for order source and registration runner. Diff whitespace check passed.
- Affected Functions detection: no codebases affected.
- Read-only live source verification: 88 orders, 8 relevant, 0 changed relevant fingerprints, 0 issues; full query took 1487ms. Latest scheduled success before release: 18:45:58 KST.
- Released source: 0596b08c5e129634c55195b8f7b66bb140798f96, promoted to origin/main and pushed to the lane branch. Clean main deploy checkout and Mac mini runtime fast-forwarded.
- Hosting: archive-pilates-core plus the existing CORE mirror on archive-pilates. No Functions deployment. Predeploy guards and all 10 CORE live canary checks passed for the exact source SHA.
- Live rules readback: HTTP 200 and new rule marker on core.archivepilates.com/rules/ and archive-pilates.web.app/core/rules/.
- Canonical read-only audit: 8 tracked orders, 8 ledgers, 8 completed registrations, 8 verified ticket steps, 8 verified confirmation steps, 0 external order reviews; automation status healthy.
- LaunchAgent remains loaded, run interval 120 seconds, last exit code 0. No restart, forced queue execution, browser session, test member creation or duplicate send.
- GitHub CI for deployed source: run 38129776267 completed successfully.
- First natural full scan after promotion: 2026-10-11 18:56:04 KST, scanned 88, new items 0, issues 0, ok=true. Alert lastOutcome=success, consecutiveFailures=0; runner ok=true, processed=0, failed=0. No forced execution or state reset.
- Complete: source, runtime, Hosting, CI and natural scheduled execution independently verified. Historical provider cause remains unproven; external service outages still require bounded recovery or operator intervention.
