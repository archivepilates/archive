# Signed signup six-digit birth date

## Approval and scope
- Policy approval: call_c669c02055404ba791b75913351a32b1.
- Release approval: call_dca9b03ec8af4482b687c69e8a07b6a3.
- Dedicated existing lane: codex/mini/instructor-signup-profile-v2-20261030, base 98596f872dd7039cf1358e2cae0ec1ec9cdf2527.
- Only signed instructor signup profile enrichment. No member sends, manual native writes, completed-job reset, historical bulk replay, new scheduler, IAM or Functions changes.

## Policy
- Keep strict full-date parsing for native and legacy validation.
- Resolve signed YYMMDD against a valid native full date first; matching suffix preserves its century.
- When native birth date is blank, YY <= current KST year modulo 100 means 2000 + YY; otherwise 1900 + YY.
- Invalid, today/future, malformed and conflicting native values remain review/conflict. Existing values are never overwritten.
- Preserve signed raw projection/source hash and queue identity. Completion-only jobs remain review with no profile values synthesized.
- Store resolution policy, reference instant and resolved value hash, not another plaintext DOB. Verify against frozen reference after calendar-year rollover.
- Existing periodic memo writer, identity checks, source binding, before-save independent reread, lock, duplicate and uncertain-save safeguards remain unchanged.

## Validation and release
- Synthetic policy/writer/integration tests only; no real member profile or message tests.
- Scoped root runtime modules + verifier; runtime fast-forward loads them in subsequent existing executions.
- CORE rules-only Hosting target instructorSignupBirthDate preserves other assets and Hosting configuration.
- No Functions deployment: no Functions code or shared contracts changed. CI may conservatively detect root scripts.
- Report: docs/reports/2026-10-31-instructor-signup-six-digit-birth.html.
- Implementation and final release evidence are recorded separately below after verification.

## Local checks
- 571 synthetic signup policy/writer/verifier/queue/integration + scoped release tests passed.
- validate:instructor-lesson-registration, validate:data-source-policy, node --check writer/verifier, git diff --check passed.
- Affected Functions detection against exact base: no codebases.
- LaunchAgent unchanged before release: 300 seconds, existing runtime memo worker, SHA256 042ab40364cd6fbcf1b2074f602a72e8922f742c880c415dcb2667d652f08c76.
- Separate reviewer tested policy/writer under America/Los_Angeles as well; no host-timezone dependency.
- Additional browser-lock/predeploy regression: 37/37 passed (608 scoped tests total).
- Independent final review: no actionable findings; 223 timezone-specific policy/writer/verifier tests passed.
- Direct CORE Hosting UI guard passed. Broad validate:archive-core-hosting wrapper fails in its catalog precheck on both clean unchanged main 98596f87 and feature worktree: preexisting catalog fingerprint drift. Catalog/app/Functions are outside this rules-only release and preserved byte-for-byte; no full Hosting bundle deployment is attempted.
