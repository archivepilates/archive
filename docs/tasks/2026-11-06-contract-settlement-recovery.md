# Contract and settlement recovery

- Date: 2026-11-06. Worktree: `/Users/archivepilates/codex-worktrees/ops-monitor-accuracy-20261104`.
- Branch: `codex/mini/contract-settlement-recovery-20261106`; baseline `9d13da3b`.
- User scope: restore the two diagnosed operational functions. Preserve existing contracts, dispatch claims, payroll sources and amounts. No member resend, signing on behalf of members, payment, distribution, new scheduler or permission widening.

## Contract evidence and recovery

- The current served StudioMate application uses a temporary upload reservation, presigned image PUT and finalization PATCH. The retired single signature POST is not used by the current component.
- The adapter validates the exact contract, approved seal bytes/hash, HTTPS AWS S3 target and restricted headers; no StudioMate session credentials follow the image URL. Each remote step rechecks current authorization/time and persists its phase. Independent exact-contract readback is mandatory; uncertain outcomes never retry blindly.
- Official seal validation and transport capability preflight occur before creating a contract claim. Ordinary operations now also reread live settings before each write. Historical E2E flags cannot verify the replacement route; an explicit new-route proof is required before automatic writing.
- Existing operator signature claims block replay even if a signing link expires or an old job remains in review.
- Shared execution requires live authorization before any claim. The ordinary processor and bounded manual recovery reread settings; the historical October batch helper has no new-route authorization and therefore fails closed rather than reopening an old batch.
- The exact five October recovery jobs have independently checked full accepted single-attempt/no-replay native receipts. Four canonical records are signed; the remaining exact native contract is unsigned with an expired request. This task did not re-request it.
- Main applied `close-membership-contract-recovery.mjs` once after a read-only plan and synthetic tests. Transactional CAS protected settings, five jobs, five contracts and five hints. It closed only the expired batch approval and attached supplemental hint closure metadata. Writer remains disabled; source jobs/contracts and hint status/reason are unchanged. It asserts dispatch acceptance, not completion of every member signature.
- Private closure plan hash: `4b187f02ee091e0167bc4bb76e432fb102cef8ad2c8a3b661304c27645b2fb55`.
- The replacement seal path was positively verified on the exact operator-saved renewal draft in the follow-up below. Programmatic creation remains unverified; the global writer remains disabled.

## 202610 settlement recovery

- The corrected actual-payroll audit, eight artifact hashes, two original payroll PDFs, retained employment source, full lesson source, cached workbook amounts and four statement links were checked. The selected extra classes remain the two approved morning classes outside the confirmed weekday working hours, not the evening alternatives.
- Added an explicit reviewed-artifact finalization branch before legacy workbook creation/rebuild. It cannot recalculate payroll, overwrite existing outputs, manufacture a missing operation workbook or replay an incomplete private intent.
- The legacy generator refuses an already finalized byte-identical corrected INDEX/XLSX pair before source preparation, preventing a later generic rerun from overwriting this recovery.
- Main finalized exactly two files under the existing home-account Google Drive month folder: canonical statement XLSX and canonical INDEX. Both are byte-identical to their verified corrected sources. Original review artifacts, source PDFs, warnings and links remain unchanged. All links and source hashes were independently reread.
- Private plan hash: `699d2a87cbd5774646e84210af752f20ca86c4440d71f8271417b927904e2b12`.
- Canonical INDEX SHA-256: `23477d9845df54304caf2d9c025122555489e593dea816c3928428bb649109ec`.
- Canonical XLSX SHA-256: `3698ca24f207561958ac2af329d156b567d1bc5bdcdcb1a71638253636ffd55f`.
- This is artifact finalization, not payment approval, transfer proof or instructor distribution. The independent payroll evidence and private finalization intent remain outside Git. The monthly execution schedule and future-month calculation policy are unchanged.

## Validation and rollout

- Combined contract, closure and settlement regression: 1,306 tests passed on Node 22, including new upload safety, no-replay, historical-proof gates, real synthetic finalization and CLI no-fallback/overwrite guards. Intentional overwrite-guard rejection was also verified against current October artifacts without mutation.
- Settlement/closure tests include synthetic success, source drift, wrong links/identity, partial publication, concurrent destinations and retained unknown intents.
- CORE operating rules updated in the existing contract, health and settlement records. Functions source/config is unchanged.
- The initial code release below preceded the positive seal test. Its historical results do not imply automatic-writer reactivation.
- First source CI run found an independent runner drift: CORE rules UI browser installation selected unsupported `ubuntu26.04-x64` with lockfile Playwright 1.59.1. Pin only the browser-test job to `ubuntu-24.04`; do not change app dependencies or widen permissions. The security job and all existing tests remain enabled. Official platform reference: https://playwright.dev/docs/intro#system-requirements and https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job .
- Initial post-release health run `health_202611061114_quick` independently recognized final 202610 artifacts, but its older unkeyed settlement finding/queue item remained open. Added an exact legacy-title mapping plus nonempty same-month completed-source requirements; other titles, missing references, prior months and active failures remain unresolved. 34 health-state tests pass; no direct status reset is used.

