# ARCHIVE CORE Staff Employment Sync

## Scope

- Canonical source: unfiltered StudioMate studio 5330 staff tab, complete roster only.
- Canonical destination: `staffs/{studiomateStaffId}` employment metadata; CORE is the display consumer.
- Identity: existing canonical staff ID resolved by unique exact phone and name, or rendered staff detail URL for a new identity. Ambiguity blocks the whole batch.
- Missing staff become `employmentStatus=inactive`, not deleted. History remains intact.
- Authentication fields `active`, `role`, `uid`, contact details and parking settings of existing staff are never changed. New staff are created without login access (`active=false`, no UID).
- Employment metadata is not a source for Alimtalk exclusions, contacts, payroll, reservations, or authentication. Existing policies remain unchanged.
- No workLanes/member360 mirror is used for production selection. This is a narrow patch to the existing staff sync lane.

## Daily Operation

- Existing Mac mini Excel runner invokes staff refresh with `--if-due` after download/import work.
- A successful full scan defers further scans for 24 hours. Legacy scoped scans do not establish this baseline.
- Shared StudioMate browser lock serializes browser access; context closure and release are in finally blocks.
- Empty, filtered, stale, paginated-incomplete, duplicate, ambiguous or unusually diminished rosters fail before the atomic batch.
- Staff refresh failure remains an actionable automation warning and preserves existing employment metadata. Successful member/reservation imports retain their freshness evidence.
- Current roster fits one page. If staff count exceeds the displayed page, automation stops for review rather than interpreting hidden pages as departures.

## Validation And Release

- Source evidence: 2026-10-07 unfiltered StudioMate roster 5, legacy CORE current 7. Kim Minji and Kim Ayoung are absent from the full source roster.
- Ignored local source artifact: `artifacts/staff-employment-source.json`; contains private operational identifiers and must not be committed.
- Dry-run evidence: `~/ArchiveIN/automation/reports/studiomate-staff-scan/2026-10-07T05-12-01-281Z-staff-employment-dry-run.json` (5 current, 7 inactive, custom operator preserved).
- Tests: employment snapshot/planning, identity grouping, CORE workflows, source freshness and rollback guards.
- Release: scoped feature commit, main fast-forward/push as required by release guard, runtime fast-forward, CORE Hosting only. No Functions or Firestore security rule deployment.
- Live acceptance: Firestore full-roster comparison, unchanged auth/contact fields, daily gate, CORE current/non-working display, asset and release identity verification, GitHub CI.
- First unattended full browser scan remains a next-day operational verification item; the manual source validation and snapshot apply do not claim that it has already executed.
