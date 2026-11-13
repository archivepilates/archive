# Weekend Cancellation Guard

## Scope And Status

- User first asked to investigate why six November Saturday classes reverted to six hours and prevent recurrence during class creation/copy. Subsequently approved implementing periodic correction for employee-created classes, connecting it to the existing runner and the full validation/operations/Hosting/commit/push set. This supersedes the earlier design-only scope; no new schedule is added.
- Source base: `83344b8590da0c9e8865eb5d436ea8be1d5b6e7c`, branch `codex/mini/weekend-cancellation-guard-20261113`, dedicated worktree with the same dated name.
- implemented: pure date policy, on-demand plan/draft/Excel guard, dependency-injected correction worker, native UI adapter, durable private canonical ledger, existing hourly runner integration and CORE rule update. Browser Service Workers are blocked, mutation routing is context-wide, native requests are single-hop without retries, and source/selection/clock/expiry are checked before transport.
- verified: focused tests, earlier November before/after regression and a new live future-range read. 451 classes from 11/13 through 12/31 included 41 ordinary weekend classes and 24 mismatches, all 12/5, 6, 12, 13, 19, 20, 26, 27 (three each). This is new native evidence, separate from the earlier November correction.
- pending at implementation stage: final live bounded apply, promotion, CORE Hosting deployment and live readback. Employee-session interception is not installed; periodic correction checks after collection rather than instant prevention. Final release receipts supersede this progress entry below.
- Report: `docs/reports/2026-11-13-weekend-cancellation-guard.html`.

## Evidence And Cause Boundary

- Native owner session showed global group cancellation default six hours. An unsaved group creation draft with 2026-11-21 and Saturday selected still showed six hours. Draft abandoned; no class created. No global setting saved.
- Historical November 9 source had 24 ordinary weekend classes with correct cutoffs. November 13 source had 23 and six wrong cutoffs. Neither class workbook exposes stable class IDs, creation/update actor or audit trail. This narrows the observation interval but does not establish who changed the six, whether they were copied or recreated, or an exact mutation time.
- Confirmed failure path: native default is inherited without weekend-specific recalculation. Copy behavior itself was not independently exercised. Do not describe it as the proven historical operation.
- Existing runtime has no ordinary class create/copy writer. Its recurring Excel imports cover members/reservations/deleted classes, not complete active class-policy data; empty classes and explicit cutoffs are not represented by reservation-derived lectures. The connected ARCHIVE PILATES MCP is read-only and does not expose class editing.
- Already completed correction: 11/21 and 11/28 09/10/11 classes now previous-day 21:00. Full month 318 rows, only six cancellation cells changed, all other cells unchanged. 23 ordinary weekend classes conform. No booking roster claim follows from a class workbook.
- Private evidence: `~/ArchiveIN/operations/2026-11-13-weekend-cancellation-fix/`; guard audit results: sibling `2026-11-13-weekend-cancellation-guard/`. Keep raw source, staff-level detail and generated JSON out of Git.

## Mandatory On-Demand Workflow

1. Obtain a fresh full-period native class export with observed UI range/total. Before creation/copy inspect the destination date/time and exact category; do not reuse the origin's lead time.
2. Generate a plan from the destination rows. Saturday/Sunday ordinary groups use previous calendar day 21:00 KST. Ordinary weekdays require a verified holiday calendar and use previous-day 21:00 for holidays, otherwise six hours. Explicit exclusions are preserved; unknown categories/coverage block.
3. Separate native batches by rule and lead hours/minutes. Read the current UI draft values independently and check them before saving. Do not generate draft evidence by copying the plan.
4. Save once via the authorized native UI, preserving time, instructor, room, capacity, reservation and closure settings. If submission outcome is uncertain, read the source; never replay it merely because a toast is absent.
5. Download the full-period native Excel again and verify exact identity set, intended additions/edits, explicit expected cutoffs and all unrelated columns. Do not proceed to fixed booking or report completion on a failed/incomplete comparison.

