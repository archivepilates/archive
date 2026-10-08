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
- Completed: code release 64bbdd73cdca6c3b14fb453f830a53d3e053dc56 deployed to archive-pilates-core and archive-pilates compatibility path; local and live responsive 95/95 each, local sequence suite 15/15 twice, real Auth/Firestore isolated regression and cleanup passed.
- Live assets: exact SHA-256 source matches for the studio and adapter on CORE, and studio on the default-site /core/ path. Live release canary passed both domains.
- Operator data readback: all three original documents retained payload, revision and deletion state; two restored distinct documents coexist. Reapplying the same recovery plan skipped both without additional writes.
- Cleanup: synthetic test notes/images/Auth deleted with zero remaining; QA contexts, browser processes, subscriptions, transactions and test servers closed. Existing user browser tabs preserved.
