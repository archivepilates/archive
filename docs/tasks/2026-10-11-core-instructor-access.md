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

## Live Test Repair

- Initial manager test incorrectly required localId from custom-token sign-in. The API omits that field; verified ID-token UID/audience/claims remain mandatory instead. Added sanitized fixed-stage diagnostics.
- Live pending login and four-width first-change dialog passed. Password update returned INTERNAL because the default compute runtime lacks Firebase Auth user-update permission. Every synthetic account and browser was removed after each attempt; manager state remained unchanged.
- Use a dedicated archive-core-auth runtime for completeCoreFirstLogin only, with a custom project role containing firebaseauth.users.get/update, plus datastore.user and logging.logWriter. Do not grant Auth admin to the shared compute runtime or grant user creation/deletion/config/send privileges. No service-account key is created.
- Source f0886adc is deployed to app/sync/alimtalk/social, both CORE Hosting sites, Firestore rules and the READY request index. Main and feature CI both passed. Synthetic login, pending API denial and the four-width dialog passed; password update remains blocked by runtime Auth permission.
- Operator credentials cannot create IAM accounts/roles; HOME administrator credentials require reauthentication. Chrome tab 2059966952 is handed off for HOME sign-in. The waiting CLI was stopped without changing credentials; resume with a fresh OAuth authorization request, not a stale verification code. Never provision the real four instructors before the isolated live flow passes.

## Runtime Permission Repair

- HOME Cloud SDK reauthentication completed; the task-owned OAuth tab is closed. Credentials are not recorded in this repository.
- Created keyless archive-core-auth service account and coreInstructorPasswordUpdater custom role with only firebaseauth.users.get/update; project bindings are datastore.user and logging.logWriter plus that custom role. The operator has serviceAccountUser on this dedicated account only.
- App export selects this account only for completeCoreFirstLogin. Shared runtime identity and all other callables remain unchanged. Two AST contract tests prevent accidental shared-account expansion.
- Single-function source e237e8ea is promoted and pushed to main; completeCoreFirstLogin deployed ACTIVE with the dedicated archive-core-auth runtime. The shared compute runtime is unchanged. GitHub affected-functions check passed.

## Current Result (Supersedes Earlier Pending Status)

- Complete isolated live flow passed: initial password gate, UI first change exactly once, old password/token denial, fresh REST and browser login, own workspace, denied raw sensitive documents and queries, per-UID notes/images, tombstone protection, inactive employment and manager preservation. Synthetic Auth/staff/note/image records and all browser contexts were cleaned.
- Updated QA parsing for official Playwright encoded IndexedDB auth storage and Firestore streamed permission-denied responses. Exact origin/database/store/key/UID scoping and actual HTTP 403 remain mandatory. Regression tests: 20 storage cases and 12 REST denial cases passed. No tokens or storageState files are written to disk.
- Latest local checks: security/handler 162, runtime/release 24, QA parser 32 and responsive instructor UI 92 passed. Rules 235 passed in the prior source deployment and are unchanged in this repair.
- Provisioned only approved canonical current instructors 1983525, 2222464, 2849322 and 4817346. Preserved three existing Auth UIDs; created core_staff_4817346 only. Manager documents, roles, password/session metadata are unchanged.
- Read back all four enabled/must-change states and tested initial login plus getCoreAccessSession; getCoreInstructorWorkspace returned PERMISSION_DENIED before change for every instructor. No real instructor first-change was performed; instructors choose their new password themselves.
- No StudioMate writes, SOLAPI sends, contact/payroll/booking/member-data changes. Auth role has only users.get/update, datastore.user and logging.logWriter; no key created or shared runtime privilege expansion.
- CORE operating rules and HTML result are updated for the final paired Hosting release. Final release verification is performed after this scoped commit is promoted to clean main. Separate sequence-user-library changes remain uncommitted and unshipped; administrator combined sequence browsing is not part of this release.
