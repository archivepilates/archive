# Member inquiry intake: promotion review and release boundary

Status: approved and deployed on 2026-11-10. The operator approved all current same-studio staff read access, 90-day retention, deployment and help.archivepilates.com domain transition. Default-site production intake and CORE review are verified; custom-domain TLS is pending.

## Authority and source

- Lane: workLanes/member-inquiry-intake; lane-specific branch codex/mini/member-inquiry-intake and managed worktree /Users/archivepilates/.codex/worktrees/member-inquiry-intake/archive-in-runtime. No production lane metadata or member record has been written during implementation.
- Approved requirement: six category cards, objective choices, optional 200-character details, real intake storage, staff review and manager approval. User confirmed fixed reservations cannot be canceled or changed.
- Canonical proposed collection memberInquiryRequests stores member-stated intent, assignments, reviews, approvals and completion evidence only. It is never a native identity/ticket/booking ledger or an external-action target source.
- Nested memberInquiryEvents is append-only audit history; nested memberInquiryCommands is transaction idempotency evidence. memberInquiryRateLimits is a bounded-abuse counter with no raw IP. These names and ownership are defined in firebase/packages/contracts/src/member-inquiries.ts.
- Owner: functions-app. No member360 mirror, workLanes or imported fallback booking selects an external change. There is no automatic member-facing send, reservation decision, ticket change, payment, refund, contact or memo write in this feature.

## Identity, duplicates and access

- Public input: name/normalized 010 phone are unverified claims. They do not resolve or display the member directory. Public response is an opaque receipt; random browser key lookup returns only receipt existence.
- Submission identity: SHA-256-derived receipt ID from a random 192-bit browser request key; payload hash binds the exact submission. Replays return the original receipt; changed payload conflicts. The browser keeps a pending key, not PII, in sessionStorage and freezes unknown-outcome retries to the original payload.
- Staff: requireStaff() still performs current server-side account, employment and session checks. All currently authenticated active owner/manager/instructor staff may read same-studio inquiries; inactive, viewer, wrong-studio and stale/invalid sessions remain denied. No staff flags are granted. Non-managers must claim an unassigned inquiry before review and may mutate only their assigned inquiries; managers may assign and approve.
- Managers: existing owner/manager roles within studio5330 may assign eligible staff and decide current submitted plans. Manager list is studio scoped. All direct client Firestore inquiry reads and writes are denied, including the audit and command subcollections.
- Default category assignees are an explicit settings map; an invalid, inactive, unauthorized or wrong-studio assignee blocks intake rather than silently assigning someone else. Without a default, all staff see the unassigned queue and may claim an inquiry. No default staff member is invented.
- Review changes invalidate approval. Manager decisions bind revision, canonical sorted-content hash and policy version in an atomic transaction with an audit event and command claim. Approval scope is inquiry_plan_only and externalExecutionAuthorized remains false.
- Manual completion requires current approval and recorded verification evidence; it does not assert provider delivery or native mutation by this feature.

## Approved privacy and retention

- Submitted name, phone, choices, optional note, reply preference and workflow history: 90 days from intake, approved by the operator on 2026-11-10 using help/privacy.html.
- Server excludes expired records at the expiration time. Four feature-specific expiresAt TTL configurations cover requests, events, commands and rate limits; generic events/commands collection groups are not changed. TTL deletion is asynchronous and parent expiry does not delete subcollections, so each dedicated group is configured separately. Reference: https://firebase.google.com/docs/firestore/ttl and https://firebase.google.com/docs/reference/firestore/indexes .
- No diagnosis/file uploads. No marketing consent or automatic notification. Browser pending-key storage contains no name, phone or request body.
- No runtime activation until settings/memberInquiryIntake has enabled, promotionApproved, privacyApproved and retentionReady=true with exact studio, policy, privacy and retention versions. These flags require actual release/TTL/index/auth verification, not merely a successful local test.

## Release targets and preserved scope

