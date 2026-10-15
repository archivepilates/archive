# Refund Dispatch Recovery

## Approved Scope
- Fix false source-change comparison and authenticated English eformsign UI readiness.
- Supplement canonical memberProfiles/activeTickets and refundCases/job validation with fresh native read-only proof before form entry and final dispatch.
- Preserve queue IDs, calculation hashes, original source snapshots, send-click boundaries and unknown-acceptance holds.
- No actual payment refund, StudioMate ticket/holding mutation or general retry of historical failures.

## Confirmed Findings
- Firestore map key order differed while all ten source fields were equal; stringification compared representation rather than meaning.
- The eformsign shared profile was authenticated, but English Fill in and deferred UI initialization failed the old immediate Korean-only check.
- During investigation the one requested ticket was natively marked refunded after the old Excel import. The human confirmed ticket-only refund, not actual payout.
- Existing case/eformsign/SMS jobs were placed in send_review_required with native-source evidence; no sendClickedAt/sentAt and no outbound operation performed.
- Continuing the previous active-ticket estimate after native status change requires a specific new confirmation; generic safety is not bypassed.

## Implementation
- Validate and normalize the exact ten-field snapshot schema before comparing values.
- Use complete verified native member/ticket/payment source as an additional fail-closed guard; canonical target selection remains unchanged.
- Reuse the StudioMate caller context for SMS reads and preserve its composer; eformsign obtains a nonwaiting shared StudioMate lock for readback.
- Bilingual template readiness and scoped, same-record delivery evidence; never combine navigation status with another document's recipient.
- Preserve count and period refund workflows without inferring missing counts.

## Verification and Release
- Refund/browser/native/queue regressions: 71 passed; refund policy: 15 passed.
- Fresh read-only native preflight at 18:39 KST blocked the refunded ticket as expected, with zero provider calls.
- Scoped independent reviews found no remaining blocker after pointer-conflict, period-zero and same-record evidence repairs.
- Mock tests never send real messages. Browser fixtures use isolated contexts and close in finally.
- Scope: Mac mini runtime scripts and CORE Hosting operator rules. No Functions/Firestore rule deployment expected.
- Private source/audit artifacts remain outside Git; no full member information in committed reports.
- See companion HTML report and release.json for released source; actual send completion requires provider/document or StudioMate ledger proof.
