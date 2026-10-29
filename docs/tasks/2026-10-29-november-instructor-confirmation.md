# November Instructor Confirmation Coverage And Recovery

User scope: reconcile November instructor-lesson enrollment, send confirmed missing
reservation notices once, diagnose and fix the intake gap. No duplicate ticket,
member, signup, prior accepted/ambiguous send or cancelled-date restoration.

Worktree: `/Users/archivepilates/codex-worktrees/november-instructor-confirmation-20261029`.
Branch: `codex/mini/november-instructor-confirmation-20261029`.
Base: origin/main 6f6e979c. Runtime had existing untracked scripts/__pycache__/;
preserve it. Canonical Google project archive-pilates; existing operator account.

Read-only full StudioMate member Excel at 2026-10-29 14:46 KST: 3657 rows,
SHA256 b839f893f3134510ac00a63179c2abe40287a36664935026ad0bcd80d41ec5d3.
23 November instructor tickets: 18 exact 강사레슨 (2T), 5 Team 강사레슨.
Browser-bound independent native read verified identities and full ticket/payment
sources for all 23; provider/canonical histories bounded and complete for the audit.
Existing 13 ordinary confirmations each COMPLETE/4000; do not replay.

Missing ordinary paid/returning recipients: Kim Ye-ji, Kim Yun-hwa, Lee Ju-hong,
all 2026-11-29. Each has one active paid 70000 KRW native ticket and previous
completed returning-member registration. Current-date registration absent, no
matching candidate/send/provider notice. Lee's old 11/28 cancelled source must
remain cancelled. Current 11/29 admission uses the separate current native ticket.

Initial additional scope (subsequently approved for the two free recipients): An So-eun 0 KRW instructor ticket and
Jung Yu-ri 0 KRW staff ticket, both 11/28; five separate Team tickets on 11/21 are
80000 KRW and have no existing 2T official calendar binding. Do not relabel them
2T, infer payment, skip staff policy, or promise D-1 workflow without validation.

Confirmed root cause: the confirmation trigger observes only canonical
instructorLessonRegistrations ticket-verification transitions. Excel member/booking
imports and manual StudioMate ticket issuance do not create these registrations.
Dashboard rosters can therefore show ticket holders without an intake/notice path.

Implementation: a narrowly approved existing-paid-returning-ticket adoption path
creates only the missing canonical registration with immutable source evidence;
no ticket/member/StudioMate job/eform job is issued. The established verification
trigger and existing queue retain schedule/template/current-source/duplicate/window
checks. All native and provider evidence is refreshed, <=120 seconds old at apply;
source/duplicate/cancellation records are rechecked transactionally.

Prevention: add a read-only bounded coverage check to the existing system health
pipeline, not another scheduler or automatic sender. Missing intake is an operator
review signal, not proof that no external message was delivered. Source freshness,
partial reads, zero-price and staff exceptions stay explicit. Health writes use
only existing operational health/action ledgers, not member/ticket/registration data.

Final local verification: 2478 broad instructor/Imweb/health tests across 65 unique
MJS files passed with zero failures/skips; the adoption pure suite has 54 tests.
Rules/catalog responsive and strict
one-note release checks passed at 320/390/768/1440. Hosting validation passed.
Fresh live dry-run adoption passed all three exact recipients. Independent review
required (and now code rejects) any same-date legacy-ID registration/query insertion
and newer unfinished signup history despite an older completed returning record.

The explicitly requested one-off notice recovery can execute only from a clean
committed exact lane worktree with an explicit expected commit, or synchronized
runtime main. It creates canonical registrations only. It does not activate a
new production worker; health/rules deployment received separate explicit approval.

2026-10-29 operational update:
- User approved the two complimentary recipients and scoped prevention deployment.
- Five missing notices each accepted once by the established queue: paid recipients
  at 15:12:04/06/08 KST; complimentary recipients at 15:22:03/04 KST.
- Independent SOLAPI GET at 15:23:54-55 KST proved COMPLETE/4000 for all five,
  matching message ID, recipient, approved template and canonical ledger. These
  are query-confirmation times; no provider completion timestamp was supplied.
- No ticket, member, signup or reservation was issued; old cancellation preserved.
- An So-eun's missing prior signup evidence remains a separate action-required
  item. Notice delivery does not establish signup completion or member consent.
- Source a10e1324 and 84935deb promoted to origin/main and runtime. Current bounded
  coverage read is complete with 18 covered and no findings, intake scope only.
- CORE rules release 8cdc830635341c29 preserved 62 other files/config. Initial
  propagation readback mismatch was reconciled to exact source hash at 15:20:29
  KST without replaying the accepted release.
- Team real five remain unsent pending content approval. Only Kim Gi-hyo's single
  visibly marked preview is authorized. Fresh native Team lectures 98585018 and
  98585168 establish November 21 13:30-14:20 reformer/block and 14:30-15:20
  barrel/stick. Additive static calendar publication and preview transport use
  canonical claims, current source/template validation and the normal window.
- Team initial calendar release 667eb92629bed6aa verified at 15:31:27 KST,
  preserving all 73 baseline files/config and adding only two files.
- Kim Gi-hyo preview accepted at 15:31:47 KST and COMPLETE/4000 confirmed by GET
  at 15:33:26 KST, matching exact recipient/template/rendered body/action key.
  Message M4V20261029153147AOMWNDQEZKIEEPM. Actual Team recipients sent: zero.
- Initial preview receipt parsing assumed an array. Provider GET proved the
  one accepted message, and canonical sent/done was reconciled without replay.
  Support keyed/array provisional receipts, preserve receipt before independent
  identity GET, reject failures/multiple/contradictory receipts. Existing candidate
  readback now returns sent/replayed:false without another provider POST.
- First Team commit CI caught a legacy validator that assumed every calendar was
  METHOD #8 at 13:00-15:10. Add exact verified Team builder comparison without
  relaxing any legacy course check. Add full canonical venue address and confirmed
  ICS status. Latest Team suite: 16 passed; rollback/calendar/address guards pass.
  The two already-created Team files require a scoped known-baseline update;
  all other 73 hashes/config remain preserved. No member replay is permitted.
- Address-only calendar update e482cba12e2f5259 deployed from clean main c2a77173
  and verified at 15:38:15 KST. Both exact source hashes match live URLs, ICS MIME
  text/calendar, and all other 73 files/config preserved. CORE intake rule still
  present in the concurrently updated operating-rules page (HTTP 200).
- Deployment boundary: existing runtime health script plus the scoped CORE rules
  and member calendar Hosting files. No Functions implementation, Firestore schema,
  IAM, DNS, ordinary sender or scheduler change. Affected detection conservatively
  includes all codebases for CI workflow edits; CI builds/checks those codebases,
  not an instruction to redeploy unchanged Functions.
- Task-owned Playwright contexts closed and StudioMate/Hosting locks released.
  Runtime preserves its pre-existing untracked scripts/__pycache__/ only.
- Final implementation CI on c2a77173: CORE MCP Check 40830371677 success;
  main Functions Affected Check 40830371713 success (all steps, 2m16s).
  Initial b0c4e64 legacy-calendar failure is superseded by this successful run.
Private proofs remain under ~/ArchiveIN/operations/november-instructor-confirmation-20261029/.
