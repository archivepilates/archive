# CORE-CHART-REPAIR-20261114-01

## Goal And Scope

- Reconcile and minimally repair only `privateLessonChartRecords/plc_283112173` and `privateLessonChartRecords/plc_283112178`, with canonical request/booking/member identity and actual Notion evidence.
- Preserve original content, IDs, request state, failure history and uncertain transport claims. Do not manufacture submissions, replay uncertain operations or create duplicate pages.
- Initial approval covered source repair, related prevention code and regression verification. Subsequent explicit approval added the scoped deployment/commit/push recorded below. External mail/SMS, payment/refund, permissions and repair replay remain excluded.
- Worktree: private-chart-repair-20261114; branch: codex/mini/private-chart-repair-20261114. Existing worktree was clean on continuation.

## Deployment Approval And Completion Gate

- Subsequent explicit operator approval ("그래", relayed by the command chat) authorizes deployment of the verified prevention changes: identity-aware revalidation, pre-Notion-write source consistency and retry-grace recovery protection, plus matching CORE rules and scoped runtime adoption.
- Approval includes necessary scoped commit/push/main promotion and official release verification. It does NOT authorize repeating either chart repair/projection, changing other business data, Notion writes, member messages, mail, IAM/security changes, schedulers or manual health-finding resolution.
- Separate one-off audit/repair/verification scripts from operational release paths. Preserve the previous private audit and never rerun the apply script.
- Completion: review current remote/runtime/live versions; rerun related regression/type checks; deploy only necessary exports and CORE rules via existing guarded release routes; verify actual source/revisions and runtime hash; read both chart states without invoking projection; record CI/Git/release state and future-submission/next-health-check observation limits.
- Deployment execution: complete and independently verified; see Deployment Closeout. Read this section again before final response.
- Subsequent execution receipt supersedes the initial state: commit `922d4c849dd9a6cf386fad617674211a86b815a4` promoted to origin/main and clean release checkout. CI 43583642770 (Functions) and 43583642749 (CORE MCP) passed. Official exact-export Firebase dry-run passed before the single apply request.
- Three Functions successfully updated at 10:10 UTC: record `syncprivatelessonnotionfromrecord-00029-coj`, request `syncprivatelessonnotionfromrequest-00029-mur`, nightly `scheduledsyncprivatelessonnotionprojections-00032-naz`. Fresh Cloud Run readback confirmed ready revision and 100% traffic for each. Downloaded immutable provider sources for each function matched both changed TS files exactly; deployment hash `1138c34d7db70372f9561e3cec5cc5cc174b903a`.
- Post-deploy readback at 10:12 UTC: both chart/request/booking hashes byte-identical to pre-deploy; still awaiting_submission, no pages/lease/submission added. Existing 22:20 Asia/Seoul scheduler ENABLED, exact target/settings preserved. All unrelated Functions source/revision/update-time/settings unchanged.
- Evidence-adapter corrections were read-only: Eventarc conjunctive filter order can vary; original raw checksums were matched by permuting only that unordered array, never by relaxing values/settings. Cloud Run resolved revision names can be short or full resource names; explicit ready/100% resolved revision is still required. Four synthetic tests added. No second Functions deployment or business mutation was used to validate these adapter fixes.
- Active runtime fast-forwarded to 922d4c84 with no running health/StudioMate worker, no restart or manual invocation. Adopted health script SHA256 `03239cf87bdb6d8b90dae6d44829ce8cb3d62a7ed2e7a75078b9801773627c1e`; existing daily/weekly LaunchAgent paths/schedules unchanged. CORE one-file rules publication remains the next release step.
- Read-only release baseline: clean runtime and clean main release checkout both at `cc52e05f`; remote unchanged. CORE version `d94bdd176a39a8c4`, 70 files. Existing three functions are ACTIVE on November 9 source/revisions; existing nightly cron is 22:20 Asia/Seoul and ENABLED. Private before receipt includes all unrelated function metadata and the exact two chart/request/booking hashes.
- Release selection: only `syncPrivateLessonNotionFromRecord`, `syncPrivateLessonNotionFromRequest`, `scheduledSyncPrivateLessonNotionProjections` in functions-private-chart; no full-codebase deployment. Local health runner adoption is a separate fast-forward, without invocation/restart. One-file CORE rules publication uses the existing manifest-preserving release protocol with a pinned baseline and dedicated receipt.
- Derived Alimtalk catalog source fingerprints/reference lines were regenerated because the chart source changed; structured comparison verified no message policy/row semantics changed. This derived metadata is source bookkeeping, not a new member send or template change, and is not part of the one-file Hosting publication.
- One-off recovery/audit helpers are retained as historical task source with explicit apply/intent guards; no operational import, LaunchAgent, scheduler or hook calls them.

## Deployment Closeout

