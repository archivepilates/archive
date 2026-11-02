# StudioMate Referral Points

## Scope And State

- Branch: `codex/mini/studiomate-referral-points-20261102`.
- Isolated source clone: `/Users/archivepilates/dev/archive-studiomate-referral-points`, base `5a8691e0`. Managed worktree creation was attempted first but the old Documents repository failed mmap checkout twice. The healthy runtime repository was cloned locally instead; runtime and unrelated worktrees were not edited.
- User approved implementation, Kim Gi-hyo-only test, purchase threshold, then validation, runtime/CORE release, commit and push.
- Operating policy: newcomer purchase >= KRW 300,000 -> referrer 20,000 native StudioMate points. Existing Imweb program remains unchanged.
- Production release pending final checks. Do not mark the first real referral live event verified merely because the operator point writer passed.

## Evidence

- Pricing source: Notion `3ebd49eae4bf8198ba47c4cb222d7c69`, read-only; 30만원 condition clarified directly by user.
- Fresh member export read-only baseline: 1,060 rows, 28 unique positive-balance holders, total 1,139,900P. The export contains one duplicate name/phone row outside the positive holders; it is not a canonical native identity or payout authority.
- Exact operator test member native ID `1982133`; full phone/name verified in native UI and test allowlist. Before 100P, credit +20,000P ->20,100P, repeat caused zero additional submissions, test debit -20,000P ->100P. Native credit/debit history reasons retained, each once. No general-customer awards or member messages.
- During test, two native dialogs, comma-formatted amount, transient zero/loading masks and negative usage rendering were verified and handled. Stops before irreversible confirmation were reconciled without deleting claims. The accepted credit was not replayed; the accepted debit was finalized by independent read-only reconciliation.
- Focused tests cover 20,000P amount, threshold/cutoff/freshness, partial/unpaid/refund/cancellation exclusions, identity/self-referral, parallel claims, unknown replay blocking, cancelled/mutated receipts, native negative usage, first qualifying purchase and queue fairness.
- CORE UI fixture checks 21 scenario groups at 320/390/768/1440px, including disabled payouts with receipt capture, uncertain submissions, role/session disposal, XSS and masked contacts.
- Build, boundary, Hosting and final source review results are added to the HTML release report.

## Runtime Activation Contract

- Settings path: `systemSettings/studiomateReferralAutomation`.
- Requires `enabled=true`, `purchaseThresholdConfirmed=true`, `sourcePromoted=true`, `pointWriterE2eVerified=true`, studio `5330`, reward `20000`, minimum purchase `300000`, explicit UTC rollout `startsAt`.
- Missing config is disabled. `STUDIOMATE_REFERRAL_POINTS=disabled` is an additional emergency pause; no new LaunchAgent environment or interval is needed.
- Existing hourly fresh import calls the bounded worker; no manual sync, queue run, scheduler restart or historical processing is part of activation.
- Before enabling, verify live callable denial/auth boundaries, public CORE assets, runtime source, exact configuration and absence of unexpected production receipts/claims.
- First genuine referral verification is pending natural operation with a real operator-declared attribution and newly qualifying member. No fake customer attribution is inserted for testing.
