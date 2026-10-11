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

Implemented and locally verified; scoped deployment authorized and in progress. CORE operating-rule source retains pending state until live verification. No real instructor password was reset for tests. Keep member tokens and sends unchanged.

Runtime source consumers are app and private-chart only. The package test entries and shared affected-codebase tool change may conservatively flag every codebase; inspect runtime impact rather than blindly deploying all Functions. Generated build folders are local ignored outputs, not changes to commit.
