# StudioMate Referral Points

## Scope And State

- Branch: `codex/mini/studiomate-referral-points-20261102`.
- Isolated source clone: `/Users/archivepilates/dev/archive-studiomate-referral-points`, base `5a8691e0`. Managed worktree creation was attempted first but the old Documents repository failed mmap checkout twice. The healthy runtime repository was cloned locally instead; runtime and unrelated worktrees were not edited.
- User approved implementation, Kim Gi-hyo-only test, purchase threshold, then validation, runtime/CORE release, commit and push.
- Operating policy: newcomer purchase >= KRW 300,000 -> referrer 20,000 native StudioMate points. Existing Imweb program remains unchanged.
- Production released and enabled at 2026-11-02T11:35:42.413Z (20:35:42 KST). Do not mark the first real referral live event verified merely because the operator point writer passed.

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

## Completed Release

- Feature source `9683ebcd`, fixture formatting `c18c6e77`, explicit CORE-only MCP exclusions `a8eb5d47`; all promoted to origin/main. Main push before deployment is required by existing release guards.
- Only two new functions were created: functions-app:operatorCaptureStudioMateReferral and functions-app:getStudioMateReferralDashboard (asia-northeast3, Node 22). Shared ownership manifest caused all-codebase validation; other production Functions were not deployed.
- CORE Hosting site archive-pilates-core deployed; member-registration HTML, app module, two new referral assets and operating rules are byte-identical at the custom domain. No Imweb/DNS/legacy member-link deployment.
- Both callable unauthenticated probes returned 401 UNAUTHENTICATED. Existing canonical owner authentication returned dashboard HTTP 200. Self-referral returned HTTP 400 INVALID_ARGUMENT before creating a receipt. Auth tokens remained in memory and were never printed or saved.
- Real deployed CORE UI was authenticated in a temporary in-memory owner browser session. Four inputs, enabled submit, active policy/automation and empty canonical queue were observed at 320/390/768/1440 widths. No receipt was submitted; the browser/context and tokens were discarded.
- Settings were created atomically with sourcePromoted/pointWriterE2eVerified/purchaseThresholdConfirmed, explicit rollout startsAt, noBackfill and no member-message path. Canonical requests/claims were empty at activation and final readback.
- Existing installed hourly job points to /Users/archivepilates/dev/archive-in-runtime, StartInterval 3600, original --download --apply --scheduled-run arguments. No restart, new scheduler or manual sync/queue run. Runtime fast-forwarded to source main.
- 168 referral/registration regressions +12 TS intake checks +224 access/ownership checks +252 MCP safety tests +6 MCP/rules UI tests passed (662 total); standalone referral UI fixture passed 21 scenario groups. Five codebases build, 107-export boundaries, Hosting and rollback/predeploy guards passed.
- Initial CORE MCP CI coverage failure was fixed by explicit exclusions, not by permitting arbitrary payout. CI on a8eb5d47: CORE MCP 41437450949 SUCCESS; Functions Affected Check 41437451249 SUCCESS.
- Final native readback again confirmed 100P, one credit and one debit, duplicate attempts 0. Immutable final-native-readback.json is retained in the private test directory; the activation-time witness hash and later readback hash are separate audit observations.
- Release audit: workLanes/studiomate-referral-points/reports/release-20261102. No task-owned browser/lock remains. No customer award, member message or historical backfill occurred.
