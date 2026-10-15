# Holding Native Identity Link

## Approved Scope

Human approved validation, Mac mini runtime adoption, CORE operating-rule Hosting deployment, commit, main promotion and push. No immediate Alimtalk send, manual queue run, StudioMate write, hold/ticket mutation, baseline reset or change to automatic activation is authorized by this release.

## Implementation

- Preserve original `memberProfiles/excel_...` documents and all existing references. Do not clone a native member profile or rename an Excel document.
- Prefer an existing `memberProfiles/{nativeId}` document. An invalid native record cannot be bypassed with an Excel fallback.
- Discovery may use `studiomateMemberId` only with an existing resolution timestamp. Discovery still produces read-only hints, never message authority.
- Before native readback and inside the dispatch claim transaction, resolve the profile from canonical `memberProfiles` only. Require one matching linked profile, exact document ID, studio, name and normalized phone, matching completed `studiomateMemberIdLookupJobs` receipt and resolution timestamp, and exactly one same-phone profile. Reject merged, disabled or conflicting links.
- Preserve exclusion fields when adapting the verified profile's member ID in memory. No synthetic profile is persisted. No member360 or provisional workLane authorizes a member-facing action.
- Keep native studio/member/issuance/creation-evidence dedupe keys unchanged. Cancellation, early release, overage, historical/48-hour guards, provider reconciliation, staff exclusion and current-hold controls remain mandatory.
- Update the active and legacy readback entrypoints as well as the shared guarded dispatcher; the old cached-history queue remains inactive.

## Verification

- Pure fixture tests cover resolved links, proof revocation, duplicate phone/ID links, invalid native records, preserved exclusions, stable event keys, atomic reads and single mock POST.
- Existing Node and TypeScript holding suites cover original issuance allowance, inclusive day union, cancellation, provider ambiguity and duplicate/concurrent dispatch.
- Read-only production preflight resolves the approved member's existing profile through the new helper and a read-only transaction. It checks settings, baseline and candidate/send/claim evidence without creating a candidate or running a queue.
- CORE responsive QA covers 320/390/768/1440/1920px. Hosting is limited to `archive-pilates` and `archive-pilates-core`; no Functions or Firestore rules/indexes are changed.
- Runtime is fast-forwarded only while the existing hourly LaunchAgent is idle. No kickstart or manual automatic worker invocation is used.

## Limits And Rollback

Future holds may not appear in the regular Excel roster before their start. A linked member is not proof of discovery or delivery. The saved current hold and complete native source must still be observable; a registration first discovered beyond 48 hours is review-only. This release does not claim a natural automated delivery from fixture tests or previous manual tests.

Rollback is source reversion through a reviewed release, preserving all original profiles, lookup receipts, baseline and send/claim records. No destructive data migration is required. The approved ID link is compatible with the old runtime and is not removed on rollback.

Release evidence: `docs/reports/2026-10-15-holding-native-identity-link.html`.

## Pre-release Results

Node holding suites: 553 passed. TypeScript holding suites: 236 passed. Staff exclusion and Alimtalk policy suites: 36 passed. Price regression: 5 passed. Local responsive QA: 95 passed at 320/390/768/1440/1920px. No skipped tests. Independent production-code review found no actionable issue.

Live identity resolution passed both direct read and read-only transaction. Original member fields and document ID were preserved, no native profile clone exists, and that member's holding event/candidate/send/claim counts were all zero. The future hold was not yet present in the latest hourly roster; no natural delivery is claimed. Canonical data-source, catalog, rollback and Hosting guards passed. Functions affected detection returned no codebases.
