# ARCHIVE PILATES OPS Mac Unlock

Local, owner-only, on-demand helper for an already logged-in Mac console session.
No daemon, timer, network listener, automatic login, FileVault change, TCC database
edit, member message, or integration into existing workers is installed.

## Build And Install

```sh
cd tools/mac-unlock
swift test --disable-xctest
swift build -c release
cd ../..
node scripts/install-mac-unlock.mjs --plan
node scripts/install-mac-unlock.mjs --install
```

The installer refuses to overwrite an existing trusted executable. It installs a
hardened-runtime ad-hoc-signed binary in the user's private Application Support
directory and a launcher at `~/.local/bin/archive-mac-unlock`. Only system
frameworks/libraries are used. No cloud deployment is involved.

## Commands

```sh
~/.local/bin/archive-mac-unlock status
~/.local/bin/archive-mac-unlock enroll
~/.local/bin/archive-mac-unlock check
~/.local/bin/archive-mac-unlock unlock
~/.local/bin/archive-mac-unlock arm
```

- `enroll`: once, while unlocked, through a hidden terminal prompt only. Never
  put a password in arguments, environment, scripts, configuration or chat. Saves
  only the dedicated generic-password item in the local login Keychain, with the
  calling executable as trusted application. Refuses an existing credential or
  state file instead of silently changing either.
- `check`: while unlocked, validates that this binary can read its dedicated
  item and the password's supported keyboard mapping, without printing it or
  sending any key. Keychain decrypt ACL identity is checked independently.
- `unlock`: if already unlocked, records that positive observation and skips all
  password access/input. Otherwise checks the current host, same owner UID,
  existing console login/session, one empty focused secure field, ABC keyboard
  layout, modifier state, and the system loginwindow executable/PID. Keyboard
  events are directed only to loginwindow, never posted globally.
- `status`: read-only sanitized state/permission/credential-ACL checks.
- `arm`: only while unlocked. Records a new positively observed console session
  or acknowledges manual recovery after a failed/uncertain attempt. Never call
  it to bypass a failed attempt while the machine is locked.

An exclusive private lock and synchronized pre-input state latch reserve a
single attempt per lock epoch. Crash, partial typing, field/focus/session change,
or unverified authentication consumes the attempt. No automatic retries occur.
Success requires a fresh same-host, same-user, same-session unlocked readback.
Restart/login/session switching requires a new unlocked observation; FileVault
preboot and initial login are not supported. Keychain unavailability fails closed.

The credential supports printable ASCII with the ABC keyboard layout. Unsupported
characters are rejected before any password event. A password change or binary
rebuild requires explicit credential/ACL maintenance; do not widen trust to all
applications or overwrite the binary to force access.

## Security Boundary

The user approved local Keychain storage for this tool. The tool exposes no
credential-export command, disables core dumps, suppresses Keychain prompts,
and uses bounded in-memory credentials. Memory copies in macOS/frameworks cannot
be guaranteed completely erased. File-based Keychain ACL APIs are deprecated but
still provided by macOS; failures never fall back to plaintext or broader trust.

This is not protection against a compromised logged-in user or administrator:
another process with that same user's authority can invoke the installed helper.
No public/remote endpoint or unattended worker is authorized by installation.
Use only for owner-authorized local work that genuinely requires an unlocked GUI.
Keep API/file work independent of screen unlocking whenever possible.

Installation and run receipts contain no credential. Preserve them for diagnosis;
never delete state to force another authentication attempt.
