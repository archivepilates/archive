# ARCHIVE PILATES OPS monitoring accuracy

- Worktree: `/Users/archivepilates/codex-worktrees/ops-monitor-accuracy-20261104`
- Branch: `codex/mini/ops-monitor-accuracy-20261104`; baseline `88803cd7`.
- Approval: `call_3d9b94cc231a42c6a7e878b38baf165f`: validate, runtime integration, CORE rules, scoped release, commit and push. Existing-profile native ID recovery only after full-phone exact/unique live evidence. No member messages, contract requests, uploads, new permissions or schedulers.

## Changes

- Existing health emails include bounded allowlisted source references. Notion findings separate overdue pending, overdue failed, unknown time and identity blockers; preserve stable finding identity and incomplete-query safeguards.
- Notification observer propagates persisted continuity loss, including failures. Recovery reports carry observed time, distinguish read recovery from historical reconciliation, and retain attention routing while a gap remains. Existing schedules, locks, hints, action keys and dispatch rules are unchanged.
- YouTube worker logs only allowlisted structured OAuth reasons or a broad typed connection category, never exception messages, responses, URLs or credentials.
- Bounded one-off member-link helper is fixed to the approved existing profile and native ID. Fresh live full-phone proof, transaction uniqueness, prior-claim checks and atomic lookup/audit evidence are required. Freshness is rechecked at each transaction attempt and after asynchronous reads; idempotent success also validates audit, lookup proof and unique native ownership. It cannot clone a native profile or overwrite an existing link. This review hardening does not replay the completed live recovery.
- CORE rules updated in existing health and notification sections. No Functions source/config changes.

## Verified recovery

- StudioMate rendered-DOM full-phone search at `2026-11-04T11:01:00.365Z` returned exactly one matching native member `5095448`.
- At `2026-11-04T11:01:33.663Z`, existing `memberProfiles/excel_2480894ded997c06` received only `studiomateMemberId` and `studiomateMemberIdResolvedAt`. All other source fields matched the before-read; no native profile was created. Lookup `studiomate_member_id_lookup_excel_2480894ded997c06` and audit `workLanes/ops-monitor-accuracy-20261104/reports/member-link-5095448` were committed atomically. Independent identity-helper read passed.
- Invoked existing `syncPrivateNotionByRecordId("plc_281659924", true)` once. Independent reads confirm `pending/awaiting_submission`, empty current error, released lease, preserved past failure, unchanged business source/request and no Notion page. This is not a submitted or synced chart.
- `plc_281659922` remains `pending/cancelled_without_submission`; independent before/after equality passed. No replay or mutation of that chart.
- Existing YouTube publisher account `archivepilates@gmail.com`: read-only `verify-credentials` returned `ok=true, channelVerified=true`; no upload or scope changes. Historical RefreshError cause remains unknown, not retroactively diagnosed.

## Outstanding evidence, not reset

- Native notification read recovery and the 11:41 KST reservation reimport are observed. The latter reports 721 rows and a catch-up lesson-date range 11/3-11/15; it does not prove all changes during the outage were reconciled.
- Current reservation/deleted-class legacy downloader synthesizes XLSX using captured private API calls. It was inspected, not executed in this task; do not present its files as native export proof or use it for this investigation.
- Historical native reservation/deleted-class exports plus canonical import/job/send comparison are still required. The outage is a change-event interval, not a lesson-time filter. A current export alone cannot prove overwritten intermediate events. `continuityLost` is deliberately retained; no source baseline, queue or member action is replayed.
- Separate ChatGPT/Dot fixed-chat routing is not repaired by these monitoring changes.

## Validation And Release

- 51 focused Node tests; 102 system-health tests; 216 private-Notion/mail-watch tests; 31 Python tests passed. Functions TypeScript build, CORE Hosting validator and whitespace checks passed. One VM test harness was updated for the new pure summary dependency. Existing holding-email test was corrected to cover two inline keys plus the shared deduplicated path, without changing holding runtime.
- Combined Node monitoring/notification/mail/release suite: 247 passed on Node 22 after review hardening. Private-Notion/mail-watch: 216 passed. Python worker: 31 passed. No real sends were used for tests.
- Static CORE rules screenshots at 320/390/768/1440px confirmed the added notes render and introduce no new horizontal width. An existing whole-page overflow remains at 320/390px (baseline and updated scrollWidth both 405px); it is not treated as a fully passing responsive page or repaired by an unrelated CSS change. Screenshots are private local artifacts, not an authenticated workflow test.
- Source release: `835e7ac0` plus review hardening `63c204cb1efe9707ed0498f2c7ece9e42aace03d`, promoted/pushed to `origin/main` and the scoped feature branch; clean main release checkout used. Affected Functions codebases: none.
- CORE Hosting `archive-pilates-core` deployed with the operator service account. Both `https://core.archivepilates.com/rules/` and `https://archive-pilates-core.web.app/rules/` returned HTTP 200 and exact source SHA-256 `69e6387e80d7fed05cf0f3e22cf3ab9eaa028971b67ad302343aa7b56a408c0c`. No other Hosting site or Functions was released.
- Runtime fast-forwarded to that source without restarting workers or modifying schedules. Natural notification execution at `2026-11-04T11:12:57.077Z` recorded `warning` with 15 notifications read and the retained historical-gap caution, verifying the new persisted continuity behavior.
- Existing health checker run `health_202611042012_quick` used `--mode=quick --no-email`, no repair/apply/restart flags. Full Notion sample coverage: 15 chart rows, 8 aliases, 5 awaiting submissions, 2 empty cancellations; overdue pending/failed, unknown timestamps and identity blockers all zero. Existing chart finding and action queue `health_946b34070c610777730146ff4b47` independently read back as resolved. No manual health-status overwrite.
- Whole-system status remains action_required for separate contract recovery approval and settlement final-execution evidence. Neither was reset, re-requested or treated as fixed in this task.
- Source CI passed: CORE MCP Check `41819280176`; Functions Affected Check `41819280282`. Browser verification contexts were closed in finally; no task-owned GUI tabs, profile locks or browser processes were retained. Final documentation-only evidence commit does not require another Hosting release because deployed bytes are unchanged.
- Report: `docs/reports/2026-11-04-ops-monitor-accuracy-triage.html`.
