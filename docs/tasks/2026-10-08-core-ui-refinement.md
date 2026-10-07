# ARCHIVE CORE UI Refinement

- Request: improve the entire operator UI and remove unnecessary copy.
- Branch: `codex/mini/core-ui-refinement-20261008`, base `d2566b2e`.
- State: UI release `93c154e1` committed, pushed to main and deployed on 2026-10-08; live verification passed. This follow-up records the verified state in CORE operating rules and the report.

## Changes

- Shared final stylesheet for all 20 CORE shell pages. Bright neutral sidebar, official logo, consistent typography, spacing, inputs, status labels, unframed operational sections.
- Local Lucide icons for navigation, search, refresh and mobile menu; accessible labels, visible keyboard focus and reduced-motion behavior.
- Remove decorative English labels, duplicated prose and static business explanation sections. Preserve source/date limits, approval/privacy warnings, safety checks, controls and operational IDs.
- Existing sequence editor/store, Firebase authentication, Firestore readers/writers, sends, reservations and refund calculations are unchanged.
- Regenerate Alimtalk catalog fingerprint/source line metadata only. No template or sending policy change.
- Adapt the existing VM test harness to bundle the local presentation import; retain every existing test assertion.
- Local-only inert preview server with empty Firebase config, no connection/form actions, disabled external navigation and sample DOM records.
- CORE operating rules record completed implementation, scoped Hosting deployment and verification in the existing operator-workflow record.

## Verification

- `npm run validate:archive-core-hosting`: passed.
- `npm run test:core-operator-workflow`: 52 JavaScript and 26 TypeScript tests passed.
- `node --test scripts/tests/core-ui-refinement.test.mjs scripts/tests/core-private-design.test.mjs`: 30 passed.
- `node scripts/verify-archive-core-responsive.mjs`: 95 combinations, 320/390/768/1440/1920px.
- `node scripts/verify-core-ui-refinement.mjs`: 32 combinations, login/populated/search-dialog captures, navigation/details/focus/icons/overflow checks.
- Additional preview smoke at 320/390/1440px: no horizontal overflow, refresh control 44px, empty Firebase config.
- `git diff --check` and JavaScript syntax checks: passed.
- Initial local issues (desktop nav specificity, mobile toolbar overflow, unequal metric rows, small seat captions and module-aware test loading) were corrected and rechecked.
- Preflight review found count badges overlapping disclosure indicators; reserve 36px and verify 8px clearance. The 32-combination browser recheck passed.
- `bash scripts/deploy-archive-core-live.sh`: passed from clean main identical to origin/main, including dry-run, Hosting sites `archive-pilates` and `archive-pilates-core`, local 95 and live 95 responsive combinations, and live release canary.
- Direct live readback: both CORE URLs report release `93c154e1`; interface.css, ui-icons.js, app.js and Alimtalk catalog exactly match source hashes on both URLs.
- Deployment log: `/tmp/archive-core-ui-deploy-20261008.log`.

## Boundaries

- UI layout QA uses synthetic data; live asset/release checks use real Hosting. No real member authentication, production data changes, external sends or StudioMate work. Hosting deployment and Git push were explicitly approved and completed.
- Sequence QA covers the shared shell; editor persistence was not retested because its source/store were untouched.
- Screen-reader and exhaustive contrast audits were not run.
- All task-owned test browsers/contexts close in finally blocks. The localhost review server is stopped during release cleanup.
- Follow-up operating-rule/report commit uses the same main promotion and scoped Hosting verification process. Latest source version is exposed by `/release.json`.

Report: `docs/reports/2026-10-08-core-ui-refinement.html`.
