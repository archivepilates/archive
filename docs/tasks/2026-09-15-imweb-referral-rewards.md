# ARCHIVE PILATES Signup Referral Rewards

## Approved Policy

- Inviter receives KRW 3,000 per referred new signup; no purchase required.
- KRW 30,000 per inviter per KST calendar month (10 awards).
- No phone verification. One inviter and at most one reward per new signup.
- Block self-referral and duplicate awards. No claim of person-level multi-account prevention.

## Source And Scope

- Worktree: `imweb-referral-rewards-20260915`.
- Branch: `codex/mini/imweb-referral-rewards-20260915`, base `e725447` (`origin/main`).
- Existing root modifications remain untouched. No checkout, group, video entitlement, classroom, or deployed asset changes.
- Canonical identity: Imweb `siteCode + unitCode + memberCode`; UID is a provider request target, not a stable dedupe key.
- Canonical attribution: Imweb signup `recommendTargetCode`, matching the inviter's own `recommendCode`. Must verify these fields with an ordinary test signup before activation.
- API field meaning reference: https://old-developers.imweb.me/members/get (legacy documentation). Current CLI readback independently confirms camelCase fields exist; it does not prove signup integration is configured.
- No customer data or credentials saved in this worktree. Audit prints only counts.

## Implemented Locally

- Disabled-by-default, immutable policy constants and pure eligibility helper.
- Fail-closed checks for source verification, identity, timestamps, cross-site data, self-referral, same email, pre-start membership, existing reward record, and monthly reservation amount.
- KST calendar-month handling; past-month events held for review. Carry-over/backfill and a campaign start time remain unapproved, so no retroactive awards.
- Read-only readiness audit, maximum 10 pages of 50; incomplete scans fail visibly.
- CORE operating-rule source updated as pending, not deployed.

## Verified 2026-09-15

- CLI authentication renewed through `imweb auth doctor`; no new permissions requested.
- `config site-capabilities`: promotion points available.
- `node --test scripts/tests/imweb-referral-policy.test.mjs`: 11 passed.
- `node scripts/audit-imweb-referral-readiness.mjs`: complete 2-page scan, 82 members; own referral code 0, signup referrer code 0; no writes.
- Initial Chrome actions were interrupted twice by user activity; no admin setting was changed in that initial attempt. The later approved native trial changes are recorded below.

## Native Trial: Saved And Verified 2026-09-15

- Used the home-account Chrome profile and the existing ARCHIVE PILATES Imweb admin tab.
- User approved the free trial terms, immediate renewal cancellation, and enabling points with the dormant common purchase/review rewards changed to zero.
- Saved points enabled. Common purchase earning changed from 5% to 0%; regular review from KRW 500 to 0; photo-review addition from KRW 1,000 to 0. Signup, native referral, long-review and app-install rewards remain zero. Existing point-use conditions were preserved.
- Product-specific earning overrides were not audited; zero common settings are not proof that every product-specific override is zero. No member balances, orders, groups, video access or classroom code were changed.
- Started the 14-day trial; application dialog showed today's total KRW 0. Subscription management displayed trial availability through 2026-09-28 and the first scheduled charge on 2026-09-29.
- Immediately cancelled renewal using the approved `무료 체험 종료` action. Final readback: `2026년 9월 28일까지 모든 기능을 사용할 수 있어요. 서비스 이용을 계속하려면 구독을 다시 시작해 주세요.`, button `구독 갱신`, and `결제 내역이 없어요.` The prior scheduled payment disappeared.
- No campaign was executed. After inspecting an unsaved setup, selected `저장하지 않고 나가기`; dashboard readback confirms `아직 친구 초대 캠페인이 없어요`.
- Closed task-owned points-settings tab; preserved the user's pre-existing admin tab. No browser viewport override or local browser process was created.
- CORE operating-rule source updated below; not deployed. Custom payout helper remains disabled. No commit, deployment or push performed.

## Native UI Benchmark: Preview Only