The CLI does not open StudioMate, acquire a browser lock, query live state, grant authorization or perform external writes. Caller-supplied UI count/range establish its coverage claim, not independent query proof. Serialized plans are re-prepared and compared before verification; they are policy calculations, not signed approvals. Snapshot freshness and exact native source/approval remain the operator's responsibility.

## Commands

Input for `plan`: `{operation:"create"|"copy"|"edit", rows:[...] , calendar?:{from,through,dates,sourceReference,verifiedAt}}`.
Rows require `date`, `startTime`, `staffName`, `title`, `room`, native `lessonType` and `category`; optional original `cancelDeadline`. Final creation/copy verification additionally requires all 14 planned `nativeCells` (same header order as the native Excel) and a consistent original `cancelDeadline`; this binds end time, capacity and all other non-policy values for the new destinations. The cutoff alone is recomputed. Retain exact source spellings and explicit empty private category. Use only private files in owned 0700 directories; output files are 0600 and never overwritten.

```sh
node scripts/studiomate-class-cancellation-guard.mjs plan --input /private/input.json --output /private/plan.json
node scripts/studiomate-class-cancellation-guard.mjs check-draft --plan /private/plan.json --input /private/fresh-draft.json --output /private/draft-check.json
node scripts/studiomate-class-cancellation-guard.mjs verify-excel --plan /private/plan.json --before-file /private/before.xlsx --file /private/after.xlsx --from 2026-11-01 --through 2026-11-30 --before-count 318 --expected-count 318 --output /private/verified.json
node scripts/studiomate-class-cancellation-guard.mjs audit-excel --file /private/classes.xlsx --from 2026-11-01 --through 2026-11-30 --expected-count 318 --weekend-only --output /private/audit.json
```

`fresh-draft.json` contains `{rows:[...]}` with independently observed native `cancelDeadline`, reconstructed from actual date/start/lead controls if the UI exposes a relative time. `--weekend-only` deliberately makes no holiday/weekday verification claim. Full audit without this flag requires a supplied verified calendar for ordinary weekdays. Exit 0 means the supplied evidence passed, 2 means an audit/plan requires review, 1 means invalid/incomplete input or a failed verification. None means a native save happened.

## Approved Periodic Correction

Implementation entrypoint: `scripts/run-class-cancellation-correction.mjs --apply --scheduled-run`, called only after successful scheduled full member/reservation imports. `--read-only` performs a live source audit without native writes. The existing hourly LaunchAgent arguments and schedule remain unchanged. Notification refresh/manual imports do not invoke correction. Shared browser busy is deferred, and the correction phase is a sidecar: it cannot turn a failed member/reservation import into success.

Canonical promotion: immutable fresh native Excel plus a private metadata receipt are stored in `~/ArchiveIN/automation/reports/class-cancellation/<runId>/`. Native source rows, not reservations/read-models, select correction targets. Authoritative action state is `~/ArchiveIN/automation/state/class-cancellation/jobs/<sha256>.json`: the hash binds studio 5330, worker and policy versions, exact seven-field class identity and expected cutoff. The sole normal writer is this worker while holding the shared profile lock; operator audits may read it. Exclusive `wx` creation, fsync of files/new directory ancestors and serialized atomic updates preserve pretransport intent. Accepted/unknown/verified claims are never reset. These files are not member sources and cannot trigger member messages, ticket/payment/reservation changes or unrelated automation. WorkLanes are not consulted for writes.

The periodic scope is ordinary Saturday/Sunday groups only, KST today through the end of next month, maximum six corrections per run with future expected cutoffs and 09:00~23:00 writes. Public-holiday automation is deliberately not enabled without verified calendar coverage. Independent full-range snapshots and exact fresh native table/selected-checkbox readbacks bind edits; cancellation alone is enabled in the native bulk form and final one-class confirmation. A native UI-generated request is intercepted unchanged, with a one-request context-wide budget and redirects/retries disabled; non-2xx or unknown outcomes are not repeated. All non-native mutations, including telemetry, are blocked and never receive class-save authority.

