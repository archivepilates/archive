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
- Release/live evidence: code through `934ee747` promoted to origin/main and Mac mini runtime; CORE rules deployed separately. No schema or Functions release needed.
- Verification: 101 focused/regression tests passed, registration release and CORE Hosting/rollback validators passed. Canonical source document `9cefa01c70494b58a4346277bc2389b4` extracted without resend; DOB persisted and independently reloaded, one detailed memo appended. Existing completion-only memo preserved.
- Queue readback: eform `done`, profile version 1, memo job `done`, member memo `synced`/`manager_only`, registration `completed`, memo step `verified`, no remaining registration error. Targeted replay processed zero documents and the done memo job was excluded before browser launch.
- Live fixes: eform browser locale uses English Completed; StudioMate puts duplicate placeholder attributes on wrapper divs; DOB mask requires keyboard events. Guard all three and verify persisted state, not a toast. One verification failure email may exist; the selected job was recovered and all states verified.
- Optional career/address were empty in this real sample and were recorded as missing; nonempty values were covered with synthetic unit fixtures, not fabricated production values. No historical bulk backfill, new ticket, booking, contract send or Alimtalk send occurred.