- Setup supports independent signup and first-purchase rewards, with separate inviter/invitee amounts. Defaults awarded KRW 3,000 to both parties; do not execute defaults for the approved inviter-only policy.
- Unsaved preview was set to inviter KRW 3,000, invitee zero, signup only, and `한 달` / 10 awards. These were preview values only, not a saved campaign. The precise native month-reset boundary was not independently verified.
- Mobile preview uses a bottom panel; PC preview uses a right-side panel. Both show an invitation image, invited-member count, awarded points, terms, and bottom `링크 복사` / `친구에게 공유하기` controls.
- Logo, floating button, bubble title/description, widget image, button style, destination URL, and social-share title/description/image are configurable.
- Templates update reward amounts, but custom title/description can retain the default both-party promise after invitee reward is removed. Default notes also claimed duplicate signup rewards despite signup rewards being disabled. Rewrite these explicitly before any launch.
- Preview share control did not issue a real referral link or open a share picker. Real link encoding, login/signup persistence, Kakao/SMS handoff, attribution and payout are NOT verified. Do not claim an ordinary-member E2E test.
- Candidate custom UX: one concise `친구 초대` entry, inviter-only reward statement, monthly remaining allowance, short terms, link-copy feedback and share action. Avoid a second prominent floating promotion over existing shop navigation.

## Remaining Before Activation

- Required-terms approval and user-completed signup confirmed. Canonical native attribution verified. Wire and verify automatic invite-link prefill and social-signup continuity separately.
- Provider-log adapter, manual award/reversal and new-signup worker award/duplicate/reversal tests verified. Full invite-link and scheduled-operation flow remains separate and unverified.
- Complete mobile/desktop visual QA and ordinary-member purchase/access regression. Local preview URL access was blocked; no bypass attempted.
- Approve activation start, private canonical SQLite location/backup, deployment and worker schedule. Never run the native campaign and custom award worker simultaneously.
- Update CORE live status after actual deployment and verified signup/award; current CORE changes are source-only.

## Follow-up Implementation And Verification

- Added public-code-only share-link helpers, a tab-scoped attribution session adapter, and an isolated Shadow DOM share widget. Empty referral fields can be filled without overwriting an existing choice; no form is submitted by this code.
- Added a private durable SQLite ledger with atomic identity/month reservations, one-time dispatch claims, unknown-outcome holds and exact provider-proof reconciliation. Stored identities are hashed; no production database has been created.
- Added complete canonical source scanning and a dry-run-first, single-use points-write adapter. No provider write was executed.
- Added private worker orchestration: complete scan before writes, exact test-pair allowlists, one-time dispatch, held-outcome reconciliation and redacted aggregate summaries. Missing real native-log verifier blocks apply. No CLI launch or schedule is installed.
- Generated self-contained `docs/previews/2026-09-15-imweb-referral.html` from the actual widget module with the official existing symbol image. Demonstration code is synthetic and the preview explicitly does not register members or award points.
- Live ordinary-member proof: generated a recommendation code in the existing ordinary test member's native profile modal, then confirmed API own-code count changed from 0 to 1. The code itself is not recorded here. Logged this test session out afterward to inspect signup.
- Native membership settings: recommendation-code field enabled and optional. No setting changed during this inspection.
- Latest complete read-only API scan: 82 members, 2 pages, one own recommendation code, zero signup-attribution codes. Provider points log has no entries; actual nonempty log schema/readback is not yet proven.
- Actual signup-field wiring, social-signup continuity and provider readback adapter remain unfinished until an approved test signup/award. The generic session helper is not live native-form integration.
- Requested approval for one new test signup (required terms) and a test KRW 3,000 award followed by a KRW 3,000 reversal. No answer received as of this checkpoint. New password entry/submission requires the user to take over.
- Local preview browser access was rejected by URL policy. Did not bypass it, serve the same file elsewhere, or use another automation surface. Mobile/desktop visual QA is pending, not passed.
- Task-created Chrome front-site/profile and membership-settings tabs closed. Failed preview blank tab closed. Only the signup terms tab is kept for the approval/password handoff. Pre-existing user Chrome tabs preserved; a points-settings tab of uncertain ownership was left untouched. No viewport override or dev-server process remains.
- All source remains local and uncommitted. No production widget, scheduled worker, customer payout, deployment, GitHub push, classroom code or entitlement change.
- Canonical source/dedupe/reader/activation decisions: `docs/decisions/2026-09-15-imweb-referral-source-policy.md`.
- Final local tests: `node --test scripts/tests/imweb-referral-*.test.mjs`, 50 passed, including six-process races and actual source-adapter/ledger reason agreement. Syntax and whitespace checks passed. These are fixture tests, not production awards.

## Approved Provider Test: 2026-09-15 19:09-19:11 KST

