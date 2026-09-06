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
- Production save, live verification, member regression, and push pending.

## Operating Rules
No ARCHIVE CORE rule update is needed: this change is public display only and
does not change staff actions, customer messages, automation, or access policy.
