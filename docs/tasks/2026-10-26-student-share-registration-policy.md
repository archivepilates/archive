# Registered Instructor Lesson Video Access

## Approved Change

The user directly changed future instructor-lesson video eligibility from actual attendees to all registered team members, including absentees. Their existing manual video grant is already present and must not be removed, re-added or duplicated. A subsequent direct user reply explicitly authorized the current time as that manual grant's first-clock anchor; it is not an inferred migration or permission to restart any recorded clock.

## Boundaries

- Canonical source: both native StudioMate class-detail registered rosters for the approved team/date, preserving actual attendance. Exact `출석` and `결석` are eligible. Cancellation, refund, unknown state, different/missing/duplicate roster identity are not automatic grant candidates.
- Both paired rosters must agree on registered name and normalized phone. Different attendance between the two sessions does not disqualify a registered participant or authorize changing attendance.
- A current uniquely matching Imweb account is required. Duplicate account holds and the two already pinned D-team identity exceptions remain unchanged. This policy is not permission to choose another account or widen the restricted CLI-only route.
- Existing group memberships, valid purchases, other videos, grade/discount and all first-grant/expiry records remain unchanged. No historical receipts or raw attendance are rewritten.
- Duration remains first independently verified grant plus exactly960 hours. Already-present untracked manual groups are held for first-grant evidence, not removed/re-added or assigned a fresh timer.
- No new member messages, production group grants, attendance edits, new polling scheduler, order/product change or Functions deployment are part of this policy rollout. One separately operator-confirmed existing manual grant receives a forty-day ledger entry only, without a provider write.

## Implementation

- `scripts/lib/lesson-share-registration-policy.mjs`: single current eligibility ID and exact known attendance-state predicate.
- `lesson-share-261024.mjs` and confirmed D identity helper: registered present/absent accepted; exact identity and account safeguards retained.
- A/B and C/D grant runners: complete registered rosters, not attended subsets; preserve per-session actual status in new `both_sessions_registered` evidence with `registered-including-absentees-v1`.
- `imweb-student-share-policy.mjs`: new evidence validation with exact paired classes and policy ID; legacy attended receipts and original dates preserved; existing E-team STAFF adoption restriction retained.
- Existing five sources continue to share the same first-grant and staff-removal protection. E source includes canonical paired class metadata for new ordinary registered-grant evidence; no old E STAFF exception is enabled.
- Existing `e-2` automation receives the updated source/eligibility instructions only after reviewed runtime rollout. Its schedule, notification policy, approved message scope and account-route restrictions remain unchanged.

## Verification

Focused synthetic tests cover both absent, mixed attendance, cancellation/unknown status, mismatched registered rosters, exact/duplicate account matching, pinned D identities, dry-run/locks/quota/unknown results, legacy dates, exact forty-day expiry and staff-exit purchase/share preservation. No tests send messages or mutate real member permissions.

Read-only production verification checks current group presence and snapshots all five canonical ledgers before/after. The separately authorized manual clock requires exact account binding, paired registered evidence, independent live group membership, direct operator confirmation and no prior receipt or entitlement. Other missing manual first-grant evidence remains held; existing clocks cannot be restarted.

## Release

Only the three existing rule notes `imweb-student-share-first-grant-policy`, `lesson-share-261025` and `lesson-share-261024` may change in CORE HTML. The existing release helper's new registered-share-policy flag is separately pinned to the reviewed baseline and preserves all unrelated live files and configuration. Runtime source is promoted to origin/main and fast-forwarded; Functions and other app surfaces are not deployed.
