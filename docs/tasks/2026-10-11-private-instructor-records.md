# Instructor Private Records And Reports

## Scope

- Branch: `codex/mini/private-instructor-records-20261011`, base `ed30ac53630b9b206d639e316328694ff5031deb`.
- Instructor: authenticated canonical staff/studio only; month history, record/report filters and owned review links.
- Owner/manager: existing combined private board and source reads unchanged.
- User approved the scoped deployment set after local implementation. No member-data mutations, Alimtalk sends, real password changes, Firestore migration or reservation changes.

## Implementation

- Workspace request accepts only a validated month, never a client-selected instructor. Home retains the existing rolling window.
- Canonical booking/request document IDs, private lesson type and staff/studio/member/date must agree. Superseded/excluded/stale sources cannot supply private tasks.
- A record must agree with its request on record/request IDs, booking, member, staff, studio and date. A mismatched record never supplies status, answers or a link.
- Report review uses the validated owned chart URL with `focus=report`; no arbitrary public/short report URL is forwarded.
- Chart link authorization rechecks current source identity without performing booking repair or cancellation writes. Changed ownership/schedule requires operator reconciliation.
- Previous report display only uses same-staff/same-studio records validated against their own request. Member report capability links retain their separate access contract with stronger record/request binding.
- Existing CORE session gates and manager-only raw private Firestore rules remain unchanged. Old bearer URLs are not made session-bound and are not revoked by CORE logout.
- Shared ownership helper maps to both app and private-chart deployment codebases, preventing a future partial release.

## Verification

- Instructor ownership/callable and chart/report access tests: 221 passed, including semi-private and legacy private classification compatibility.
- Affected codebase tests: 3 passed.
- Private flow regressions: 87 passed.
- Operator/renewal/staff regressions: 40 passed; report-delivery/lesson-roster regressions: 26 passed.
- Offline full-app UI: 124 synthetic scenarios; 320/390/768/1440px, root and /core/ paths. Filters, month reload, refresh, login identity, logout, password gate, manager access and absence of instructor broad reads checked. Screenshots visually reviewed at 320/1440px.
- TypeScript noEmit, JavaScript syntax, full Functions codebase build, 94-export boundary validation and catalog source-fingerprint validation passed.
- Read-only archive-codex-operator / archive-pilates sample: 30 recent records, 30 matching requests, 30 matching bookings, 0 missing sources, 0 identity mismatches. This is a sample, not a full historical audit or deployed authorization proof.
- Test-owned browser contexts 124 opened/closed, browser/server closed, synthetic fixtures 0 remaining.
- Fixed the pre-existing catalog fixture's outdated bootstrap assumption without changing the application bootstrap. The fixture removes only the unique final live bootstrap, serves current static module dependencies and retains external-network/write blocking. Full `test:core-operator-workflow`: 53 + 26 passed, including instrumentation fail-closed tests.

## State / Next

Implemented, promoted to origin/main and deployed. Runtime source f1b28a0bd7d34983c68db0f966da9a8e7dfb19d7; HMAC fixture follow-up 8d094568a0631a8be6f351a913819e6944eaccf9. No real instructor password was reset for tests. Member tokens and sends are unchanged.

Runtime source consumers are app and private-chart only. The package test entries and shared affected-codebase tool change may conservatively flag every codebase; inspect runtime impact rather than blindly deploying all Functions. Generated build folders are local ignored outputs, not changes to commit.

## Deployment / Live Evidence

- Clean main checkout: /Users/archivepilates/codex-worktrees/system-hardening-20260914; archive-in-runtime fast-forward aligned with origin/main.
- Project archive-pilates, archive-codex-operator service account; root firebase.json. Only getCoreInstructorWorkspace, privateLessonChartApi and privateLessonReportView updated. No Firestore rules/indexes, other Functions, StudioMate writes or sends.
- All three Functions ACTIVE: getcoreinstructorworkspace-00004-rir (2026-10-11T06:23:49.640984227Z), privatelessonchartapi-00120-bas (06:26:29.284573912Z), privatelessonreportview-00102-dup (06:26:32.558081303Z).
- Hosting archive-pilates-core and the existing /core/ mirror on archive-pilates deployed. CORE-only release manifest; both custom-domain and web.app canary passed at 8d094568.
- Both live instructor JS/CSS assets exactly matched Git source. JS SHA256 b10d15417f6e3d236da09d12eed9d3a6f1e94d6956df16bfb47eed29a15ce04b; CSS 1f1d7b43aa2f812b46f8864e8bc41d2d8ae9c78ae02175a2aafa0fe2b12915da.
- Workspace without authentication: HTTP 401 UNAUTHENTICATED. Existing canonical chart GET: HTTP 200 and correct request/date; wrong chart token HTTP 400; wrong report token HTTP 403. Request/record/booking updateTime unchanged after read-only probes. No daily-chart GET or successful legacy report GET that could create a snapshot was executed; positive member report rendering remains locally tested, not live-proven in this run.
- Live anonymous/static/synthetic-DOM responsive QA: 95 combinations at 320/390/768/1440/1920, no assertion failures, contexts/browser closed. Console/network error totals are not collected by that legacy script. Evidence screenshots: /tmp/private-records-live-responsive-20261011.
- Additional isolated full-app UI run: 124/124, zero page errors/external requests/SDK writes; contexts 124/124 closed, browser/server closed, zero fixtures. Secret-binding regression fixture corrected to use actual ownership helper and complete identity: 42/42 passed.
- GitHub Actions ARCHIVE IN Functions Affected Check for 8d094568: success, run 38117805327.
- Current four real instructors all require first password change. No real authenticated instructor/operator data session was opened or altered; successful own-history UI and denial matrix were verified with synthetic fixtures. Follow-up is first password change and normal fresh login by each instructor, not an automated password reset.
- CORE rule final state explicitly separates implemented/deployed/live read-only verification from the pending real-user login check. Documentation-only follow-up requires Hosting for the operating rule, not another Functions deploy.
