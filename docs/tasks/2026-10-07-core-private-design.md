# CORE private design alignment

- Request: align the private menu with the sequence-note studio and finish testing.
- State: implemented and verified; user authorized the scoped production release on 2026-10-07.
- Base: origin/main 01510e6bd99e437010f4ebeb82e7dc06be0036a3.
- Branch: codex/mini/core-private-design-20261007.

## Scope

- Page-scoped stylesheet and private HTML only for production assets.
- Sequence-style header, underline tabs, compact summary band, unframed stages, and instructor sidebar on wide screens.
- Mobile single-column stages, tablet two-column stages, desktop four stages with instructor sidebar.
- Unknown loading counts use a dash instead of a false zero.
- Shared app.js, calculations, canonical sources, survey/report actions, approval, sends, auth, and Firestore are unchanged.
- No CORE operating-rule update needed: this is cosmetic presentation, with no change in staff procedure or automation.

## Verification

- `node --test scripts/tests/core-private-design.test.mjs scripts/tests/core-operator-workflow.test.mjs`: 28 passed.
- `npm run validate:archive-core-hosting`: passed after attaching the existing ignored Functions node_modules dependency directory. Initial attempt could not resolve TypeScript; no package files changed.
- `git diff --check`: passed.
- Read-only live comparison: CORE sequence and private pages.
- Browser QA through CUA, localhost-only fixtures, no Firebase initialization; CSP prohibits external connections.
- Widths 320, 390, 768, 1440: no document horizontal overflow; screenshot review passed; 320px visible buttons and report links meet 44px minimum height.
- Today/overdue click and keyboard ArrowLeft navigation: selection, focus, counts and matching rows updated correctly.
- Populated, empty, loading, unavailable and long-name states: passed.
- Overflow disclosure: 27 recording rows, first 20 plus expandable remaining 7; expansion and refresh passed.
- Member detail href retained; links not followed into production.
- Synthetic preview console errors: none.
- Real sends, report generation, Firestore writes, source sync and login reauthentication were deliberately not exercised for this UI-only task.
- Screenshots: artifacts/private-design/desktop.jpg and mobile.jpg; synthetic names only.
- Optional local preview: `node scripts/preview-core-private.mjs`, http://127.0.0.1:4387/private/.

## Next Action

Release from a clean main checkout equal to origin/main, deploy CORE Hosting only, verify live assets/layout and GitHub CI, and preserve unrelated work. Repository deployment guards require the reviewed source to reach origin/main before Firebase deployment.

## Release Verification, 2026-10-07

- Fast-forwarded the feature worktree to origin/main 0617e512 without overwriting the approved holding v2 release.
- Rechecked 320, 390, 768 and 1440px screenshots on the current renderer: no horizontal overflow; stages use one, one, two and four columns respectively.
- Today/overdue selection, keyboard ArrowLeft navigation, summary counts and refresh passed against isolated synthetic fixtures. No production member writes or sends.
- CORE Hosting and rollback guard validators passed again. Changes to production assets remain limited to core/private/index.html and core/private/private.css.
- The existing HTML report captures design/fixture verification, not proof of production writes. No operational rule change: presentation only.
