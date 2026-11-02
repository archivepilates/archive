# Instructor Order Lifecycle Validation

- Approval: operator requested validation correction, exact two-row state recovery and full deploy set. No pass issuance or member resend.
- Branch/worktree: `codex/mini/instructor-order-confirmation-20261102`, managed `instructor-order-confirmation-20261102/ARCHIVE-IN`.
- Main owns policy, recovery runner, production transaction and release. Review agents own recovery planner/tests and obsolete harness fixes in disjoint files.
- Cause: a paid joint order moved from OPEN/SHIPPING_COMPLETE to CLOSED/PURCHASE_CONFIRMATION. Only these two raw fields changed; whole-object fingerprint equality rejected normal progression.
- Policy: bounded predecessor reconstruction, exact original raw hash, unchanged approval key. All other source fields, current financial checks and attendee-family guards remain binding. Reverse/unknown transitions fail closed.
- Recovery: exact approved pair only; dry-run by default, clean expected runtime commit, fresh native ticket and SOLAPI GET evidence, complete canonical histories, atomic compare-and-set with immutable private audit. Completed downstream jobs/forms/messages and original approval remain unchanged. No automatic clearing of other holds.
- Canonical sources: current Imweb order, StudioMate member/pass/payment, instructorLessonRegistrations, imwebInstructorLessonOrders, studiomateInstructorLessonJobs, eformsignInstructorMemberJobs, alimtalkCandidates/alimtalkSends.
- Private source proofs: local operations directory `instructor-order-confirmation-20261102`; no raw member/contact/provider payloads in Git. Work-lane audit is evidence only, not an action source.
- Release scope: Mac mini source fast-forward and CORE rules Hosting only; affected Functions detection must remain empty. Existing schedules/locks/quiet hours unchanged.
- Verification/release and exact recovery results: record in the companion HTML report after execution. Stored eform completion is distinguished from a new provider check.
- Separate issue: Gmail ingress `gmail_http_400` remains outside this order-recovery release. No cursor reset or replacement poller.

## Verified Execution

- Code commit `1f4bed6c` promoted/pushed to main; runtime clean and fast-forwarded. CI enforcement follow-up `db6274e7` contains no operational code or Hosting changes.
- 866 related tests passed (536 Node, 286 Functions/schedule, 44 CORE rules release). Local and live synthetic responsive QA each passed 95 checks at 320/390/768/1440/1920px.
- Exact dry-run and approved apply yielded the same plan hash. At 2026-11-02T14:58:12.520Z both original registrations became completed in one transaction; ledger queued/approved, original fingerprint/key retained.
- Fresh native ticket/payment and SOLAPI COMPLETE/4000 GETs matched both canonical rows. Existing eform completion is stored canonical evidence, not a new native signing-screen check.
- Existing jobs/eform jobs, member evidence/steps/completion times and all queried candidate/send histories remained unchanged. No new passes, contracts or sends; no manual sync.
- CORE MCP independently read both completed; read-only reconciliation returned unchanged/verified, proving the fixed source checker accepts the restored family.
- CORE Hosting and compatibility Hosting deployed; initial compatibility SHA mismatch was fixed by deploying the existing compatibility target. Both rule markers/releases and all 10 CORE canaries pass at code commit `1f4bed6c`.
- Code CI runs 41466775937 and 41466775990 succeeded. CI follow-up 41467332231 exposed Node 22 invalid-Date equality/reporting differences; test-only portability fix `44d1f72d` retains the full immutability check using serialized values. All 866 related tests also passed locally on Node 22.23.4. Final CI 41467902266 succeeded including the new joint-order regression step; no skipped test steps.
- Existing scheduled scan at 2026-11-02T14:58:22.944Z independently recorded ok/unchanged/attendeeResolutionVerified and zero issues. No scan was manually triggered or cached issue state reset.
- Native and QA browsers closed in finally; user-owned browser state preserved. Runtime configuration, IAM, original schedules and outbound quiet hours unchanged.
