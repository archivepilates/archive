# CORE Favicon And Session Reset

User requested official-logo favicon and fresh login for every CORE account.

- Icons: existing official circular ARCHIVE PILATES bitmap, versioned relative PNG/ICO links for dedicated Hosting and /core fallback.
- Canonical authorization: existing staffs/{staffId}.uid, role, active and coreAuthAfter; no new member collection or mirror.
- Mutation: explicit six eligible CORE account IDs. Transactional cutoff before refresh-token revocation. Passwords, claims, employment and content preserved. Non-CORE accounts excluded.
- Reader rules: old owner/manager tokens rejected by requireStaff, sessionStaff, signedIn/isManager. Legacy operator email grants resolve canonical staff documents and cannot bypass cutoff. Instructor ownership/first-change gates preserved.
- Scope review: both real operator email-to-staff bindings and all six UID/claim mappings are verified before any mutation. Unrelated legacy managers retain their pre-existing access. Future manager identity changes require separate canonical mapping review; this is not a general arbitrary-account revocation service.
- Browser: unauthenticated access check signs out, transient errors do not. Already-open cached pages need refresh to load new client behavior; server authorization blocks old credentials independently.
- Verify: unit tests, isolated rules emulator, offline responsive integration, synthetic live old/fresh login checks, real six-account readback and live favicon paths/headers.
- Deploy: shared security consumers app/sync/social/alimtalk, Firestore rules, affected Hosting. Hosting-only firebase.json headers do not require private-chart Functions redeployment.
- CORE operating rules updated in same release. Member data, StudioMate, Alimtalk and sequence content must not be modified.

## Verified Result

- Implementation e1522f99 pushed to origin/main; GitHub Actions 38099080960 passed.
- Four affected Functions codebases deployed. Direct Cloud Functions readback confirms ACTIVE and updated timestamps for app, sync, social and Alimtalk; private-chart was not redeployed.
- Firestore rules and both CORE Hosting mounts deployed and live verified. Official favicon bytes, MIME types and no-cache headers match at the custom domain and web.app/core fallback.
- Real one-time action completed at cutoff 1791679817 (2026-10-11 09:50:17 KST): six approved CORE accounts, two operators and four instructors. All refresh tokens revoked and re-read. Only session cutoff/audit fields changed; claims, email, disabled state and other staff fields preserved. No password update call, member write or sequence write was made.
- Auth tests 174, related regressions 36, isolated Firestore tests 245, offline responsive auth combinations 108 and live responsive checks 95 passed. Synthetic live manager/instructor tests confirm old callable and Firestore access is blocked and fresh login with unchanged passwords works. Synthetic accounts/documents were deleted.
- An initial live synthetic probe overlapped the app deployment and returned the prior denial code; it was cleaned up and repeated successfully after deployment. The first operator command lacked its credential environment and exited before any network/mutation; the credential-scoped run above completed once. No failed production action remains.
- Existing real-user passwords were not used for login tests. Already-loaded cached screens require refresh; server authorization blocks stale credentials. Separate bearer links and unrelated non-CORE accounts are unchanged.
- Final operating-rule evidence and self-contained execution report are recorded in the follow-up documentation release. No additional session reset is required.
