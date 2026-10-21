# Instructor climate access

- Request: allow existing instructor accounts to see and control the CORE climate menu. This explicitly changes climate permission only; no new user, password, role or membership changes.
- Existing promoted LG lane: `codex/mini/lg-thinq-control-20261021`, worktree `lg-thinq-control-20261021`, base379462298699565ab5e6187dc96d8c3b957b3c4a. Source origin/main; clean at start, fetched before work.
- Main owns climate callable gate/tests, narrow Firestore signal rules/tests, CORE rules/docs, final review, promotion/deployment/push. Frontend agent owns instructor shell/climate UI and their fixtures. Separate read-only agent verifies the isolated rules emulator.

## Contract

- Keep requireStaff canonical lookup on every climate call. Existing eligible instructor guard requires active=true, matching uid/staffId/studioId claims, current StudioMate employment source, coreAccessEnabled=true, completed first password change and fresh auth_time. Retired, disabled, unverified or stale sessions fail before PAT/provider access.
- Existing owner/manager access unchanged. Other roles remain denied. No global requireManager/auth helper changes.
- Instructor navigation becomes private, sequence, climate only. Home remains hidden and redirects to private; never restore/show the operator shell to make climate work. Mount the existing climate component in the isolated instructor surface, not a duplicate control implementation.
- Signal rules allow bounded16 reads to eligible instructors via existing readyCoreInstructor. No client writes, command/guard/member ledger access, or member-facing data-source change.
- Eight existing allowed units and all existing supported controls, including confirmed serial all-off, use the same canonical preflight, command UUID, durable guard, state readback, uncertainty hold and no automatic control retry. No separate instructor LG credential.
- Existing event receiver, subscriptions, tokens, polling intervals, StudioMate/member/Alimtalk automations untouched.

## Verification

- Initial backend climate/client/access regression317 passed, including15 new positive/negative callable tests covering all3 actions and identity/employment/activation/password/session failures.
- Real Firestore emulator360/360 passed, including10 new eligibility/signal isolation cases and unchanged Sequence/auth regression. Temporary official-checksummed Java21 and emulator processes were removed.
- Climate UI78/78 passed (old66+new12), focused instructor/navigation96/96, climate rerun8/8, navigation/runtime7/7. Includes320/390/768/1440px, one-original-main ownership, equal8 collapsedcard heights, nooperatorflash, firstpasswordgate, lateauth and signoutcleanup. Allfixtures/browsercontexts/servers closed.
- Five physical Functions builds, boundaries, canonical-source policy, rollback guards and Hosting validation passed. Diff whitespace clean. Main reviewed the scoped auth and component lifecycle diffs. No global auth helper, app bootstrap or staff data changes.
- Feature7fff94d732f28423e851aa0cbd7771b8e6ca820d promoted/pushed to origin/main; canonical runtime FF-aligned. Existing3 climate Functions ACTIVE around2026-10-21T09:32:08Z, signal rules compiled/released and both CORE Hosting sites deployed. No receiver restart or credential changes.
- Live5 asset hashes match source, full-SHA canary passed. Anonymous climate callable probes401 and signal read403. Actual operator session returned8 real units/4 running, no overflow and normal completed status. A task-owned duplicate operator tab hit existing shared-UID read throttles and later recovered; the tab was closed and existing user tabs preserved.
- Chromium and WebKit live-static/synthetic-SDK tests each initially8/8 passed after one first320px retry. Failure screenshot showed the existing sequence save guard correctly refusing navigation before the nested editor was ready. The new climate fixture now uses the existing navigation test's explicit editor-readiness wait; no production save/navigation guard was changed or bypassed.
- Final live-static reruns each8/8 with no retries, contexts16/16 closed, browsers/servers closed, no remaining fixtures. Reports: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-3jIFWI/report.json` (Chromium) and `core-instructor-access-ui-vPjBaJ/report.json` (WebKit). Screenshot copied to ignored `artifacts/lg-climate/instructor-390-20261021.png` and visually checked.
- Feature CI39577429487 passed. Final test/report-only commit is promoted through Hosting without repeating Functions/rules or changing the receiver. Real instructor login/physical controls remain intentionally unexecuted; mock account UI verification is not live instructor authentication proof. No passwords, staff records, member data, real device controls or messages changed. Task-owned live tab closed; user tabs preserved.
- Deployment scope when verified: existing3 climate functions, climate signal read rules, CORE Hosting and updated operating rules. No staff data changes, real HVAC controls, password changes or real instructor impersonation tests.