- User explicitly approved KRW 3,000 trial credit and reversal. Used the existing ordinary test member, verified by native own referral code, canonical member identity and exact expected test-account name. No real customer selected.
- Checked home-profile Chrome Imweb admin session already logged in. CLI saved authentication refreshed normally; no password requested or copied.
- Initial balance 0; increase dry-run then exactly one increase execution. Readback balance 3,000 and one log matching recipient, unit, unique reason, currency KRW, type `etc`, changePoint +3,000.
- Reversal dry-run then exactly one decrease execution. Readback balance 0 and one separate matching -3,000 log. Member group digest unchanged. Two audit records remain, as expected for compensation rather than deletion.
- Private journal outside Git: `~/ArchiveIN/automation/referral-tests/20260915-yVjFc6/journal.json`, owner-only folder/file. Final state `verified_restored`. No credentials retained. No real signup reward or production ledger entry created.
- Implemented `scripts/lib/imweb-referral-proof.mjs` from the observed nonempty log schema. Its real read-only verification confirmed the original test award after reversal; it does not assert a positive current net reward.
- Native signup still waiting for action-time required-terms consent. The required third-party disclosure contains example placeholders. Asked the user whether to proceed for the test member; no consent/check/submission performed yet.
- Native campaign still absent. Custom payouts remain disabled and no schedule/deployment was created. Manual provider operation success must not be described as full friend-signup E2E success.
- Follow-up local validation: 60/60 tests passed after adding 10 provider-proof tests. Main reviewed the disjoint test patch and reran the full suite. Actual provider adapter readback passed without executing another payout.

## Approved Signup Terms And Credential Handoff

- User approved the pending required signup terms/privacy/third-party/age confirmation after the placeholder-disclosure finding was explained. Checked only required items; optional SMS/Kakao and email marketing remained unchecked.
- Clicking the native input directly did not toggle it. Clicking the visible label did; checked states were verified before advancing to the actual signup form.
- Observed native signup form `#join_form`, optional text input `#recommend_code[name="recommend_code"]`, placeholder `추천인 코드를 입력하세요.`. This is the signup target, distinct from the profile's own-code display.
- Entered an explicit test display name and the existing ordinary test inviter's public referral code through the native UI. No custom script was injected and this does not prove automatic invite-link prefill.
- New email/password/confirmation and final signup submission handed to the user. No password read, entered, generated or reused. Existing home-profile administrator session unchanged.
- No new member or signup attribution confirmed yet; no second credit/reversal executed. Only inherited IAB tab 2 remains open for this handoff. Native campaign and custom production payouts remain inactive; no deployment or push.

## User-Completed Signup: Canonical Attribution Verified

- User confirmed signup was completed. Read-only canonical API scan now returns 83 members across two complete pages, with exactly one matching new test member and one attributed signup.
- The new member's canonical join time is 2026-09-15T10:33:57.000Z. Its `recommendTargetCode` resolves uniquely to the expected existing ordinary test inviter. New member points remain zero. No supplied password was entered, reused or saved by the agent.
- Executed the actual worker in `apply: false`, exact test-pair allowlist mode with real canonical source records. Test-only policy start equals the observed signup time; production policy remains disabled. Result: one simulated KRW 3,000 reward, zero writes/reservations/claims/sends/failures.
- Reran the full fixture suite: 60 passed, zero failed. The prior manual provider credit/reversal remains separate evidence; signup-triggered real worker payout and duplicate-run proof are not yet completed.
- Requested specific approval for one additional KRW 3,000 worker award to the inviter, duplicate-run check and immediate reversal. No second award executed before that approval. Automatic link prefill, social signup, responsive widget QA, activation/schedule and deployment remain pending.

## Approved Signup Worker Test: Completed

