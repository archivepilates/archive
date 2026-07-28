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
