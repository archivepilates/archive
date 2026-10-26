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

## Post-deployment Evidence (2026-10-27 KST)

- Source commit 8088b8686f3a8a3625dba38374f958964bc5f5ea promoted to origin/main; clean local main used for deployment. Runtime fast-forwarded to the same source without restarting or changing existing schedules.
- Affected Functions app + alimtalk: 62 successful updates, both deploy processes exit 0. Three decisive confirmation/queue functions independently described ACTIVE with fresh updateTime.
- CORE Hosting archive-pilates + archive-pilates-core released; live rules markers, live responsive 95 checks and release canary at source SHA passed.
- GitHub run 40346935876, ARCHIVE IN Functions Affected Check: success, no failed annotations.
- 00:18 KST exact source re-read and atomic admission succeeded for the approved two attendees. Original registration IDs preserved; each 70000 KRW, whole order 140000 KRW. Audit snapshot created once under the existing instructor-lesson lane.
- 00:19 KST independent canonical readback: registrations queued; jobs pending, attempts 0, externalEffectStarted false, nextRunAt 2026-10-27T00:00:00Z; no eform jobs, related candidates or sends. Both fresh source helper and extracted production policy function accepted the actual stored allocation. The extracted policy check is local/read-only, not a live provider invocation.
- Subsequent read-only admission check returned unchanged with attendeeResolutionVerified true; no second jobs created.
- Native member/pass/form/message processing remains pending for the existing runner after 09:00 KST. No real send or worker execution was manually invoked. No CORE rule gap remains.
- Full private evidence is in the owner-only operations folder for this task; no private inputs or credentials tracked in Git. A local verification harness import issue was corrected without production writes or permission changes.
- Final HTML report checked at 320, 390, 768 and 1440 widths; table overflow repaired and 320px screenshot inspected. Task-owned report browser (PID 50051), preview server and deployment sessions were closed; user browsers and the shared StudioMate profile were untouched.
- Final documentation-only commit is promoted after live verification. This does not change deployed executable/UI/rules assets from 8088b86 and does not require a second deployment. Final repository heads/status are rechecked after that promotion.
