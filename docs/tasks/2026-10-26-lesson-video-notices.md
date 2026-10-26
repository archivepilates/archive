# Instructor Lesson Video Completion Notices

## Current Default: Ask After Upload, Send Only After Approval

- 2026-10-26 operator instruction: once a requested instructor-lesson YouTube upload is actually verified, propose the completion Alimtalk in the current chat. Show lesson/date, team, canonical registered recipient count, signup/access exceptions, approved text and the classroom/signup buttons. Verify existing website/classroom readiness and clearly retain any access blockers.
- Upload permission, APPROVED template status and silence do not authorize sending. Wait for the operator's explicit approval of this notice's audience and content; unanswered/declined proposals remain unsent, and material changes require renewed approval.
- At dispatch, refresh registered rosters including absentees while excluding cancellation/refund/identity ambiguity, exact template/channel/content/image/buttons, real [09:00,23:00) KST and canonical cross-channel histories. Preserve original action keys, existing accepted/unknown sends and first-grant 960-hour clocks.
- Existing completion template KA01TP261025172058035A7GWKDTFl7Y was independently read as APPROVED at 2026-10-26 19:49 KST; provider review comment records approval at 12:15:52 KST. Content, channel, image-style definition and both buttons matched the frozen specification. This supersedes the older INSPECTING snapshot below, not any historical send record.
- This default is an operator/agent workflow, not a newly deployed upload-event watcher or automatic ATA dispatcher. No approval request is sent to the operator by Alimtalk, no scheduler is added, and the 20 previously delivered LMS notices are not resent.
- Scope: common/project AGENTS instructions, this existing lane record and its existing CORE rule-note only. The existing scoped Hosting helper's pinned baseline is refreshed without changing its release protections. No Functions, membership, product, access, YouTube or member-message mutation.
- Release: policy commit 7a34d151 promoted/pushed to main and runtime; 196 no-send synthetic tests, syntax and diff checks passed. Initial fresh-worktree dependency resolution was repaired by reusing runtime NODE_PATH, without package changes.
- 20:22-20:23 KST exact-note Hosting releases: main 2656c72f988d2e26, CORE 0bbcca9c9e764fff. All other 222/62 files and configuration preserved; both HTTP 200 responses match SHA-256 4a2618a743ff15ea192cf7e8b1b25aaa112c92a497fd42c4ec12979c4d788225. CI run 40314604174 was in progress when checked; no final success claim. No UI/session or real-phone test was created.

## Current Override: Immediate Dispatch

- 2026-10-26 direct user change: send now instead of the previously scheduled 11:00. Actual KST was after 09:00; the old automation `2` is PAUSED before dispatch.
- Current fixed window is 2026-10-26 [09:00,23:00); the original 2026-10-27 reservation below is historical and superseded. No next-day catchup.
- Private `reschedule-261026.json` preserves the untouched original manifest/hash and new approval. Only schedule and approval timestamp changed; same20 recipients, sender, copy, purpose and channel-independent action keys. No prior sends/intents existed.
- Fresh eight-class native roster rechecked immediately before this change. Original POST message/group receipts can bind metadata-free provider readback only with exact recipient/sender/type/content; adopted legacy histories never become trusted POST receipts.
- Actual result: 2026-10-26 09:10:10-09:10:49 KST, 20 LMS accepted; separate GET-only reconciliation attempted 0 new sends and independently verified all20 status4000 delivered. Old automation remains PAUSED. No rights changes.
- Initial provider GET429 occurred before any intent/POST and was resolved with paced reads (400ms minimum) plus at most one GET-only retry respecting provider wait headers. POST/PUT never wait/retry internally. No unresolved send failure or duplicate.
- Current complete synthetic suite: 214 passed, including schedule/quiet window, original receipt binding, historical unknown replay fencing, read throttling and exact existing CORE-note replacement.
- Current release receipt: `d7903edd` main/runtime aligned; exact one-note replacements on both CORE sites verified live hash and all221/63 files/config preserved (versions b2675a7c6eddbc4d / 4a84f00c0cf5a29a). Old automation PAUSED; dispatch locks0; current owned Chrome tab closed. Original initial preparation receipt below remains historical.

## Approved Scope

- Direct user request: one completion SMS/LMS to all registered #9 external-feedback2 A/B/C/D members, including absentees. Live source verified 20 unique recipients, five per team; one C absentee is included only for the notice.
- One-off dispatch: 2026-10-27 11:00 Asia/Seoul; never before that instant, at/after 23:00, or on another date. Existing access check remains at 10:30/14:30/18:30. Standalone Codex automation id `2`; one Tuesday occurrence, then pause after completion/attention. No new recurring rights poller.
- No current member sends. Do not extend this approval to rights, orders, profiles, enrollment or refunds. A pending account may not yet have playback rights.
- Future video completion notices should use the approved Alimtalk template, not the old class-material template. This one-off remains LMS even if review finishes before dispatch. Do not automatically resend prior LMS as Alimtalk.

## Canonical Selection And Private Queue

