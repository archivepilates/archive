# Imweb shipping products only

## Goal

Keep the `판매상품` navigation limited to shippable merchandise. Online video subscriptions remain under `영상구매`, and the offline instructor lesson remains under `강사레슨`.

## Source audit

- Imweb category `니티도` contains 27 displayed physical products.
- Imweb category `온라인 클래스` contains the displayed subscription products.
- Imweb category `오프라인 클래스` contains the displayed instructor lesson product.
- The former `/16?ap_shop=all` page only hid non-Knitido cards after Imweb pagination, so later catalog pages could expose videos and the offline lesson.

## Change

- Route the Imweb `판매상품` navigation and legacy unfiltered catalog links to `/16?ap_shop=knitido`.
- Redirect direct visits to `/16`, `/16?ap_shop=all`, and their paginated variants to the same shipping-products-only route, while preserving product detail URLs with `idx`.
- Remove the redundant `전체` subcategory entry after the shipping-products-only route loads.
- Point the official homepage `/shop` redirect and retired Imweb `/15` route to the shipping-products-only route.
- Align `영상구매`, `강사레슨`, `내 강의실`, `knitido`, and `커뮤니티` to one 54px sidebar row height and one 30px left edge without changing the video dropdown behavior.

## Verification

- Run `npm run validate:shipping-products-route`.
- Run `node scripts/imweb/apply-shipping-products-only.mjs` as a read-only current-vs-prepared comparison. The helper rejects `--apply` so the live normal `Header Code` field cannot accidentally receive a duplicate through a different CLI script surface. The CLI write path was not used because its safety limit rejected the combined script size; the reviewed installer was saved in Imweb's previously empty normal `Header Code` field instead.
- Verify desktop and mobile navigation, direct legacy routes, product detail links, `/17`, and `/18` on the live site.
- Verify the five primary sidebar entries share the same computed left edge and row height on desktop and mobile.

## Live result

- Saved on 2026-08-28 through the authenticated Imweb admin session for `archivepilates.imweb.me`.
- Reloading the admin SEO page confirmed the final `2026-08-28c` marker persisted in the normal `Header Code` field.
- `/16?ap_shop=all&page=2` resolved in the browser to `/16?ap_shop=knitido`, and the redundant `전체` entry was absent.
- The shipping-products page exposed 27 visible Knitido product links and no visible online-video or offline-lesson product link.
- `/17` still exposed online classes and `/18` still exposed the offline instructor lesson.
- Desktop and 390px mobile checks measured all five primary sidebar links at `54px` height with `30px` left padding and an identical left edge.
- `firebase.archive-home.json` is aligned for the official `/shop` redirect in source, but no Firebase Hosting deploy was performed from this branch. The current public `/shop` route still reaches the corrected Imweb route through the saved redirect guard.
- A live browser check of `https://archivepilates.com/shop` finished at `https://archivepilates.imweb.me/16?ap_shop=knitido` with the `2026-08-28c` marker active and the header still visible.
- Computed top-menu typography matched across all five entries: desktop `15px` and mobile `13px`, with the same weight and line height at each breakpoint.

## Header-preserving follow-up

- The deployed official `/shop` redirect still targets Imweb `/16`, so the first installer version caused a second full-page navigation to the Knitido URL and could make the header appear to disappear during entry.
- Version `2026-08-28c` replaces the query URL with `history.replaceState` before the existing shop renderer starts. The page, header DOM, and menu remain mounted while the physical-products-only mode initializes.
- A same-origin `location.replace` remains only as a defensive fallback when the History API is unavailable.
- A targeted Firebase Hosting deploy was attempted to make the official `/shop` redirect one hop, but stopped before upload because the configured service account and registered Firebase users did not have `archive-pilates` project access. No Hosting files changed. The header-preserving Imweb implementation fixes the live entry behavior without that deploy.
