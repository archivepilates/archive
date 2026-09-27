# ARCHIVE PILATES instructor signup recovery

- Isolated branch: codex/mini/eform-readiness. Shipping completion work remains separate and unreleased.
- Live evidence: two pre-send 30-second waits timed out; the third scheduled attempt succeeded at 2026-09-28 00:22 KST without code changes. Exact failing wait cannot be reconstructed from old logs.
- eformsign progress and history show one sent document and signature pending. No duplicate message, member, ticket, or reservation was created during this investigation.
- Confirmed defect: markSent cleared the queue error but not the registration error. A guarded transaction cleared the matching historical registration timeout for the verified document and retained lastResolvedEformError.
- Change: use actual visible operator fields instead of the undocumented viewer load flag; existing fill/actionability, exact field values, required-field count and final-send guards remain.
- Change: distinguish operator readiness, ticket input, payment input, send transition and send-dialog failures. Diagnostics contain only page path and structural UI state, not form values or recipient data.
- Change: future successful retries clear only the matching eform error if no other stage has a failure. Retrying jobs report warning rather than healthy in automation control.
- Checks: 18 helper/contract tests; syntax check; instructor lesson release validator; independent read-only review. Live unsaved form reached required fields 2/2 and Send; no final send test was run against a real member.
- Residual: intermittent vendor/browser delay was not reproduced; the existing send-dialog vendor callback workaround is unchanged. Do not claim all timeouts eliminated.
- Deployment target: Mac mini runtime worker and ARCHIVE CORE rules only; no Functions, Firestore rules or schema changes.
