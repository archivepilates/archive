# CORE Login Name

- Request: display the authenticated user's name in the upper-right corner, including manager and instructor views.
- Canonical source: existing getCoreAccessSession.staffName returned from staffs. No extra Firestore reads, user lookup, phone/email fallback or persistent account cache.
- Scope: shared frontend access module and stylesheet; offline fixture QA. No password, role, account provisioning or backend authorization changes.
- Lifecycle: clear identity when auth disappears/changes, during access revalidation and on revoked-session sign-out. Repeated refresh creates one account bar only.
- Added request: logout button next to the manager name; retain instructor logout. Quarantine operational content immediately during sign-out, restore valid-session content with a retry only on failure. Sign-out does not delete saved sequence notes or change passwords/roles.
- Verification: offline synthetic manager/instructor fixtures across root and /core mounts, 320/390/768/1440px; name safety, refresh, logout, stale-session handling and layout checks.
- Approval: user approved validation, CORE Hosting release, scoped commit and GitHub push. Actual production login credentials are not used for these UI fixtures.
- Verification completed: 124/124 synthetic full-app integration scenarios across both mounts; canonical manager/instructor names, text escaping, no email/phone fallback, refresh uniqueness, auth-change/revoked clearing, logout success and failure retry. Browser/server/contexts closed by the harness. Screenshots at mobile/tablet/desktop reviewed; no overflow or overlap.
- Additional checks: 22/22 auth-storage/runtime-identity tests, 95 responsive route checks, Hosting guard, rollback guards, syntax and diff whitespace passed. Affected Functions codebases: none.
- Release scope: CORE Hosting on archive-pilates and archive-pilates-core in Firebase project archive-pilates, using archive-codex-operator. No Functions or Firestore rule deploy and no account/data mutation.
- Status: implementation and offline verification complete; Hosting release and live asset/canary verification pending. Actual member data and real-user sign-out are not exercised by the synthetic harness.
