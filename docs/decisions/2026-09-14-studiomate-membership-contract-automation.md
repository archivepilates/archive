# StudioMate Membership Contract Automation

State: native source reader, contract writer, completion refresh and welcome queue deployed; production activation blocked.
Owner: ARCHIVE PILATES. Updated: 2026-09-14.

## Operating Decision

Staff register the member and issue the ticket in StudioMate once. Native electronic
contracts should follow issuance without recreating a member, ticket, payment or booking.
Trial, one-off, instructor lessons, staff education, complimentary and compensation
products are excluded. Regular products require an approved native product-ID allowlist.
StudioMate member grade is an independent gate: only the established regular-member grade
family (blank, VIP, Blue, influencer, member/general-member labels) may proceed. Instructor
members, staff, trial and consultation grades are excluded before contract creation. A new
unknown grade is review-only until explicitly classified; product eligibility cannot override
the member-grade gate.

First regular purchase uses the full signup agreement only when complete purchase and
signature histories establish no previous applicable agreement. Renewal uses the purchase
confirmation with the actual transaction. Unknown legacy signature history is review,
not proof of a new member. Material changes in terms require separately reviewed terms.
Marketing consent is not added or inferred.

## Welcome After Native Contract Completion

User decision on 2026-09-14: retain newcomer welcome Alimtalk in the native contract flow.
The integration trigger is independently verified member signature completion, not draft
save, center-seal upload or signature-request acceptance. Renewals never get welcome.
The pre-contract first-purchase decision is recomputed from its immutable evidence;
fresh native contract/member/issuance readback must still match and remain eligible.
Trial, one-off, instructor, staff, free, compensation, cancelled and refunded records are
excluded. No test override bypasses this automatic welcome policy.

`scripts/lib/studiomate-membership-welcome.mjs` exposes the shared TypeScript completion policy;
the existing read-only contract verification command now also evaluates welcome using
optional `welcomeCompletion` evidence (`completion`, `history`, `template`, UTC `now`).
`selection` always comes from the original contract-policy input, not the nested evidence.
The pure policy does not perform IO and retains `sendAllowed:false`. A separate guarded
queue adapter now performs canonical source checks and transactional queue/claim handling.
A pure ready intent is NOT a production candidate or proof of a live send.

SOLAPI template `KA01TP260914091233543JoFDsn7KfCr`,
`아카이브 신규회원 가입완료 웰컴 안내 v6`, was created and independently re-read as
INSPECTING on 2026-09-14. It keeps the approved v5 image and member channel, uses BA/IMAGE,
and retains only the existing facility-information and reservation-instructions buttons.
The old signup/short-link button and channel-add button are absent. The v5 source was
not edited or deleted. Provider state, exact ID, content, image, channel and buttons must
match before a ready intent can be produced. Public Notion destination rendering was not
verified in this session because the web reader could not open those existing URLs.

Permanent dedupe spans the whole welcome family, not template version or contract ID.
The proposed candidate identity hashes studio + normalized phone + welcome family. Before
promotion, the trusted loader must collect ALL canonical candidates/sends, retired onsite
request outcomes, legacy `new_member` sends, phone formats and merged member aliases,
and reconcile provider outcomes. Missing history is review, never an empty successful
history. Delivered/accepted blocks permanently. Queued/sending/unknown or any attempted
failure is review-only; repeated contract-complete events must not resend. Unattempted
cancelled/skipped jobs may qualify only after the fresh complete cross-family audit.

Promotion design (implemented, NOT active): native StudioMate contract/issuance records are the source;
`studiomateMembershipContracts` is the verified-source collection and
`alimtalkCandidates`/`alimtalkSends` are the existing delivery ledger. The source collection
is populated only by the guarded writer after a verified native issuance. The authorized
manual test contract is not retroactively inserted. WorkLane hints and CRM mirrors are forbidden
external-action sources. The adapter atomically reserves phone/member welcome identity
before the provider POST, repeats source/role/template/history checks and uses the shared
Alimtalk queue/provider ledger without a second direct sender.
No automatic retry on ambiguous provider acceptance. Activate only after native E2E,
approved template, source promotion and limited test readback; no historical backfill.

## Source And Promotion Boundary

- Canonical purchase evidence: fresh StudioMate member Excel plus independently verified
  native member ID, native issuance ID, product ID, dates and settled payment records.
- Canonical contract evidence: the native contract record and signed status, supplemented
  by applicable ARCHIVE IN/legacy regular membership agreements. Instructor eformsign
  consent does not count as a regular membership agreement.
- Provisional discovery: `workLanes/studiomate-membership-contract-automation/state/excelBaseline`
  and `purchaseHints`. Hints are never an external-action source.
- Identity after promotion: native StudioMate member ID + native userTicketId. Product ID
  is a different namespace. Names, dates, remaining counts and Excel hashes are not IDs.