## Release evidence

- Source commits `0fba1fd99bf168bb70614f5979ce8f38a367992d` and `bb51c3a9688526275b316ce457e8ad7b14a81356` were promoted/pushed to `origin/main` and the scoped feature branch. Release checkout and runtime were clean and aligned after fast-forward; workers, locks, schedules and permissions were not restarted or changed.
- CORE Hosting site `archive-pilates-core` released from clean main using `archive-codex-operator@archive-pilates.iam.gserviceaccount.com` and root config. Both `https://core.archivepilates.com/rules/` and `https://archive-pilates-core.web.app/rules/` returned HTTP 200 and exact source SHA-256 `d9e13e3f17232273e5ab0c147f7766e5ea204ac1cdd0bc19e2c7792404cc24b4`.
- No Functions source or Firebase configuration changed; no Functions deployment was performed. Initial affected detection was empty. The later CI-workflow-only runner change conservatively marked all five codebases for validation; the full generated-codebase builds/boundary checks passed in CI, not a server release.
- Local checks: 1,306 contract/closure/settlement tests, 99 health tests, 22 CORE rules browser tests, Hosting/catalog validation and whitespace checks passed. Changed health/contract/settlement sections were checked at 320/390/768/1440px. Existing 405px whole-page mobile overflow is unchanged, not reported as a new fix.
- Main CI succeeded: CORE MCP Check `42149490465`; Functions Affected Check `42149490455`. The equivalent feature-branch Functions run `42149490096` also succeeded. The earlier unsupported-Ubuntu browser-install failure was repaired by the supported-image pin, without suppressing a test.
- Independent home-account Google Drive API reads found exactly one canonical INDEX and one canonical XLSX, no pagination, with each remote MD5 equal to its finalized local source. Full source contents and compensation values were not logged.
- Existing health run `health_202611061119_quick` resolved the exact old settlement finding and Codex queue item `health_2d4e7c01de2ef1f1c5e7d8c31550` through completed-source evidence. Independent document reads confirmed both statuses `resolved`; no manual status reset.
- Final health run `health_202611061122_quick` recognized 202610 `final_present` and no CI finding. Its only remaining finding is the contract writer lane, referencing the prior natural hourly report at `2026-11-06T02:08:57.760Z`. Current settings independently show old recovery `completed`, accepted count 5, writer still false. This is not full-system healthy; no manual sync or scheduler was added to refresh the report.
- All main/test/agent-owned browser contexts, local test servers and tracked browser processes were closed; user tabs and production sessions were preserved. No member message, contract re-request, payment or instructor distribution occurred.
- At this initial release, positive live seal evidence was still pending. The later exact-draft test below resolves only that storage check, not programmatic creation or global writer reactivation. The unsigned expired member contract remains review-only and was not resent.

## Approved canary follow-up

- User allowed exactly one new operator test contract, no change to existing contracts, purchases or passes, no member consent/signature, no signature invitation. Approval did not authorize replaying an uncertain creation or reactivating the global writer without positive storage evidence.
- Fresh native identity search was unique. Current ticket and all-time contract history were read independently. The operator test pass has no verified payment source, so the ordinary commercial candidate rules were not relaxed or marked verified. A separate canary fixture used the display values of an existing operator test document, not a new purchase or payment decision; terms remained unchecked.
- At `2026-11-06T04:36:31.088Z`, one private pretransport create intent was persisted before the single native contract-create request. No successful creation response/ID was retained. The one-off harness recorded a sanitized generic exception but omitted typed HTTP/transport details, so the failure cause is not established and must not be retroactively called a provider rejection. The consumed intent remains `needs_review` with no-replay and max-create-attempt guards intact.
- No seal reservation, image upload, finalization, signature request or member message was invoked. No new route E2E proof or global writer-setting mutation was made.
- Read-only reconciliation at `2026-11-06T04:42:46.633Z` verified unchanged member/profile hash, unchanged pass-list hash and all three original contract hashes. Complete native history remained three records, zero new canaries and zero unplanned contract records. Current absence is recorded as a readback observation, not proof that the original transport never dispatched.
- The already-existing unsigned test draft also has a center seal; it was only read, not overwritten as an alternative test. No second create, latch reset, contract deletion or blind replay occurred.
- Requested a user-saved, explicitly identified new test draft with no signature request as the next safe input. A positive result is still pending. Private helper/intent/reconciliation remain under `~/ArchiveIN/operations/contract-seal-canary-20261106/`, outside Git, without tokens or presigned URLs.
- Published CORE rules already state that actual storage verification is pending and the writer is paused. That rule and production settings did not change, so this documentation-only follow-up does not need a new Hosting/Functions release.
- Internal attention report was accepted by home-account Gmail as message `1a1af2c814f9f0d7` with the domain/status labels applied. The first local mail invocation rejected a non-digest event ID before authentication or transport; it was corrected to a stable SHA-256 event ID, not replayed after an accepted send.

