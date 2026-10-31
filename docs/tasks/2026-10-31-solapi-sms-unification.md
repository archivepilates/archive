# Direct text delivery via SOLAPI

## Approval and boundary
- User requested all future ordinary texts via SOLAPI; release approval call_acd55ce92a414f0bade98d9cda3de02e.
- Covers ordinary SMS/LMS/MMS delivery authored by ARCHIVE PILATES: instructor signup reminder, membership signature reminder, refund calculation notice. Existing video LMS and SOLAPI ATA remain unchanged.
- Provider-managed StudioMate/eformsign initial contract/signature/refund-agreement invitations remain native, explicitly included in approval boundary. No guessed secure links or changes to signing flows.
- No manual bulk recovery, real-phone test, existing-job reset, historical replay, new scheduler, IAM or Functions implementation changes.
- Dedicated branch codex/mini/solapi-sms-unification-20261031 reuses the clean completed worktree /Users/archivepilates/codex-worktrees/team-instructor-intake-20261029, base 08e8a0086e935aa1aecefd12d92eff23bca9cf10. Managed creation against historical checkout failed during mmap; no edits were moved from that stale repository.

## Design
- Existing queues, source selection, live native/eform checks, original canonical keys/fingerprints, approvals and browser locks remain. Only delivery changes to common scripts/lib/member-sms-solapi.mjs.
- Ordinary messages retain [09:00,23:00) KST; reminders retain stricter [09:00,20:00). Check before reads/claim and immediately before provider POST. A proven zero-POST clock deferral restores the existing pending state; unknown writes never retry.
- Copy immutable recipient/key/body before awaits. Validate active configured sender and complete bounded recipient history across all sender numbers and message types. Same key blocks any type; unkeyed matching SMS/LMS/MMS body blocks; different known canonical actions may reuse generic copy.
- Revalidate source and claim transaction before the single POST. No write retries or StudioMate fallback. Retired general StudioMate sender throws before browser access. Source browser remains read-only.
- Preserve legacy numeric StudioMate receipts; new SOLAPI message/group IDs and content/recipient binding remain on the original canonical job. Reception is not final delivery; keep deliveryStatus not_verified until independent provider evidence exists.
- Existing approved message bodies and action keys remain. Reminder subjects use concise ARCHIVE PILATES labels within provider 40-byte limit; hash the actual transmitted subject/body/image, never silently truncate body. Conservative UTF-8 byte limits fail closed.
- Refund pretransport transaction now checks the current dispatch token and prior send markers. Business calculation/purchase/cancellation rules are unchanged.

## Private sender and credentials
- Existing SOLAPI account has two active numbers. Selected sender matches the previous approved instructor-video sender, independently present exactly once in current active list, last4 4425; no arbitrary first-number selection.
- Private local config /Users/archivepilates/ArchiveIN/automation/config/member-sms-solapi.json, mode 0600, contains policy/sender/approval metadata only, no API secrets. Existing Secret Manager SOLAPI_API_KEY and SOLAPI_API_SECRET are read under archive-codex-operator@archive-pilates.iam.gserviceaccount.com in archive-pilates.
- Reuse HMAC transport, add optional gcloudPath. New factory uses /opt/homebrew/bin/gcloud so the existing restricted LaunchAgent PATH works without changing agents or credentials.
- Live read-only provider preflight for exact current pending job reached the deliberately stopping callback at 2026-10-31T01:47:51.185Z: 2 provider GETs, 0 provider POSTs, 0 canonical writes, 0 messages.
- Restricted PATH configuration/credential probe passed with intentionally invalid recipient, stopping before provider reads/claims/POST.

