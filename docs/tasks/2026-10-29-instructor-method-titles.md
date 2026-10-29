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
Owned preview server PID 26646 served only core/, bound to 127.0.0.1, during local
review. It was stopped after successful production publication. Use the live
https://core.archivepilates.com/instructor-lessons/ instead.

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
Publication completed from clean main 0f446f5692e67c98da5bf2b2293f1b3b1e1c7362.
Version: sites/archive-pilates-core/versions/2cab2cc6294c4b50.
Release: sites/archive-pilates-core/releases/1793258857553000.
Provider release intent 2026-10-29T07:27:37.502Z, live verified at 07:27:40.017Z
(16:27 KST). All three live raw hashes exactly match reviewed source. Remaining
60 manifest entries and complete Hosting config are unchanged. Immutable private
journal: ~/ArchiveIN/operations/core-instructor-method-titles-20261029/hosting-release.json.

Independent production verification:
- CORE MCP current read returns all three schedule date keys (stored operational
  data, not a fresh StudioMate read); no source/capacity mutation performed.
- Actual logged-in Chrome CORE page renders the exact three method titles.
- Read-only selected Team roster shows #9; recent registration filter shows #10.
- No registration, cancellation or member-facing action button was invoked.
- Genuine live screenshot: artifacts/instructor-method-titles/live-overview.jpg.
- CORE MCP Check 40835504611 and Functions Affected Check 40835504514 both success.
  Workflow edits conservatively build/check all codebases; unchanged Functions
  were not redeployed. No new operating-rule policy required by these UI labels.
- Task-owned Chrome verification tab closed; local preview server stopped. Existing
  user tabs/profiles and pre-existing runtime scripts/__pycache__/ preserved.

Status: deployed and live-verified; main/feature pushes and runtime alignment
completed for implementation. This final note records the verified result only.
