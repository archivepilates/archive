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
- Imweb UI asset: `/assets/imweb-wishlist-20260728b.js`.
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
- Pending live asset deployment, Imweb header save, and authenticated-member persistence check.
