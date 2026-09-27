# Website Instructor Lesson Payment Category

## Scope

- User rule: all paid website instructor lesson orders use the StudioMate credit-card category.
- Preserve the provider's actual method in `externalOrder.sourcePaymentMethod`; never change or recharge the Imweb payment.
- Keep eligibility, identity, amount, cancellation/refund, capacity and duplicate checks.
- No automatic class reservations, unrelated shipping changes or Functions deployment.

## Diagnosis

- A completed TOSSPAY order was held by the former CARD-only predicate.
- The ledger and local fingerprint caches prevented reassessment of unchanged held orders after a policy fix.
- Live read confirmed the affected record was an `imweb_order_review` registration with no StudioMate job.

## Implementation

- Record website payments as `card` while retaining their original method.
- Reassess only the obsolete payment-method hold. Transaction guard requires the same order/registration, review source, action-required state, no external effect and no existing job.
- Re-run normal capacity/source checks; create the existing deterministic ticket job once.
- Existing completed jobs, other hold reasons, cancellation and foreign ownership remain protected.
- Canonical sources: freshly read Imweb order, instructorLessonRegistrations, imwebInstructorLessonOrders and studiomateInstructorLessonJobs. No mirror-based external actions.

## Verification

- Policy and ingestion tests: 103 passed, including TOSSPAY source preservation, card mapping, transaction replay, cache recovery, capacity, successive source changes after newer holds and no duplicate job.
- Registration contract and affected-codebase tests: 11 passed.
- Instructor lesson release validator: passed.
- CORE Hosting and live rollback static guards: passed.
- Released code: `1996c221`; main pushed, Mac mini runtime fast-forwarded, CORE Hosting deployed. Live `/release.json` matches and `/rules/` serves the payment-category rule.
- GitHub Actions run `36332603748`: success.
- Affected order recovered through the normal deterministic ingestion queue. The scheduled worker claimed it first; the scoped manual worker performed zero duplicate actions.
- StudioMate member detail and payment-history UI independently verified one instructor lesson ticket for 2026-10-25, KRW 70,000, card (single payment), zero outstanding balance.
- Registration/job retains original `TOSSPAY`, normalized `card`, verified member/ticket, no registration error, and manual bookings.
- At final check, eformsign signup and confirmation Alimtalk were queued, not yet confirmed sent. Recipient signature remains pending; do not report complete delivery.
- Task-owned verification tab closed, scoped worker exited, StudioMate profile lock absent. Source worktree, integration and runtime clean before this evidence-only update.
