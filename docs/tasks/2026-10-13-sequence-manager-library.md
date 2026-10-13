# Sequence Manager Library

Human approval: validate, deploy CORE Hosting and scoped Firestore rules/index, commit and push. No Auth/credential change or existing sequence mutation.

## Contract

- Canonical sources: sequenceNotes, sequenceNoteImages and existing server-verified CORE access.
- Managers list all live notes by default; own-only selector remains available. Each query is limited to 100 with cursor pagination.
- Ready instructors retain own UID queries only. Names never grant access.
- Foreign notes/images are read-only for managers; images require a live matching parent. No foreign save/delete/ownership changes or deleted-note reads.
- Preview/PDF of foreign sources must not open or replace the editor. Backup/import and previous-move pickers remain own-only.
- No data migration, send, StudioMate action, or new schedule.

## Verification

- Adapter scope/pagination/attachment/read-only/session tests: 5 passed; cross-realm persistence: 24 passed.
- Real Firestore rules emulator: 345 passed including instructors, stale sessions, parent-images, foreign writes and pagination.
- Actual UI/adapter with mock SDK: complete suite passed across 320/390/768/1440px, manager preview/PDF, 103-row pagination, saved-draft preservation, existing save/delete/recovery regressions. No production writes.
- Hosting/rollback guards passed. Alimtalk catalogue regeneration changes only app source fingerprint; catalogue entries and send rules unchanged.
- Independent review findings corrected: retain loaded pages on head changes, serialize scope/cursor transitions, explicitly hide exhausted pagination, preserve queued head after a read error with manual retry, and restore full startup readiness on first-read retry. Fault-injection browser checks passed at all four widths.
- Complete UI suite 30 passed plus initial-failure recovery case passed. Production deployment and readback completed.
- Only the first 100 notes are live-subscribed; opened deeper pages reread when the head changes. A deeper-only change with no head change needs a scope reload or browser refresh. No full-collection listener is added.

Runtime/worktree: codex/mini/sequence-manager-library at ~/codex-worktrees/sequence-manager-library; base origin/main 27af68d5. CORE operating rules updated in same lane. Firebase archive-pilates, archive-codex-operator. Deploy only CORE/compatibility Hosting, Firestore rules and added sequence list index; no Functions.

## Production Evidence

- Deployed source `e1a766c2ee5e85563afed58849cd92226c0853ad`; verifier readiness correction `793e6a0f588f2943684af43bb99e4d71d97d106a` changes only a manual verification script and requires no redeployment.
- Clean main dry-run and actual deploy succeeded: firestore:rules, firestore:indexes, hosting:archive-pilates and hosting:archive-pilates-core. No Functions, Auth account, password, or sequence data mutation.
- New sequence all-owner index `CICAgOi39IkK` reached READY. Existing remote-only index/field overrides were retained; no force/deletion. The first live preflight waited for normal index provisioning, not a send/data job failure. Stage index readiness before Hosting in future multi-target releases.
- Custom domain and compatibility `/core/` assets match local SHA256 for app, adapter, studio, stylesheet and operating rules. CORE release canary: 10/10, deployed SHA e1a766c2.
- Existing-account read-only live verification: managers at 390px/1440px each saw all 7 canonical live notes, including the assigned instructor's 7 currently saved notes. Foreign preview and PDF passed; editor unchanged. Ready instructor at 390px saw own 7 and could not request all scope. The earlier authorized legacy transfer remains six notes; this release did not transfer or create any note.
- Source document/image updateTime tuples unchanged before/after live verification, client write attempts 0. Existing UID/custom claims used for verification without changing roles/passwords. Task-owned contexts and browser closed in finally.
- Source GitHub Actions `38392859067` and verifier-only run `38393498848`: success. CORE operating-rule completion status follows in a Hosting-only documentation release; final branch/main status recorded in chat after completion.
