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

## Verified Release Receipt

- Functional commit: `6eb1d40e`; origin/main and Mac mini runtime synchronized.
- Fourteen focused suites:684 passed, zero failed/skipped. Syntax and diff whitespace checks passed.
- Existing e-2 prompt updated to registered-present/absent eligibility; schedule, project, model and failed-runs-only notification policy retained.
- Main CORE release: `sites/archive-pilates/versions/215d0b2b9f0985dc`;222 other files retained.
- Dedicated CORE release: `sites/archive-pilates-core/versions/2a80cda630d93fc5`;62 other files retained. Its initial stale post-release response was reconciled by independent latest-release and HTTP/hash readback; no re-deployment occurred.
- Both live rule hashes: `1cdfe428b4595c6ea466858a02bd6dde099b71ccb959e4101da01e9391d7dacb`.
- One operator-confirmed manual C clock recorded from2026-10-26T08:20:37Z until2026-12-05T08:20:37Z. Current member and complete group readback verified; provider writes0. Existing entries and other four ledgers retained.
- Live C expiry runner read-only verification returned `not_due` for the approved manual clock, with9 reads, no provider writes or ledger saves. All five canonical ledgers and STAFF-exit unexpired-share protection validated.
- Report screenshots at320/390/768/1440px show no horizontal overflow or external dependencies; the390px render was visually reviewed and the task-owned browser was closed.
- Pre-existing historical E261017 classroom hash test drift reproduced at immutable baseline6e50653f; not changed or counted as passing. All applicable focused policy/release checks passed.
- No member sends, attendance edits, provider group changes, Functions deploys, unrelated page changes or new polling scheduler.
- GitHub Actions `ARCHIVE IN Functions Affected Check` run40292211630 completed successfully at2026-10-26T08:28:38Z for functional commit6eb1d40e; all job steps passed.
