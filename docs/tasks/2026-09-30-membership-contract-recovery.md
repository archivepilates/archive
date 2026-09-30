# Membership contract discovery recovery

- Scope: Mac mini runtime contract observer/processor/writer and CORE operating rule. No Functions, payment, reservation, member classification or template change.
- Canonical authority: current StudioMate member, user-ticket issuance and complete contract history; `studiomateMembershipContractJobs` and `studiomateMembershipContracts` remain the write/delivery journals. Work-lane hints authorize native reads only.
- Missing/decreased export groups are held with their prior fingerprint, count and last complete timestamp. Loss over 5% of prior groups or rows blocks all discovery. Small losses do not suppress unrelated discoveries.
- Pending native-read hints resume in batches of at most five members, using the current export time and each hint's original lower bound. Invalid hints become review; uncertain writes/sends never automatically replay.
- Contract readback requires exact user-ticket issuance ID. Saved unknown-send reasons block retries even when journal stage is `review`.
- Source-sync health is independent from actionable contract-stage findings. Reservation catch-up uses source health, not contract delivery status.
- Operator recovery CLI defaults to read-only. Apply requires exact member/phone/issuance and an approval reference, fresh native eligibility/history, no existing job, valid template and approved seal. Seven-day issuance-age exception is local to this invocation, not a settings mutation. The user signs independently.
- Read-only production-source replay: 3,381 rows, 899 prior groups, 904 current groups, one missing group; new observer identifies 13 changes including the approved member and preserves the one held group. No DB writes in replay.
- Verification: observer/pending/native policy tests; uncertain-send and issuance-binding regressions; system-health source/contract split; release guard; CORE Hosting validator; exact-member native recovery preflight.
- Rollout: scoped commit/main promotion; update clean Mac mini runtime; CORE rule Hosting publication; approved single-member recovery and fresh readback. Existing scheduled cadence unchanged. No broad pipeline manual run or multi-member send.
- Remaining held group and historical candidates require native review; no blanket baseline reset or historical resend.
