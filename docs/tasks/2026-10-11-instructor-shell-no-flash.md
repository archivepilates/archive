# Instructor Shell Visibility

## Scope

- Instructor navigation: Private and Sequence only. Home redirects to Private.
- Remove today lesson/member-count rendering; preserve manager Home.
- Hide operator shell in render-blocking CSS before module/auth bootstrap. Only a verified manager session reveals it.
- Clear visibility on access quarantine, sign-out, auth change and pagehide. Persisted pageshow reloads and revalidates.
- Static connection/retry surface outside the shell on every CORE entry page.
- No backend, Auth, password, Firestore, StudioMate, reservations or sends changed.

## Source And Isolation

- Base origin/main: 3087393e.
- Worktree: /Users/archivepilates/codex-worktrees/instructor-shell-no-flash.
- Branch: codex/mini/instructor-shell-no-flash.
- Access source remains getCoreAccessSession + canonical staffs; visibility marker is presentation only, never authorization.
- Private ownership and UID-scoped sequence storage remain unchanged.

## Verification

- npm run test:core-instructor-access: 224 passed.
- npm run test:core-operator-workflow: 79 passed.
- npm run verify:core-instructor-access-ui: 146 passed; both root and /core/ surfaces at 320/390/768/1440px.
- Every scenario holds the initial app module through three animation frames and asserts zero operator-shell flashes. Instructor Home redirects before workspace reads.
- First password, logout success/failure, auth changes, denied/revoked/transient states, logged out, failed module with static retry, Private filters and Sequence owner reads checked.
- Navigation and synthetic persisted page lifecycle checked. This is not evidence of actual bfcache eligibility/cache hits.
- Approval-turn UI report: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-aT3nb7/report.json.
- npm run verify:archive-core-responsive: 95 static synthetic operator layout checks passed; bootstrap and Firebase network isolated, not live authorization proof.
- npm run validate:archive-core-hosting: passed.
- node --check core/assets/core-instructor-access.js and git diff --check: passed.
- Responsive screenshots inspected at 390 and 1440px.
- Independent read-only review found no blockers in visibility restoration, lifecycle clearing, persisted-page reload and static recovery surfaces.
- Approval-turn independent verification reran 224 instructor-access and 79 operator-workflow tests successfully; clarified the CORE rule wording to distinguish initial module failure from access-session failure.
- All 146 test browser contexts closed, browser/server closed, fixture count zero. No shared StudioMate profile or production browser opened.

## Deployment

- Implementation, CORE rules, Hosting deployment and live verification completed on 2026-10-11.
- Deployed source: 62617424d4799b65ed74f58fda5fcede084ad394, promoted to origin/main after scoped checks.
- Account: archive-codex-operator@archive-pilates.iam.gserviceaccount.com; Firebase project archive-pilates.
- npm run deploy:archive-core-live: exit 0; hosting:archive-pilates-core and hosting:archive-pilates only. Functions, Auth and Firestore unchanged.
- Custom domain https://core.archivepilates.com/ and mirror https://archive-pilates.web.app/core/ release markers match the deployed source.
- Live canary: 10 checks passed. Live static synthetic operator responsive QA: 95 checks passed, not real authorization proof.
- Independent live readback: 14 asset hashes matched; 8 anonymous screens at 320/390/768/1440px showed login, zero operator-shell flashes and no horizontal overflow.
- Live report: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/instructor-shell-live-e5OGtx/report.json.
- Live cleanup: all 8 contexts and browser closed; user Chrome untouched. No production test account, login or data mutation performed.
- GitHub ARCHIVE IN Functions Affected Check: run 38133157533 completed successfully; affected codebases empty. https://github.com/archivepilates/archive/actions/runs/38133157533.
- Completion audit is documentation only; no repeat Hosting deployment is required when core/ matches the deployed source.
- Do not change instructor passwords or create production test accounts to verify these UI-only changes.
