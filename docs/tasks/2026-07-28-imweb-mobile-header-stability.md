# Imweb Mobile Header Stability

Date: 2026-07-28

## Symptom

- The attached iPhone recording showed the ARCHIVE PILATES mobile header and equipment navigation moving down and snapping back during top-edge scrolling.
- The online equipment navigation was fixed and rewrote its top offset from the header rectangle on every scroll event.
- The Imweb header wrappers also exposed `transition: all`, amplifying position and height changes.

## Change

- Install `scripts/imweb/install-mobile-header-stability.html` in the Imweb global header.
- Disable mobile vertical overscroll chaining on the document.
- Disable animation and transition on the three Imweb mobile header wrappers.
- Move the online equipment navigation directly after the header and use normal-flow `position: sticky`.
- Keep the navigation out of layout flow when the online subnavigation is closed.
- Disable the remaining opacity transition for reduced-motion users.

## Verification Plan

- Check the AB5 product detail and the online listing in mobile WebKit and Chromium.
- Sample header, subnavigation, and content rectangles while scrolling down and back up.
- Verify stable header and subnavigation heights at each responsive breakpoint, no horizontal overflow, and no content overlap.
- Verify non-online routes do not gain an empty subnavigation gap.
- Check `320px`, `390px`, tablet, and desktop widths and review browser console errors.

## Pre-deploy Verification

- Mobile WebKit:
  - AB5 detail used an `81px` header and `44px` sticky subnavigation.
  - Scroll samples at `0`, `40`, `80`, `160`, and `320px`, followed by upward samples, preserved the same deterministic geometry.
  - The product image moved into normal flow below the subnavigation instead of being covered by it.
  - The all-products and home routes kept the closed subnavigation fixed and hidden, so no empty `44px` gap was added.
- Mobile Chromium:
  - `320`, `390`, and `430px` kept an `81px` header and `44px` sticky subnavigation.
  - `768px` retained Imweb's existing scaled layout without horizontal overflow.
  - `1024` and `1440px` retained the desktop layout with the mobile subnavigation hidden.
  - Reduced-motion mode removed the remaining subnavigation transition.
- Re-running the stabilizer after a resize produced zero child-list mutations once the DOM was already correct.

## Live Result

- Imweb site `S20260516852c71a014d08` saved the global header at `2026-07-28T07:11:22Z`.
- The saved `11,627`-character header matched the prepared payload exactly and retained wishlist loader `2026-07-28d`.
- Fresh mobile WebKit verification on AB5 product `idx=45`:
  - live marker `2026-07-28a` loaded.
  - the header remained `81px`, the subnavigation remained `44px`, and the subnavigation used `position: sticky`.
  - down-and-up samples at `0`, `40`, `80`, `160`, and `320px` reproduced the same geometry with no horizontal overflow.
  - document overscroll was `none`, the product image started below the subnavigation, and the detail wishlist retained exactly one control.
  - the checked product route had zero console errors.
- Fresh mobile Chromium verification:
  - `320`, `390`, and `430px` retained the stable `81px` and `44px` layout.
  - `768px` retained Imweb's scaled tablet layout without overflow.
  - desktop widths kept the mobile subnavigation hidden and unchanged.
  - reduced-motion mode removed header and subnavigation transitions.
- Online equipment navigation retained all five links, and the reformer link navigated to the expected filtered route.
- All-products, offline-class, and home routes kept the closed subnavigation fixed and hidden without adding a layout gap.
