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
- Positive live E2E for the replacement seal path is pending. Asked permission for a separate operator test draft with no signature message; no response or test creation is recorded yet. Do not enable the writer based on synthetic tests alone.

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
- No positive live seal test or automatic-writer reactivation should be inferred from the completed code release below.
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
- Remaining blocker: permission and positive evidence for the separately proposed operator test draft. The new route is implemented/released and synthetically verified, but actual seal storage and automatic writer reactivation are not complete. The unsigned expired member contract remains review-only and was not resent.

## Private evidence

- `~/ArchiveIN/operations/contract-settlement-recovery-20261106/`: closure intent/verified receipt, finalization evidence and durable finalization intent.
- Prior corrected payroll sources: `~/ArchiveIN/operations/october-payroll-actual-20261102/`.
- Do not copy payroll values, member details, presigned URLs, upload tokens or full source documents into this report, public rules or Git.
