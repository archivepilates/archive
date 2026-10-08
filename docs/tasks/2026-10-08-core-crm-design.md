# ARCHIVE CORE CRM Design

- Request: a clean contemporary CRM interface with appropriate animation.
- Worktree: `/Users/archivepilates/codex-worktrees/core-crm-design-20261008`.
- Branch: `codex/mini/core-crm-design-20261008`, base `5d5dd49c` (`origin/main`).
- State: completed on 2026-10-08 after explicit release approval. Final source `9a6712da2bb8e562743b8a6167ab0e4787d7de55` is promoted/pushed to main and deployed to CORE Hosting. Live responsive/canary, byte comparisons, anonymous motion/focus smoke and exact-SHA CI passed. Post-deploy documentation is a separate Git commit, not a new Hosting release.

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
- `node --test scripts/tests/core-ui-refinement.test.mjs scripts/tests/core-private-design.test.mjs scripts/tests/core-crm-motion.test.mjs`: 40 passed after the keyboard follow-up, including unchanged Firebase/auth/read/write contracts, retained HTML controls and bounded/reduced-motion contracts.
- `npm run validate:archive-core-hosting`: passed. The removed duplicate heading retains the same accessible section name required by the existing guard.
- `node scripts/verify-archive-core-responsive.mjs`: 95 route/viewport combinations passed at 320/390/768/1440/1920px.
- `node scripts/verify-core-ui-refinement.mjs`: 32 populated/login combinations passed after toolbar alignment.
- `node scripts/verify-core-crm-motion.mjs`: 56 combinations passed (7 routes x 4 widths x normal/reduced motion), with source hashes matching the reviewed UI. Zero forbidden requests; all 8 contexts, browser and server closed.
- Complementary fresh live smoke on the final source: 28/28 combinations passed (7 routes x 390/1440px x normal/reduced motion). Natural first Tab visibly focuses the login form. Normal entrance is 180ms with zero delay; reduced motion is disabled. Zero runtime/network errors, forbidden actions, authenticated sessions or live fixtures.
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

## Live Release Evidence

- Final source commit: `9a6712da2bb8e562743b8a6167ab0e4787d7de55`. Includes design `cd7b54a`, CSS-only login background focus fix `a20baa39`, and verifier preparation fix `9a6712da`.
- Clean main deployment checkout: `/Users/archivepilates/codex-worktrees/system-hardening-20260914`; exact freshly fetched origin/main guard passed.
- `bash scripts/deploy-archive-core-live.sh`: exit 0. Hosting dry-run and deployment completed for both approved sites. Functions/Firestore deploy targets were not used; affected Functions detection returned no codebases.
- Live `https://core.archivepilates.com` responsive verifier: 95 combinations passed at 320/390/768/1440/1920px.
- Live canary: 10 checks passed, including both release manifests, home, registration, app and operating rules.
- Main directly compared 7 deployed files on each of the two URLs against committed source: home/private/rules HTML, app.js, interface.css, ui-icons.js and catalog JSON. All 14 matched byte-for-byte; both manifests report the exact source commit above.
- Live `interface.css` returns `Cache-Control: public, max-age=0, must-revalidate`.
- GitHub Actions `ARCHIVE IN Functions Affected Check`, run `37717732507`: completed/success for exact final source SHA. Main directly read the run status and an independent agent checked the logs: no affected Functions (`codebases: []`), no failures. URL: `https://github.com/archivepilates/archive/actions/runs/37717732507`.
- Independent fresh live source comparison matched 12/12 files and both manifests; main separately matched 14/14 files. Evidence: `/tmp/archive-core-crm-live/results.json`, `/tmp/archive-core-crm-live/report.html`. Earlier failed first-Tab evidence is preserved in `/tmp/archive-core-crm-live/cd7b54a-evidence/results.json`.
- No real login, member data changes, sends or StudioMate actions were used for this deployment verification.

## Keyboard Follow-Up

- Complementary live smoke on the initial `cd7b54a` release found a pre-existing issue: the first Tab focused hidden background controls behind the login gate in all 28 combinations. Motion, layout, eventual visible login focus and network predicates passed; this was not treated as a fully passing smoke.
- Fix is CSS-only: while the existing `.login-gate.on` is active, the background shell and command palette have `visibility: hidden`. Closing that existing gate restores visibility automatically. Authentication, permissions, data loading and writes are unchanged.
- Added a static guard and local browser checks for natural first Tab plus gate-on/gate-off restoration. No assertion was weakened.
- The `a20baa39` deployment preflight stopped before upload because the existing responsive verifier waited for a visible shell before removing its synthetic login gate. Corrected the order to attached shell -> existing synthetic gate removal -> visible shell, and guarded that order without removing any layout assertion. Local 95 combinations and 40 static tests passed again.
- Final source `9a6712da` Hosting deployment completed with live 95 combinations, canary 10 checks, 14 byte-exact source comparisons and fresh live first-Tab/motion smoke 28/28. Final smoke closed all 28 contexts, browser, owned processes and temporary profile; main reviewed raw results and mobile login-focus screenshot. Read-only verification agents are closed.
