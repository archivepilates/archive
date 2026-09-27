# Imweb public design renewal

Approved: user requested items 1-6 of the design proposal on 2026-09-27.

## Scope
- Stable Korean navigation, restrained typography and emphasis.
- Home class-choice section before reviews, existing hero preserved, clearer reservation/video CTA labels.
- Video catalog before recommendations; compact campaign notice; AR6/AB10 instructor mapping.
- Short video headings and the product's own preview before the watch CTA.
- Native offline option status displayed without stock quantities; undated class photograph.
- Knitido story disclosure with the team photograph retained.
- Classroom presentation, explicit exit/watch actions, error/empty distinction and in-page retry.

## Boundaries
- Preserve native purchases, prices, stock, option selection, refunds and membership access.
- Preserve all paid/private catalog entries, manual access modes and the loader version.
- No speculative per-member expiry/progress or unverified classroom thumbnails.
- Canonical product 1 snapshot comparison: only productImages and editTime changed.
- SEO Header Code is separate from the API unit scripts; preserve the full existing header and append one versioned installer.
- This is a presentation-only release, not an operating-rule change. No CORE rule or Functions deployment is required.

## Verification
- Public UI preview/live matrix: 320, 390, 768, 1440px.
- Unit/regression tests: public renewal and classroom loading/retry/access fixtures.
- Existing Hosting predeploy checks and postdeploy classroom guard.
- Ordinary-member authorized/unauthorized gate, restoring test-only groups afterward.
- Compare live homepage, team page, classroom and sales assets to source before deployment to avoid rollback.

## Release
Hosting release, SEO Header save and live verification completed. Report included; scoped branch push and final status are reported in chat.

- Code commits: cc2f803, 0e3b537, 9eb09c6, d165377.
- Hosting target: archive-pilates / archive-pilates-home. No Functions deployment.
- Final CSS query: v=20260927d. Renewal scripts appear once in saved SEO Header Code.
- Regression tests: 23/23 passed; existing Hosting predeploy and final postdeploy classroom guard passed.
- Ordinary buyer/nonbuyer: mobile and desktop 10/0 classes; test-only groups restored to original zero and verified. No real checkout performed.
- Initial live checks: 18/24 passed. Remaining six layout scenarios passed after photo repair and sequential rerun. Not a single final-version 24-case run.
- Temporary Imweb 429 stopped audits. Later HTTP 200 and final guard passed; no 429 in final six cases.
- Final desktop countdown and catalog edges match (95px / 1345px, center 720px).
- Sidebar legacy hover exposed English on a later check. CSS scope now includes native sidebar containers; regression test covers 390/1920px hover/focus geometry and labels.
- Final live menu check: CSS d loaded; 1920/390px hover and focus all passed, Korean retained, English hidden, rect drift 0px, focus visible, URL unchanged, no 429. All browsers closed.
- All task-owned Chrome admin/public tabs closed; user's pre-existing tab preserved. Agent Playwright contexts closed.

## Confirmed before release
- Homepage, team page, classroom and sales runtime live bytes matched the source baseline.
- Hosting predeploy validators passed; classroom fixture tests 11/11 passed.
- Product 1 representative image changed from f2ee1b5133b73.jpg to 6d75782e71eb1.jpg; every other API field except editTime matched the backup.
- Screenshot-based preview found two native Imweb layout differences (goods_form heading and separate mobile/desktop bodies); selectors and tests were corrected before release.
