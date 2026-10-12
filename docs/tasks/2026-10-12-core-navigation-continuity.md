# CORE navigation continuity

- Request: reduce full-screen connection gates during menu transitions while preserving authorization and Sequence data.
- Worktree: /Users/archivepilates/codex-worktrees/core-navigation-continuity
- Branch: codex/mini/core-navigation-continuity
- Base: a619e5f8e4d63ead2f9f211a1b6d53e514c3d39e
- Go-live approved by user on 2026-10-12: scoped validation, CORE Hosting, commit and push.

## Implementation

Keep the already authorized outer navigation and account bar. Load one same-origin destination document with its existing controller, reuse the outer Firebase runtime, and require the destination's existing server access check before swapping visible content. No local authorization cache, route data cache, provider sends, member writes, new Auth accounts or changed server permissions.

Flush Sequence's acknowledged save loop before navigation. Freeze departing content while preparing the destination. Retain it on failed load or failed save. Destroy departing editors only after acknowledged save and destination readiness. Access isolation and sign-out dispose content frames. Different UID/role/staff/password state fails closed. Keep direct URL reload and browser history support.

## Ownership

Main owns production JS/CSS, Sequence save integration, unit contracts, operating rule and release. Bounded subagent owns scripts/verify-core-instructor-access-ui.mjs and evidence-only review; no production actions.

## Verification

- Sequence adapter/UI: 26 isolated save/PDF/delete/ownership scenarios passed; 320/390/768/1440px.
- Regression unit suite and navigation contracts: passed after exact reviewed bridge normalization and generated catalog fingerprint refresh.
- Initial shell/access, frame navigation/history, pending logout, failed save, role changes, transient access errors and responsive checks: 204 passed, 0 failures. Evidence: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-zZHgB4/report.json. Synthetic fixtures only; all task-owned browser contexts, browser and local server closed.
- Regression/navigation unit checks: 89 passed. Server instructor access contracts: 193 passed. Static responsive checks: 95 passed.
- Production release: validated for scoped Hosting release; deployment evidence will be recorded after live verification.
- No new deployment Functions or Firestore rules are required; server contracts are unchanged.
- Actual iPhone Safari and real member draft navigation are not tested by isolated browser fixtures.
