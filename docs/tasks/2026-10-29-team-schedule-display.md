# Team Schedule Display

- Request: show 2026-11-20 as 14:00~15:50; label 11/20 and 11/21 as Team with distinct cards.
- Branch: codex/mini/team-schedule-display-20261029.
- Worktree: /Users/archivepilates/codex-worktrees/team-instructor-intake-20261029.
- Source baseline: f356b2dcc3c303c9ea4aabe87a8d29f82aae59fc.
- Scope: CORE display, CSS, rule note, regression tests and scoped release manifest only.
- Canonical source remains the existing instructor dashboard; the approved date presentation does not change courseKind, capacity, cancellation, confirmation eligibility or registration data.
- Native 11/20 schedule was already 14:00-15:50; this release exposes the full span, including registration-only read models. Explicit conflicting source times remain review-required.
- 11/21 keeps its native time and topic. Legacy tickets are not reclassified by this display patch.
- No StudioMate writes, Firestore writes, Functions deployment, member sends, scheduler or IAM changes.
- Validation: 59 focused tests passed, including four responsive widths, conflict protection, unchanged counts and cancellation/action guards; syntax and registration validator passed.
- Deployment: dedicated scheduleDisplay target replaces only app.js, interface.css and rules/index.html while preserving all other Hosting assets/configuration. The saved release evidence and live readback determine actual deployment, not this plan.
- Evidence: artifacts/team-schedule-display-qa/ and artifacts/team-instructor-intake-20261029/scheduleDisplay-release.json.
