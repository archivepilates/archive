# Mac Unlock On Demand

- Scope: owner-requested local Mac mini tool; no changes to CORE Hosting,
  Firebase, StudioMate/member pipelines, schedules, login policy or remote access.
- Approval: user requested a reusable unlock tool after a successful one-time
  keyboard-input verification and explicitly selected a dedicated local macOS
  Keychain item for credential storage. No password is recorded in this file.
- Worktree: `/Users/archivepilates/codex-worktrees/mac-unlock-on-demand-20261101`.
- Branch: `codex/mini/mac-unlock-on-demand-20261101`, based on runtime origin/main.
- App-managed creation against the historical Documents repository failed with
  an object mmap error. A separate normal Git worktree was created from the
  active runtime clone instead; unrelated historical/runtime changes preserved.
- Ownership: `tools/mac-unlock/**`, `scripts/install-mac-unlock.mjs`, this task.
- Canonical credential: dedicated file-based local login Keychain item, not
  Firestore, cloud Secret Manager, a source file, or an environment variable.
- Canonical safety receipt: private local state and operation lock, never a CRM
  mirror or a source for member-facing operations.
- Guards: own existing console user/session, host binding, lock-epoch identity,
  exclusive file lock, durable intent before typing, one attempt, narrow system
  process target, focused empty secure field, ABC layout, no active modifiers,
  post-authentication same-session readback, and fail-closed Keychain access.
- Verification: Swift guard tests, hardened binary signature/dependency review,
  dedicated Keychain ACL/read check, already-unlocked no-op, then live locked
  invocation. No wrong-password tests or repeated authentication attempts.
- Verified installation: `~/.local/bin/archive-mac-unlock` resolves to the
  private signed binary. Source commit `97eb8844`; binary SHA-256
  `aa3a4d59cc84492cb4e5698b449265b7678ab4e38e2230cc1112b80e66b5260e`.
- Enrollment completed through hidden TTY into the dedicated local Keychain item.
  Sensitive-operation ACL identity audit and trusted-binary read passed. An
  independent Swift reader was denied (`errSecAuthFailed`); no credential output.
- Final release build, 18 Swift Testing tests, Node installer syntax, signature,
  system-only library dependencies, private permissions and exclusive-lock
  contention checks passed. Initial XCTest-based invocation was unavailable in
  the installed Command Line Tools; tests were migrated to provided Swift Testing.
- Live verification: positively observed locked console; installed binary
  retrieved the Keychain item and submitted once; same-session unlocked readback
  succeeded about 0.79 seconds after submission. Independent status confirmed
  unlocked. A second unlock invocation returned `already_unlocked` without input.
- Final state: installed and usable on demand. No resident process, scheduler,
  network listener, plaintext credential file or test browser session remains.
- File-based Keychain API deprecation warnings are documented; they are not
  suppressed by disabling any system security setting.
- CORE rules: no member/staff workflow or existing automation is changed. This
  local owner-tool rule and operating instructions are in the included README;
  no unrelated CORE web release is authorized or needed for the local install.
- At the initial local-tool stage, no push or cloud deployment was requested.
  The subsequent explicit CORE release approval includes scoped source promotion,
  Hosting publication, live verification and GitHub push under the standard rule.

## Common-Rule Adoption

- Subsequent user request: use this installed helper whenever an authorized GUI
  task is blocked by ordinary screen lock; record it as a cross-project rule.
- Applied immediately to `/Users/archivepilates/.codex/AGENTS.md` and
  `/Users/archivepilates/dev/AGENTS.md`; original files backed up under
  `/Users/archivepilates/project-backups/mac-unlock-common-rule-20261101`.
- Matching project `AGENTS.md` and CORE rules HTML source updated in this lane.
  CORE MCP discovery confirmed no supported generic operating-rule save action.
  No endpoint was invented and no direct database rule mutation was substituted.
- Procedure: status, one guarded unlock only when ready, independent status
  verification, continue only the originally authorized task. Password export,
  fallback injection, retries/reset, new permissions and background unlocks stay
  forbidden. First login/FileVault preboot/user switching remain operator-only.
- Three rule tests, exact before/after text-preservation comparisons and
  whitespace checks passed. No executable, credential, worker or business data
  was changed. No browser was opened for these text-only source changes.
- At the common-instruction stage, global local instructions were active while
  the CORE web notice was prepared but not published. The later explicit release
  request below authorizes and completes that previously separate publication.

## CORE Rules Release

- User explicitly requested deployment to CORE operating rules. Target only
  `archive-pilates-core` Hosting `/rules/index.html`; service account
  `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`.
- Source `506c653445f26f56359d22bdcd65975083fee6fa` was reviewed and promoted
  fast-forward to clean local main before release. No unrelated commits mixed in.
- Scope guard pins the prior HTML and exact added section. A fresh live version,
  shared site deployment lock and durable write intents protect against drift,
  concurrent releases and replay of uncertain operations.
- Baseline version `f4af03d66d447274`; published version `b54c0046d841ff02`;
  release `1793544111878000`. Independently verified at
  `2026-11-01T14:41:54.371Z` (2026-11-01 23:41 KST).
- Both custom CORE and Firebase-site rules URLs matched source SHA-256
  `cdb22d9d737f13f076354c3fc2511766562cc348fb8e1f36044ee278bf7f3e8b`.
- Hosting has 63 files; only rules HTML changed, all other 62 hashes and the
  Hosting configuration remained equal to the baseline. Functions affected: none.
- Eight common-rule/release tests passed. Isolated existing-CSS rendering at
  320/390/768/1440 passed text, overflow, clipping and overlap checks; live HTML
  verification is separate. No member data or authenticated user sessions used.
- Private release receipt:
  `/Users/archivepilates/ArchiveIN/operations/mac-unlock-rules-release-20261101/hosting-release.json`.
- No unlock executable, Keychain item, login setting, member communication,
  existing worker or official sales-site resource was changed by this release.
