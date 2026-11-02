# StudioMate Registration Split Compatibility

- Date: 2026-11-02, ARCHIVE PILATES OPS.
- Request: adapt member-registration automation to StudioMate notice 225; verify without member effects.
- Worktree: `/Users/archivepilates/codex-worktrees/studiomate-registration-revamp-20261102`.
- Branch: `codex/mini/studiomate-registration-revamp-20261102`; base `5b17ea289b7545447a711997083c4a3b2b9cb3c1`.
- Managed create_worktree rejected the source root. Used ordinary isolated Git worktree fallback; runtime remained unchanged.

## Source And Boundary

Authenticated notice `https://arcpilates.studiomate.kr/boards/studio-notice/225?page=1`, published 2026-11-02 08:51 KST. Primary notice image was read, not inferred from navigation text. Scheduled rollout is 2026-11-17 14:00-16:00 KST, subject to change. PC basic member save and subsequent ticket issuance become separate stages. Optional post-save guide has cancel/confirm controls. Administrator app uses a separate add-ticket action.

Read-only source check 2026-11-02 10:13 KST: current blank PC form still has exactly one name field, phone field, grade field and member-save button. Fields were empty, not filled; no save clicked. After authentication, non-read HTTP requests were blocked. Task context and shared StudioMate lock were released. Private ignored artifacts contain only the primary notice image and non-personal form counts, no member roster.

## Implementation

- Shared capability observer recognizes current detail redirect or the strict anticipated success/ticket guide. It never clicks the guide's confirm/cancel or implicitly issues tickets. Unknown dialogs/origins/edit URLs stop.
- Independent exact phone/name/native-ID readback confirms member persistence. A known redirect ID must match. Standard worker checkpoints member completion before the separate ticket step; Team adapter persists its receipt and retains unknown-effect replay guards.
- Final new-member form identity and unique controls are rechecked before the durable external claim. Existing-member edit forms cannot enter member creation.
- Known maintenance interval blocks new member/ticket writes before claims where possible, with a final clock check immediately before submission. Existing quiet-hour checks remain independent. Standard worker records maintenance deferral without provider attempts; no second scheduler.
- Existing purchase baseline, coverage reconciliations, source holding, contract writer settings, contract eligibility, signature gating, member exclusions, dedupe and all-time history remain unchanged. A profile-only row cannot trigger contract/welcome. Established baseline discovers a later ticket separately; first-baseline historical suppression remains intentional.
- CORE rules draft records source, scope, verification, pending release and post-rollout limitation.

## Verification And Release

- Synthetic unit and real Chromium DOM tests use fake identities and intercepted local HTML, never the authenticated production profile.
- Real production verification is read-only current-form inspection, not future-form creation/issuance E2E.
- No member/profile/ticket/contract/booking/memo write, send, manual queue, baseline reset, setting change or new automation.
- User explicitly approved runtime/rules deployment, scoped commit and push on 2026-11-02. Functions implementation is unchanged; CI/package metadata conservatively marks all codebases as affected, so all five were built locally but no unnecessary Functions deploy is planned.
- Final verification counts and detailed scope are recorded in `docs/reports/2026-11-02-studiomate-registration-revamp.html`.
- Remaining: after actual rollout, read-only inspect new form/dialog/export columns. New selectors/layout not evidenced by notice fail closed, not auto-guessed.

## Approved Release Preparation

- One-shot `scripts/release-studiomate-registration-rules.mjs` pins the previous rules source hash and exact two-line diff. It clones the current 63-file Hosting manifest/config, replaces only `/rules/index.html`, preserves the other 62 files, requires clean main equal to fresh origin/main, and records durable intent/receipt outside Git. Any prior/unknown release intent prevents replay.
- Read-only release plan confirmed baseline `sites/archive-pilates-core/versions/cef0f2c98ad849f0`; source SHA256 `ef23e94469059354284119481dd3cb6a0b723c9f9d28d4f5af9060d9ceca31a5`.
- Release guards add five synthetic checks; compatibility suite now 129 passed. Browser DOM/rules suite 12 passed again after approved text update. Existing unrelated mobile rules overflow remains 405px at 320/390 widths; added member-registration rule fits and does not increase it.
- Installed `com.archive.instructor-lesson-registration-queue` points to the runtime script and existing 120-second interval. No LaunchAgent or interval change/restart/manual queue is needed.
- Final release version, promotion, CI and runtime readback will be recorded after actual completion.
- Optional broad `test:core-operator-workflow` stopped at `validate:alimtalk-catalog` because the generated catalog predates unrelated app/private-chart source changes. The unchanged runtime base reproduces the same failure. No catalog regeneration was included in this scoped release. Direct CORE workflow/renewal/staff identity checks passed 48 tests. Required registration release/compatibility/retired-welcome gates passed; catalog drift remains an independent residual check, not a new member-send failure.
