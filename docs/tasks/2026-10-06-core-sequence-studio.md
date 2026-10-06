# ARCHIVE CORE Sequence Studio

- Request: add the supplied ARCHIVE_Sequence_Studio.html as a CORE menu.
- Source: /Users/archivepilates/Downloads/ARCHIVE_Sequence_Studio.html.
- Scope: core/sequence, CORE navigation/search, operating rules and focused checks.
- Deployment: archive-pilates / hosting:archive-pilates-core only.
- Preserve: embedded licensed NanumSquare fonts, stages, images, preview, PDF, JSON backup and local library.
- Storage: browser localStorage on the canonical CORE origin; no cloud/member/booking writes or cross-device sync.
- Access: existing CORE Auth check before loading the iframe; direct studio navigation returns to the CORE entry.
- Safety fixes: quota failures are not reported as successful imports; stale-window saves cannot overwrite newer data; invalid drafts do not hide the saved library; long multiline notes paginate; 100-record save/restore limit is consistent.
- Tests: verify-core-sequence-studio.mjs checks 320/390/768/1440px, isolated signed-in/out Auth fixtures, draft reload, library save/search, JSON restore, selectable Korean-font PDF, storage quota/conflict and multiline notes.
- Regression checks: CORE responsive 95 checks, Hosting guard, catalog freshness, rollback guards and ticket liability price tests.
- Auth fixtures replace Firebase SDK modules only in isolated test contexts. They do not establish live operator identity or read/write production Firestore.
- Browser cleanup: contexts and browsers close in finally; static QA server closes. Test data remains only in disposed browser contexts and temporary QA artifacts.
- Alimtalk catalog regeneration changes only the app.js fingerprint, not template behavior.
