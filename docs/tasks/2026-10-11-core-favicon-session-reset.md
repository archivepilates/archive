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
