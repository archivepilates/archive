# ARCHIVE PILATES Video Price Countdown

## Scope
- Approved production application of the local countdown preview.
- Public video listing `/17` and 28 known paid-video product detail IDs only.
- Announcement: 15,000 KRW until September 30; 20,000 KRW from October 1.
- Deadline: `2026-10-01T00:00:00+09:00` (KST). Remove announcement at expiry.
- Presentation only. Product prices, scheduled discounts, coupons, member groups,
  checkout, paid/private access, and classroom loaders are unchanged.
- Actual price scheduling remains a separate, unapplied commerce change.

## Release Boundary
- Source: `codex/mini/video-countdown-20260906`, isolated from `8d3f830`.
- Do not promote the unrelated public-home lineage wholesale to `origin/main`.
- Dedicated Hosting config: `firebase.archive-home.json`, site `archive-pilates-home`.
- Before-release Hosting version: `8dc39180bd84750b`.
- All 70 live files preserved: SHA-256 of level-9 gzip bytes matches source;
  Hosting config matches. Only the new versioned asset is added.
- Imweb: append the dedicated loader once to SEO Header Code only.
- Before SEO lengths: top 925, header 26831, footer 54568; Body empty.
- Unit Header/Body/Footer scripts are a separate API surface: preserve hashes.

## Verification
- Seven existing predeploy guards passed.
- Local injection into live public DOM: listing/detail at 320, 390, 768, 1440px.
- No overflow or clipped countdown text; digit updates preserve element dimensions.
- Deterministic fixtures cover deadline, duplicate loader, reduced motion,
  native-price preservation, and excluded shopping/classroom/private routes.
- Deployed Hosting version: `d2ce8212f142475e`; 71 files, exactly one new path.
- Runtime compression differs between local Node 25 and deploy Node 24. Before
  manifest matches source using Node 25 gzip-9; after manifest matches the same
  source using Node 24 gzip-9. Existing file bytes and Hosting config are preserved.
- New public asset SHA-256: `4be12f931a1f61c0c407d56b580165caf02c51189a4342f0500cec35dbb771f6`.
- SEO Header saved and reload-read exactly: 26980 characters; one 149-character
  append. Top, Footer, and empty Body preserved. Unit scripts JSON is unchanged.
- Live responsive checks passed at all four widths, with stable countdown bounds.
- All 28 paid-video detail pages show exactly one countdown and native 15,000 KRW.
- Existing classroom canary passed: raw asset hash and cache policy unchanged;
  anonymous classroom/ACA6/ACH9 access remains login-redirected.
- Ordinary BUYER/NONBUYER fixtures: 24 protected-page checks passed across mobile
  and desktop; classroom lists six permitted entries for BUYER and none for
  NONBUYER. Temporary test groups restored and API-read back for both accounts.
- Existing Imweb `header_more_menu.js` race warning occurred in two matrix runs;
  no access failures or new countdown errors. This pre-existing warning is not
  fixed in the countdown scope. Actual payment and full playback were not tested.
- Implementation commit: `ff6ba6f`. Push follows successful verification.

## Evidence
- Ignored local artifacts: `artifacts/countdown-20260906/`.
- Includes before/after Hosting and unit-script snapshots, responsive screenshots,
  local/live results, and the 28-detail-page readback.
- Member fixture evidence: `artifacts/public-site-ux-20260905/member-regression-*`.

## Operating Rules
No ARCHIVE CORE rule update is needed: this change is public display only and
does not change staff actions, customer messages, automation, or access policy.