- Baseline stores hashes and per-group row counts, not personal fields. Hints omit
  phone/name/DOB/address and retain sourceImportId.
- Allowed readers: bounded operator review/enrichment. Forbidden: sends, member creation,
  ticket issue, payment, reservation, contact or memo writes from hints or CRM mirrors.
- Native field mapping, full contract-history reads and exact ticket/payment readback are
  implemented and verified against the authorized completed test. Production promotion
  still requires a fresh issuance through the automatic writer and an approved v6 template.

## Implemented Guarded Entry Point

The existing fresh-download runner may pass `--contract-source-downloaded-at` to the
member importer. Only explicit `STUDIOMATE_MEMBERSHIP_CONTRACT_OBSERVER=shadow` and a
successfully applied, complete, fresh raw export enable provisional discovery. Default
is off. Manual historical files, contacts-only imports and dry runs do not invoke it.
The first baseline never creates candidates. Remaining-count/status/holding-end edits
are ignored by discovery. Financial/date changes are hints requiring native verification,
not confirmed new issuance. Repeated fingerprints cannot reset a resolved hint.
Empty purchase groups, lost member/ticket rows, invalid baseline schemas, stale downloads,
concurrent baseline changes and mass deltas fail closed without advancing the baseline.
Coverage loss requires review (including legitimate source deletions); do not automatically
reset the baseline. Freshness starts before the download process, not at its completion.
An observer error surfaces as a separate health warning without breaking ordinary
member/booking import or enabling legacy sends.

`verify-studiomate-membership-contracts.mjs --input <private-evidence.json>` runs the
policy offline; no apply/send option exists. Input is the documented policy schema.
Only anonymous index/reason/key results are printed. Do not commit evidence containing
personal details or provider credentials. Eligible means ready for further verification,
not permission to send; `sendAllowed` remains false in this staging implementation.

## Native UI Findings

- Existing `아카이브 회원가입` retained unchanged; facility, refund and privacy clauses read.
- New required term `재등록 구매조건 확인` registered 2026-09-14 16:07 KST.
- New template `아카이브 재등록 구매조건 확인`, native template ID `1341`.
- Address/visit/purpose toggles off; native creation still renders an optional address.
  Name/phone/gender/DOB are mandatory native fields and cannot be removed in template UI.
- Custom field `구매조건 상세` has a 50-character limit. Never silently truncate a real
  purchase condition; split explicitly reviewed fields or hold if it does not fit.
- Product selection fills catalog price and today's period, not the owned purchase.
  Exact name/phone and all transaction fields must be rechecked after every selection.
- Contract names allow Korean/English/numbers and `() - _ , .`, not square brackets.
- Test draft saved and read back with existing ticket dates/count/zero amount; owned
  ticket remained one. Saving a draft did not issue a new ticket in this test only.
- Signature-request click was blocked by `서명 요청 전에, 작성자의 서명이 필요합니다.`
  Native author signature supports drawing or image upload.
- The user selected official center-seal image upload instead of drawing. The approved
  200x200 PNG is stored outside Git at
  `~/ArchiveIN/automation/assets/archive-pilates-official-seal.png` with mode `0600`.
  Its required SHA-256 is
  `8aa7cc2bf0fb4c43809d753a505898a305b5d0340147f78364eb9ef56795ff8f`.
  The local verifier rejects links, public permissions, altered bytes, non-PNG files and
  different dimensions. Do not invent or substitute a seal, copy it into Git, sign for
  members, or check member consent on their behalf.
- On 2026-09-14 21:13 KST, one explicitly approved ordinary-member live test contract
  was saved with this exact seal, then refreshed through readback.
  The native contract reached 완료 status with both center and member signatures present and
  all three required terms marked as agreed. No welcome Alimtalk was sent.

## Activation Blockers And Next Verification

1. The official center seal, both signature-presence flags, and three required terms
   were verified on one live test contract (21:13 KST). The recipient signed themselves.
   Keep monitoring message history as additional completed-case evidence is collected.
2. Re-read ticket/payment state after completion for the same test contract:
   one ticket issuance remained (expected), and two payment rows were observed:
   one initial unpaid ledger row and one later actual card-settlement row. No ticket
   or payment duplication occurred.
3. Native issuance/product/payment/history enrichment now reads exact IDs and full
   StudioMate timestamps. The member Excel remains discovery-only and its blank IDs or
   date-only values are never promoted as native evidence.
4. Review existing terms against current cancellation policy and legal requirements.
   Existing brackets, broad injury liability, exclusive jurisdiction and blanket refund
   wording were not rewritten or certified legally valid during this task.
5. Synthetic tests cover cutover baseline, signed renewal, first regular purchase,
   exclusions, source edits, duplicate jobs, partial payments and ambiguous external
   results. Run one limited automatic-writer E2E on a future explicitly approved test
   issuance before setting `nativeE2eVerified` and live activation flags.
