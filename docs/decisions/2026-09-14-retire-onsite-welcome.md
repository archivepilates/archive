# Retire Onsite Welcome Intake

Owner: ARCHIVE PILATES. Date: 2026-09-14.

The operator requested removal of the duplicate ARCHIVE IN signup system and replacement
of the CORE menu with StudioMate member registration. This decision retires new intake
and sending only; it does not delete signed agreements, existing contract links or PDFs.

## Implementation

- CORE quick action, navigation and command palette open
  `https://arcpilates.studiomate.kr/users/create` in a new tab. The URL was verified through
  the live StudioMate member-add button without creating a member.
- `/onsiteWelcome/` becomes a no-form retirement notice and direct registration link.
  No request IDs, tokens or phone data are forwarded to StudioMate.
- Every `onsiteWelcomeRequest` POST returns 410 before accessing Firestore; authenticated
  historical GET remains. The API always reports `canSendAlimtalk: false`.
- The old Alimtalk sender module is removed. Shared send-time eligibility denies all
  `onsite_welcome` candidates before template queries or test-recipient exceptions.
- The local worker becomes a dependency-free no-op. Its LaunchAgent is booted out and
  moved outside the active LaunchAgents directory after preserving the plist backup.
- Health monitoring no longer expects/restarts that worker or auto-retries its queue.
  Release guards require the retirement behavior, not the removed signup UI.

## Data Boundary

Read-only preflight found 68 requests (7 sent, 29 cancelled, 20 ready/lookup-ready,
12 errors), no pending/running requests and no queued/processing sends. There were
12 member contracts, including 5 submitted contracts. These are historical records,
not evidence that the new native contract automation is complete.

`scripts/retire-onsite-welcome-requests.mjs` defaults to read-only. Apply requires the
live API retirement response and removal of the active plist. Only requests without
send/candidate evidence are marked cancelled/resolved with retirement metadata. No
memberSignupContracts, source member profiles, payments, passes, reservations, short
links, signed PDFs or instructor eformsign documents are changed. Concurrent state
changes abort the transaction. Audit output is local outside the repo.

## Verification And Release

- Focused retirement tests cover POST no-side-effects, authorized historical GET,
  test/queue send denial, worker no-op and safe request closure.
- Run Functions build, boundary/data-source policy, CORE hosting and rollback guards,
  system-health queue tests and responsive UI checks.
- Promote the scoped commit to origin/main; deploy from clean local main only.
- Deploy changed Hosting surfaces and affected Functions. Verify live retirement markers,
  POST 410, CORE link replacement and preservation of historical contract/PDF routes.
- Reconcile the 32 eligible old requests only after API shutdown and worker removal.

## Explicitly Not Included

Native StudioMate contract automation remains in its separate uncommitted worktree.
It still needs center-author signature and native issuance/payment/signature-history
verification. Staff manually register member, ticket and contract in StudioMate until
that workflow is verified and separately activated. Instructor lesson eformsign and
existing signup-submission follow-up workers remain active. No SOLAPI template is deleted.
