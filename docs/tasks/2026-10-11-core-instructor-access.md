# ARCHIVE CORE Instructor Access

## Approved Scope

- User approved instructor accounts for the current StudioMate staff roster, initial password `111111`, and a mandatory first-login password change. The user explicitly chose no additional activation code.
- Keep existing owner/manager accounts unchanged. Instructor menus: home, private, sequence notes.
- StudioMate `staffs` employment metadata is canonical for instructor eligibility; neither member360 nor name-only matching grants access.
- First-login sessions may change their password only. No member data or sequence access until password change and fresh login.
- Current shared initial password cannot establish phone ownership; document this residual risk without silently adding another factor.

## Implementation Plan

- Worktree: `~/codex-worktrees/core-instructor-access-20261011`; branch: `codex/mini/core-instructor-access-20261011`.
- Main owns account provisioning, backend/auth policy, Firestore rules, integration, release and operating rules.
- Bounded agents investigate access boundaries and implement isolated UI files. No agent performs production writes.
- Instructor workspace uses server-side canonical staff identity, returns only own lesson/private data and no finance/communication ledgers.
- Sequence ownership remains per Firebase UID; existing notes are not reassigned.
- Runtime guard checks first-login status and current employment on every instructor API call. Rules independently check those fields; hiding menus is not authorization.
- Password update revokes old sessions and requires a fresh sign-in.

## Verification

- First-login, own vs other staff, inactive employment, stale session, manager preservation, private assignment, sequence ownership and denied direct/API access.
- Emulator tests plus responsive browser checks at 320, 390, 768 and 1440 pixels. Live synthetic account only; do not change a real instructor password for testing.
- Scoped commit, main promotion, required Functions/rules/CORE Hosting, live verification and push. Provision only eligible real instructors after security checks pass.
- No SOLAPI sends, StudioMate writes, contact/payroll/parking changes or real-member test mutations.

## Status

- Read-only audit: current roster contains four instructors plus the owner; legacy non-working accounts still exist. Existing instructor credentials require deliberate provisioning, not duplicate Auth users.
- Implemented password-change-only session, fresh-login cutoff, canonical own-booking workspace, per-UID sequence access, and three-menu instructor UI. Owner session is normalized to the manager UI without changing stored roles.
- Pure policy and mocked handler regressions: 162/162 passed, including concurrent changes, failed Auth/revoke/final-save recovery, malformed identities, exact chart request capability binding, and published vs delivered distinction.
- Firestore emulator: 235/235 passed; CORE/operator/deploy-safety regressions: 56/56 passed; original responsive UI: 95 combinations passed. Typecheck, all physical codebase builds, boundary and rollback validators passed.
- Current source request window counts: 84/89/48/0 across the four current instructors; all available request links match their document IDs and remain below the 200-request guard.
- Provisioning dry run validated four current canonical identities; three existing Auth UIDs will be preserved, one will be created. Password is supplied through the process environment, not a stored credential file.
- Full-app offline UI: 92/92 passed across root and /core/ at 320/390/768/1440px; mobile first-change and desktop private screens visually inspected. All test browser contexts, fixture API and server closed.
- CI sidecar: system hardening 62/62, contact staff precedence 16/16, private flow 87/87 and rollback semantics 60/60 passed. Source-policy, cost, private-flow, instructor-registration and release guards passed.
- Isolated production first-change test and real instructor provisioning remain pending. No production account mutation or deployment yet.
- Shared auth guard is consumed by app, sync, alimtalk and social exports. Private-chart bearer authentication is unaffected; the manifest/detector changes conservatively report all codebases but do not change private-chart runtime behavior.
