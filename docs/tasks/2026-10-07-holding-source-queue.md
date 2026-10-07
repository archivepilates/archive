# Holding Source and Queue

Status: implemented and locally verified; source identity promotion blocked; not deployed; production sending disabled.

Worktree: `/Users/archivepilates/codex-worktrees/holding-source-queue`.
Branch: `codex/mini/holding-source-queue`; base `644a1b4c`.

## Scope

- Read StudioMate ticket issuance change history and the complete registered hold list through the browser, without StudioMate writes or API-mode migration.
- Native IDs are not exposed by the inspected DOM. Require an explicit, observation-bound identity reconciliation; never derive a hold ID from mutable dates or a list position.
- Preserve a stable operator-assigned hold ID across edits. A changed observation requires review, not an inferred new event.
- Initial baseline suppresses every historical hold. Queue only newly registered, verified events after the baseline and cutover.
- Keep canonical production collections disconnected until separate source promotion and deployment approval.

## Source Contract

Provisional evidence: `workLanes/holding-allowance-notice/observations` and `.../identityReviews`.
Proposed canonical source: `memberTicketHolds/{holding_ticket_sha256}` (one complete issued-ticket snapshot).
Candidate/send: existing `alimtalkCandidates` / `alimtalkSends`; durable pre-provider claims: `holdingNoticeClaims`.
Settings: `settings/holdingNotice`, defaults unchanged (`operator_sample_only`, autoSendEnabled=false, canonicalSourcePromoted=false).

Snapshot schemaVersion=1, source=`studiomate_ticket_history_dom`, studioId/memberId/ticketId native numeric strings,
memberName/ticketName, observationFingerprint/sourceVersion (SHA256), observedAt ISO,
identityVerified=true, holdsComplete=true, originalPeriod {days,source:issuance_record,evidenceRef},
holds [{id,status:registered|cancelled,kind:member,start,end,registeredAt,evidenceRef,creationEvidenceFingerprint}],
historyFingerprints array (append-only), issuanceFingerprint,
baselineAt ISO, baselineHoldIds array, noticeEligibleHoldIds array, noticeStatus, identityReview {reviewedBy,reviewedAt,observationFingerprint}.
Candidate payload: holdingSourceId, holdingSourceVersion, holdId, variables, holdingNotice=true.
Candidate uses existing `manual_review` type, exact v2 template, maxAttempts=1; holding discriminator must be recognized by template OR payload, never allow generic transport fallback.

## Safety and Promotion

- Staff/test recipients remain excluded; no new member-facing sends authorized by this implementation request.
- Require fresh post-candidate StudioMate readback; source/settings/member identity rechecked transactionally immediately before durable POST claim.
- Cancellation, revision, stale/incomplete history, overage, template mismatch, unknown provider history/outcome all block sending.
- Allowed source readers: holding planner/dispatcher and operator audit. Mirrors/member360/workLanes forbidden as sending sources.
- Review first, shadow comparison, sample verification, separate approved canonical promotion, then activation. Source and runtime schemas are not production-promoted by creating files.
- Reuse hourly Excel sync as an opt-in sidecar, with bounded member selection and the shared StudioMate browser lock. No new recurring poller.

## Verification

Read-only Kim/Bae source evidence: immutable issuance periods both 365 days; registered holds 8 / 0 days. Current expiry is not original duration. Source DOM has no native issued-ticket or hold ID.
Focused source/queue/provider/roundtrip/scheduling tests: 281 passed. Existing regression tests: 846 passed (1127 total).
Functions strict typecheck, five-codebase build, function boundaries and data source policy passed.
Reader tab extraction is tested with mocks and selectors inspected against live UI; unattended collector execution is still pending.
The roundtrip uses synthetic issuance/holding evidence, mock Firestore and a mock provider; it is not production E2E evidence.
No runtime checkout, deployed configuration, member records, tickets, holds or messages changed.
Interrupted processing is quarantined out of the active queue without retrying or deleting durable claims. The welcome interoperability gate reuses the welcome provider's exact audit validator, including malformed/duplicate/template-family rejection.

## Initial Operator Runbook (Before Release)

