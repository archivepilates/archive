# Sequence Library Creation Date

## Scope And Approval

User requested creation dates in My Sequences and approved real Firestore creation-time backfill, validation, scoped deployment, commit and push. Preserve all note payloads, revisions, update timestamps and tombstones. No member operations.

## Implementation

- `sequenceNotes.createdAt` is canonical immutable server metadata, outside answer payloads.
- New saves record server time; edits preserve it. Legacy missing dates stay absent until reviewed admin backfill.
- Display Asia/Seoul dates, label normal records 작성일 and recovered records 복구일; class dates are explicitly 수업일.
- Firestore rules preserve legacy compatibility while forbidding forged creation dates and date removal/change.
- Backfill requires explicit owner and project/account guard, private preimage backup, transaction conflict checks and exact unchanged-field readback.
- First cloud-save time is not proof of earlier browser-local authoring time. Recovery creation time is not the original authoring date.

## Verification

- Local sequence suite: 20 passed across 320/390/768/1440, KST day boundary and legacy absence.
- Firestore emulator: date invariance plus existing access/owner/images/tombstone regression; final result in HTML report.
- Production read-only audit: five active operator notes missing createdAt, one deleted tombstone excluded. No backfill yet at source preparation.
- Deployment, backfill, synthetic live Auth/Firestore test and cleanup results will be recorded in `docs/reports/2026-10-08-sequence-created-date.html`.
- CORE operating rules updated in the same change; no Notion update needed.

## Rollout

Deploy rules and Hosting before backfill. Existing open editors must save and reload to obtain the adapter that preserves creation metadata. No Functions, index or unrelated database changes.
