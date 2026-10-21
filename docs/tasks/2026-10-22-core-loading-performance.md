# CORE loading performance

- Source: origin/main e3f935d084f88b3d8200ddd9c75e46c440c2943d.
- Scope: static SDK startup, authorized navigation readiness, route-scoped operations reads.
- Preserve: fresh getCoreAccessSession on every destination, instructor workspace authorization, first-login gate, sequence save acknowledgement, canonical data and all sends.
- No member/device actions or production fixtures.
- Findings: four global operations reads ran on unrelated operator routes; destination publication awaited all data queries; initial SDK downloads began only after the large application module loaded.
- Implementation: publish authorized shells before data queries; skip duplicate late navigation publication; retain source health reads on home and quality reads on members/detail; preload public static SDK modules only for top-level documents.
- Safari hardening: invalidated access hides old content immediately and reloads through a parent-owned timer, so iframe disposal cannot interrupt the child's reload caller. Verified instructor markers hide the loading block without relying solely on descendant :has invalidation.
- Verification complete: 224 access/ownership checks, 73 general/navigation/loading/SDK checks, 36 sequence checks and 95 responsive cases pass. Chromium full-app regression 112 and controlled slow-data cases 16 pass; final WebKit full-app regression including controlled delays 128 passes without retries. Surfaces / and /core/, widths 320/390/768/1440; static QA also covers 1920.
- Final WebKit evidence: /var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-Ifl0Bg/report.json. Chromium regression: core-instructor-access-ui-TYKnZn/report.json in the same temporary root; controlled delays: core-instructor-access-ui-NhZNZD/report.json.
- Initial verification found a VM harness requiring --experimental-vm-modules, stale manager-library expectations, native WebKit month-field blur requirements, and the Safari reload/loader issues above. All final selected checks pass; intermediate failed/source-drift reports are not release evidence.
- Cleanup: all QA contexts/browsers/servers/fixtures closed; the task-created Chrome observation tab closed, user tabs preserved. No shared StudioMate browser/profile used.
- Deployment: user explicitly approved the complete scoped deploy/commit/push set on 2026-10-22. Hosting only (archive-pilates, archive-pilates-core); no Functions, Firestore rules, accounts or Firestore data changes. Promote verified source to clean main before existing deploy guards; record live release verification before completion.
