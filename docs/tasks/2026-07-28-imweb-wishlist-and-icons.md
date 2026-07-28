# Imweb Wishlist And Shared Icons

Date: 2026-07-28

## Scope

- Use the official ARCHIVE PILATES symbol for both the official homepage and Imweb icons.
- Place an Imweb native wishlist control on product cards and next to the product-detail title.
- Keep wishlist counts hidden.
- Preserve the Imweb member login and native wishlist data flow.

## Implementation

- Official icon source: the high-resolution transparent ARCHIVE PILATES symbol in Google Drive branding assets.
- Icon canvas: warm white with the red symbol occupying about 90% of the square.
- Imweb UI asset: `/assets/imweb-wishlist-20260728d.js`.
- Imweb loader and favicon override source: `scripts/imweb/install-wishlist-and-icons.html`.
- The versioned loader is appended to the existing global header script without replacing prior header behavior.

## Verification

- Local injection against the live Imweb markup:
  - 30 native product cards and 27 KNITIDO custom cards received one heart control each.
  - Card and detail controls measured `44 x 44`.
  - Anonymous card and detail clicks opened the native Imweb login dialog and did not show a false selected state.
  - `390px` mobile and `1440px` desktop checks had no horizontal overflow.
  - Reduced-motion emulation reported no heart animation or transform; only the red selected color remained.
- Live v1 verification found an Imweb detail-title color rule overriding the selected heart. Version `2026-07-28b` adds scoped color/fill precedence.
- Live responsive verification found Imweb applying `body { zoom: .85 }` in its tablet layout. Version `2026-07-28c` compensates at `768-1099px` so the rendered touch target stays at least `44px`.

## Live Result

- Firebase Hosting target `archive-pilates-home` deployed successfully.
- Live `imweb-wishlist-20260728c.js` SHA-256 matched the committed file.
- Live favicon:
  - `HTTP 200`
  - `48 x 48`
  - opaque warm-white canvas
  - source and live SHA-256 matched.
- Imweb global header:
  - saved at `2026-07-28T06:19:14Z`
  - length `8838`
  - contains only loader version `2026-07-28c`.
- Public Imweb checks:
  - 30 native listing controls installed on the all-products route.
  - 27 KNITIDO custom-card controls installed on the KNITIDO route.
  - rendered target sizes were `44px` at `320`, `390`, `1100`, and `1440`; `44.1875px` at the Imweb-scaled `768` and `1024` layouts.
  - no horizontal overflow at the checked widths.
  - four visible cards completed member-specific state synchronization from their detail markup.
  - anonymous card and detail clicks opened the native Imweb login dialog without showing a false selected state.
  - normal motion used a `0.34s` scale animation.
  - reduced motion used no animation or transform and retained the ARCHIVE PILATES red fill.
  - both original detail wishlist buttons and all wishlist counts remained hidden.
- Authenticated-member add/remove persistence was not mutated during this release; the controls call the same Imweb native wishlist endpoint and read server-rendered member state.

## Detail-only Follow-up

- Product-card hearts were removed after visual review showed the image area felt crowded.
- Version `2026-07-28d` keeps one native wishlist control beside the product-detail title only.
- The cleanup also unwraps any custom KNITIDO card shells left by an older in-page version.
