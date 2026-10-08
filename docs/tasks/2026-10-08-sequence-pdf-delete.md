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
- No real operator records modified.

### Release Complete

- Source commit `d7fae9e50062a4d0805bcc2c3056ed75a7dc84ae` promoted to origin/main and deployed to `hosting:archive-pilates,hosting:archive-pilates-core` with the operator service account. Functions, rules and indexes unchanged.
- Deploy dry-run, local/live CORE responsive checks (95 each) and CORE release canary passed. Studio and operating-rule bytes match Git on the custom domain and web.app compatibility path.
- Real Auth/Firestore synthetic test passed on live CORE at 390/1440: canonical PDF includes Korean and images, leaves editor/source untouched, UI deletion cleans photos, stale-device save is rejected and reload/old localStorage cannot restore the deleted ID.
- First live deletion assertion raced the list snapshot against asynchronous attachment cleanup. The verifier now waits for the completed delete UI state before checking actual documents; rerun passed without production code changes.
- Live PDF files independently parsed and rasterized; raster visually checked. Exact synthetic UID records and Auth identity removed and browser closed.
- GitHub Actions source commit check passed: https://github.com/archivepilates/archive/actions/runs/37768209595
- Final execution evidence: `docs/reports/2026-10-08-sequence-pdf-delete.html`. Final follow-up commit contains only verifier synchronization and these execution notes; no additional Hosting deployment required.