1. Read-only collector: `node scripts/collect-studiomate-holding-source.mjs --member-id <native-member-id> --ticket-name <exact-name>`.
2. Evidence preview: `node scripts/reconcile-studiomate-holding-source.mjs --observation <private-json> --output <private-preview-json>`.
3. Prepare a separate reviewed JSON with the verified native ticket ID and stable hold UUID mappings. Bind it to the full observation fingerprint; do not guess IDs or omit cancellation/edit rows. Every hold creation must map to exactly one event and every hold history row to exactly one event. The first complete snapshot establishes an immutable no-send baseline.
4. Run shadow reconciliation with `--review <review-json>` and optionally `--previous <source-json>`. `--stage` writes incubation evidence only; it never sends. Separate audited promotion is mandatory for `--promote`.
5. Source activation requires `sourceScanEnabled=true`, studioId=5330, explicit `scanTargets` (max 10 member/name pairs), `sourceReadbackVerified=true`, `promotionAuditId`, and `canonicalSourcePromoted=true`, plus hourly runtime env `STUDIOMATE_HOLDING_SOURCE_SCAN=enabled`. None have been changed here.
6. Queue activation additionally requires `mode=live`, `autoSendEnabled=true`, `nativeE2eVerified=true`, a valid `cutoverAt`, exact v2 templateId, audited `providerHistoryCoverage` (startAt <=cutoverAt, verified/allHoldingVersions/noRetentionGap/auditId). Activation gates do not bypass per-candidate operator review.
7. The manager-authenticated callable `operatorApproveHoldingNotice` requires the `expectedSnapshot` hash of the candidate actually reviewed. Verified manager UID and studio are server-derived. It persists the immutable approval binding; claim never replaces it. Generic candidate review fields alone do not authorize holding sends. A post-candidate native readback must be strictly later than candidate creation and at most 15 minutes old. There is no new CORE approval UI in this change. Unattended immediate sending is not implemented.
8. Before any holding candidate generation or send, the welcome automation's `providerHistoryCoverage.nonWelcomeTemplateAllowlist` must independently audit and allow v2 (`independentlyAudited=true`, `auditId`, `templateIds`). This prevents holding receipts being mistaken for unknown welcome history. The production setting was not changed.

## Remaining Blockers and Timing

- Live rendered DOM has no issued-ticket/hold IDs. Native ticket identity evidence and reviewed stable hold mappings have not been obtained for the real Kim/Bae records; no canonical promotion performed.
- Changed source content requires explicit reconciliation, not automatic mutable-date matching. Ambiguous identical history entries or paginated history are blocked.
- First candidate reconciliation queries one ready source per existing queue run. Source scan is opt-in and bounded; this is not an all-member rollout.
- Hourly source collection and post-candidate readback can add another hour; manual review duration is unbounded. Do not describe this as real-time detection or a completed operational automation.
- CORE rules prepared locally, not published. Full result: `docs/reports/2026-10-07-holding-source-queue.html`.

## Holding Roster Refinement (2026-10-07)

User requested discovery by comparing paused members in existing periodic Excel.
Implemented `studiomate-holding-roster.mjs` and hooked the existing parsed raw rows before retention cleanup.
No additional download, spreadsheet parser, recurring poller, or all-member browser scan.
Paused rows include historical `정지중 (8일 정지)` forms; preserve product multiplicity.
Provisional state: `workLanes/holding-allowance-notice/state/excelHoldingRoster` (schemaVersion=2).
Read-only jobs: `workLanes/holding-allowance-notice/readbackJobs/{sha256(phoneHash,productName)}`.
This key groups discovery hints, NOT a native issuance or hold identity. Raw phones/names/memos are not stored in the baseline.
Transitions baseline/entered/continued/changed/left all request bounded native detail reads; left never confirms cancellation.
Native member ID resolution uses current canonical profile phone matches; unresolved or duplicate products are review-only.
Empty/schema-incomplete/stale/replayed/large-coverage-loss exports do not advance the baseline.
Schema completeness and the 5% loss guard do NOT prove full export filter scope. Initial/full-scope live validation remains required.
Pending jobs survive repeated imports; acknowledgement compares discoveryVersion so an older read cannot finish a newer job.
Existing source worker `--from-roster` requires fresh roster, max 10 jobs per run, bounded backlog, and current profile phone-hash match.
Jobs authorize reads/staging only. Canonical writes still require the independently audited source/target promotion settings; no candidate/send is produced from workLanes.
Source import gets explicit download-start timestamp only from the successful existing periodic downloader; manually supplied files do not automatically qualify.
Activation not performed: `STUDIOMATE_HOLDING_ROSTER_OBSERVER=shadow`, `STUDIOMATE_HOLDING_SOURCE_SCAN=enabled`,
settings `sourceScanEnabled=true` and `rosterDiscoveryEnabled=true` remain operator/deployment steps.
Latest retained run report (2026-10-07 18:39 KST) has 3419 rows/984 groups but reports deletion of raw Excel.
Historical real-data compatibility test: 2026-05-27 normalized 2903 rows, all 16 paused rows / 13 paused members recognized.
That is historical evidence, not today's paused member count. Future-hold visibility is still unverified.
No production mutation, StudioMate/browser job, actual send, commit, push, deployment, or runtime configuration change performed.
Report: `docs/reports/2026-10-07-holding-roster-sync.html`.

### Refinement Verification

- Roster tests: 65 passed. Worker safeguards: 3 passed, including superseded-job rejection.
- Selected Node regression suite: 358 passed; selected TypeScript suite: 877 passed (1235 total).
- Syntax checks, data source policy, and diff whitespace checks passed.
- Independent read-only review identified missing discovery-version CAS on canonical promotion/invalidation.
  Both canonical transactions now read the pending job and compare identity/version before writing;
  superseded promotion reports `superseded` without acknowledging newer work.
