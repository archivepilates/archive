# ARCHIVE CORE CRM Design

- Request: a clean contemporary CRM interface with appropriate animation.
- Worktree: `/Users/archivepilates/codex-worktrees/core-crm-design-20261008`.
- Branch: `codex/mini/core-crm-design-20261008`, base `5d5dd49c` (`origin/main`).
- State: user approved the scoped commit, main promotion, CORE Hosting deployment, live verification and push on 2026-10-08; execution in progress.

## Scope

- Shared neutral sidebar, white active navigation with official red accent, calmer headings, lists, tables, controls and status colors.
- Local Lucide quick-action/close icons; no new runtime library or remote icon requests.
- Remove the repeated visible home section heading while retaining its accessible section name. Move the private title into its existing toolbar.
- Private board adapts to usable container width rather than forcing four narrow columns at a viewport breakpoint.
- Dynamic viewport-safe search results, inset sidebar keyboard focus, solid form focus borders.
- Finite CSS entrance and disclosure effects (150-180ms), hover and press feedback. No animation delay, data-driven observer, new timer, polling or query. Reduced-motion disables effects. Busy refresh rotation is existing behavior.
- Preserve all operational identifiers, fields, handlers, canonical data sources, auth, sends, bookings and refunds. Sequence editor/Firestore adapter/PDF layout remain untouched.
- Generated Alimtalk catalog changes are app source fingerprint metadata only, not template or sending rules.
- Existing CORE operator-workflow record describes this CRM release separately from the prior UI release and links its Hosting release manifest for the current deployed version.

## Verification

- `npm run test:core-operator-workflow`: 52 JavaScript + 26 TypeScript tests passed.
- `node --test scripts/tests/core-ui-refinement.test.mjs scripts/tests/core-private-design.test.mjs scripts/tests/core-crm-motion.test.mjs`: 39 passed, including unchanged Firebase/auth/read/write contracts, retained HTML controls and bounded/reduced-motion contracts.
- `npm run validate:archive-core-hosting`: passed. The removed duplicate heading retains the same accessible section name required by the existing guard.
- `node scripts/verify-archive-core-responsive.mjs`: 95 route/viewport combinations passed at 320/390/768/1440/1920px.
- `node scripts/verify-core-ui-refinement.mjs`: 32 populated/login combinations passed after toolbar alignment.
- `node scripts/verify-core-crm-motion.mjs`: 56 combinations passed (7 routes x 4 widths x normal/reduced motion), with source hashes matching the reviewed UI. Zero forbidden requests; all 8 contexts, browser and server closed.
- Additional 390x420px interactive search check passed: dialog remains inside the viewport, results scroll, search/close controls remain accessible and Escape closes it.
- `npm run build:dashboard`: passed; generated dashboard files are unchanged in Git.
- `node --check core/assets/app.js`, `git diff --check`: passed.
- Main visually inspected desktop/mobile synthetic home/private screenshots, including the final mobile private toolbar spacing and two-column board.

## Boundaries And Cleanup

- Live CORE anonymous read verified the current source surface; no real authentication, member data or external actions used.
- Presentation checks use an empty Firebase config, synthetic DOM fixtures and localhost-only GET requests. They are not proof of production rendering or real workflow writes.
- Browser/context/server cleanup is in verifier finally blocks. Task-owned interactive browser must close before completion; local review server may remain only as an explicitly reported preview service.
- Final cleanup: interactive session `core-crm-20261008` closed; its browser PID 40449 no longer exists. Read-only review agents are closed. The sole intentionally retained preview process is PID 46921, listening only on `127.0.0.1:4180`, with synthetic data and external writes blocked.
- Exhaustive screen-reader/contrast audit and real-device Safari testing are not included. Container queries degrade to a single-column board in older browsers.
- No unrelated work in the historical Documents checkout or other worktrees was changed.

Report: `docs/reports/2026-10-08-core-crm-design.html`.

## Release Approval

- Explicit user request: `배포해줘` after reviewing the local preview.
- Target project/account: `archive-pilates`, `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`, via the existing service-account setup script.
- Targets: `hosting:archive-pilates,hosting:archive-pilates-core` to update both `/core/` compatibility and the dedicated CORE domain. Functions and Firestore are excluded.
- The repository guard requires a clean `main` exactly matching freshly fetched `origin/main`, so scoped main promotion/push precedes the approved Hosting deployment. Post-deploy evidence is recorded separately.