## Validation and release evidence
- Focused transport/processor/refund/legacy/release and shared source tests are synthetic; count and final CI links to be recorded after final review.
- Existing member-dispatch-macmini suite has four preexisting failures (two instructor fixture subtests and their parents), reproduced on untouched runtime. Transport-specific new failures corrected; unrelated eform fixtures are not changed.
- CORE rules UI tests pass at 320/390/768/1440. Existing overflow in unrelated older sections remains outside this change.
- Broad Hosting catalog precheck has previously established base drift; direct CORE UI guard and rules-only manifest preservation apply, not full-bundle Hosting replacement.
- Affected detection lists all five codebases solely because the CI workflow changes. No Functions source/config/shared contracts change; do not deploy unchanged Functions. Existing workflow builds all codebases and runs the new transport guard suite.
- Rule target solapiSms replaces only /rules/index.html, baseline version 41ce5b9f50c9a529, 63 paths. Current source rules SHA256 5eef77f02c710087b42fdb9c82ae22f754fe59e669860c76574707a8edb14014.
- Implementation, runtime adoption, Hosting release, independent hashes, CI and natural member dispatch remain distinct proof stages. No active target state is inferred from this note.

## Final pre-release checks
- 1652/1652 combined scoped tests passed, including transport, both reminder processors, refund source/claim gates, source identity, shared HMAC, release guards and both CORE UI suites. No skips.
- Three bounded test/review agents completed; identified final-clock, null receipt, cross-type history, effective-subject hash and group-only deferral holes were fixed and regression-tested before release. No remaining scoped blocking findings.
- Syntax checks, git diff --check, instructor registration/refund release validators, data-source policy and direct CORE Hosting UI guard passed.
- New rule layout passes 320/390/768/1440 with eight screenshots under ignored artifacts/solapi-sms-rules; existing broader CORE MCP suite adds six passing checks. Task-owned browser contexts closed.
- Source sender readiness and private configuration were checked without dispatch. Restricted LaunchAgent PATH successfully loads configured credentials and stops at the intentional invalid-input guard before provider transport.
- Existing instructor worker plist SHA256 15e80206ea574d396a4ee660b3a8ad99d7b951cca11ba846d3209beaa5cacdd5; refund worker plist SHA256 0a48a6652d63b601c8e270d45616e913d03bcab8e1cc7ee73437046cfa4da308. No LaunchAgent edits; membership reminder remains integrated with existing Excel/admin processing.
- Failure emails now name SOLAPI/legacy histories correctly and dedupe by cause/code as well as source/stage so one materially new block is not hidden by an old UI-error report.

## Actual rollout
- Implementation commit 41943bd3b2548da20e572809d7ec8811238f00ad was promoted/pushed to origin/main and fast-forward adopted by archive-runtime-main. Eleven changed runtime MJS files independently matched committed hashes.
- Rules-only release at 2026-10-31T01:48:43.664Z: sites/archive-pilates-core/versions/094582bfbc5d0249, release 1793411323706000. Independent verification at 01:49:34.738Z found only /rules/index.html changed among 63 paths; all other hashes and Hosting config were identical.
- Custom and Firebase rules URLs both returned HTTP 200 and exact source SHA256 5eef77f02c710087b42fdb9c82ae22f754fe59e669860c76574707a8edb14014. No Functions deployment or scheduler change.
- Functions Affected Check succeeded: https://github.com/archivepilates/archive/actions/runs/41157080274 . CORE MCP Check 41157080196 passed rules UI and functional checks but failed dependency audit on six moderate transitive findings.
- Minimum security follow-up pins glob 14.0.2 and minimatch 11.0.1; direct SDK/firebase-admin/ajv versions remain unchanged. Local MCP tests 252/252 and npm audit --omit=dev (zero findings) passed. The existing rimraf glob cleanup path has a synthetic compatibility regression; the override exceeds its declared glob range and is not an exhaustive compatibility proof. Independent three-file review found no actionable issue. Fresh authenticated stdio/runtime checks and follow-up CI remain separate evidence below.
- No real-phone tests, manual queue runs, historical replays, member data writes, app restart, or provider POST occurred during this rollout.
