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