- Existing Firebase project archive-pilates. Proposed isolated Hosting site archive-pilates-help serves help/ only and rewrites /api/inquiries to memberInquiryApi in asia-northeast3. Existing five Hosting site definitions remain unchanged.
- CORE /inquiries/ uses existing authentication and callable memberInquiryStaff. CORE common navigation gains a link; instructor-wide access is not granted by displaying a menu.
- Source CORE rules record #member-inquiry-intake has implementation/testing/pending release boundaries. Live CORE and Notion were not edited.
- help.archivepilates.com currently resolves to A121.254.178.238, TTL86400; it is not considered unused. HTTPS fetch did not establish a usable current page. Confirm reuse and actual DNS owner/settings before any record change. No domain was purchased or changed.
- Root Hosting/manifest/shared contracts/prepare guard changes affect all five codebases under the existing detector. All five built locally; do not manually override affected detection or legacy release guards. The inquiry functions themselves belong only to functions-app.
- Canonical shared contract generates a self-contained Functions source copy and browser JSON; prepare checks freshness. Runtime bundles never depend on a sibling contracts directory outside the uploaded Functions root.

## Historical local verification evidence and release criteria

- Local suite: 82 tests; no real recipient/identity/provider/Firestore writes. Atomic fake database tests include stage failures and rollback, map-key reordering, stale approval, assignment isolation, 101-item pagination and receipt recovery.
- Browser: actual member UI -> real service business logic with atomic memory DB -> staff plan submission -> manager approval -> independent ledger read. One synthetic request at revision3 and exactly three events; memberNotificationStatus=not_sent_by_system and externalExecutionAuthorized=false.
- Responsive screenshots: home/detail/member/staff/manager at 320/390/768/1366px, no horizontal overflow; visible choice targets >=44px and error-free final browser consoles.
- Build, boundary validation, CORE Hosting regression guard, contract/schema freshness and diff checks passed. Existing catalog fingerprints were regenerated solely for the changed CORE navigation file; template content did not change.
- Actual Firebase authentication, real Firestore rule/index/TTL behavior, custom domain TLS and live delivery are not claimed verified. Node25.9.0 used locally; Functions deployment runtime remains Node22. No commit, push, deployment, production config write, access grant, scheduler or member send was performed.
- Before release: verify dedicated site availability, promote source/data policy, deploy scoped reviewed source under current release guards, verify TTL/index activation and real account role boundaries, enable intake last, run one explicitly approved synthetic production smoke case and independently read it back.

## Approved release readback 2026-11-10

- The earlier no-write/no-deployment statements describe the implementation phase. Approved release promoted source and data policy, recorded workLanes/member-inquiry-intake, created settings/memberInquiryIntake and enabled canonical intake after authentication, rules, TTL/index and endpoint checks. No member-facing external action uses the work lane.
- Canonical memberInquiryRequests and dedicated audit/command/limit groups are now deployed. Four TTL configurations are ACTIVE and list index READY. A real public UI synthetic request was read independently: one request, revision5, received/claim/review/approve/complete events5, commands4, exact90day expiry, approval hash matches, externalExecutionAuthorized=false, not_sent_by_system.
- Actual existing CORE operator authentication and manager decisions passed. Current-staff same-studio reading and assigned-only mutation were tested in the server suite and synthetic staff UI; separate live instructor logins were not performed. No staff flags or credentials were changed.
- Node22.23.4 passed all88 inquiry tests and five builds. Navigation tests8, MCP callable coverage and GitHub CORE MCP/affected checks passed. All110 Functions ACTIVE; CORE and isolated help Hosting verified on normal HTTPS. No scheduler or member message was created.
- Cloudflare home@archivepilates.com official profile saved exact DNS-only help CNAME and ACME TXT. Authoritative/public DNS verifies archive-pilates-help.web.app. The old A was not an exact help record; wildcard and other records were preserved. Firebase custom-domain certificate is still pending and normal help HTTPS is not yet verified. The usable site is https://archive-pilates-help.web.app/; CORE is https://core.archivepilates.com/inquiries/.
- Current execution evidence and limitations: docs/reports/2026-11-10-member-inquiry-release.html and private operations/2026-11-10-member-inquiry-release. CORE operating rule is updated to deployed/domain-pending. No Notion update was needed.
