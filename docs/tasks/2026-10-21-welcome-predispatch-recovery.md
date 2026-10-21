# Welcome Preflight State Reconciliation

- Worktree: `welcome-predispatch-recovery-20261021`; branch: `codex/mini/welcome-predispatch-recovery-20261021`.
- Main owns canonical evidence, backend, data correction, docs and any approved deployment. UI worker owns `core/assets/app.js` and registration regression tests only.
- Preserve permanent candidate/send/claim identities and all prior failure evidence. No reset, alternate key, unconditional retry, contract resend, or signature-time fabrication.
- Confirmed source mismatch: signed contract still says welcome queued while its exact candidate/send are failed at `history_time_limit`, attempts 1. No phone claim or provider attempt marker in the exact records. Provider history loader currently stops at an unaudited non-welcome template, so completeness is not established.
- UI must resolve bounded exact contract references even after older welcome rows fall outside the recent 250 general messages. Wrong identity/studio references fail closed.
- Future typed, read-only preflight failures must move candidate and source to review without incrementing attempts, creating a send row, claiming or calling transport. Post-claim failures remain ambiguous and never automatically retry.
- Existing failure will only receive an exact source-state reconciliation; no stored attempt counter or outbound evidence is erased.
- Sending remains subject to existing freshness, signature age, recipient, template, history coverage and duplicate rules. Original signature age is never replaced with readback time. Late welcome requires separate operator review.
- Deployment and any one-member completion are pending the user's scoped approval question. No test messages.

## Confirmed Source-State Cleanup
- Exact reconciliation dry run validated source/candidate/send identity and the same failure reason. Applied only source welcomeStatus from queued to review and welcomeReason to history_time_limit; updatedAt and one stable workLane audit report were written.
- Audit: workLanes/welcome-predispatch-recovery/reports/source-state-3bfa512dfdcf7560015d98645fc1b70bcf31335ce8029132d7afeba005731fe5.
- Independent contracts_get_progress readback confirmed signed/review. Second reconciliation returned already_audited with no writes. Candidate/send attempts=1 and all historical records remain unchanged; no claim or message was created.
- Current read-only inspector: local complete/two aliases/two failed records; provider incomplete/unknown_welcome_template, no known welcome receipt in the inspected prefix. This is NOT exhaustive provider no-send proof. Native readback is stale. Source signature 2026-10-18T11:01:10.000Z is outside ordinary 24-hour welcome freshness; no altered timestamp or automatic replay is authorized by this cleanup.
- Code leaves ordinary eligibility/recipient/template/signature freshness and all histories unchanged. Pending code only improves accurate UI reads and typed preflight-failure persistence.