Scheduled actionable review receives one internal home-account report per canonical incident; provider acceptance/unknown mail receipts are not replayed. Quiet/run-limit deferrals alone do not send reports. Main turn verification does not run this scheduled mail sidecar. Rollback is to remove/disable only the correction call in the existing runner, leaving member/reservation imports and canonical claims intact; no claim reset is a rollback.

The following rollout requirements remain the acceptance criteria; implementation/evidence entries above and below distinguish what actually ran.

### Source And Scope

- Extend the existing successful hourly Excel workflow, not a new independent poller: collect the full active class list over an explicitly approved future horizon after existing critical collection completes. The horizon and placement in the existing run need approval and bounded-duration/load tests. Do not silently add every-month downloads or delay member sync indefinitely.
- Use full native class Excel plus exact native UI identity/current controls. Require UI count/range equality and complete headers; missing/partial exports or login failures block correction. Reservation-derived lectures, notifications and workLanes summaries are not mutation sources.
- Shadow results may live in `workLanes`; before any writes promote a documented canonical class snapshot/job source with stable native class ID when available, destination identity, policy version, snapshot hash, allowed reader/writer, exclusions, dedupe and source-vs-result verification. Do not write from workLanes.
- Automatic candidates: future ordinary group Saturday/Sunday and verified public holidays only, with their expected cutoff still in the future. Preserve weekday six-hour settings and all excluded classes. Passed cutoff/start, ambiguity, unknown category/calendar or residual changed source => review, not retrospective tightening.

### Execution And Idempotency

1. Read-only detection produces a snapshot-bound delta and full input coverage receipt. Initially compare in shadow without mutations.
2. Existing serialized StudioMate browser coordinator owns the native session. Lock waits/failures defer without claims. Never acquire a parallel shared profile or bypass native auth/security.
3. Immediately before claim/save, re-read exact native class identity and current date/time/category/cutoff plus all non-target fields. A stable ID is preferred; when unavailable, require unique full composite key resolved to one fresh native row. If exact binding cannot be demonstrated, do not automate that row.
4. A canonical transaction claim binds `classIdentity + policyVersion + expectedDeadline`, observation hash and intent. Preferred class identity is `native:<studioId>:<nativeClassId>`. If no native ID is exposed, the separately validated fallback is `composite:v1:<studioId>:sha256(JSON.stringify([date,startTime,staffName,lessonType,category,title,room]))`, preserving exact current strings and KST date/time. It requires uniqueness in the full source and the same fresh native row on both pre-save checks; do not use an index, partial name or guessed ID. Only the explicit cutoff field may be enabled. Unknown/in-flight/prior transported attempts are never replayed. Already-correct classes are no-ops. Drift after a verified correction becomes a new review incident, not an unlimited override loop.
5. Limit an initially approved batch to a small explicit number of classes. Use the existing member-safe time window conservatively until native notification behavior is verified. No extra Alimtalk/SMS is part of correction. Expired target cutoff or concurrent edit stops the batch.
6. Independent saved UI readback plus fresh full-range Excel must show each intended cutoff and no unrelated changes. A toast, local plan or job status is insufficient. Native settings save, verification complete and incident resolved are separate states. Do not roll back blindly onto a concurrent edit.

### Rollout And Controls

- Phase 1: read-only full-source coverage and native ID extraction proof; measure collection latency and shared-lock contention.
- Phase 2: operator-reviewed dry-run over ordinary weekends and a verified calendar; independently sample both mismatches and exclusions.
- Phase 3: separately approved limited native apply with durable claim/no-replay and intentional interruption tests. No test classes or member notifications without authorization.
- Phase 4: only after count/identity/non-target preservation pass, adopt correction inside the existing runner. Expose enable state, last full source time, future horizon, findings, verified corrections and review/unknown states in existing observability. Alert only on new actionable changes; no success spam.
- Fail closed on incomplete source, unrecognized UI, cross-identity mismatch, past cutoff, unknown transport, non-target change or shared-lock issue. A read-only rollback disables the new correction stage, not existing member/reservation sync. Never reset claims to recover.
- Acceptance: correctly detect employee-created and copied weekend classes including empty classes, destination minute/year/month boundaries; preserve private/instructor/weekday settings and all reservations; repeated runs no-op; concurrent edit and ambiguous save blocked; full before/after export reconciles. Browser shutdown and lock release are required on success/failure.

