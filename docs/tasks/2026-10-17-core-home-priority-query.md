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

Approved release preparation. Deploy only the existing two CORE Hosting surfaces after scoped checks and clean-main promotion. Final deployment evidence is appended after independent live readback. Functions, rules, canonical records and schedules remain untouched.
