# CORE Home Summary Removal

- Worktree: `/Users/archivepilates/codex-worktrees/core-home-summary-removal`.
- Branch: `codex/mini/core-home-summary-removal`.
- Base: `731501ff`.
- Approval: user approved summary removal, scoped validation, CORE Hosting deployment, commit and push; then requested removing the empty visible home heading and improving home layout.
- Scope: presentation only. No account, member, Firestore rules/schema, provider, send/approval/exclusion policy or scheduler changes.

## Behavior

- Remove the unlinked combined priority count, explanatory copy and its computation. Preserve per-domain actionable links, counts and errors.
- Replace the visible empty home title with a screen-reader-only Home heading.
- Retain source health, read time and refresh in one compact toolbar.
- Reorganize home search, quick actions and collapsible external tools for mobile and desktop; retain existing real workflow controls, form IDs and safety messages.
- Explicitly render the renewal pipeline at all old summary refresh sites so removing the summary cannot stop renewal updates.
- Remove obsolete summary CSS. Existing query/source fix stays unchanged.
- Update guards and UI tests to assert retained actionable lists instead of the removed DOM marker.

## Ownership And Verification

- Main: markup, app presentation, tests, guard markers, operating rules, report, production execution.
- Bounded CSS agent: only `core/assets/styles.css` and `core/assets/interface.css`; no production actions.
- Initial Node regressions: 57 passed across operator workflow, cross-frame query, navigation, renewal visibility and catalog.
- Hosting validator and rollback guard passed. Final responsive/authenticated UI QA and deployment evidence follow below after completion.
- Final synthetic full-app QA: 24 owner/manager/navigation cases passed across 320, 390, 768 and 1440px on both root and /core/ paths. Verified permissions/logout, source reads, menu return, no duplicate summary and no overflow. All 24 contexts, browser and server closed; zero fixtures remain. Report: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-faqDzF/report.json`.
- Static responsive QA: 95 checks passed across 18 routes and 320/390/768/1440/1920px. Final mobile and desktop screenshots inspected directly.
- Shorter empty content exposed shell row stretching at tablet width. Home-only max-width 1040px rows `auto 1fr` keep the header compact. All 24 cases passed after correction; no production rollout preceded the fix.
- Legacy `verify-core-operator-workflow.mjs` initially failed before browser startup because its old bootstrap marker predates current access startup. This is not a production failure. Current full-app authenticated synthetic harness is the primary verification surface for this change; do not count the legacy run as passing.

## Release

Pending final local layout verification and clean-main deployment. No real sends or member writes are authorized or performed.
