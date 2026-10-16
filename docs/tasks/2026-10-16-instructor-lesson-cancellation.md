# Instructor Lesson Cancellation

## Human Scope
- Add an operator cancellation button to the CORE instructor-lesson roster.
- Human confirmed StudioMate issued-pass retirement plus its same-day reservations, with payment refund separate.
- Human approved validation, scoped production deployment/runtime adoption, commit and push. No real-member cancellation, refund or test message is authorized for verification.

## Canonical Contract
- Canonical selection: existing instructorLessonRegistrations and memberProfiles identity, approved manager request, then fresh StudioMate UI-generated complete native ticket/booking responses and visible DOM.
- Queue: studiomateInstructorLessonCancellations. Key: studio + native member ID + KST lesson date; a single immutable request is retained after retries/timeouts. Not a member360/workLanes action source.
- Allowed readers/writers: manager callable creates requests; Mac mini existing instructor registration worker claims and records results; dashboard exposes sanitized state only. No client Firestore writes, new schedule, raw-history mirror or deletion.
- Target: exactly one unused, nonshared 강사레슨 (2T) issued pass with exact one-day period, original issued ID when known, complete <=2 linked same-day bookings with no attendance/consumption. Unknown identities, duplicate passes, excessive/history pagination and past/started bookings stop for review.
- Native execution: UI 사용불가 처리, not 환불/delete. Prompt warns linked bookings auto-cancel. One UI POST is permitted only for the exact active-toggle issued ID and fixed reason, after a durable checkpoint. All other browser writes are blocked.
- Verification: two fresh before observations agree; two after observations prove retained unusable pass, exact booking cancellation, unchanged payments and other passes. Native IDs, product IDs and synthetic Excel IDs are distinct.
- Result unknown: review_required/cancellation_review, retained effect checkpoint, attention email, no automatic retry. Stale processing goes to review, never back to pending.
- Existing source/audit records remain. Completed canonical cancellation receipts exclude matching member/date from stale seat inputs until the next normal import. Pending/review requests do not free seats. Re-registration with the same old request is blocked pending explicit operator handling.
- In-flight registration, eform sending or candidate processing blocks the request. Pending registration/eform/confirmation/material work stops; later callbacks preserve cancellation. Already sent contracts/messages and consent records remain.
- Imweb cancellation/refund and payment handling remain separate. Paid order refresh cannot recreate an operator-cancelled admission.

## Implementation / Verification
- Dedicated worktree: ~/codex-worktrees/instructor-lesson-cancellation; branch codex/mini/instructor-lesson-cancellation; base 5bea7d7e.
- Local synthetic browser tests cover 320/390/768/1440px, dialog, single queue call, no overflow and pending != complete. Contexts close in finally.
- Production-source read-only preflight matched one exact issued pass and two linked future bookings; plan accepted with zero native writes. The disable prompt and public UI handler were inspected read-only; no confirmation was submitted.
- Actual native cancellation is intentionally untested on real members. Passing fixtures/read-only preflight are not production cancellation proof.
- Required release: functions-app + functions-alimtalk (including confirmation/material final guards), CORE Hosting, runtime fast-forward. No Firestore rules/index changes or new LaunchAgent.
- Release report: docs/reports/2026-10-16-instructor-lesson-cancellation.html. CORE rule: /rules/#instructor-lesson-cancellation.

## Remaining Release Checks
Record scoped test results, native/UI cleanup, source-vs-dashboard preview, clean-main promotion, deployment canary, function ACTIVE state, no-auth denial, runtime revision and CI after deployment. Do not manually run the production worker as a smoke test.
