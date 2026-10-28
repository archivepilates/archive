# Instructor Registration Recovery

- Approval: repair one existing native ticket binding and one unsent instructor signup stage; prevent duplicate issuance and any redispatch of existing confirmation Alimtalk. Validate, deploy, commit and push.
- Scope: lane-specific worktree from origin/main 612d27e8. Preserve runtime's existing untracked scripts/__pycache__/. No member details, native IDs, order IDs or source payloads in Git.
- Canonical sources: exact current Imweb paid order and shared allocation; native StudioMate identity and complete ticket list; canonical registration/jobs/candidate/send ledgers; eformsign progress/completed document searches. workLanes reports are audit only.
- Native receipt: persist the accepted native ticket ID before independent page verification. Visibility/outer-card filtering and one read-only reload resolve transient duplicate presentations, but real duplicates remain blocked. Retained receipt/ID prevents another issuance when a card disappears. A missing/ambiguous response ID never becomes verified.
- Family progress: existing source/identity/approval/cancel/refund eligibility remains strict. Whole-family immutable checks complete before an operational-progress error is typed. Watcher does not revoke approval for that error; eform defers without consuming an attempt and rechecks in five minutes. Concurrent holds/claims/send markers are never overwritten.
- Exact-job executions scope stale-job inspection to the supplied job ID instead of touching unrelated jobs.
- Bounded recovery planner: exact actor/action/registration approval, fresh identity/ticket proof, current paid source externally checked by operator runner, same canonical job and immutable before-state audit. Native binding requires existing issued ticket/date/payment/issue-time match and never issues. Eform requires legacy pre-send failure, no accepted/ambiguous markers, fresh empty document searches and preserved prior confirmation evidence. Original attempts remain; one additional attempt is allowed.
- No API writes, native ticket/member changes, settings/IAM/schedule changes, extra scheduler, contract deletion or confirmation resend. Existing general contract maintenance hold remains unchanged.

## Verification Before Release

- Main instructor/imweb/dispatch Node suites: 976 passed; synthetic fixtures only. Recovery failure cases independently added/reviewed; no production fixtures used in tests.
- Runtime helper changes affect no Functions codebase; TypeScript confirmation guards are deliberately unchanged. Runtime and CORE Hosting publication only.
- Hosting/catalog validation and git diff whitespace check passed. Deployment/live results and exact scoped recovery remain pending until independently read back.
- Final expanded run: 1096 Node tests passed. Independent reviewers' final suites passed (266 recovery/send-boundary and 104 family/concurrency tests, subsets of the expanded run); no remaining blockers. Earlier local findings were fixed before release. No live test dispatch.
- Local CORE responsive QA passed 95 checks at 320, 390, 768, 1440 and 1920 widths. Registration release validator and live rollback guards passed.
- Exact native identity/ticket rechecks and empty eform progress/completed search proofs were obtained privately. Dry-run plans for the two approved canonical IDs are verified before any apply; fresh proofs are mandatory again after deployment.
