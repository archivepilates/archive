# Holding Notice: New Registrations From 2026-10-08

## Approved Scope

Human approval: automatically send holding v2 notices for holds newly registered from 2026-10-08 00:00 Asia/Seoul. The cutoff is native creation time, not holding start date, discovery time, or a changed period. No historical backfill, additional real-member tests, reservations, ticket changes, or holding changes are authorized by this activation.

## Canonical Promotion Contract

- Source of truth: current StudioMate ticket controls, full native issuance/holding lifecycle history, and canonical `memberProfiles` identity. Read twice under the existing shared browser lock; compute from fresh data immediately before dispatch.
- Discovery: existing hourly Excel `workLanes/holding-allowance-notice/state/excelHoldingRoster` and readback jobs. These only select read-only investigations. Require the current import/version and a fresh complete roster; preserve its pre-cutoff initialization.
- Canonical destination: `holdingNoticeEvents`. Flat minimal event identity and policy fields only; do not persist raw holding history or a cached balance ledger.
- Receipt operational metadata: `holdingNoticeReceiptChecks` stores last-check/error only, and `opsState/holdingAutomaticReceiptCursor` stores the bounded scan position. Neither can authorize dispatch or replace the send/claim ledger; no history or balance is stored there.
- Key: existing `holding_operator_notice_` digest of studio, member, immutable issuance fingerprint, and native creation-evidence fingerprint. Period edits, template changes, and execution dates never mint a resend key.
- Writer: Mac mini `scripts/run-automatic-holding-notices.ts`, only after fresh native source validation. Allowed readers: this dispatcher, receipt reconciler, operational audit. No member360, mirror, or provisional workLane may authorize a send.
- Actions: exact canonical event plus current policy, latest native readback, current member/staff exclusions, provider history, and atomic candidate/send/two-claim checks. Reconcile accepted/uncertain outcomes using GET only; never recreate a send after unknown acceptance.
- Policy: `holding_new_registrations_20261008`; cutoff `2026-10-07T15:00:00.000Z`; mode `live_readback_auto`. The old cached-history cloud mode `live` stays inactive.
- Calculation: original contract days x 20%, floor; inclusive union of noncancelled actual/current/future member-holding days. Exclude center closure extensions. Early release with missing actual dates, overage, multiple ambiguous tickets, invalid identity/history, and stale discovery are review-only, not guesses.
- Old holds: no notice for pre-cutoff creation. Fresh new creations older than 48 hours require review, not automatic backfill. Preserve original baseline and existing send/claim audit evidence.
- Timing: existing hourly Excel chain, no new polling schedule. Bound reads to ten jobs per run with continued-hint fairness; receipt checks do not POST. Browser contention and larger rosters can defer work.
- Coverage limitation: a future scheduled hold is discoverable only when StudioMate exports it in the current/expected-holding roster. Do not claim export coverage that has not been observed. A registration first exposed after the 48-hour boundary is review-only rather than silently backfilled.
- Stop/rollback: setting `autoSendEnabled=false` stops new dispatches at the transaction guard. Preserve all accepted/unknown claims and audit records; disabling does not cancel a provider-accepted message. Never reset the baseline or erase claims to restart.

## Verification And Rollout

1. Mock/unit tests cover midnight boundaries, historical exclusion, current source/profile/setting races, cancellation, unknown acceptance, duplicate/concurrent dispatch, terminal delivery preservation, receipt rotation, fairness, and deadline bounds.
2. Previous approved native Kim test: temporary zero-price ticket, save-to-delivery, COMPLETE/4000 and matching candidate/send/claims. Cleanup proof confirms ticket removed, original tickets unchanged, no payments or reservations. Activation rereads its provider receipt; do not send another test.
3. Activation check reads provider v2 APPROVED/BA/IMAGE, exact eight variables, logo image, holding-rule mobile/PC button, cleaned native E2E journal, matching ledgers, and fresh baseline. Check mode performs no writes.
4. Commit and promote tested source to origin/main; fast-forward Mac mini runtime; deploy only affected Functions and CORE Hosting. Activate using clean main CAS after rechecking proof.
5. Before cutoff, run the normal holding entrypoint and verify `holding_cutover_not_reached`, unchanged candidate/send/event counts, preserved baseline initialization, and running hourly LaunchAgent. No clock override or live test mutation.
6. Live report: `docs/reports/2026-10-07-holding-auto-cutover.html`. CORE operating rule: `/core/rules/#holding-allowance-notice`.

