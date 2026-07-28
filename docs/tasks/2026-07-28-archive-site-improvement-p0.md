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

- Firebase Hosting site `archive-pilates-home` deployed successfully.
- Versioned listing asset:
  - Live URL returned `HTTP 200`.
  - Local/live SHA-256 matched: `7734d70b095315995b45884319fdb282d27a8a6fa75cef4c100aa1e6b376fd97`.
- Official home:
  - `https://archivepilates.com/` returned `HTTP 200`.
  - Both visible instructor-lesson CTAs read `강사레슨 일정 확인`.
  - `/offline` retained its `302` redirect to the Imweb offline category.
- Imweb saved script verification:
  - Header: exact match, SHA-256 `dff181c485e419e94d37f91ee29327984897e428bd14e5e9c5068603f80d9085`, saved `2026-07-28T10:03:56Z`.
  - Body: exact match, SHA-256 `a33cfee6fe82dd2baf21430afe0b53e73127c22052ca27e69a1c11a8a19aa0a8`, saved `2026-07-28T09:59:52Z`.
  - Footer: exact match, SHA-256 `325cc03ebed7d275b04dfecc606d15af08a5fe855b216b345cf50816f958f189`, saved `2026-07-28T09:59:52Z`.
- Imweb home network check:
  - All six official-home images returned `HTTP 200` from `archivepilates.com`.
  - Zero requests used the legacy `archive-pilates.web.app/assets/imweb-home/v2/` path.
  - Zero global home-image preload links remained.
- Non-home network check:
  - The video listing requested none of the six home images.
  - Zero global home-image preload links remained.
- Retired routes:
  - `/studio` moved to `https://archivepilates.com/#philosophy`.
  - `/15` moved to `https://archivepilates.imweb.me/16?ap_shop=all`.
  - The early header script applies `noindex,follow` and replacement canonical metadata before the client redirect.
  - Imweb's vendor-generated sitemap still lists both source paths; route-level search exclusion takes effect when a rendering crawler revisits them.
- Responsive live checks at `320`, `390`, `768`, and `1440px`:
  - Sale products: `2 / 2 / 3 / 4` columns.
  - Video products: `2 / 2 / 2 / 3` columns.
  - Zero horizontal overflow.
  - KNITIDO retained its existing brand heading and 27 custom cards without a duplicate generic heading.
- Detail regression check:
  - Product routes with an `idx` query do not receive a listing heading or listing-density attribute.
  - The checked video product retained one `44 x 44px` detail wishlist control at all four widths.
  - No visible native duplicate wishlist control and no browser console errors were found.
- Offline product check:
  - The public card remained `[오프라인] ARCHIVE METHOD 5:1 강사레슨 7월마감`.
  - `SOLDOUT` remained visible at mobile and desktop widths.
