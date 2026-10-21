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
- Pending: scoped main promotion, deployment and live-static instructor fixture verification. Real instructor login/physical controls remain intentionally unexecuted.
- Deployment scope when verified: existing3 climate functions, climate signal read rules, CORE Hosting and updated operating rules. No staff data changes, real HVAC controls, password changes or real instructor impersonation tests.
