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
- Production deployment completed from 391d5f926c609de153527972e4eb682d8afd41b9, promoted to origin/main before the mandatory deploy guard.
- Live verification: https://core.archivepilates.com/sequence/ and six served assets are byte-identical to the deployment worktree, including core/release.json.
- Live isolated Auth-fixture workflow passed at four widths; live CORE responsive checks passed all 95 cases. No live operator login or member-facing action was performed.
- QA timing fix: after navigation, wait for the authenticated iframe's application state rather than only the parent page load event. This changes tests only and does not require another Hosting deployment.