- CORE rules-only publication from source `3f3bf63d4e038743c0b81624a591ec267d4a15cb`: site archive-pilates-core, version `68c435fed139ec18`, release `1794651306091000`, 2026-11-14 19:15:06 KST. Only `/rules/index.html` changed; 69 other files, Hosting config and prior version verified unchanged. Both canonical/web.app URLs matched raw SHA256 `7dacf59c81869bbc37cb7661f2510661cf57c1ea9cab94fbfa584f67917f6725`.
- Final exact chart read at 19:16:28 KST again matched the original post-repair record hashes; both pending/awaiting_submission, no pages/submissions added. The existing health action finding remained open; no manual resolution occurred.
- Daily and weekly health LaunchAgent files matched their pre-release hashes. No scheduler edit/restart, source repair/projection replay, member send, Notion mutation, permission/security change, payment/refund or reservation mutation was performed by this release.
- Verification totals: original 339 regressions rerun by independent reviewer, 9 manifest-release guard tests, 4 readback adapter tests, 72 existing hardening tests, all five codebase builds/type checks, export boundaries (110 exports), Hosting/data-source/rollback guards passed. CI evidence is recorded against the actual tested source commits, not inferred from deployment output.
- Final release-source CI at `3f3bf63d`: Functions Affected Check run `43584314897` SUCCESS; CORE MCP Check run `43584313420` SUCCESS. The final closeout commit changes only this task record and HTML report; Functions, health runtime and published rule bytes are unchanged and must not be redeployed.
- Public rule layout smoke used a fresh, read-only anonymous browser and closed it. The rule HTML/hash/text were present and page widths had no horizontal overflow at 320/390/768/1440, but the authenticated panel was hidden in the anonymous session; this is not an authenticated visual-workflow verification. No new UI controls were introduced.
- Small task source archives, checksums and baseline/release receipts are retained privately as deployment evidence. No original/user file was removed and no disk-space recovery is claimed. No task-owned browser, shared StudioMate profile lock or deployment process should remain after final process/session check.
- No further approval is needed for this completed scoped release. Genuine future submission and the next scheduled health reconciliation remain unobserved business outcomes, not unfinished deployment steps. Do not create another monitor or manually invoke either workflow to manufacture that proof.

## Progress

- Previous read-only diagnosis found empty future preparation records for November 17 and 20, with missing native-member pointer on their shared temporary profile. These observations require fresh confirmation before mutations.
- Previous native read reported unique full-name/full-phone identity and matching two bookings; not a current snapshot or permission to bypass guards.
- Existing read-only review completed: 184 tests and three synthetic reproductions. Findings: retry-grace false recovery, request-only identity change event gap, and separation of unsubmitted waiting from verified native identity. No code or production data changed by the reviewer.
- Continuation initially confirmed no prior task repair or conflicting source changes. Actual approved source repair and independent readback are recorded below; no deployment or member notification occurred.

## Completion Criteria

1. Fresh exact identity, booking/request/submission/cancellation and actual Notion comparison for each record.
2. Only evidence-backed minimal changes, with private before/after audit and independent readback; preserve business content and historical failure evidence.
3. Focused regression tests for temporary identity, empty/cancelled requests, identity-only changes, idempotency, failure persistence, real recovery and recurrence.
4. Report each record separately, code/commit/test/deployment state and any approval/blocker. Do not claim submitted content restored when none exists.
5. Re-read this document after context transitions and before final response. Keep unrelated referral work out of this task.

## Operational State

- Source repair: native full-phone/name unique match, both booked private lessons and instructor verified at 09:20 UTC. Notion root live REST traversal found 29 child folders, no exact member candidate, no source-linked page or binding. Private audit retained outside Git.
- At 09:21 UTC, guarded transaction linked only the existing profile pointer and completed the existing lookup with prior state retained in a private audit. Existing operational projection handler processed the exact two records once, both returned pending/awaiting_submission; no provider calls or page creation. Original business/request/booking hashes and failedAt were preserved.
- Prevention code: identity-aware fingerprint, pre-projection request/source identity guard (including known-page paths), and retry-grace recovery guard deployed from `922d4c84`. No temporary identity checks weakened, no new lookup scheduler or page-creation policy.
- CORE rule update: published from `3f3bf63d` in version `68c435fed139ec18`; both operating domains independently hash-verified.
- Deployment/commit/push: complete; source branch, origin/main, release checkout and runtime aligned. Final closeout commits are documentation-only and require no repeated Functions/Hosting deploy.

## Independent Verification

- Fresh native traversal and full Notion-root child readback at 09:23 UTC independently confirmed both unchanged booked lessons, exact native identity, unchanged 29-folder root, absent member candidate/bindings, and both records still awaiting submission.
- Verification at 09:24 UTC compared original business/request/booking hashes, original profile fields excluding only the native pointer/timestamp, preserved lookup fields and historical failure timestamps. All matched. The canonical audit is `workLanes/private-chart-repair-20261114/reports/source-repair`; projection evidence is in `projection-result` beside it. Required private files remain outside Git.
- Bounded full pending/failed chart query was below its 250-document cap, complete, with zero actionable and zero unclassified grace rows. The existing aggregate action finding remained open; this task did not manually resolve it or run unrelated queues. Its existing scheduled health check must reconcile it independently.
- Local regression command: Node 22 with the existing Functions `tsx` loader; `private-notion-*.test.ts`, `private-chart-member-link-repair.test.mjs`, `ops-health-member-link.test.mjs`, `system-health-*.test.mjs`: 339 passed, zero failed/skipped.
- Functions `tsc --noEmit` passed; task audit/apply/verification scripts parse successfully; `git diff --check` passed. New tests are synthetic; no real submission or member message was fabricated.
- Browser readers closed in finally; shared profile lock absent after checks. No GUI tabs, background worker or scheduler was created. Only necessary small private evidence remains; no eligible large disposable artifact was generated.

## Release Boundary And Remaining Work

- Only the existing source profile pointer, lookup receipt, two records' Notion processing metadata and task audit were changed operationally. No new native profile, chart content, Notion page, provider message, permission or reservation mutation occurred.
- Prevention source, tests and operating rule are committed/pushed and released; runtime adopted the source without restart or manual processing. The original pre-release runtime base `cc52e05f` is retained in the baseline receipt, not the current runtime version.
- No deployment approval remains pending. A genuine future instructor submission must still pass normal identity/ownership/provider verification; this release does not claim that future content has been projected. The next scheduled health-finding reconciliation is likewise unobserved and was not manually invoked.
- Existing reviewer performed final read-only code review after the known-page guard: no remaining actionable gap, 93 focused tests independently passed. Main retained final 339-test result and type-check result. No new analysis task was created.