6. The canonical source reader, contract writer, completion refresh and queue adapter are
   implemented and deployed. Remaining blockers are provider-history coverage approval,
   v6 template approval and the limited automatic-writer E2E. The legacy onsite entry was
   already retired on main in commits 06f49971/7c3d658a; do not re-enable it or delete
   historical ARCHIVE IN contracts or links when integrating this older worktree.

Verified live evidence:
- 2026-09-14 21:13 KST: completed authorized test contract has center and member
  signatures present, and all three required terms agreed; one ticket issuance remained.
- The same contract had two payment rows: one initial unpaid ledger row and one
  later actual card-settlement row. No member/ticket/payment duplication occurred.
- Native readback normalized the ticket period and the two-row payment ledger to the
  exact owned issuance, 398,000 KRW paid and zero outstanding balance.
- template `KA01TP260914091233543JoFDsn7KfCr` remains `INSPECTING` in SOLAPI,
  so welcome Alimtalk remains inactive.

No Codex heartbeat or duplicate LaunchAgent was created. Native automatic sends stay off.

## Completion And Dispatch Implementation

- The DOM reader waits for populated contract fields, exact native URL/ID, signed status
  and both member/center signature images. Only presence booleans are retained, never images.
- StudioMate exposes a signature calendar date, not a signature instant. A bound draft-to-
  signed observation interval is retained. No synthetic signedAt is inferred from that date.
- The completion worker shares the existing browser-profile lock.
  Its default-off path exits before opening a browser or reading member data. It only reads
  existing bound native contracts and cannot create/send contracts, issue tickets or sign.
- Local/canonical welcome history exhausts bounded pages across phone formats and merged
  member identities, with a 15-second elapsed budget. Provider pages require a separately
  verified all-time coverage audit; unknown templates fail closed unless independently
  classified non-welcome. Empty current-window results are not historical proof.
- Candidate creation and dispatch use the existing Alimtalk queue. All four activation
  gates (enabled/live/sourcePromoted/nativeE2eVerified) must pass. Disabled candidates are
  not claimed or changed. One welcome candidate is considered per queue cycle.
- Missing attempts are never converted to zero for this type. Before POST, permanent
  phone-family and member-alias claims are created atomically. Acceptance/unknown outcomes
  retain claims. No automatic retry after timeout, crash or ambiguous provider acceptance.
- A current native member/ticket/payment readback plus the same contract's current signed
  state, exact native IDs and settled payment are required again before claiming and
  immediately before POST. The provider signing instant must exactly match the accepted
  completion. Candidate creation
  writes a one-shot readback request into the existing 30-second Mac mini operations queue;
  only a post-candidate readback no older than 12 minutes qualifies. Copied contract
  amounts do not qualify. No new LaunchAgent or periodic StudioMate scan was added.
- Source fingerprints, config, role exclusions, template content/image/buttons and history
  are rechecked. The shared transport does not create an extra short link for welcome v6.

The native issuance/payment/contract-history reader and automatic
draft/seal/signature-request writer are implemented. They remain dormant behind environment
and Firestore gates. Do not activate them until the v6 template is approved and one fresh,
explicitly authorized issuance completes the automatic writer E2E. The completed manual
test must not be rerun through the writer because its issuance is already contracted.

## Checks

`npm run test:membership-contract` passed 815 tests (189 Node + 626 TypeScript),
with zero failures or skipped tests. Covers first/renewal/exclusions, partial evidence,
template contract, native DOM/signature intervals, historical pagination, aliases,
concurrent/crashed dispatch, legacy nested outbound markers and current-readback races.

`npm run build:function-codebases`, `npm run validate:function-boundaries`, and
`npm run validate:data-source-policy` passed. All 5 codebases / 91 exports build.
The existing Alimtalk dedupe/safeguards/onsite-retirement regression suites passed 19 tests;
`node scripts/validate-onsite-welcome-release.mjs` passed. Retired entry points remain blocked.
One explicitly approved native LMS signature request ran after manual source review. No
welcome Alimtalk or separate member/ticket/payment write ran. New source formatting and
syntax checks passed.

`node --check scripts/emergency-import-studiomate-member-excel.mjs`

`node --check scripts/run-studiomate-excel-emergency-mode.mjs`

`npm run verify:studiomate-official-seal` passed against the private local asset.

`node scripts/process-studiomate-membership-contract-completions.mjs --dry-run`
returned disabled with zero reads, writes and sends (browser never opened).

`git diff --check`

Commits through `4d7afc62` were fast-forwarded to `main`, pushed to GitHub, and deployed on
2026-09-14. `functions-alimtalk` and ARCHIVE CORE Hosting passed their release guards and
live CORE canary. The Mac mini runtime checkout was fast-forwarded to the same commit.
Production activation remains deferred until template approval and automatic-writer E2E.

Report: `docs/reports/2026-09-14-studiomate-membership-contract-verification.html`.
