# Instructor signup postal callback and review resolution

## Scope and approval
- User reported manually adding the affected instructor's StudioMate address and approved review cleanup plus recurrence prevention, validation and deployment.
- Dedicated branch codex/mini/signup-address-readback-20261101 at ~/codex-worktrees/signup-address-readback-20261101; base origin/main17894614. Existing runtime untracked Python cache and unrelated worktrees preserved.
- Do not reset/re-run completed memo jobs, recreate contracts/memos/tickets, resend notices, change raw signed answers or blanket-clear review flags. Existing canonical sources, locks, schedules and blank-only profile-write policy remain.

## Current exact-case evidence
- Original job: done, memoWriteState verified, profileSyncStatus review_required. DOB verified; address review/postal_exact_match_unavailable/native_callback. Signup and confirmation steps completed; only memo-profile enrichment required review.
- Fresh native editor read at2026-11-01T02:40:06.499Z confirmed exact name+full phone+native ID, DOB matches signed source. Current operator-entered address present but not equal to signed jibun; detail blank. No member write occurred.
- Official native postcode search used only the signed base lot address, without name/phone/DOB/detail. Unsaved single selection at02:44:46.698Z reproduced the root cause: one exact jibun result; callback returned the corresponding road address in the same selected result row; popup closed normally. Returned road address was not the current manually entered address. Independent reopen preserved current native profile unchanged. No save/API write.
- Asked operator whether to retain the current manually entered address as authoritative and resolve review, or use the signed address instead. Until reply, do not override the current address or falsely certify signed-address equality. Historical source and stored review remain unchanged.

## Recurrence fix
- Keep the unique exact signed-base result selection, one click only. Capture aliases exclusively from that selected dl.list_address, never another search row.
- For a jibun source, permit only one unambiguous recognized road address in the same row; canonical source itself remains allowed. Multiple road aliases fail closed. No arbitrary/fuzzy address, direct JS callback or input injection.
- Poll the same visible native address locator with bounded reads; compare full canonical keys rather than raw final-token substring. Popup close alone is not proof. Narrow auto-close click rejection permits readback only when popup is actually closed and opener remains open; never repeat click.
- Record source/selected/detail hashes with native selection evidence. Only prior verified evidence bound to the same signed source and native fields permits idempotent alias replay recognition.
- Revalidate the independent saved-source snapshot and all intended/preserved draft fields before save intent and again immediately before save. Late callback or changed source cannot silently join an independent DOB save.
- New pure review planner changes only field-review metadata after fresh exact native identity, signed-job/canonical memo binding and explicit operator approval tied to native profile hash. Signed-equality mode rejects mismatch; retaining a differing operator-entered address requires its explicit decision and records that basis truthfully, not as signed-field equality.

## Native verification
- Fixed chooser executed on same real native source at2026-11-01T02:49:53.579Z: exact jibun selected once, same-row road callback verified, no save, existing persisted member profile unchanged. Evidence under owner-only ~/ArchiveIN/operations/signup-address-readback-20261101. Raw addresses, birth dates, phone numbers and credentials are not in Git/report output.
- Unit/writer/reconciliation/UI counts and release evidence recorded after final checks. No new worker/queue/scheduler or Functions source change.
- Root npm and Functions dependency installs are local worktree setup only; package/lock files unchanged. Existing root audit findings remain unrelated and are not bulk-fixed in this task.
- Final local suite: 844 tests passed, no failures/skips, including 134 native-writer and 228 review-resolution tests. Selected-row alias ambiguity, late callback/save-intent mutation, source changes, closed registration, cross-document approval replay, mismatched step references and raw-metadata exclusion fail closed. CORE note layout checked at320/390/768/1440px with no overflow. Hosting guard and git diff whitespace checks passed.
- Review plan is pure and has no automatic apply endpoint. Its explicit approval binds decision mode, job/registration/document/source/profile-update hashes and the exact fresh native profile. Any future approved one-off apply must re-read canonical records transactionally and preserve original content, attempts and completed job status.

## Release status
- Runtime scripts and CORE rules-only target signupPostalReadback; no Functions deployment. Live manifest/config/hash, CI and Git status are separate completion proofs.
- Individual review cleanup remains blocked on the explicit address-basis reply if still pending. Do not count a successful recurrence-fix deployment as resolution of that review.