Deploy selection correction: the directory-based affected detector incorrectly classified `membershipWelcomeHistory.ts` as private-chart. Independent esbuild dependency graphs for all five exported entrypoints show only `functions-alimtalk` consumes this adapter. Correct that one-file mapping and test it against the dependency graph. Deploy only `functions-alimtalk`; changes to the deployment detector itself do not require unrelated runtime codebases to be redeployed.

## Status

Implemented, deployed and activated for native registrations from 2026-10-08 00:00 KST. Tomorrow's first natural scheduled send has not occurred and is not claimed from today's tests.

## Release Evidence

- Implementation: `33076476ca8d5b4c8075b2414ff7ea55d5d3c758`, promoted and pushed to `origin/main`. Main checkout and Mac mini execution runtime were clean and aligned at activation.
- Operator/project: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`, Firebase `archive-pilates`.
- Checks: focused Node suites 193 passed; welcome-history TypeScript suite 100 passed; additional deployment-selection/predeploy guards 24 distinct cases passed. Functions TypeScript build, Hosting/catalog validation, diff check, and production receipt-query/index preflight passed. Responsive verification passed 95 local and 95 live route/viewport checks, covering 320/390/768/1440/1920px.
- GitHub Actions: implementation run 37631866039 completed successfully: https://github.com/archivepilates/archive/actions/runs/37631866039.
- Functions: affected dry-run and production deployment completed for `functions-alimtalk` only. All 13 functions in that codebase verified ACTIVE; update times 2026-10-07 13:54 UTC. Queue revision: `scheduledprocessalimtalkqueue-00125-jik`.
- Hosting: scoped CORE deployment to `hosting:archive-pilates,hosting:archive-pilates-core` completed. Custom-domain and web.app release canaries match implementation SHA. Both `/rules/` and `/assets/alimtalk-catalog.json` return HTTP 200 and exact holding-cutoff/template markers.
- Activation: provider v2 APPROVED/BA/IMAGE, exact body/image/button contract, prior native E2E COMPLETE/4000 and cleanup evidence were reread. `mode=live_readback_auto`, `autoSendEnabled=true`, `canonicalSourcePromoted=true`, `activationCommit=33076476ca8d5b4c8075b2414ff7ea55d5d3c758`; cutoff `2026-10-07T15:00:00.000Z`.
- Pre-cutoff actual entrypoint check at 2026-10-07T13:55:50.834Z: `run-studiomate-holding-sync.mjs --from-roster --apply` returned `holding_cutover_not_reached`, `sendAllowed=false`. Automatic events/candidates/sends/claims each remained 0 before and after. Baseline initialization `2026-10-07T10:25:08.176Z` and seven historical held members preserved. Legacy cached-history queue remained disabled.
- Scheduler: existing `com.archive.studiomate-excel-emergency-mode` LaunchAgent is loaded/enabled, interval 3600 seconds, last exit 0. It runs the updated Git-tracked runtime with `--download --apply`; no additional polling schedule was created.
- Follow-up: existing daily 10:00 heartbeat `automation-4` updated to read-only first natural automatic-delivery verification. It must not revert activation from obsolete disabled-state notes, manually run queues, create test holds or send more tests. Unchanged/no-target runs stay quiet; delete after first canonical-ledger/provider-confirmed natural delivery.
- No real member/ticket/holding/reservation changes or additional manual sends were performed in this activation session. Prior approved temporary test ticket cleanup was verified from its evidence. Browser QA contexts were closed by their existing finally blocks; no StudioMate browser was opened for the pre-cutoff gate check.

Remaining verification: first post-cutoff natural holding send, and scheduled-future-hold export exposure. Missing/ambiguous source evidence is review-only; activation does not waive those guards. This follow-up documentation does not change deployed assets and needs no additional Hosting/Functions deployment.
