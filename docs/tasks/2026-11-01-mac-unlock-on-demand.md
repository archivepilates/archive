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
- GitHub: no push or cloud deployment requested for this local-only tool.

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
- Status: global local instructions active now; CORE web notice is prepared in
  source, not published. A scoped Hosting release is separate and was not part
  of this local common-instruction request. Do not call the live CORE page updated.
