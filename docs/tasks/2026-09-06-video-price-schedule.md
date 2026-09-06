# ARCHIVE PILATES Video Price Schedule and Countdown Layout

## Approved Scope
- 28 currently sold 40-day videos: IDs 27-33, 35-51, 79, 80, 84, 85.
- Base price 20,000 KRW, native Imweb period discount 5,000 KRW for all visitors.
- Current checkout price 15,000 KRW through September 30, 2026.
- Discount ends October 1, 2026 at 00:00 KST. No Codex timer or host uptime dependency.
- Hidden, private, physical, and offline products excluded.
- Countdown right-edge visual repair and responsive number layout.
- Recommendation prices and analytics use native product prices, not 15,000 KRW constants.

## Saved and Verified
- All 28 native product editor saves completed using the home account session.
- CLI before/after comparison preserves titles, details, status, media, 40-day
  entitlement settings, tax settings, and existing coupon/group-discount flags.
- Native editor normalizes empty point mode/type to common/percent with value 0;
  these dormant defaults are recorded explicitly rather than hidden in the diff.
- Product 80 previously omitted discountOptions; native editor serializes its
  existing disabled flags as N. Only period discount is enabled.
- All 28 public detail pages independently show native 15,000 KRW and native
  end_time `2026-10-01 00:00`. The modern API serializes that timestamp with an
  extra nine-hour offset; do not compensate by changing the editor's KST value.
- Actual execution on October 1 has not occurred and is not claimed as verified.

## Layout and Regression Checks
- Original 320/390/768/1440px public listing/detail checks found no cropped text.
  Missing right border made the section look unfinished.
- Complete border, flexible four-column clock, mobile labels below numbers.
- Local injection into live pages passes eight geometry checks, stable updates,
  reduced motion, expiry, deduplication, and excluded routes.
- Native-price fixtures cover 15,000, 20,000, and 22,000 KRW with three cards each.
- Deployment and ordinary-member checks: pending.

## Release Boundary
- Source branch: codex/mini/video-price-schedule-20260906, base 043281f.
- Before Hosting version: d2ce8212f142475e, archive-pilates-home.
- 71-path Hosting manifest compared with Node 24 gzip hashes; only countdown and
  video-sales JavaScript differ. Firebase reserved init paths excluded locally.
- Hosting configuration and classroom asset unchanged. No Functions deployment.
- SEO Header Code changes are two exact loader cache-version replacements only.
- No customer order, payment, refund, or real member entitlement mutation.
- Test fixtures may temporarily modify only the two established synthetic users;
  the existing test runner restores their original groups with API readback.

## Operating Rule Record
- Purpose: maintain advertised/current price consistency at the discount deadline.
- Source of truth: Imweb native product price and period discount, not the countdown.
- Staff should edit the native period discount if the deadline changes and update
  the public announcement in the same operation; do not create a second price job.
- Verification: 28 public detail price/end-time readbacks and source diff audit.
- ARCHIVE CORE live rule page update is deferred: this isolated public-site branch
  does not have the current CORE deployment source. Do not redeploy stale CORE
  files from this worktree. Promote this rule separately from current origin/main.
- Updated: 2026-09-06. Next action: CORE rule promotion; no extra customer message.

## Evidence
- Ignored artifacts/video-price-schedule-20260906/: product snapshots, native
  price verification, and before-release Hosting manifest.
- Ignored artifacts/countdown-20260906/: desktop/mobile screenshots and checks.
