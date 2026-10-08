# Sequence Save Recovery

- Date: 2026-10-08
- Scope: ARCHIVE CORE sequence editor, Firestore adapter, focused QA, operator rules.
- Approval: user approved distinct-note recovery plus validation, commit, deployment and push.
- Canonical source: sequenceNotes and immutable sequenceNoteImages; same authenticated owner only.
- Cause: startup loaded latest saved note; autosave and Save reused that ID. New lesson content replaced a previous lesson.
- Recovery: read-only bounded PITR audit, private before snapshot, create-only deterministic recovery IDs. Current document and intentionally deleted example remain unchanged.
- Recovered: two prior lesson payloads, eight moves each; historical final minute snapshots at 2026-10-07T05:26:00Z (revision 1) and 2026-10-08T05:39:00Z (revision 119).
- Readback: four active notes and one preserved deletion tombstone. Original current payload unchanged.
- Fix: blank new editor on entry/reload, explicit existing-note edit, copy action, accessible New action, fresh server backup query, payload identity validation.
- Boundaries: no member, booking, messages, StudioMate, Notion, auth policy, Firestore rules or indexes changed. Private recovery files never enter Git or Hosting.
- Verification: focused isolated browser suite; synthetic live account suite with cleanup; CORE responsive and Hosting/release guards. Results recorded in the HTML report.
- Deployment: CORE Hosting and default-site /core/ compatibility; no Functions deploy. Full release hash recorded in core/release.json.
- Limitation: historical PITR snapshots older than one hour are minute-granular. Restoration uses the last available whole-minute state before each title transition; no claim of sub-minute recovery.
