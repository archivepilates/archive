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
