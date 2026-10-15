# Approved Refund Followup

## Authorization and Boundaries
- Human approved the existing 292,500 KRW quote, agreement once and pre-payout SMS once.
- Native ticket had already been marked refunded. Human separately confirmed no actual payout.
- Manual followup used existing canonical case/jobs and a durable operatorApprovedFollowup record with original calculation hash, native IDs, document name, message hash, expiry and per-channel claim state.
- Generic native refunded-ticket guard was NOT bypassed or relaxed. Existing jobs were not reset to pending/retry.
- No payment refund, ticket restoration, member/pass/holding/reservation mutation or unrelated send.

## Confirmed Dispatch
- Agreement: 2026-10-15 19:17 KST, one provider create response, matching document ID/title and progress-list full recipient; signature completion is separate.
- SMS: 2026-10-15 19:21 KST, one exact native recipient in request, title/body match, POST /v2/staff/sms 200 and a positive send record ID.
- Reopened SMS history initially showed processing for that full recipient. Do not infer handset delivery or retry while provider result is pending.
- Full provider records, private screenshots and recipient details remain outside Git in the task-owned automation report directory.

## Actual UI Corrections
- eformsign fill() could show transient values without committing prior widget fields. Sequential keys plus Enter were verified live; same-page fields, registered signature and writing-date completion precede required 8/8 gate.
- SMS recipient was in a read-only input value, not innerText.
- Composer Send opens a separate one-recipient confirmation; only its final Confirm creates the SMS request.
- The response count is point debit, not recipient count; use exact request users and body binding.
- These corrections keep the original canonical pre-send checks and unknown-acceptance no-retry rule.

## Release
- Full refund Node regressions: 82 passed; refund policy: 15 passed. Both worker syntax checks and release/rollback guards passed.
- Live dispatch is the explicitly approved single case, not a repeated test. No additional test send is authorized by this result.
- Generic worker changes were verified with synthetic fixtures and source review; no second live send was used to test them.
- Runtime UI scripts and CORE operator rules only. No Functions or Firestore rules changes.
- Scoped regression tests and release evidence accompany main promotion; exact released source is recorded by CORE release.json.
