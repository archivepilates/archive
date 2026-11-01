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
- Current state: 18 guard tests pass; final build/install/enrollment/live
  readback pending. No claim of installed operation yet.
- CORE rules: no member/staff workflow or existing automation is changed. This
  local owner-tool rule and operating instructions are in the included README;
  no unrelated CORE web release is authorized or needed for the local install.
- GitHub: no push or cloud deployment requested for this local-only tool.
