# ARCHIVE PILATES Instructor Order Attendees

- Approval: operator confirmed the exact two attendees for the November 29 paid order, then approved validation, deployment, commit/push and continuation.
- Canonical sources: fresh Imweb order; `imwebInstructorLessonOrders` approved attendee resolution; `instructorLessonRegistrations`. `workLanes` audit is never an action target source.
- Identity: studio + normalized phone + lesson date, retaining existing registration IDs.
- Admission: operator-only bounded CLI; default dry-run; exact raw order fingerprint, unique actual attendees, buyer included, one product/date, KRW 70,000 per attendee, capacity union, no prior downstream effects. Registration family, jobs and approval commit atomically.
- Guards: raw source plus complete canonical family before native effects and forms; family checks before confirmation creation and provider dispatch. Source changes block the complete family. Accepted/ambiguous effects are preserved, not replayed.
- Quiet window: no member-facing effects before 09:00 KST or from 23:00. Durable pending jobs use existing runner and nextRunAt, not another scheduler.
- Isolation: dedicated branch/worktree; synthetic tests only; no real test dispatch.
- Deployment: only affected Functions and CORE rules Hosting after required checks. Runtime fast-forwards to verified origin/main.
- Actual source/member/payment data stays in owner-only operations files and access-controlled canonical/audit documents, never Git.
- Evidence and final state: see `docs/reports/2026-10-26-instructor-order-attendees.html`; pending updates until tests/deployment/admission are independently read back.

## Pre-deployment Verification

- 431 Node tests and 139 TypeScript integration/regression tests passed, including real sender-function execution against synthetic fetch/store fixtures. No real member test sends.
- Functions TypeScript build and all five physical codebase builds passed; 105 export boundaries matched. Only app and alimtalk are affected.
- CORE static responsive QA: 95 checks at 320, 390, 768, 1440 and 1920 widths passed. Hosting/catalog and rollback guards passed after regenerating the catalog fingerprint for the sender change.
- Read-only live case dry-run: two attendees, capacity 10, union occupancy after admission 3, nextRunAt 2026-10-27T00:00:00Z (09:00 KST).
- Review fixed stripped allocation-key fallback and aligned eform joint holds to existing send_review_required health state. Family source reads use a read-only transaction; immutable audits preserve previous review rows and raw order.
- Deployment, runtime alignment and actual admission remain pending until explicit post-deploy evidence below.