- Current canonical runtime remains unchanged. No task-owned browser state was created.

## Approved Release (2026-10-07, Initial Release Plan)

- User approved scoped deploy, discovery activation, and testing. Production sends remain gated by real evidence.
- Fresh 19:16 KST member Excel: 3419 rows, 7 held members; 5 resolved native members, 2 native-ID review cases.
- Read-only live collector succeeded for Kim 1982133 and Bae 1992206, both original periods 365 days, current holds 1/0.
  Fixed actual card click overlay and whitespace around tab labels. No StudioMate data changed.
- SOLAPI directly confirmed v2 APPROVED and the existing Kim test COMPLETE/4000 with matching candidate/send ledger.
  Stable test key replay was blocked with providerPostCount=0; no extra test message was sent.
- Independent review found shared queue starvation and a ten-event lifetime cap. Paginated generic selection now
  retains 20 nonholding slots plus one holding slot; eligible history processes in ten-event chunks with versioned progress.
- Selected regressions: Node 359 and TypeScript 886 (1245 total), five codebase build, strict typecheck,
  Functions boundary, CORE catalog/hosting, and rollback guards passed before release.
- Tracked LaunchAgent template adds shadow roster observation and source scan to the existing hourly job, not a new schedule.
- Intended activation: sourceScanEnabled=true, rosterDiscoveryEnabled=true, studioId=5330; mode remains operator_sample_only,
  autoSendEnabled=false, canonicalSourcePromoted=false. No fabricated identity mappings or audit/E2E booleans.
- Pending final proof: clean-main promotion, Functions/CORE deployment, runtime update, loaded agent environment,
  first canonical import baseline/readback run, CI and live readback. Final audit report will record actual results.

### Release Verification Evidence

- Code commit `130a657` fast-forward promoted to origin/main. Clean local main and runtime updated.
- Functions affected detection conservatively includes all five codebases due to the export ownership manifest.
  All five dry-runs and production deploys succeeded. Read-back verified all 91 Functions ACTIVE and updated today.
  No force push/reset/clean used.
- Installed existing hourly LaunchAgent with two opt-in holding environment variables; other membership settings preserved.
  Firestore sourceScanEnabled/rosterDiscoveryEnabled enabled. All sending/promotion/E2E gates remain closed.
- Actual periodic pipeline `2026-10-07T10-25-48-299Z-run-apply.json`: success, exit 0.
  Fresh member import `af84ae05322f2e74fa7cd07bc660d316`: 3419 rows, held baseline 7, readback jobs 7, sends 0.
  Five native-member readbacks succeeded and staged observations, two native-ID matches need review.
  No canonical memberTicketHolds documents were promoted. No StudioMate test mutations or additional messages.
- Whole pipeline elapsed approximately 108 seconds; holding readbacks approximately 15 seconds.
- Existing v2 receipt rechecked COMPLETE/4000 at 19:26 KST; one provider receipt and local ledgers agree.
- Callable operatorApproveHoldingNotice ACTIVE; unauthenticated POST returns HTTP 401 UNAUTHENTICATED.
  scheduledProcessAlimtalkQueue ACTIVE revision scheduledprocessalimtalkqueue-00124-fij.
  Scheduler retains every 10 minutes / ENABLED. At 19:32 KST the new queue revision returned HTTP 200 and
  processAlimtalkQueue completed with processed=0/sent=0/failed=0/deferred=0. No manual queue invocation.
- CI Functions Affected Check 37607063404 succeeded. Independent offline CORE QA passed 95 cases at 320/390/768/1440/1920.
- Final concurrency correction treats only durable prior send/claim outcome as terminal for progress; other blocked states
  still require review. Latest focused reruns: Node 125, TypeScript 212 passed; strict typecheck passed.
- Successful raw downloads cleaned by normal retention; task-owned superseded 19:16 read-only Excel copies deleted.
  Shared StudioMate browser lock absent and hourly agent exited normally. Audit records and dedupe ledgers preserved.
- Rollback of discovery only: set sourceScanEnabled=false/rosterDiscoveryEnabled=false and remove the two holding
  environment flags from the existing hourly agent. Do not disable unrelated member/contract/reservation synchronization.
- Final release report: `docs/reports/2026-10-07-holding-roster-release.html`. Full real-source send E2E is not complete.
- CORE rules commit `d577c798` promoted to origin/main and deployed to both Hosting sites. Custom-domain and web.app
  release canary passed. All three rules URLs returned HTTP 200 and the holding discovery/deployment markers.
  Pre-release and post-live responsive QA each passed 95 checks across five viewport widths.
- CORE rules CI 37608622221 completed successfully. Existing follow-up heartbeat updated with the verified release
  state and remaining native identity/source promotion gates; no duplicate schedule or additional send authorized.
- Replaying completed roster work returned an empty results array and sendAllowed=false. Provider/local v2 ledgers
  still contain only the existing Kim test receipt. No new candidate or message was created.
- This final audit update changes documentation only; the deployed code remains `130a657`, CORE Hosting `d577c798`.