## Checks

### Final Implementation Evidence

- Focused policy/worker/native parser/transport/ledger/operator recovery/runner/one-path release suite: 263 tests passed, including the declared Node 22 runtime under `TZ=America/Los_Angeles`. Shared browser/sync lock suite: 17 tests passed. CORE Hosting static and data-source-policy validation passed. New guards are connected to the existing GitHub Actions workflow after root dependency installation.
- Live native source: 451 rows in the today-through-next-month horizon, 41 ordinary weekend classes, 24 wrong December cutoffs. Native final-draft preview: three classes, zero save requests, full source unchanged (`eb340126-8abf-49b2-ada7-46f4fd8277bd`).
- An initial 12/5 09:00 checkpoint caught provisional UI count vs complete export before transport was armed; original terminal unknown claim remains byte-identical. User separately approved that one pre-submit recovery. The approval binds its exact original digest/date/time/policy, is private and time-limited, and creates a distinct canonical recovery child. A sealed resolution is adopted only after that child is independently verified; approval alone is insufficient. No generic unknown/submitted request can use this path. Native UI now commits dates through its calendar instead of raw text edits and compares settled UI count with the full export.
- Approved recovery verified one class (`e08f1deb-3015-4e7c-9503-8d57cb29f3ad`). Normal bounded apply verified six more (`affee82a-2dd0-403c-9b13-bf3596c9d2c2`), with zero reviews and 17 deferred by the per-run limit. Main independently compared the initial/final 451-row native exports: exactly seven cancellation-column changes, no other cells or rows changed. Evidence: private `2026-11-13-weekend-cancellation-release/native-seven-audit.json`.
- Final live read-only rerun (`6f876c2d-67b5-4aa9-8e29-04d559bfbcd7`) confirmed 41 ordinary weekend classes, 17 remaining mismatches, zero reviews and zero saves. Do not describe the remaining 17 as already corrected. They remain eligible for the existing hourly correction stage; no duplicate scheduler or repeated manual backlog loop was added.
- Original raw claim remains unknown and its digest is unchanged; the derived resolved read is verified through the canonical child. This is an explicitly approved, positively pretransport-blocked one-off reconciliation, not a retry of an accepted or ambiguous provider request. Verified drift still requires review.
- Deployment: source promotion, one-path CORE Hosting release, active runtime alignment, CI and clean-state receipts are recorded at closeout below. No Functions/IAM/DNS/global default, member message, member roster or ticket changes are part of this release.

### Earlier Guard-Only Checks

- Focused policy and native-table/CLI tests: 90/90 passed.
- Independent review identified three false-success paths; fixes require an enforced category for changed cutoffs, bind new destination non-policy cells, and reject contradictory canonical/native cells. Added regression coverage, including JSON CLI roundtrip.
- Syntax checks for both modules, `git diff --check`, CORE Hosting static guard: passed. Affected Functions detection against the exact source base: zero codebases. All 90 tests also passed with the declared Node 22 runtime under `TZ=America/Los_Angeles`.
- Final independent re-review reproduced rejection of all three original false-success probes and found no remaining high-risk false-success path in the reviewed scope. Its 89 read-only tests exclude the filesystem-writing CLI test, which the main run included in the 90 total.
- Stored native regression: before audit 23 checked / 6 mismatches / exit 2 as intended; after audit 23 checked / zero mismatch / exit 0. Final exact 318-row before/after verification passed for six targets, preserving all unrelated fields. Raw receipts remain private.
- No new native create/copy save was used as a test. No Functions, IAM, scheduler, global StudioMate setting or member messages changed. No CI/deploy/push ran; all eight source/doc files remain scoped local changes on the dedicated branch.
