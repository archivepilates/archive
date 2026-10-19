# Compact Holding Memo Reference

- Worktree: `holding-memo-reference`; branch: `codex/mini/holding-memo-reference`; base: `f4968873`.
- Request: shorten the visible holding memo marker while preserving duplicate prevention.
- New memo bodies display `[홀딩기록: H-<24 lowercase hexadecimal characters>]`, derived from the immutable full holding notice hash. This is a display reference, not an authorization key or calculation input.
- Full canonical memo/job IDs, source notice/message identity, source validation, content hash, acceptance/delivery policies, append-only writes and schedules remain unchanged.
- Already queued/retrying/completed pairs are checked against exact legacy or compact plans. Both records must match the same plan in full; no rewrite, attempt reset or historical backfill.
- Worker readback uses complete normalized holding content plus the exact final marker for both forms. Holding memos never fall through to permissive first-line/tail matching.
- No production member memo edit, Alimtalk resend or source member/pass/holding mutation is requested by this change.
- User explicitly approved production runtime adoption, CORE operating-rule Hosting release, commit and push on 2026-10-19. No existing StudioMate memo edit or Alimtalk resend is authorized by this release.
- CORE operating rule updated in the existing holding lane. Release scope: Mac mini runtime scripts plus Hosting only; no Functions, Firestore rule/index, production configuration or schema change.
- Verification: `node --test scripts/tests/holding-*.test.mjs` passed 793 tests, zero failures/skips. Includes both format readbacks through the actual worker function, unchanged legacy pending/retry/done pairs under both policies, mixed-format/tampering rejection, atomic duplicate/concurrent handling and source/calculation guards. Syntax and `git diff --check` passed.
- Initial all-holding run lacked this new worktree's Playwright package. Installed lockfile dependencies with `npm ci --ignore-scripts --no-audit --no-fund`; rerun passed including isolated DOM fixtures. No production browser/profile was opened.
- Independent review found no blocker in the formatting change. Before runtime cutover, wait for old memo-worker and holding-projection processes to finish; the browser lock alone does not protect pre-browser projection/version overlap. Do not kill production workers or manually drain the queue.
- Separate pre-existing observation: progress lookup compares persisted memo/job content and hashes but does not reconstruct the worker's canonical memo plan. It is read-only and not external-action authorization; strengthening that independent proof is outside this formatting patch. Worker source checks remain strict.
- Pre-release source: clean main/runtime checkouts at the same base; feature worktree contains only this lane's six files including the self-contained HTML report. Both scheduled memo and Excel jobs observed not running, last exit 0; intervals remain 300 and 3600 seconds. Recheck immediately before runtime fast-forward; never manually execute the queues for release verification.
- Production read-only legacy check: existing completed memo/job/source pair passes the new worker guard, keeps its full marker and unchanged content hash `372d9edb5da82cb64511524fab573f1a9f112f74b1ea7882091ab989aef2058a`, memo synced/job done. No production transaction or write was invoked.
- CORE Hosting/catalog validation passed. The new feature checkout initially lacked Functions development dependencies for its catalog parser; using the existing runtime dependency path resolved the local-only setup issue without changing lockfiles or packages.
- Independent release review repeated all 793 holding tests with zero failures/skips; no code blockers. Local responsive checks passed 95 cases at 320/390/768/1440/1920 widths. Rollback must retain both-format reader support once any compact memo has been created.

## Released And Verified

- Source commit `ec82665eedc188b3a14e35c1efb0e51a90da6546` pushed to the feature branch and promoted to `origin/main`. Clean main deployment checkout fast-forwarded. Runtime fast-forwarded immediately after confirming no old memo/Excel/holding workers were active; no scheduler reload or queue execution was used.
- Reopened runtime and reran all 793 holding tests: zero failures/skips. Existing legacy source/memo/job guard passed with identical five-document evidence digest before and after adoption. Full canonical IDs and stored legacy content unchanged; memo synced/job done.
- Existing launch jobs still use the runtime checkout, interval 300/3600 seconds and last exit 0. Holding mode remains live_readback_auto, autoSendEnabled/canonicalSourcePromoted true. No settings changed.
- Hosting dry-run and production release succeeded through root `deploy:archive-core-live` for `archive-pilates-core` and the existing `archive-pilates` mirror. No Functions/rules/index deployment. Exact release canary matched source SHA.
- Local and live responsive suites each passed 95 cases at 320/390/768/1440/1920 widths. Live CORE rules and web.app mirror returned HTTP 200 and exact local SHA-256 `7e4056e334bc4c6057ff2c7fb394aba34e37c2b7fd7d85d140d10bc3ddd2c388` with the new rule present.
- An exploratory probe used the wrong ARCHIVE IN-domain mirror path and returned 404. Correct canonical CORE and archive-pilates.web.app/core paths passed; no site/config change was needed.
- User/member records were read only. No test memo, real notice, manual queue run, source mutation or historical backfill. Natural creation of a new compact memo is not claimed by this rollout.
- Task-owned responsive contexts/servers closed; no task processes remained. Existing nonblocking ADC quota-project warning was preserved without auth/config changes. CI proof and final Git status follow below.
- Exact source CI succeeded on main run `39251306404` and feature run `39251302646`; independent watcher reported no failed steps. Results-only task/report follow-up changes no executable/deployed assets, so no second Hosting release is required.
