# Sequence Library PDF And Deletion Verification

## Request And Approval

User requested PDF instead of JSON from each saved library record and verification that deleted records cannot automatically return. Approved local validation, CORE Hosting deployment, commit and push, and isolated synthetic test records only. Never delete real operator notes for tests.

## Scope

- Library record PDF button reads canonical server note plus attachments and downloads the existing PDF format.
- Preserve active editor, preview state, dirty flag and note revisions; no save is triggered by export.
- Retain separate JSON response and recent-library backups for intentional recovery.
- Check delete/reload, stale second-device save, legacy localStorage, canonical tombstones and explicit restore boundaries.
- No auth, Firestore rules, indexes or Functions change is planned.
- Update CORE operating rules; Notion is unrelated.

## Read-Only Operational Evidence

At audit, operator collection has five active records and two tombstones. The deleted 코어 & 칼로리 버닝 ID remains deleted. A different-ID recovery copy with that title was created at 2026-10-08 19:03 KST, before the deletion at 19:56 KST. It is not a recreation of the deleted ID. Do not delete the separate recovery copy without explicit instruction.

## Verification

Local responsive/PDF and deletion regressions, scoped Hosting checks, synthetic live Firebase verification, cleanup and deployment results are recorded in the final HTML report. Production source files must match reviewed Git source before completion.

### Local Checks Complete

- Actual adapter/UI fixture: 26/26, no skipped checks; 320/390/768/1440 responsive layouts and saved-record PDF downloads.
- Eight PDFs independently parsed with pypdf and rendered with PDFium; selectable Korean, canonical metadata and compressed attachments verified. Library PDF raster visually checked.
- Real Firestore rules emulator: 215/215; unchanged rules are not redeployed.
- Deletion, stale second-device autosave, reload with old localStorage and explicit JSON restore boundaries passed. Missing and tombstoned records never download or mutate the editor.
- Initial fixture failures were incorrect deleted-document error expectations and a hidden status label at tablet width, not production failures; assertions now use the correct conflict message and visible recovery action.
- Hosting validation, rollback guards, syntax and diff whitespace checks passed. Browser, contexts, subscriptions, transactions and test server closed.
- Hosting and isolated live Firestore verification pending; no real operator records modified.
