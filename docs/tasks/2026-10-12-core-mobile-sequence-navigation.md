# CORE Mobile Sequence Navigation

- Worktree: `/Users/archivepilates/codex-worktrees/core-mobile-sequence-navigation`
- Branch: `codex/mini/core-mobile-sequence-navigation`
- User approved scoped validation, CORE Hosting release, commit and push.
- Source baseline: `df57639c` from `origin/main`.
- Symptom: both instructor and manager mobile navigation show the save-check error.
- Root cause: `flushEditors` inspected every iframe, including cross-origin auth helpers; a SecurityError was treated as a save failure.
- Reproduction: an isolated opaque authentication-helper fixture makes the original module show the exact reported error. Baseline WebKit screenshot: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-rGz0C9/root-390-manager-navigation-1-failure.png`.
- Fix: inspect only identified Sequence editors and CORE navigation frames. Unloaded placeholders do not block; active unready editors and rejected saves still block. No auth, persistence, API, Functions, Firestore or member data changes.
- Unit tests: `node --test scripts/tests/core-navigation.test.mjs` passed 5/5.
- Chromium bounded integration: 48/48 passed, report `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-52HFsE/report.json`.
- Full Chromium regression: 204/204 passed, report `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-FJfeur/report.json`. Navigation and predeploy unit tests passed 25/25.
- WebKit touch-enabled integration: 16/16 passed, report `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-L3xc93/report.json`.
- UI coverage uses synthetic auth and SDK fixtures; not a real instructor login or physical iPhone verification. Chrome/WebKit screenshots and geometry cover 320, 390, 768 and 1440px on root and `/core/` routes.
- CORE rules updated with the same save-guard policy and verification limits.
- Deployment target: `hosting:archive-pilates-core`, Firebase `archive-pilates`, archive-codex-operator service account. Release evidence will be recorded after live readback.
- New request: all Alimtalk-linked survey/input pages receive a separate read-only mobile wrapping audit; no implicit member sends or survey submissions.
