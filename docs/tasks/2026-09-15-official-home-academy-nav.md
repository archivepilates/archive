# Official Homepage Academy Navigation

## Scope
- User requested grouping instructor lessons, video purchases and physical products under Academy to remove the two-row mobile navigation.
- Four top-level controls: team, academy, community, careers. Academy contains the three existing destinations unchanged.
- Desktop mouse hover, native touch/keyboard disclosure, Escape/focus return, outside dismissal and page-return reset.
- All eight official-home header pages use the same new versioned CSS/JS. Existing shared assets, Imweb settings, permissions, points and purchases are unchanged.

## Source And Release Boundary
- Branch: `codex/mini/official-home-academy-nav-20260915`, based on published official-home source `5b04a95`.
- `origin/main` lacks official-home. Main promotion is a separate integration task; no runtime or CORE source is deployed here.
- Pre-change Firebase release: `2e1d9ff815cb2c91` (2026-09-11). HTTP byte comparison matches 71 source files including all 50 existing assets. The remaining `/community/index.html` is intentionally redirected to Imweb by unchanged Hosting configuration.
- Project `archive-pilates`, site `archive-pilates-home`, config `firebase.archive-home.json`; operator service-account helper.
- No CORE operating-rule update needed: public navigation only; no staff, messaging, sync, approval, access or business-policy change.

## Verification
- Existing eight predeploy guard groups pass (SEO, public UX, address, team, community, physical products routing, classroom, video sales).
- Added HTMLParser navigation validator covers all eight pages and unchanged URLs.
- Five isolated interaction tests pass: mouse hover/leave, touch/native toggle, Escape/outside/page restore, keyboard focus boundaries and hover-only Escape without focus stealing. Independent review findings for document-level Escape and desktop selector specificity were fixed before release.
- Browser checks: 8 pages x 320/390/768/1440 widths, one menu row, no horizontal overflow, text within controls, logo loaded and minimum 44px controls.
- Screenshots reviewed on homepage at 320/390/768/1440 and team page at 390. Dropdown is 208px wide, fits the 320px viewport, and does not change header height (109px mobile, 75px desktop).
- Browser pointer entry opens the menu. Space toggles, Escape closes and restores summary focus, outside click closes. No account or financial writes performed.
- Deploy/live readback pending.
