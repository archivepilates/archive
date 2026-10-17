# CORE Home Priority Query

- Worktree: `/Users/archivepilates/codex-worktrees/core-home-priority-query`.
- Branch: `codex/mini/core-home-priority-query`.
- Base: `7b84a432d176889884cad9757ef69831d9b7f5b8`.
- Request: investigate erroneous home priorities. User approved Hosting deployment, scoped commit and push on 2026-10-17; no member/provider writes or sends.
- Sources: deployed authenticated CORE home/navigation, browser warning logs, canonical Firestore query code. No member or provider mutation, sends or scheduler changes.

## Confirmed Cause

Direct home loads completed, while home reached through shared-runtime iframe navigation failed all five unresolved communication queries. Firebase 10.14.1 rejects foreign-frame arrays (`Unsupported field value: a custom Array object`). The query constraints were built by the child and parsed by the owner's Firebase SDK.

## Repair

- Owner initialization installs `createRealmSafeWhere` after the Firestore spread. Top-level status/document-ID arrays are copied using the SDK owner's Array constructor; scalar values, SDK objects, policy sets and source selection are unchanged.
- Read-health failures name their source instead of repeating the same generic title five times.
- Existing open owner documents require a full reload after a future release. Child-only refresh cannot replace an old owner runtime.
- No broader normalization of nested objects or write payloads is claimed.

## Verification

- Actual installed Firebase 10.14.1 query construction reproduces the unpatched failure, then accepts each patched status list and document-ID list with no network read.
- VM production action-query tests verify all five collections, actionable failure rendering and distinct failure labels. Existing home, renewal and navigation tests remain required.
- Isolated full-app browser navigation QA uses a strict cross-frame array validator; all fixtures are synthetic and all external writes/network blocked. Screenshots and cleanup evidence are in its generated report.
- Production comparison: direct home showed a successful read, iframe home showed unavailable communication reads. This is reproduction evidence, not post-release proof or independent validation of renewal eligibility.
- Final regression: 55 tests passed across query, home workflow, navigation, renewal visibility and catalog suites. Hosting validator, rollback guards and `git diff --check` passed.
- Chromium synthetic full-app navigation: 8 scenarios passed across `/` and `/core/` at 320, 390, 768 and 1440px. Returned iframe home reads all five status sources, preserves the same shared runtime, shows no unavailable source state and does not overflow. Eight contexts closed, browser/server closed, fixtures remaining zero. Evidence: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-fkcOkG/report.json`.
- First browser pass stopped on the harness's outdated manager-only library tab label. Updated that locator to the existing manager label; no Sequence feature code changed. The clean rerun passed all eight scenarios.
- Catalog regenerated only for app source fingerprint and shifted source lines; no template policy changed. New worktree dependencies link existing installed runtime packages; no package/lockfile edits.

## Not Changed

No Functions, Firestore rules/indexes, data model, approval/duplicate/exclusion policy, automatic send or automation cadence changes. Follow-up findings about stale-source classification, cached renewal urgency, pending bucket overlap/test exclusion and automation pagination are distinct from the confirmed cross-frame failure; do not claim those are repaired by this narrow patch.

## Release

Completed release from clean main source `2b0d8070a74c45d18ac5536a543d8ba8d90bb7f6` on 2026-10-17. Main and feature branch pushed. Used `archive-codex-operator@archive-pilates.iam.gserviceaccount.com` with the existing service-account setup script, project `archive-pilates`.

- `npm run deploy:archive-core-live` passed all guards, Hosting dry-run, deployment and independent canary verification. Only `hosting:archive-pilates,hosting:archive-pilates-core` deployed; Functions, Firestore rules/indexes and automation schedules unchanged.
- Pre/post-release responsive checks each passed 95 cases across 18 routes at 320/390/768/1440/1920px. These are layout/static checks, not a replacement for authenticated source verification.
- Both canonical release manifests report exact source `2b0d8070a74c45d18ac5536a543d8ba8d90bb7f6`; app, helper, catalog and operating-rules files each hash-match the committed files on both custom-domain and web.app/core surfaces (eight comparisons).
- Live hashes: app `d5fa431ec3df9340db22e2283d57bd08d28a221da26c08d96c96bd55e5c9c780`; helper `02d2ff7fa4c60fbbb9e9a420d5ae092bcae659de6baa34fd9f0a8f38bff222c1`; rules `c5fcbda31e15e4f30352fd2453b0cc624b936cbe9d4b5a98255004aa8eff6338`.
- Fresh existing-operator Chrome session: direct home succeeded, messages iframe succeeded, returning to home iframe and its refresh button succeeded. Home displayed `9건 확인 필요` and `조회 완료` consistently; these are observed UI values, not an audit of all renewal cases. Browser warning/error logs were empty after navigation and refresh. Task-owned tab `2059969241` closed.
- GitHub Actions run `38997003303` succeeded for source commit `2b0d8070`; no CI repair needed.
- Existing pre-release tabs were not changed or closed. A full browser reload is necessary to replace old parent-frame code. The task-owned live-verification tab is closed after final readback; no StudioMate browser/profile lock was used.
- No manual sends, retries, approval mutations, member changes or source-state resets. Final documentation-only evidence commit does not require redeploying unchanged runtime files.
