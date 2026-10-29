# Instructor Lesson Method Titles

User request: show ARCHIVE METHOD titles by lesson date in the CORE instructor
lesson UI. Display-only metadata, not StudioMate source or member-send content.

Branch: codex/mini/instructor-method-titles-20261029.
Worktree: /Users/archivepilates/codex-worktrees/november-instructor-confirmation-20261029
(reused only after the previous instructor lane was clean and fully promoted).
Base: 9d953603. Original Documents checkout is dirty and remains untouched.
Managed-worktree creation from that partial clone failed at checkout; no new
managed attachment was created. The clean runtime-backed worktree is isolated
on the new dedicated branch instead.

Approved display titles:
- 2026-11-21: ARCHIVE METHOD #9 외부피드백2.
- 2026-11-28 and 2026-11-29: ARCHIVE METHOD #10 전신 통합 움직임.
- Unknown dates: no invented title or reuse of another date's topic.

Surfaces: date/seat cards, selected-roster header and recent registration rows.
Existing member links, counts, capacity, selected date, cancellation identities,
permission checks, registration flows and message actions remain unchanged.
CORE operating rules do not change: this is presentation metadata only, with
no new operator action, policy, automation, data source or member communication.

Files: core/assets/app.js, core/assets/styles.css, regenerated
core/assets/alimtalk-catalog.json (only app fingerprint/policy fingerprint),
scripts/tests/core-instructor-method-titles.test.mjs, cancellation UI test helper
dependency list, and this note. No Functions/config/schema/IAM/DNS changes.

Checks passed:
- node --check core/assets/app.js.
- New method-title tests 11, including offline Playwright at 320/390/768/1440.
- Cancellation UI tests 13; both suites together 24 passed.
- Core operator workflow/runtime identity/cancellation suites together 48 passed.
- Alimtalk catalog 13 passed; generated 34 rows unchanged apart from fingerprints.
- npm run validate:archive-core-hosting; git diff --check.
- Existing live app.js/styles.css hashes match this task's Git baseline. This is
  pre-deployment evidence, not confirmation of the new UI on the live site.

Offline synthetic screenshots: artifacts/instructor-method-titles/{width}.png.
They exercise actual renderer functions and actual CSS, not authenticated live
data. Playwright browser/context closed; no production action was tested.

Local CORE static preview: http://127.0.0.1:4195/instructor-lessons/.
Owned preview server PID 26646 serves only core/, bound to 127.0.0.1. Kept running
for the user's local review. HTTP 200 confirmed; live authentication not verified.

The operator explicitly approved verification, CORE Hosting publication, commit
and push. Deployment is prepared with a three-existing-file publisher using
pinned baseline 9d953603 and reviewed UI 0a7a6451. Read-only plan verifies live
version sites/archive-pilates-core/versions/405f9ffb8466497e, all 63 file entries,
the three raw/gzip baseline hashes and preserved Hosting config. Only app.js,
styles.css and alimtalk-catalog.json change; the other 60 files stay identical.
Journal and shared CORE Hosting lock prevent blind retry/concurrent publication.
Independent publisher review and pure manifest test passed. Expanded UI/cancel/
release suite: 25 passed. Live rollback/calendar/address guards passed. CI now
includes the new UI and release tests. No Functions implementation changed.
Status: approved and validated for publication, not yet claimed as deployed.
