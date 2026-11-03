# Operations Health Error Review

## Scope

Latest user request: inspect and fix the newly received error email. Existing clean worktree reused on dedicated branch `codex/mini/ops-health-errors-20261103`, based on `ec67dca0`. User approved verification, runtime/CORE rules integration, necessary deployment, commit and push in `call_086cb50916b747519734e8374cdd3001`. No member dispatch, contract replay, financial recalculation, scheduler change or IAM change.

## Verified Sources

- Latest actual operational attention email: Gmail `1a19ea2c4e561549`, 2026-11-03 08:40 KST. Four findings, not a new Gmail ingress failure. The later 09:39 email is the previous internal receipt test, not an incident.
- Independent read-only health run `health_202611030959_quick_read_only`: same four findings, no repair, restart, mail or status mutation.
- Canonical private chart and request `plc_281189166`: both cancelled, no submissions, no known Notion page or creation intent, inactive lease. Failed at 11/2 22:20 KST in member-folder identity/submission validation. Cancellation was treated as a folder-creation failure instead of a no-content no-op. CORE MCP returned business metadata; missing notionSync/lease fields were narrowly read using the operator service account.
- Contract recovery remains intentionally gated: latest natural Excel run 09:13 KST succeeds independently of `signature_recovery_approval_unavailable`. This is not an IAM lookup failure. Do not clear the approval or enable automatic writer.
- Monthly settlement last scheduled execution failed 11/1 09:30 with local pointer read error `-11`; bounded retries were already fixed on 11/2. The October review index exists, the canonical final index does not. No settlement execution or financial regeneration attempted.

## Changes

- Empty cancellation no-op requires matching canonical request/record identifiers and both cancelled, no answer/report/media/page/create intent/lease or successful projection evidence. Only the known pre-dispatch identity guard error or no error is eligible. Unknown provider failures remain reviewable.
- Persist explicit `pending / cancelled_without_submission`, never synced. Retain historical failedAt and attempted version; unchanged repeats perform no write or external call. Reactivation/submission resumes the ordinary path.
- Health excludes only the explicit eligible marker, not an arbitrary cancelled failure. Add a separate diagnostic count.
- Read-only settlement artifact inspection distinguishes review-only/missing/final-present without changing paths or accepting drafts as success.
- Preserve the historical unkeyed settlement finding title/cause/first source so explanatory changes do not create duplicate unresolved incidents.
- Health labels the exact recovery-only contract issue as approval hold; simultaneous issues retain the general review title.
- Explicit null run time is stored as unknown, not the health observation time; existing logging callers without that option retain defaults.
- Exact one-off metadata repair defaults to plan. Apply requires expected fingerprint, clean main matching origin/main, canonical cancellation guards, one-time audit and independent source/request/readback hashes. It cannot call Notion or send messages. Do not apply before approved release or replay an unknown transaction.
- CORE rules source updated, not deployed.

## Current State

Local implementation complete. Node 22 regression: 216 tests passed, zero failures/skips, including 49 isolated one-off runner tests. The one-off test helper is mocked; real cancellation eligibility is separately confirmed by the compiled production helper against the exact stored record, without apply. TypeScript build, syntax and whitespace checks passed. Functions affected detection: private-chart only. No production dry-run was attempted from the dirty feature branch.

Static CORE responsive preview: 95 checks across 320/390/768/1440/1920 widths. Expanded changed section and HTML report additionally checked at 320/390/768/1440, no horizontal overflow. These are synthetic/static previews, not authenticated live production checks. Task-owned local servers, pages, contexts and browsers closed in finally; no user browser state touched.

## Verified Release

- Code `fda4c2ff` plus finding-identity follow-up `32b588aa4467238c873669f8f4151269a1dc450f` promoted to main via fast-forward and pushed. Main and runtime were clean and exactly aligned before deployment; active runtime fast-forwarded without restarting any worker. Source worktree and runtime are separate Git clones, so the pushed feature branch was fetched for promotion instead of assuming shared local branch refs.
- Node 22: original regression 216, settlement identity 3, Functions predeploy protection 20, total 239 passed, zero failures/skips. TypeScript build passed. Initial boundary check lacked generated exports; after all five local codebases were built, the 107-export boundary guard passed. Local compilation of all codebases is not a broad deployment.
- Root Firebase dry-run and real deploy preserved clean-main/origin-main and rollback guards. Only `syncPrivateLessonNotionFromRecord`, `syncPrivateLessonNotionFromRequest`, `scheduledSyncPrivateLessonNotionProjections` updated in functions-private-chart. Firebase runs predeploy hooks across codebases, but prepared/uploaded and updated only the selected private-chart target functions.
- ACTIVE revisions: `syncprivatelessonnotionfromrecord-00027-now`, `syncprivatelessonnotionfromrequest-00027-non`, `scheduledsyncprivatelessonnotionprojections-00030-muy`. Existing scheduled projection remains ENABLED, `20 22 * * *`, Asia/Seoul.
- Exact one-off metadata repair at `2026-11-03T01:45:04.581Z` (10:45 KST), source commit 32b588aa. One atomic audit plus notionSync update only; no Notion API or member transport. Audit: `workLanes/ops-health-errors-20261103/reports/notion-empty-cancellation`. Independent 01:45:46Z readback confirms canonical business/request hashes unchanged, exact sync hash stable, failedAt preserved, no syncedAt and lease released. Do not replay the single-use repair.
- Runtime quick health `health_202611031045_quick`, no repair/restart/email: findings 4 to 3. Notion coverage complete, 13 records, 8 aliases, 4 awaiting submission, 1 empty cancellation, zero overdue pending/failed or unknown timestamp. Exact old Notion finding and Codex action are resolved against that run. Contract and both settlement IDs are unchanged and remain open.
- CORE and compatibility Hosting dry-run/deploy succeeded. Only rules HTML and generated CORE release manifest changed; all other tracked Hosting content matches previous source ea35c5a1. Live rules on both URLs exactly match SHA256 `854a91bfdde9d9fa3be63617bca45c7e1b5d1a55202598bf7933ab304643dfec`. Release source is 32b588aa; 10 post-release canaries passed. A pre-Hosting canary correctly found the old live manifest; final post-release checks pass without relaxing the guard.
- Functions CI run 41561331701 and CORE MCP CI run 41561331608 succeeded for source 32b588aa. CORE stored monthly-settlement status remains failed, lastRunAt empty rather than today's observation. Contract writer remains false and recovery blocked. No IAM, secret, schedule, member message, contract request, Notion content or financial amount change.
- Local and final LIVE static layout each passed 95 checks at 320/390/768/1440/1920. Expanded changed rule section passed four more LIVE checks at 320/390/768/1440 with the new marker visible, no overflow or clipping. Main visually inspected the 320px section screenshot. Evidence: `/tmp/ops-health-errors-20261103-live/expanded-checks.json` and `rules-ops-health-expanded-{width}.png`. These are isolated static previews, not authenticated operator interaction tests. All task-owned browsers, pages, contexts, temporary servers and sessions closed; user browser state untouched.

Contract approval and October final settlement remain separate operator follow-ups. Do not mark them successful because this code release completed. No operational failure email was sent for the expected outstanding findings, which already have their original reports, or for local pre-release checks corrected during this session.