## Eight Registration Reviews, October 21-22
- Human approval `call_b0b9bc1e791041e2aec2ff0afa2007eb`: exactly five historical signed welcomes, conditional on current native member/pass/payment, exhaustive local/provider history and permanent family claims. No blanket signature-age exception. Permit expires 2026-10-22T15:00:00.000Z.
- The one-off recovery runner has a hardcoded five-contract scope. It never changes the normal 24-hour signature rule, seven-day automatic selection rule, schedules, reservations, tickets or payments. Real historical signature times remain unchanged; no member signature is manufactured.
- Kim/Jeong's verified numeric canonical profiles were linked with the existing native-profile merge pattern; original Excel profiles and historical fields remain. Explicit profile timestamps bound to the full alias/history scan are rechecked in the claim transaction.
- The exact diagnosed pre-transport history_time_limit failure keeps attempts=1 and full preRecoveryEvidence. A single provider attempt uses the SAME permanent phone/family candidate/send identity, with durable phone and all alias claims before POST. Accepted, ambiguous and failed transport claims never automatically retry.
- Reservation-open v4 was independently checked against the approved provider template (full content, image, channel and two buttons). Only this exact non-welcome identity was appended to the existing audited history classification; group-survey audit and all welcome-family exclusions remain intact.
- All five approved welcomes have provider acceptance and COMPLETE/4000 delivery proof, with matching candidate/send/source/phone and all alias claims. Exact private-survey/report audits were added after approved provider body/image/button verification. IDs are in the local HTML report; no full contacts or health answers are included. Re-entering the exact Sim recovery path returned GET-only/zero additional POST.
- Joo is an existing member with pre-cutover regular issuance and a July signed contract. Only the erroneous October discovery hint was excluded; the July contract was not attached to the October ticket and no welcome was sent.
- Yoon has four independently reviewed retired regular issuances predating cutover. The already signed October contract is preserved; canonical welcome disposition is not_required with native registration and issuance proof, not an invented accepted send. New UI/observer support remains pending deployment approval.
- Seo has an active October 12 regular pass, no native electronic contract, and missing native gender. User action is requested; do not infer gender, silently extend recovery age or report member signing complete.
- Code deployment/commit/push approval is separately requested. Current one-off member operations do not constitute runtime/Hosting deployment. No unapproved test sends or contract resends.
- Validation: membership suite 276 Node + 623 TS passed; focused UI/preflight/reconciliation/recovery 143 passed; independent template audit 305 passed; CORE operator workflow 59 Node + 26 TS passed; all five function codebases built; Hosting/catalog guard passed. Responsive isolated fixture 320/390/768/1440 has no overflow, console error or external/write request and includes the verified legacy-exclusion label. Final catalog fingerprint 46a42792bc40c587fa29b37d71b6f59a45d0c38ab0e1ec02c6d98eab272d0276.

## Release Authorization, October 22
- User explicitly requested deployment of the pending UI/preflight fixes, including scoped commit, latest-main promotion, runtime fast-forward, affected Functions and CORE Hosting, read-only live verification, CI and final Git checks.
- Latest origin/main advanced independently to e38a36e7 (Imweb webhook sample receiver/protocol). Its changes do not overlap this lane and must be retained. They are not an approval to invoke webhook probes or member workflows.
- Affected detection selects functions-alimtalk and functions-private-chart; no Firestore rules, indexes, secrets, credentials, schedules, reservation/pass/payment mutations or member sends are included in this release.
- Existing five completed welcome sends are verification-only. Seo remains blocked pending native required information and member signature; no contract is fabricated or resent.
- Release guards require clean local main matching freshly fetched origin/main, so reviewed main promotion precedes deployment. The scoped feature branch is pushed after live verification as well.
- Independent release review found two additional display ambiguities: terminal delivery failure behind legacy exclusion, and a queued candidate masking a failed send-ledger read. Both now remain review; accepted-send fallback is preserved. Registration tests pass 79 cases. Final release catalog fingerprint is 88fb4395377b29c057f073f239ba43f27660fd390ed05311e94e6fc70f90ebf6.

## Verified Release, October 22
- Behavior commits: 55e6f399 and 465a4796. Deployed source: 27118d0a, preserving the independent main changes. Runtime was fast-forwarded without changing scheduler cadence.
- CORE Hosting archive-pilates and archive-pilates-core deployed successfully. Live responsive checks 95 and release canary checks 10 passed; authenticated registration readback confirms existing-member exclusion, correct contract-bound pass, five completed welcomes and one required-information review.
- Affected Functions only: functions-alimtalk (15 functions) and functions-private-chart (24 functions). Dry runs and all update operations succeeded. Read-only Google Cloud metadata confirms representative queue, staff survey and member contract functions ACTIVE with new update times.
- Read-only canonical guards confirm all five original message IDs unchanged, attempts still one, and signatureReminderEnabled still true. No member send, manual queue, contract resend or data-policy migration occurred.
- Full results: docs/reports/2026-10-22-welcome-registration-release.html. Earlier approval-pending notes above describe historical checkpoints and are superseded by this release record.
- This final documentation-only commit does not require another Functions deployment. Refresh CORE Hosting release metadata after promotion and push the scoped feature branch after the live canary succeeds.
