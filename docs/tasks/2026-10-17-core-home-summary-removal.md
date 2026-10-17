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

Source commit `2081a93da7ee9a2011b95676e1327cd505180b3c` promoted and pushed to main and feature branch. Existing `archive-codex-operator@archive-pilates.iam.gserviceaccount.com` service account deployed only `hosting:archive-pilates,hosting:archive-pilates-core` in project `archive-pilates` via `npm run deploy:archive-core-live`.

- Deployment guards, Hosting dry-run and live canary passed. Both release manifests identify exact source `2081a93d`.
- Post-deployment static responsive checks: 95 passed across 18 routes at 320/390/768/1440/1920px.
- Ten exact hash comparisons passed for home HTML, app, both stylesheets and operating rules across custom-domain and web.app/core surfaces. Home HTML `17156aad65efee8aaf3227ac2f9834fc89adf4a916d9987e956213de198cb814`; app `be1eba4e74b5a4699f32ffb586e4c21963e5f458e2c11e14a6ae5b4f599fb414`.
- Authenticated operator live home has no priority total or visible old title; actionable renewal row remains, compact read toolbar reports success. Clicking the real renewal action expands its detailed list and selected Today tab. No warning/error logs observed; task-owned tab `2059969321` closed.
- No real sends, member/profile writes, reservation/contract changes, automation/schedule changes or manual jobs performed. Existing user tabs preserved.
- GitHub Actions run `39009167465` succeeded for deployed source `2081a93d`; all build, boundary, data-source, deployment safety and release-manifest checks passed.
- Final evidence is documentation-only; unchanged deployed runtime does not require another Hosting release. Main, runtime and feature branches are aligned after the final evidence push.
