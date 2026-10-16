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

## Release Evidence / 2026-10-16
- Implementation commit 16091ba700262bd239f8ce514a5aa78e0635351b was pushed to the feature branch and promoted to origin/main. Deployment used a clean main checkout and archive-codex-operator for Firebase project archive-pilates.
- functions-app (44) and functions-alimtalk (13) deployed successfully after dry-runs; all 57 are ACTIVE. New cancellation callable returned HTTP 401 / UNAUTHENTICATED for an unauthenticated probe; no request was created.
- Both Hosting sites archive-pilates and archive-pilates-core deployed. Live release canary matches implementation SHA 16091ba7. Live instructor-lesson HTML, app.js, interface.css and operating rules match tested source hashes.
- Node focused suite: 396 passed. TypeScript workflow suite: 62 passed. All five codebase builds, ownership boundaries, release/data-source/rollback checks passed. Local and live whole-CORE responsive checks each passed 95 checks at 320/390/768/1440/1920px; synthetic cancellation dialog passed four widths.
- GitHub Functions Affected Check passed: https://github.com/archivepilates/archive/actions/runs/38842304467 (2m32s).
- Runtime fast-forwarded to 16091ba7. Existing com.archive.instructor-lesson-registration-queue remains loaded at 120 seconds, last exit 0. Natural run at 2026-10-16T02:58:03.802Z reported ok=true, failed=0, cancellation processed=0. Cancellation queue count remained 0 after deployment verification.
- No real-member cancellation, financial refund, test message or manual production worker invocation occurred. Native read-only preflight is not end-to-end production cancellation proof; verify completion on the next legitimate operator-requested cancellation.
- All task-owned browser contexts closed in finally and the shared StudioMate browser lock was released. Existing user browser state was preserved.
- Documentation-only completion commit follows the deployed implementation. Hosting/runtime behavior remains versioned by implementation SHA; no second deploy is required for these task/report records.

## Approved Operational Follow-Up / 2026-10-16
- Human separately approved repairing the verified member identity link and continuing one real cancellation. This is a legitimate operator action, not a test authorization for other members. Full identity and source IDs remain in the canonical lookup/cancellation audit records, not this report.
- Preserved the existing Excel memberProfiles ID and linked its unique, exact-name/full-phone StudioMate identity. Completed the existing member-ID lookup receipt atomically; no native member, pass or booking was created.
- Submitted the existing manager callable once. The regular worker accepted the native disable once but entered review when the archived pass was not found in the active-ticket container. Retired cards actually live in the previous-ticket modal and omit dates; the original selector was incorrect, with an additional count-before-render race.
- Corrected read-only selection to await the previous-ticket button and card visibility, require one exact-title archived card, and verify the UI-generated detail response against the exact issued ID/member/studio. Active cards retain their date filter. Ambiguous archived cards remain blocked; the write gate and no-retry rules are unchanged.
- Independent fresh UI reads proved the retained unusable issued pass, the exact two cancelled booking IDs, and the unchanged payment fingerprint. The existing review job and registration were reconciled transactionally at 2026-10-16T04:43:07.251Z with an explicit operator-independent verification method and retained original error. No native action was retried and reconciliation made no native write.
- Added synthetic archived-modal/render-timing, duplicate-card and wrong-detail-ID regression tests. This patch requires runtime adoption and Hosting only for the updated operating-rule status; no Functions changes.
- This proves the approved cancellation and independent reconciliation, not a new automatic end-to-end test. Next legitimate cancellation verifies the corrected automatic post-action readback.
