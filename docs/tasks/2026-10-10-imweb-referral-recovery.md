# Referral failure diagnostics

- Request: diagnose recurring homepage referral award failure/recovery emails.
- Source: home@archivepilates.com Gmail failure/recovery pairs; private referral worker stdout/status and read-only SQLite ledger.
- Base: origin/main 10cdfde3; dedicated codex/mini/referral-failure-diagnostics-20261010 worktree.
- Verified defect: installed CLI 0.1.13 emits nested error.status_code; existing classifier read only statusCode. Source/worker/runner discarded non-transient details as WORKER_FAILED.
- Historical boundary: 7 failures among 1641 executions since Oct 4 at initial inspection; each next run succeeded. Original provider error payloads were not retained. Latest failure coincided with token issuance, which is a clue, not proof of an OAuth root cause.
- Read-only ledger: both canonical reward tables empty; no unresolved local payouts observed. No manual award or repair performed.
- Changes: parse structured stdout/stderr and fail closed on conflicting HTTP metadata; one retry only for member-list network/429/5xx reads; keep sanitized stage/role/status diagnostics through runtime state and notification. No retry of writes/dry-run/ambiguous dispatch.
- Validation: 359 referral, order intake, notification and system-health tests passed, including later-page CLI retry exhaustion and full-scan recovery. Initial expanded run lacked the worktree TypeScript dependency; dependency linked before final rerun. CORE Hosting and rollback guards passed; read-only independent safety review found no remaining blockers.
- Approval: user approved operating runtime rollout, CORE Hosting deployment, commit and push. No manual real award authorized or performed.
- Operating rules: CORE rules updated; no Notion duplicate or schema/config/ledger change.
- Deployed source: 5804ca3f42ffbd82db7c94fb1e93b4b76aa58c84. Both archive-pilates and archive-pilates-core Hosting completed; custom domain/web.app rules readback passed. Local/live responsive checks 95 each; live canary 10; GitHub Actions 37972070119 succeeded. Functions/rules/indexes unchanged.
- Runtime: clean archive-runtime-main fast-forwarded to deployed source; loaded LaunchAgent retains 300-second interval and existing entrypoint. No kickstart, apply rerun, configuration/ledger reset or real points mutation performed.
- First natural updated run: 2026-10-09T18:18:25.314Z to 18:18:27.398Z (2026-10-10 03:18 KST), success in 2.084 seconds, 114 members/3 pages, sendAttempts/held/unresolved/failures all zero. query-alert-state success with zero streak and no notified incident; both reward tables still empty.
- Read-only installed CLI 404 probe on deliberately nonexistent member preserved IMWEB_REQUEST_FAILED, HTTP 404 and provider code 30001; no member changed and no alert flow invoked.
- Verification boundaries: historical provider failure cause still unavailable; new real referral payout was not manufactured. Actual transient provider incident/recovery under the new classifier remains naturally occurring future evidence; mocks cover the three-failure threshold and recovery rules.
- Browser cleanup: responsive verifier exits via browser.close()/server.close() finally; no task-owned verifier process remains. No user browser was opened or closed.
- Final verification record is source-only documentation; no second Hosting deployment needed for this local report update.
- Report: docs/reports/2026-10-10-imweb-referral-recovery.html.
