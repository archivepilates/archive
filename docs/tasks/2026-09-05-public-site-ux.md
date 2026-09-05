# Public Website UX 3-7

- Scope: community direct access, video discovery and previews, consistent headers, photo-first homepage content, Knitido filtering and image delivery.
- Base: origin/codex/mini/imweb-support-movement-paid-20260904 at 87a2e77. This source matches live official-home assets. origin/main does not contain official-home.
- Excluded: unpublished ed4f10d workflow changes, classroom loader and access rules, Functions, product stock/prices, orders and member data.
- Worktree: codex/mini/public-site-ux-20260905.
- Release target: Firebase archive-pilates / archive-pilates-home and scoped Imweb common-code UI loaders.
- Verification: responsive public pages at 320/390/768/1440, filters and preview identity, ordinary authorized and unauthorized classroom accounts, classroom asset hash, live script readback.
- Implemented: five scoped UI enhancements, direct board route, responsive image variants and guarded installers.
- Verified before release: 20 public route/viewport combinations, video and Knitido filters/reset/jump, matching ACH9 preview. Static deployment/classroom guards pass. Classroom and loader source are byte-identical to 87a2e77.
- Ordinary-member baseline: all four role/viewport combinations have exact expected lists (buyer six, nonbuyer zero); all 24 protected-page access checks match. Native paid widgets defer the iframe until play, so verification recognizes the visible native player launch control without claiming playback.
- Baseline warning: Imweb's existing header_more_menu.js calculateMenuWidth occasionally raises querySelector TypeError on desktop private pages. It also occurs before this release and does not change the verified access result. The regression helper records this exact known warning separately; any new error remains a failure. No production error suppression or auth code change.
- CORE rules: no operational policy change; existing ordinary-member verification rule remains in force.
- Official-home deployment: complete on 2026-09-05 KST. Firebase project archive-pilates, Hosting site archive-pilates-home only, service account archive-codex-operator@archive-pilates.iam.gserviceaccount.com, source commit d628dcb.
- Live official verification: root HTML and new UI assets return 200 with SHA-256 matching Git source; /community, /community/ and /community/index.html return 302 to the Imweb community board. Screenshots checked at 320/390/768/1440. Existing classroom asset hash and anonymous-access canary pass.
- Imweb installation: pending, not saved. Supported CLI script update refused with write_bulk_limit_exceeded; header, body and footer were independently read back and are unchanged. No safety limit bypass was attempted. Local intercepted-page QA is not Imweb live-installation proof.
- Next operator step: approve the administrator-screen save and log in to the task-owned Imweb admin tab. Before saving, compare current common code with the prepared before snapshot, save only scoped header/footer edits, and verify exact after hashes plus unchanged body. Then run public --live and ordinary-member regression checks.
- Browser cleanup: all task-owned Playwright contexts/processes closed. Chrome tab 2059950102 remains at the Imweb administrator login page solely for the pending login/save handoff; existing user tabs were preserved.
- Release report: docs/reports/2026-09-05-public-site-ux-release.html. CORE rules update not needed because this release changes presentation/navigation only and preserves existing verification and access policy.
