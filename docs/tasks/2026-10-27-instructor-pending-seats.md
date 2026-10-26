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
