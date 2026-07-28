# ARCHIVE PILATES Site Improvement P0

Date: 2026-07-28

## Scope

1. Stop loading the six official-home images on unrelated Imweb pages and remove the six legacy image 404 requests from the Imweb home.
2. Align the official-home instructor-lesson CTA with the currently closed July product.
3. Retire the stale `/studio` page and empty `/15` page from user and search flows.
4. Add clear listing headings and denser desktop/tablet product grids while preserving the two-column mobile layout.

## Targets

- Official home: Firebase project `archive-pilates`, Hosting site `archive-pilates-home`
- Imweb site: `S20260516852c71a014d08`
- Imweb unit: `u2026051698c99ea234719`
- Imweb owner verified through `site info`: `home@archivepilates.com`

## Imweb Backup

The live global scripts were read before any write and saved outside the repository:

- Directory: `/tmp/archive-imweb-p0-20260728-185001`
- Header: `11,630` bytes, SHA-256 `9a05b41393ee6085d3692b3cf5b5126a473e5f321843d8d93c30da1a695d46a9`
- Body: `98,500` bytes, SHA-256 `3b4bd98194b6365d97cff43c1d6378db41b4d0f2abe83d7d4d1f43d48970980c`
- Footer: `54,531` bytes, SHA-256 `32c5ac615d91d7805992a9ae62fa5d743c0de68d9c90b529434c5bdcb317fcac`

Rollback is a script update using the matching backed-up `header.html`, `body.html`, or `footer.html`.

## Implementation

- `official-home/index.html`
  - `강사레슨 예약` and `강사레슨 상품 보기` become `강사레슨 일정 확인`.
- `official-home/assets/imweb-site-improvements-20260728b.js`
  - Adds `판매상품` and `영상구매` list headings.
  - Uses four/three/two columns for sale products at desktop/tablet/mobile widths.
  - Uses three/two/two columns for video products at desktop/tablet/mobile widths.
  - Leaves the KNITIDO brand page unchanged.
- `scripts/imweb/install-site-improvements-p0.html`
  - Redirects `/studio` to the official philosophy section.
  - Redirects `/15` to the sale-products list.
  - Adds `noindex,follow` and the replacement canonical before redirecting.
  - Loads the versioned listing-layout asset on active pages.
- `scripts/imweb/install-logo-official-home.html`
  - Keeps only the header-logo link correction.
  - Removes the global six-image preload and computed-style background repair.
- `scripts/imweb/prepare-site-improvements-p0.mjs`
  - Applies the bounded header/body/footer changes to a current backup.
  - Fails if required existing wishlist/header-stability markers disappear.
  - Fails if a legacy image host or global preload fragment remains.

## Pre-deploy Verification

- JavaScript syntax checks passed for the listing asset and patch preparer.
- Patch preparation completed with all required markers preserved.
- Live-markup injection checks:
  - Sale products: 4 columns at `1440px`, 3 at `768px`, 2 at `390px`.
  - Video products: 3 columns at `1440px`, 2 at `768px`, 2 at `390px`.
  - No horizontal overflow at the checked widths.
  - KNITIDO retained its existing brand heading, 27 product cards, and no duplicate generic heading.
  - Mobile online navigation retained the stable header/subnavigation geometry.

## Live Result

Pending deployment and post-deploy verification.
