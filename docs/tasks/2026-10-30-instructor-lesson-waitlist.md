# Instructor lesson unpaid waitlist

Date: 2026-10-30
Status: production feature and operating-rule completion record deployed and independently verified.
Worktree: /Users/archivepilates/codex-worktrees/instructor-lesson-waitlist-20261030
Branch: codex/mini/instructor-lesson-waitlist-20261030
Base: origin/main 319a904f

## Scope

- Existing manual course selector adds `waitlist` (수강대기).
- No payment, occupied seat, member creation, ticket, eform, memo, or confirmation job.
- Date cards show a separate waitlist count. Roster shows ordered name, administrator-only phone, and intake time.
- Existing paid registration, cancellation and dispatch policies remain unchanged.
- No automatic promotion, notifications, scheduler, or production test records.

## Canonical State

Use existing `instructorLessonRegistrations` and the original studio + normalized phone + lesson date key. Waiting records have `courseKind=waitlist`, `mode=waitlist`, `status=waitlisted`, `waitlistOnly=true`, `intakeOnly=true`, `paymentMethod=none`, false payment/seat checks, and all downstream steps `not_required`.

Duplicate waiting submissions retain the original position and timestamps. Paid records cannot become waiting records. Explicit paid registration of the same identity/date can replace waiting state only with fresh payment/seat checks, no existing issuance job, and matching identity. Preserve original intake time in `waitlistHistory`; normal paid handling then applies. Team conversion remains internal intake only.

The schedule and Imweb seat calculations explicitly exclude waiting records. Confirmation and existing Mac mini registration worker reject them even if step flags are forged. A stray pending/retry issuance job is quarantined as `review_required`, without changing the waiting registration or incrementing attempts, so it cannot starve normal paid work.

Full waiting phone data is available only through the existing manager-authorized dashboard. Generic MCP public results keep their existing masking policy. No mirror is a downstream action source.

## Source Changes

- CORE instructor page, app rendering/submit handlers, interface CSS and operating rules.
- Registration parser/transaction, waitlist helper, schedule, derived state, confirmation guard.
- Existing runtime contract, Imweb capacity helper, registration worker.
- Existing CORE MCP operation notes; no new tool or permission.
- Focused synthetic tests and existing CI coverage.

## Verification

- 59 backend tests: waitlist creation, normalized duplicate/concurrent calls, standard/team paid conversion, forged step guards, queue isolation/quarantine, paid schedule/confirmation regressions.
- 43 UI tests including waiting/paid/team flows and responsive Chromium at 320, 390, 768, 1440 px.
- 10 runtime contract / Imweb helper tests.
- 250 CORE MCP tests.
- 13 scoped Hosting release tests, including a rules-only completion target, passed.
- Functions TypeScript noEmit, all physical codebase builds, boundary validation, data-source policy and JS syntax checks passed.
- Browser evidence: artifacts/core-instructor-waitlist-ui/report.json and four screenshots. No external network, browser errors, unintended callables, or remaining contexts.
- Independent review found orphan queue starvation; fixed with quarantine and repeat-run regression coverage.
- Before release, live assets returned HTTP 200 without waitlist markers. After release, all four live custom-domain assets returned HTTP 200 with exact committed hashes and revalidation headers.
- Local MCP suite initially lacked its dedicated dependency link; linking the existing runtime dependencies restored the full 250-test pass. No production service changed.

## Release Boundary

The user approved scoped Functions + CORE + runtime + rules deployment/commit/push in call_931a276f99df449b9a2bee1261e39ff5. Existing member records and sends remain untouched. Report deployed state only after independent release verification.

Affected detector conservatively includes all five codebases because CI workflow files changed. Actual production deploy was limited to five app handlers and four alimtalk queue/approval consumers; no private-chart, sync or social functions were deployed. All predeploy branch/source/rollback guards passed on clean main matching freshly fetched origin/main. No member-facing send is part of this task.

## Production Evidence

- Feature commit: ce024116a636fce08ab12b605d42a7ea6b825a61, promoted and pushed to main. Mac mini runtime fast-forwarded to the same code; the existing registration LaunchAgent points to that runtime. No manual job execution or schedule change.
- App ACTIVE: operatorCreateInstructorLessonRegistration, getInstructorLessonRegistrationDashboard, operatorQueueInstructorLessonCancellation, confirmInstructorLessonBookingAndQueueAlimtalk, queueInstructorLessonConfirmationOnTicketVerified. Update times 2026-10-30T14:30:27Z through 14:30:35Z.
- Alimtalk ACTIVE: scheduledProcessAlimtalkQueue, scheduledQueueAndSendAlimtalkDaily, scheduledQueueAndSendReservationOpenAlimtalk, approveAlimtalkBatch. Update times 2026-10-30T14:32:37Z through 14:32:50Z. Existing schedules and message windows retained.
- CORE feature release: sites/archive-pilates-core/versions/ae1ef667666c8c6a, release 1793370804106000 at 2026-10-30T14:33:24Z. Replaced exactly four paths, preserving all other paths and configuration in the 63-file manifest.
- CORE rules completion release: sites/archive-pilates-core/versions/7ce075cbdbfe6fba, release 1793370998404000 at 2026-10-30T14:36:38Z from 0f8832b0. Only /rules/index.html changed, preserving all feature assets and the 63-file configuration. Rule SHA256: 387ae8b8a0401758958039f35e7370a574c14147c35827bc4cfcc2226daed5b2.
- Custom-domain SHA256: instructor-lessons c73ea9f2f265a52eadcb22d08499618d0d52ad9f6434eea551fd90547a9e71c0; app.js ab1460930d5e522fc01c2882b8876719a685634ea225cdc244cfa27b39037e26; interface.css b09f8ce58ae328a43d4b324caba5ea49e147fea2d92cf852d33f0ebdf4d3b7b1. Operating-rule hash is recorded separately above.
- Authenticated CORE readback: new waitlisted count 0 and per-date waiting arrays present; all preexisting status counts and date seat counts unchanged, with countsLimited=false. 11/20 6/6, 11/21 5/5, 11/28 10/10, 11/29 10/10. This is CORE stored-source verification, not a fresh StudioMate native inspection.
- Unauthenticated empty create request remained HTTP 401 / UNAUTHENTICATED, with no production write.
- Feature GitHub Actions: 41071715530 Functions Affected Check and 41071715526 CORE MCP Check both succeeded, independently reviewed.
- Rules/release follow-up GitHub Actions: 41072946152 Functions Affected Check and 41072946336 CORE MCP Check also succeeded for 0f8832b0. Final custom-domain readback of all four paths matched that source after the rules-only release. Final report rendered without horizontal overflow at 390/1440 px; report browser closed.
- Skipped intentionally: live positive registration/promotion, member creation, ticket/eform/memo operations and all real member dispatch. Synthetic transactional tests are not real Firestore contention tests.
- Source worktree and clean deployment main are clean after commits. Runtime preserves the preexisting unrelated untracked scripts/__pycache__/ directory. Test-owned browser contexts closed; user tabs untouched.
