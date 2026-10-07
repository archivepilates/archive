# ARCHIVE CORE UI Refinement

- Request: improve the entire operator UI and remove unnecessary copy.
- Branch: `codex/mini/core-ui-refinement-20261008`, base `d2566b2e`.
- State: implemented and locally verified; Hosting release approved on 2026-10-08, preparing scoped commit and deployment.

## Changes

- Shared final stylesheet for all 20 CORE shell pages. Bright neutral sidebar, official logo, consistent typography, spacing, inputs, status labels, unframed operational sections.
- Local Lucide icons for navigation, search, refresh and mobile menu; accessible labels, visible keyboard focus and reduced-motion behavior.
- Remove decorative English labels, duplicated prose and static business explanation sections. Preserve source/date limits, approval/privacy warnings, safety checks, controls and operational IDs.
- Existing sequence editor/store, Firebase authentication, Firestore readers/writers, sends, reservations and refund calculations are unchanged.
- Regenerate Alimtalk catalog fingerprint/source line metadata only. No template or sending policy change.
- Adapt the existing VM test harness to bundle the local presentation import; retain every existing test assertion.
- Local-only inert preview server with empty Firebase config, no connection/form actions, disabled external navigation and sample DOM records.
- CORE operating rules contain the implementation, verification and pending release state in the existing operator-workflow record.

## Verification

- `npm run validate:archive-core-hosting`: passed.
- `npm run test:core-operator-workflow`: 52 JavaScript and 26 TypeScript tests passed.
- `node --test scripts/tests/core-ui-refinement.test.mjs scripts/tests/core-private-design.test.mjs`: 30 passed.
- `node scripts/verify-archive-core-responsive.mjs`: 95 combinations, 320/390/768/1440/1920px.
- `node scripts/verify-core-ui-refinement.mjs`: 32 combinations, login/populated/search-dialog captures, navigation/details/focus/icons/overflow checks.
- Additional preview smoke at 320/390/1440px: no horizontal overflow, refresh control 44px, empty Firebase config.
- `git diff --check` and JavaScript syntax checks: passed.
- Initial local issues (desktop nav specificity, mobile toolbar overflow, unequal metric rows, small seat captions and module-aware test loading) were corrected and rechecked.

## Boundaries

- Synthetic/local QA only. No real auth, production data changes, external sends, StudioMate work, deployment or Git push.
- Sequence QA covers the shared shell; editor persistence was not retested because its source/store were untouched.
- Screen-reader and exhaustive contrast audits were not run.
- All task-owned test browsers/contexts close in finally blocks. Only the localhost preview server remains available for operator review.
- Remaining release step: scoped commit, main promotion, Hosting deployment and live verification; then update the final release evidence.

Report: `docs/reports/2026-10-08-core-ui-refinement.html`.
