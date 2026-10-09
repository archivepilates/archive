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
- Deployment and natural scheduled-run verification: pending.
- Report: docs/reports/2026-10-10-imweb-referral-recovery.html.
