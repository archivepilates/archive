# Sequence Studio Firestore Storage

## Promotion Contract

- Existing CORE Sequence Studio is promoted from browser-local records to an operator-owned, isolated canonical source.
- Canonical sources: `sequenceNotes/{noteId}` (metadata and JSON text) and `sequenceNoteImages/{noteId_sha256}` (immutable compressed JPEG). No mirror is introduced.
- Identity: random stable note ID, immutable Firebase Auth owner UID; image identity is the note ID plus SHA-256 of its data URL. Move IDs remain stable across reloads.
- Readers/writers: existing CORE manager/owner identities, restricted to their own UID. Same account across devices; no cross-account sharing.
- Duplicate rules: transaction compares revision; conflict never overwrites silently. Explicit file import creates copies. Browser-local migration uses deterministic UID plus legacy-ID hash and skips already imported notes. Legacy localStorage is never deleted.
- Images: browser resizes to at most 640px longest edge, JPEG binary at most 64KiB, image stored separately from note JSON. A transaction commits image references and assets together. Unchanged assets are not rewritten.
- Data retention: deletion preserves a tombstone and deletes that note's image documents. Old image variants remain until note deletion to avoid breaking concurrent readers. Removed/replaced variants are not automatically pruned during active editing.
- Cost: no periodic server jobs or new Functions. Client autosaves after 2.5s idle, with 15s dirty-only maximum interval; listeners exist only while editor is open. Recent 100 active notes are queried; images load only on explicit note open/export/pick. Payload/dataUrl indexes are disabled.
- Forbidden downstream actions: member messaging, StudioMate writes, reservations, payments/refunds, Contacts, Notion, settlement, and automated teaching decisions must not select targets from these collections.
- Failure policy: save success requires committed transaction; offline state is not success. Unsaved navigation warns; JSON export is the recovery path, not a second cloud source.
- Verification: emulator rules test with synthetic users; adapter unit tests; isolated Auth browser workflows including distinct contexts, version conflicts, image limits, JSON/PDF, and responsive widths. No production member records used.
- Deployment: explicit Firestore rules/indexes and `hosting:archive-pilates-core`, from canonical committed main using archive-codex-operator service account. Do not deploy other Functions or Hosting sites.

## Limits

The browser list and its export cover the most recently updated 100 active notes. Firestore retains older notes, but this first version has no older-page browser. Shared staff libraries and Google Drive backup are outside scope. Firestore is not intended for full-resolution media; originals are not retained by this tool.

Reference: Firebase Firestore document size and transaction limits: https://firebase.google.com/docs/firestore/quotas and https://firebase.google.com/docs/firestore/manage-data/transactions.
