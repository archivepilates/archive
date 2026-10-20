# Instructor student-share video: first verified grant + 40 days

- Decision date: 2026-10-20.
- User direction: unify the first-grant 40-day basis and review official Imweb webhook onboarding feasibility.
- Scope: instructor-lesson student-share rights, keyed by site, member, approved class/video bundle and policy. Not STAFF tenure access, paid purchase terms, administrator access, or merchandise discounts.
- Start: first independently verified group grant timestamp. End: start + 40 * 24 hours. Store a timezone-explicit instant; display Asia/Seoul. At or after expiry the share entitlement is due, although actual revocation follows the executing worker.
- Preserve the original verified instant across signup, login, reruns, duplicate events and group re-adds. An expired entitlement does not automatically restart. Renewals/extensions need separate approval and evidence.
- Existing evidence must be adopted without resetting its date. Missing/conflicting evidence is review-required, not a new grant today. No bulk historical recalculation was performed.
- A bundle can contain multiple videos sharing one grant instant. Do not grant unrelated historic classes merely because a member attended an instructor lesson.
- Protect active STAFF access, valid purchases and unrelated groups. Expiration of a student-share reason is separate from removing effective access that has another valid reason.
- Implementation approved in the next user turn: common calculation/evidence module shared by E261017 expiry and STAFF exit. Protect the union of valid purchase and student-share reasons; validate original receipts and recheck protection under the shared lock before any removal.
- Verified source registry currently contains E261017 only. Other historical PRIVATE LESSON groups without a registered source block automatic STAFF exit if worker-owned and not protected by purchase; do not infer no rights or reset them to today. Their evidence migration remains pending.
- Existing E261017 policy id and serialized timestamps stay compatible. A verified grant not yet adopted by the expiry worker can protect access without the STAFF worker mutating its source ledger. Terminal entries never fall back to old receipts.
- Webhooks: feasibility confirmed by the official own-site FAQ, conditional on app/scope approval and conversion to integration-complete. The generic preparation guide restricts single-site-only app approval, so the applicable review/publication path requires clarification before registration/submission.
- Review source: docs/reports/2026-10-20-imweb-webhook-review.html.
- CORE record: `imweb-student-share-first-grant-policy` in core/rules/index.html. Runtime and both CORE Hosting surfaces are approved deployment targets; final verification is recorded in the release report. Existing job frequencies and production ledgers remain unchanged.
- The user approved the scoped validation/commit/deploy/push set. App registration, terms acceptance, OAuth consent, app publication and webhook activation remain outside this entitlement deployment.
