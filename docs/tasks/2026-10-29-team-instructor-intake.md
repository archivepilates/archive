# Team Instructor Intake

- Approval: operator approved implementation, validation, release and six CORE intakes for 2026-11-20 14:00 KST, ARCHIVE METHOD #1, bank transfer, KRW 80,000/person, KRW 480,000 total. Personal identities remain in the private canonical records, not this repository.
- Worktree: team-instructor-intake-20261029; branch codex/mini/team-instructor-intake-20261029; base 0029b186.
- Source: instructorLessonRegistrations. Existing studio + normalized phone + lesson date key is unchanged. workLanes and mirrors are not dispatch sources.
- Team intake stores exact course/time/topic/amount and paid/seat checks; action_required/team_intake/intakeOnly remains explicit. No StudioMate, eformsign, memo or Alimtalk jobs are created. Standard 2T remains unchanged.
- Existing differing course/time/topic/amount/payment and cancelled intake or orphan issuance jobs fail closed. Concurrent identical submissions write once. Ticket-confirmation trigger and manual recovery reject intakeOnly.
- Paid intakes count on the CORE roster immediately. Without native lecture capacity, the UI hides inferred default remaining seats. End time, duration and actual StudioMate booking are not invented.
- Verification: pure Team policy, transactional handler with in-memory Firestore, existing standard/cancellation/confirmation/schedule regression tests; responsive UI at 320/390/768/1440 with synthetic data only; TypeScript build and release guards.
- Release scope: affected app and Alimtalk functions; exact CORE instructor page/app/rules/catalog only, retaining all other Hosting files and config. No member sends, schedules, ticket or payment changes.
- Pending at implementation commit: production release/readback, approved six intakes and independent roster/job absence verification. Consult the dated HTML report for final execution state.

## Verified Execution

- Implementation commit d918050 promoted to origin/main. CORE release sites/archive-pilates-core/versions/2c2638707c8e7abd replaced exactly four assets and preserved the other 59 files and Hosting config.
- Deployed app: getInstructorLessonRegistrationDashboard, operatorCreateInstructorLessonRegistration, operatorQueueInstructorLessonCancellation, confirmInstructorLessonBookingAndQueueAlimtalk, queueInstructorLessonConfirmationOnTicketVerified. Alimtalk: scheduledProcessAlimtalkQueue, scheduledQueueAndSendAlimtalkDaily, scheduledQueueAndSendReservationOpenAlimtalk, approveAlimtalkBatch. Existing schedules remain unchanged; no manual queue execution.
- Six canonical intakes saved at 2026-10-29T10:34:34Z through 10:35:11Z. Independent dashboard at 10:35:22Z: six unique IDs, total KRW 480,000, all exact Team inputs; existing November counts 5/10/8 unchanged. Native CORE screen independently showed the six-person roster and review-only status.
- At 10:36:04Z, exact canonical reread confirmed all six intakeOnly/review steps; combined StudioMate/eformsign jobs 0, member memos 0, memo write jobs 0. November 20 Alimtalk candidates 0. No tickets, bookings, signatures or messages were issued.
- Tests: Team policy 5, pending-seat 65, registration/schedule/confirmation regression 46, transactional/cancellation 29, bounded send/eform/cancellation combined 165, UI renderer/responsive 31, operator workflow 33; all passed. TypeScript and all generated codebases built, function boundaries and release/Hosting guards passed. Cancellation verifier passed all four viewports after its missing renderer dependency was restored.
- GitHub Actions 40858068389 and 40858068622 passed for d918050. Scoped operating-rule verification update follows as a docs/rules-only release. Task-owned Chrome tabs and offline Playwright browsers closed; no shared StudioMate profile opened.
