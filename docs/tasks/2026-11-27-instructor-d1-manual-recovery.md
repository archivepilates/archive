# Instructor lesson D-1 manual recovery

Operator-only recovery of one exact management number for tomorrow's class, on today's KST date from 14:00 through 22:59. Normal 11:30 sample, 13:30 reminder, 14:00 automatic dispatch, and ordinary approval endpoint remain unchanged. No new scheduler, production UI, provider template edit, historical replay, or student send as part of deployment.

Run the local operator script from reviewed, clean main with the established operator identity:
1. `preview <lessonDate> <managementNumber>` reads current canonical reservations, cancellation states, read-only provider history and the approved V3 template; it shows the content, four buttons and cohort count, not personal contacts.
2. `sample <lessonDate> <managementNumber> <plan>` requires an explicit test-only instruction and stable live plan. It uses only the designated Kim Gi-hyo test recipient and that date's preview parking link. It does not create student candidates or recipients' parking links.
3. Read `preview` again after the provider returns COMPLETE / 4000 for the exact sample. Obtain explicit human approval of that sample and the exact dated cohort. Then `send <lessonDate> <managementNumber> <approvalProof> confirm-delivered-sample operator:<approval-reference>`. It re-reads the current cohort, cancellation and provider history; only then prepares inbox and parking items and atomically claims the one batch. It uses the existing per-recipient eligibility and delivery claim. Check final provider delivery separately, never repeat a failed or unknown attempt.

No alternative SMS, no date/clock substitution, no broad batch approval/rebuild. Changes in audience, material, provider template or sample invalidate the proof. Ambiguous provider history or any existing attempt requires reconciliation rather than replay.