## Operator-saved renewal draft: verified seal-only test

- The user saved a new renewal draft at `2026-11-06T04:48:40.000Z` and explicitly identified it. Exact contract ID: `14b508a0235b2db293565132e7bdeb998dd6c1464daaae8a629176d288b9475a`. This follow-up created no contract and sent no signature request or member message.
- After fresh identity, member/pass and full-history checks, only this draft received the approved 200x200 center seal. Reservation GET, image PUT and finalization PATCH occurred at `04:52:06.562Z`, `04:52:07.634Z` and `04:52:08.725Z` respectively. No session credentials were forwarded to image storage.
- An initial whole-content fingerprint warning was reconciled read-only: only the authorized center party status changed from pending to signed and its update timestamp changed. Restoring those two prior metadata values reproduced the exact original content hash. Contract terms, member consent/signature, member profile, passes and the three prior contracts were unchanged; complete history contains four records.
- Independent fresh-browser reads confirmed the center image loaded at 200x200, draft status, member unsigned, zero agreed terms and no signature-request timestamps. Uploaded source bytes passed the official hash check. Optional independent image-byte fetch was unavailable; no claim of a stored-byte hash comparison is made.
- At `2026-11-06T05:02:38.951Z`, a guarded transaction recorded only `sealUploadVerification` and create-only audit `workLanes/studiomate-membership-contract-automation/reports/center-seal-e2e-20261106`. Independent readback verified every other setting unchanged, `contractWriterEnabled=false` and `contractCreationVerified=false`.
- Private intent, independent readback and verified receipt are under `~/ArchiveIN/operations/contract-seal-canary-20261106/`. The original false-positive attempt evidence is preserved, not reset or replayed. Browser contexts and shared lock were closed/released in finally blocks.

## Creation diagnostics: repaired gaps and remaining uncertainty

- The initial create harness discarded typed HTTP/transport metadata. Its historical server response cannot be reconstructed; no specific HTTP status, bad field or authentication cause is asserted. Current required profile fields match the saved native draft, so missing identity data is not established as the cause.
- The consumed first create intent remains no-replay. The old fixture creator is explicitly retired; the existing user-saved draft was used rather than creating another document.
- Native HTTP, transport and JSON-body failures now retain a strict six-field diagnostic without message, stack, response body, headers, URL or tokens. The timeout covers body decoding; image PUT errors retain typed metadata. Writer journals validate that exact allowlist.
- Seal/message diagnostics are persisted at their existing non-replayable stage before reconciliation reads, so a second read failure cannot discard the original write failure. No automatic retry, policy relaxation, writer enablement or member message is added.
- Full Node 22 contract regression: 1,143 tests passed, zero failures/skips. Independent bounded review passed, including dual-failure/no-replay tests. Hosting/catalog validation, empty affected-Functions detection and whitespace checks passed. CORE rules UI checks are rerun; release evidence is recorded after live verification below.

## Seal-only follow-up release evidence

- Source commit `758413ab72930580742d3ac8f55a455c866e06fc` was promoted and pushed to main and the scoped branch. Runtime fast-forwarded to that exact source without restarting workers or changing schedules/settings.
- CORE Hosting `archive-pilates-core` deployed from clean main with the existing operator service account and root Firebase config. Both CORE rules URLs returned HTTP 200 and source SHA-256 `93bbc3521b65e6484dc11d7464e8d806352e5f55373a532b5963a621f4eceb7c`. No Functions were affected or deployed.
- Node 22 contract tests: 1,143 passed. CORE rules browser tests: 22 passed across 320/390/768/1440px. Hosting/catalog, affected-target and whitespace checks passed. Existing whole-page mobile overflow remains unchanged; this is not a layout repair.
- Task-owned browser cleanup receipts confirm closed contexts/process connections; shared StudioMate lock is absent. User-owned tabs and production sessions are preserved. No extra contract, member message, signature request or writer activation occurred in this follow-up.
- Main GitHub checks passed: CORE MCP `42166828407`, Functions Affected Check `42166828451`. Documentation-only completion evidence is committed separately; Hosting content remains byte-identical and needs no redeploy.

## Private evidence archive

- `~/ArchiveIN/operations/contract-settlement-recovery-20261106/`: closure intent/verified receipt, finalization evidence and durable finalization intent.
- Prior corrected payroll sources: `~/ArchiveIN/operations/october-payroll-actual-20261102/`.
- Do not copy payroll values, member details, presigned URLs, upload tokens or full source documents into this report, public rules or Git.
