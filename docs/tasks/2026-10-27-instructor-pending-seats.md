# ARCHIVE PILATES Immediate Intake Seats

- Request: separate immediate CORE roster/capacity reservation from the 09:00 member notification gate, continuing the approved instructor-attendee rollout.
- Confirmed source defect: the schedule used ticket holders before all other sources, omitting approved but unissued registrations once any ticket existed.
- Read-only live-source reproduction on 2026-10-27 01:03 KST: November 29 showed 1 occupied / 9 remaining, both approved target registrations absent from roster despite queued canonical registrations.
- Change: preserve existing ticket/booking source preference, union payment-and-seat-confirmed pending registrations into the chosen base, dedupe by normalized identity. Unapproved review, cancellation and synthetic pending rows do not add seats. Issued tickets retain their existing canonical count.
- Canonical sources: instructorLessonRegistrations operator checks and steps; same existing lectures/bookings/current active ticket read sources. No mirror is used to authorize writes or sends.
- Member communication, native member/pass issuance, quiet window, scheduling and retry/duplicate policies are unchanged. No production data mutation or manual worker invocation is needed.
- CORE source labels and operating rules explain the separated phases. New tests cover pending intake with existing tickets/bookings, exclusions and later issuance dedupe.
- Read-only evaluation of fixed source against the same actual data: 3 occupied / 7 remaining, both targets in roster, confirmed pending count 2.
- Deployment and independent final verification are recorded in the report after completion; the pre-deployment calculation is not a claim that the live endpoint has changed.
- New roster rows carry issuedTicketVerified; the existing native pass-cancellation button requires that row-level evidence, not another attendee's ticket or a registration ticket name. Pending intake does not gain unsupported native cancellation actions.
- Checks before rollout: 444 Node + 216 TypeScript tests passed (660 total), full 105-export Functions build/boundary, registration/CORE/catalog/rollback guards passed, and static responsive QA 95 checks at 320/390/768/1440/1920 widths passed.
- Actual Chrome CORE read before rollout independently showed both queued registrations but only 1/10 in the November 29 schedule card; an owned verification tab is retained only until post-deploy UI readback.

## Verified Deployment

- Source e817e04b3450fe35cdaf99614a55a13ca73a0ad9 pushed to origin/main and deployed from clean local main. Affected scope was functions-app only (47 successful updates), plus CORE archive-pilates/archive-pilates-core Hosting. No other Functions codebase, DB/config/DNS change or member operation.
- getInstructorLessonRegistrationDashboard independently described ACTIVE with updateTime 2026-10-26T16:14:13Z. Live CORE bundle contains the combined-source label; rules and release canary match source.
- Exact-commit GitHub run 40356704396 completed successfully.
- Actual authenticated Chrome UI after reload: November 29 occupied 3, capacity 10, remaining 7; selected roster heading 3 and both approved attendees present, each showing pending agreement/notice, no native cancellation button. November 21 remained 5/5 and November 28 remained 10/10.
- Runtime fast-forwarded; read-only actual source recalculation at 2026-10-26T16:16:48.711Z confirmed the same 3/10 and both target registration IDs in roster. No member data writes or manual worker/send execution were performed in this follow-up.
- Task-owned Chrome tab 2059975437 closed; original four user tabs retained. Deployment/QA sessions completed; no shared StudioMate profile was opened.
- Documentation-only final results commit follows live verification. Final heads and clean statuses are checked after promotion; deployed functional source remains e817e04b.
