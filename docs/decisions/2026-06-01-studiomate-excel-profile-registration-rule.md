# StudioMate Excel Profile Registration Rule

Decision date: 2026-06-01

## Decision

ARCHIVE IN creates temporary `excel_...` member profiles from StudioMate member Excel rows when the row has an active ticket. The member registration date is no longer used as a hard exclusion rule.

## Reason

StudioMate Excel is now the normal operating source and is refreshed regularly. A member can register or consult earlier, then buy a private trial ticket later. Excluding Excel-only profiles because `registeredAt` is older than 3 days can prevent canonical `memberProfiles` and `bookings` from being created, which then prevents private survey Alimtalk candidates.

## Current Rule

- Existing `memberProfiles` are still matched first by phone/name.
- Excel-only members require at least one active ticket before a temporary profile is created.
- Members without active tickets are not promoted into member profiles.
- Consultation-only contacts continue to be handled as contact records, not full member profiles.
- The old `--new-excel-profile-max-age-days` argument is treated as legacy metadata and does not block profile creation.

## Verification

Dry-run against the 2026-06-01 13:28 member Excel showed:

- `temporaryExcelProfiles: 1`
- `newProfileTooOld: 0`
- `plannedStudiomateMemberIdLookupJobs: 1`

This covers the 계지수 private trial case that was previously blocked by the 3-day registration-date limit.
