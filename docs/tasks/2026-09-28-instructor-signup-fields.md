# Instructor signup profile sync

- Scope: signed instructor signup date of birth to StudioMate profile; career, affiliation and address to append-only member memo.
- Code lane: `codex/mini/instructor-signup-fields`, app worktree `eform-readiness/ARCHIVE-IN`.
- Canonical source: exact completed eformsign document and `eformsignInstructorMemberJobs.submittedProfile`; match registration, member ID, name, phone and current template before writes.
- Derived copies: `memberMemos`, `studiomateMemoWriteJobs`, StudioMate profile and memo. No downstream message or booking selection from these fields.
- Identity: `instructor_member_profile_<documentId>`. Retry rechecks DOB and existing memo; never modifies an existing conflicting DOB or existing memo.
- Missing answers: empty DOB leaves the profile unchanged; optional details are marked missing, never invented. Six-digit DOB uses the most recent non-future century (100-year validity window).
- Completion: existing memo step gates both DOB persistence and memo persistence. No new daemon or polling schedule.
- Targeted recovery: `--refresh-completed-fields --job-id <existing-completed-job>` only; no global completed-record scan or resends.
- Checks: focused source/identity/date/idempotency tests, existing registration and eformsign regression tests, release and CORE Hosting validators.
- Release/live evidence: pending validation and targeted completed-document verification. No schema or Functions release needed.
