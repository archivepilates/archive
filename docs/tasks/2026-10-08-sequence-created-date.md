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
- Firestore emulator: 215 passed, including creation date invariance and existing access/owner/images/tombstone regression.
- Production audit and apply: five active operator notes backfilled from actual document createTime; one deleted tombstone untouched. All other fields unchanged. Idempotent second apply changed zero documents.
- Code release `162bbae5d4cec1a5da4772bce6d79cb919b5bd47`: Firestore rules, archive-pilates-core Hosting and default-site /core/ compatibility deployed. Functions and indexes not deployed.
- Local and live full CORE responsive checks: 95/95 each. Exact source hashes match CORE studio, adapter and default-site compatibility studio. The in.archivepilates.com member site does not host /core/ and is not the compatibility target.
- Synthetic live Auth/Firestore: writing dates visible at 390/1440, creation metadata present and immutable after edits, distinct originals preserved, cross-device conflict recovery passed. Temporary test notes/images/Auth identity removed and browser closed.
- Results in `docs/reports/2026-10-08-sequence-created-date.html`; private preimages and reviewed five-ID plan remain outside Git under the automation recovery directory.
- CORE operating rules updated in the same change; no Notion update needed.

## Rollout

Deploy rules and Hosting before backfill. Existing open editors must save and reload to obtain the adapter that preserves creation metadata. No Functions, index or unrelated database changes.
