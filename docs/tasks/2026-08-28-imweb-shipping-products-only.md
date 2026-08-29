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
- Reloading the admin SEO page confirmed the final `2026-08-28d` marker persisted in the normal `Header Code` field.
- `/16?ap_shop=all&page=2` resolved in the browser to `/16?ap_shop=knitido`, and the redundant `전체` entry was absent.
- The shipping-products page exposed 27 visible Knitido product links and no visible online-video or offline-lesson product link.
- `/17` still exposed online classes and `/18` still exposed the offline instructor lesson.
- Desktop and 390px mobile checks measured all five primary sidebar links at `54px` height with `30px` left padding and an identical left edge.
- `firebase.archive-home.json` is aligned for the official `/shop` redirect in source, but no Firebase Hosting deploy was performed from this branch. The current public `/shop` route still reaches the corrected Imweb route through the saved redirect guard.
- A live browser check of `https://archivepilates.com/shop` finished at `https://archivepilates.imweb.me/16?ap_shop=knitido`; the later DOM-order fix is active as `2026-08-28d`.
- Computed top-menu typography matched across all five entries: desktop `15px` and mobile `13px`, with the same weight and line height at each breakpoint.

## Header-preserving follow-up

- The deployed official `/shop` redirect still targets Imweb `/16`, so the first installer version caused a second full-page navigation to the Knitido URL and could make the header appear to disappear during entry.
- Version `2026-08-28c` replaces the query URL with `history.replaceState` before the existing shop renderer starts. The page, header DOM, and menu remain mounted while the physical-products-only mode initializes.
- A same-origin `location.replace` remains only as a defensive fallback when the History API is unavailable.
- A targeted Firebase Hosting deploy was attempted to make the official `/shop` redirect one hop, but stopped before upload because the configured service account and registered Firebase users did not have `archive-pilates` project access. No Hosting files changed. The header-preserving Imweb implementation fixes the live entry behavior without that deploy.

## Delayed DOM reorder follow-up

- A real top-menu click followed by a 10-second observation reproduced the header at document position `3806px`, immediately before the footer.
- The Knitido renderer inserts `.ap-shop-subcategory` and `#ap-knitido-brand-intro` at the start of the Imweb body after initial paint. That insertion put the 3690px brand section before `#doz_header_wrap`.
- Version `2026-08-28d` watches those insertions and restores `#doz_header_wrap` immediately before the first shop-content node. It does not clone the header or change navigation typography.
- After a real menu click and 10-second wait, desktop and 390px mobile both kept the header at document position `0px`, child index `0`, before shop-content index `2`. Browser console error checks were empty.

## Desktop shop-label typography follow-up

- The desktop anchor inherited `15px`, but the visible `.ap-shop-pill-ko` child still had a more specific legacy rule at `13px` and weight `850`.
- Version `2026-08-28e` aligns the visible Korean label to the neighboring menu values (`15px`, weight `750`, 44px link height) and aligns the English hover label to `11px`, weight `880`.
- Mobile remains unchanged at the already-matching `13px` menu size.

## Header click-stability follow-up

- Live click sampling showed a real desktop order jump: the expected `강사레슨 → 영상구매 → 판매상품 → 커뮤니티` order was replaced at `360-720ms` by `영상구매 → 강사레슨 → 커뮤니티 → 판매상품`, then restored by `1200ms`.
- Mobile briefly painted `강사레슨 → 영상구매 → 판매상품 → 아카이브홈 → 커뮤니티` before returning to the intended order within `80ms`.
- Version `2026-08-28f` fixes visual order independently of delayed DOM insertion order, keeps the shop link at the same 44px height as adjacent links, removes its vertical hover movement, and ignores mutations caused only by ARCHIVE PILATES managed style nodes so legacy observers do not repeatedly wake themselves.
- The normal Imweb `Header Code` field was saved through the authenticated `home@archivepilates.com` Chrome session, then reloaded and confirmed to retain the `2026-08-28f` marker.
- Version `2026-08-29g` fixes the video-shop equipment dropdown geometry at 148px wide with four 43px rows. The legacy menu builder and bilingual-label enhancer may still replace the row markup during initial load, but the visible menu box and row positions no longer change while the pointer is over the menu.
- The authenticated `home@archivepilates.com` admin session saved version `2026-08-29g` in the normal Header Code field. Reloading the SEO settings page confirmed that both the installer marker and version persisted.
- Live early-load sampling reproduced the legacy plain/bilingual row replacement while the dropdown stayed fixed at `148 × 190px`; all four desktop rows stayed at `146 × 43px`. Five repeated hover cycles and pointer entry into the dropdown kept identical coordinates. Cross-page checks on the shipping-products and instructor-lesson routes stayed stable at `1024`, `1440`, and `1900px`, with no console warnings or errors.
- The `390px` mobile regression check kept the five top-menu items in the intended order with no horizontal overflow. The desktop-only equipment geometry rules did not alter the mobile header.
- Desktop click sampling from `0ms` through `6400ms` kept the five menu items at fixed x positions and 44px heights. The shop link now renders at `15px`, weight `750`, and `104px × 44px`, matching adjacent labels.
- Consecutive transitions through `/16?ap_shop=knitido`, `/community`, and `/18` kept the same visual order. On the shop page, the header remained at document position `0` before shop content through the `6600ms` check.
- Responsive checks at `320`, `390`, `768`, and `1440` CSS pixels found no clipped labels or horizontal overflow. The `390px` mobile click test held the intended order from the first sample through `3450ms`.
- Browser console checks reported no warnings or errors after the desktop and mobile navigation runs.