- Narrow extension of the existing instructor-video sharing lane, not a new CRM/mirror pipeline.
- Source: StudioMate native class-detail registered roster, instructor/date/time, and attendance. IDs: A 97134106/97134121, B 97177049/97177091 (2026-10-24); C 97134107/97134122, D 97177137/97177166 (2026-10-25).
- Each first/second class has the same five registered members. Instructors/times are listed in the saved automation prompt. A/B/D are five attended; C four attended and one absent.
- Fresh read route: `https://arcpilates.studiomate.kr/lecture/detail?id=<id>`. Verify the visible heading, date, instructor and start time. Read the five native member rows from the ancestor list item of each attendance textbox named `선택`; the row contains name and unmasked registered phone, and textbox value is `출석` or `결석`. Never change the textbox. Unknown markup/status/contact or mismatching paired rosters stops the run.
- Private root: `~/Library/Application Support/ARCHIVE PILATES/lesson-video-notices-261026` (0700, regular files 0600). Source file `fresh-source.json`: `{source:"StudioMate live lesson-detail DOM",verifiedAt:<real ISO>,sessions:[{team,date,lessonId,rows:[{name,phone,attendance}]}]}`. Require age under two hours at dispatch and during the run.
- Approved canonical manifest: `state.json`, `approved-manifest.sha256`. Preserve approval, sender, names/normalized phones, sorted team membership, frozen subject/body, hashes and action keys. Never regenerate the target queue tomorrow.
- Identity/deduplication: purpose + normalized name/phone + sorted teams, independent of channel. Duplicate phones across teams combine into one notice; conflicting names stop. Current queue is 20 unique phones.
- Allowed readers: the approved one-off dispatch worker and operator review. Forbidden: selecting rights, payment/refund, reservations, attendance, contacts, surveys or CRM writes from this queue. No member data is tracked in Git or public reports.

## Dispatch And Verification

1. Read current user changes, prior queue/intent/receipts and all eight native rosters; check cancellation/refund/exclusions. A changed roster or unresolved source must stop, not silently expand recipients. Keep original approval/queue while reporting attention.
2. Review existing access ledgers for signup/rights state without changing rights. The approved text says playback requires account/rights confirmation, not immediate access for everyone. First verified grant starts 960 hours; signup/class date does not.
3. Run from reviewed `~/dev/archive-in-runtime`: `node scripts/send-lesson-video-notice-261027.mjs --plan`, then `--apply` once on the due date. Dependencies must already exist in the runtime Functions package. A worktree-only check can use `NODE_PATH` pointing to that package's node_modules.
4. Active sender, KISA/custom exclusions, complete provider LMS history, frozen manifest, fresh source, exclusive lock and real-clock guard must all pass. The latest pre-POST check has no asynchronous gap before the provider request.
5. Save permanent intent before one-recipient POST. Accepted, unknown, failed or crash intent is not auto-retried. Reconcile actual provider message/group IDs; POST acknowledgement is not delivery. Only independent status 4000 means delivered. Conflicting content/sender/purpose under an existing action key is attention, not delivery.
6. Results use planned / accepted / delivered / excluded / unknown / failed, never label quiet deferral as sent or failed. One-off job pauses after handled result or action needed. No late-next-day catchup or second scheduler.

## Alimtalk Definition

- New template: `KA01TP261025172058035A7GWKDTFl7Y`, `강사레슨_수업영상 업로드 완료 v1`.
- Instructor channel: `KA01PF260511123407631PSoAflYAVXs`; approved reference `KA01TP260825074722212ylmndmsB3V4` is unchanged.
- Type BA/IMAGE, deliberate paragraph breaks, name/class/team variables. Buttons: 내 강의실 바로가기 `/48`, 홈페이지 회원가입 `/?mode=join&back_url=LzQ4` on the Imweb site.
- Official 800x400 basic red symbol image is copied unchanged. Original KAKAO asset was rejected by inspection; exact same bytes registered as ATA `ST01FZ261025172834907hcnuuocG7hz`. SHA256 `3820f01c96fb6ddce5d6d67ccda6c360b9a9702e7bb5cb451356da33da5a9e10`.
- Original inspection returned ValidationError: not an Alimtalk template image. Independently verified PENDING, repaired only this new template's image registration, then verified `INSPECTING`. No duplicate template or original-reference edit.
- Creation and inspection are not approval. `requireApprovedLessonVideoTemplate` requires the exact template/channel/content/image/buttons and APPROVED status before a future ATA worker may dispatch. No new ATA sender or automatic post-approval historical replay is activated here.
- Template journal records initial intent, rejected inspection, diagnosed root cause, exact-byte ATA registration, targeted repair and independent inspection readback.

## Verification And Release

- Native roster: 8 classes, paired agreement, 20 registered/unique contacts. Owner-only frozen queue and 554-byte maximum LMS body; subject 26 UTF-8 bytes.
- Provider read-only preflight schema verified: active registered sender strings, empty complete KISA/custom block lists, complete LMS list schema. Current known actor and project are the existing SOLAPI account via `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`, project `archive-pilates`; no credentials in output.
- Tests cover quiet/due/date boundaries, roster/source/hash changes, lock/intent/replay, provider histories, exclusion, privacy and template approval gating. No real-phone tests.
- Source release is scoped to this lane and the single CORE `lesson-video-upload-notice` note. Hosting patch preserves every unrelated file/configuration, uses reviewed clean synchronized main and live hash readback. No Functions, membership/site-product or YouTube changes.
- Remaining: actual scheduled provider results and Kakao approval are future states; neither is claimed complete. Future template rejection requires operator review, not repeated submission or an unapproved alternate channel.
- Release receipt: code commit `f50480e3` promoted/pushed to main and runtime; 199 synthetic tests passed. Both exact CORE-note Hosting patches verified complete manifests/config and live source hashes (versions `8e15b7e85b3f6f9a` / `b79126f7c9208de9`). Runtime pre-due apply returned deferred with attempted 0; queue remains 20 with no sends/intents/locks. Task-owned browser tabs closed. Real-device member sends intentionally skipped during quiet hours.