- User explicitly approved one additional KRW 3,000 test credit, duplicate-run verification and immediate reversal. Preflight verified the unique new ordinary test member, expected native inviter code, existing inviter test-account name, zero balances, baseline group digests and no existing provider log for the new signup reward key.
- Ran the actual worker with complete canonical API scans, a durable private SQLite ledger, real provider adapter and real log verifier. Exact member/inviter pair allowlist, test-only activation timestamp, no customer-wide activation.
- First run: one reservation, one claim, one send, one verified paid record, zero failures. Inviter balance 0 -> 3,000. Repeat run: one duplicate, zero prepare/claim/send, zero failures; balance stayed 3,000.
- Executed the separately approved reversal with dry-run/confirmation token, then independently read member balances, groups and provider logs. Final inviter balance 0, invitee balance 0, both group digests unchanged, one +3,000 and one -3,000 test log. Prior manual test records are preserved separately.
- Private journal: `~/ArchiveIN/automation/referral-tests/e2e-20260915-32ef405f25cc/journal.json`; state `verified-restored`. Test ledger stays private beside it. The historical paid row is preserved after compensation to block re-award; this is not a production ledger.
- Reopened the ledger in a fresh process after reversal: paid record retained; worker returned one duplicate and zero attempts. The provider prepare dependency was disabled for this read-only restart check.
- No credentials saved, test-account deletion, real customer credit, order/group/entitlement/classroom change, native campaign activation, worker schedule or deployment. Signup attribution was entered manually; do not claim automatic invite-link prefill, social signup, responsive widget QA or scheduled signup-to-award operation is complete.
- Updated verification HTML and CORE operating-rule source only. Test browser tab closed after credential handoff was no longer needed; user-owned Chrome tabs preserved. No commit or push.

## Production Activation And Native Popup Benchmark

- Scoped source is committed and pushed to origin/main and codex/mini/imweb-referral-rewards-20260915. Latest UI commit d92577b; canonical clean runtime is ~/dev/archive-in-runtime. CORE Hosting only, project archive-pilates, existing operator service account. No Functions, Firestore rules, entitlement, order or product changes.
- Benchmarked the native paid campaign preview without executing/saving a campaign. Reconfirmed no native campaign after leaving the preview. Custom popup uses mobile bottom sheet, compact desktop panel, inviter-only 3,000 won copy and 30,000 won monthly limit. No fake personal counters.
- User additionally requested centered sidebar text and a distinct menu color. Final live row is centered, #b3392d with white text, 57px high, immediately after Community on mobile and desktop. Actual clicks open the popup. Footer entry remains separate and unchanged.
- Final asset version 282893b98f96: public HTTP 200, 28,456 bytes, exactly equals tracked asset. Home-profile native SEO Footer save was reopened and compared in full; original 54,568 characters preserved plus only a 210-character loader. CLI unit-script source is stale/different and production apply is deliberately blocked, not bypassed. Header/body original hashes unchanged.
- Ordinary-member own-code creation, correct share URL and copy-success UI verified. Clipboard external readback was unavailable. Unauthorized ordinary-member classroom /48 remains denied; temporary points fully reversed and groups unchanged. No claim of authorized playback revalidation.
- Responsive popup checks at 320,390,768,1440 widths found no horizontal overflow. Close target 44px, primary buttons 48px, Escape works. Final native menu clicking tested via accessibility actions on PC and mobile; both centered/red and duplicate-free.
- Production enabled at 2026-09-15T11:29:14.318Z (20:29 KST) with exact three test/admin exclusions. LaunchAgent com.archive.imweb-referral-rewards every 300 seconds runs from canonical runtime. Complete scan 83 members/2 pages, one pair excluded, no eligible customer payouts. Three scheduled runs passed; last recorded 11:39:53.240Z, zero awards/failures, exit 0. Owner-only persistent ledger and daily SQLite backup verified.
- Native auth refresh succeeded on pinned default profile. Existing delegated Gmail credentials/profile read succeeded; no test email sent. Missing/uncertain ledger or provider outcome fails closed; no automatic retry of an unknown award.
- Final code tests: 120 passed. CORE Hosting, onsite welcome compatibility and release guards passed. One predeploy stopped on an outdated local HEAD before any upload; fast-forward corrected it and deployment succeeded.
- Remaining live proof: native signup-field auto-fill after required terms. Action-time consent requested; no new acceptance, account or payment without response. Social signup not certified. Task-owned QA tabs close at final; only the terms handoff remains while awaiting consent.
- Final verification report and CORE rules updated in this release; no Notion duplicate created.

## Popup Copy Removal

- User requested removal of the existing-member invitation notice. Do not create that paragraph for logged-in visitors; preserve the anonymous email-signup invitation and all referral attribution/reward rules.
- This is presentation-only: no worker, payout, identity, policy or access change. No CORE operating-rule update is needed. Generated widget asset version 3366800e05eb; deploy CORE asset and update only the existing native SEO loader version.
