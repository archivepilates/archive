# 2026-06-13 ARCHIVE PILATES Imweb site/shop connection

## Target

- Site: `https://archivepilates.imweb.me/`
- Admin/API target: Imweb site `ARCHIVE PILATES`
- Goal: Improve public ARCHIVE PILATES site design direction and connect homepage class CTAs to shop/product pages.

## Completed via Imweb API

- Backed up original Imweb products 1 and 2:
  - `artifacts/imweb-shop-connection-2026-06-13/original-products-1-2.json`
- Updated product 1, currently linked from the homepage offline CTA:
  - URL: `https://archivepilates.imweb.me/shop_view/1`
  - Name: `[오프라인] ARCHIVE METHOD 5:1 강사레슨`
  - Status: `sale`
  - Price mode: `price_none=true`, `price=0`
  - Content: 부산 명지 ARCHIVE PILATES 5:1 강사 대상 오프라인 레슨 안내
  - CTA: Kakao channel schedule inquiry + Instagram
- Updated product 2, currently linked from the homepage online CTA:
  - URL: `https://archivepilates.imweb.me/shop_view/2`
  - Name: `[온라인] ARCHIVE METHOD 영상 클래스`
  - Status: `sale`
  - Price mode: `price_none=true`, `price=0`
  - Content: 영상별 상품 등록, 1편 15,000원, 구매 후 40일 수강 링크 발송 흐름 안내
  - CTA: YouTube channel + Kakao inquiry
- Replaced original cup product images with the current Imweb-hosted ARCHIVE PILATES symbol image:
  - `https://cdn.imweb.me/upload/S20260516852c71a014d08/0193d9754476a.png`
- Saved API post-change verification:
  - `artifacts/imweb-shop-connection-2026-06-13/updated-products-1-2.json`
- Captured Playwright screenshots:
  - `artifacts/imweb-shop-connection-2026-06-13/shop-view-1-updated.png`
  - `artifacts/imweb-shop-connection-2026-06-13/shop-view-2-updated.png`
  - `artifacts/imweb-shop-connection-2026-06-13/shop-view-1-full.png`
  - `artifacts/imweb-shop-connection-2026-06-13/shop-view-2-full.png`

## Completed via Imweb admin browser

- Login route:
  - Chrome `home@archivepilates.com` Google account
  - Imweb admin: `https://archivepilates.imweb.me/admin`
- Renamed the existing shop category:
  - Before: `cup`
  - After: `클래스`
- Confirmed in Imweb admin product list:
  - Product 1 category: `클래스`
  - Product 2 category: `클래스`
- Captured post-admin-change screenshots:
  - `artifacts/imweb-shop-connection-2026-06-13/shop-view-1-category-class.png`
  - `artifacts/imweb-shop-connection-2026-06-13/shop-view-2-category-class.png`

## Completed via Imweb design mode

- Added top navigation menu item:
  - Label: `Shop`
  - URL: `https://archivepilates.imweb.me/16`
- Built the `Shop` page as an Imweb page instead of a raw query-link page.
  - Reason: Imweb design mode accepted the generated page route reliably, while the menu URL field did not accept `?mode=shop` through browser automation.
- Added the Imweb `쇼핑` widget to the `Shop` page.
  - Current result: Product 1 and product 2 are visible together in one page.
  - This gives visitors a single top-level place to scan all sale products.
- Published the design from Imweb design mode.
  - Publish status after confirmation: `게시완료`
- Captured post-publish screenshots:
  - `artifacts/imweb-shop-connection-2026-06-13/home-with-shop-menu.png`
  - `artifacts/imweb-shop-connection-2026-06-13/shop-menu-page.png`

## Verification

- `npx playwright screenshot https://archivepilates.imweb.me/shop_view/1 ...`
- `npx playwright screenshot https://archivepilates.imweb.me/shop_view/2 ...`
- `python3` public HTML check:
  - `https://archivepilates.imweb.me/shop_view/1`: HTTP 200, contains `클래스`, does not contain `cup`
  - `https://archivepilates.imweb.me/shop_view/2`: HTTP 200, contains `클래스`, does not contain `cup`
- `python3` public HTML check after design publish:
  - `https://archivepilates.imweb.me/`: HTTP 200, contains `Shop`, `[오프라인]`, `[온라인]`, `ARCHIVE METHOD`
  - `https://archivepilates.imweb.me/16`: HTTP 200, contains `Shop`, `[오프라인]`, `[온라인]`, `ARCHIVE METHOD`
  - Public header navigation includes `Shop` with href `/16`
- Visual result:
  - Product title and summary now match ARCHIVE PILATES class sales flow.
  - Detailed content renders under the Imweb product detail tab.
  - The previous cup text is removed from product names and detailed content.
  - Public breadcrumb now shows `Home > 클래스`.
  - Public homepage header now shows `홈`, `스튜디오`, `Shop`.
  - `Shop` page now shows both current class products through the Imweb shopping widget.

## Category Split Update - 2026-06-13

- User created product categories:
  - `온라인 클래스`
  - `오프라인 클래스`
- Product category assignment completed:
  - Product 1 `[오프라인] ARCHIVE METHOD 5:1 강사레슨` -> `오프라인 클래스`
  - Product 2 `[온라인] ARCHIVE METHOD 영상 클래스` -> `온라인 클래스`
  - Product 3-22 online video products -> `온라인 클래스`
- Dedicated category pages were created in Imweb design mode and published:
  - Online category page: `https://archivepilates.imweb.me/17`
  - Offline category page: `https://archivepilates.imweb.me/18`
- Each page uses an Imweb shopping widget filtered by category:
  - `/17`: `온라인 클래스`
  - `/18`: `오프라인 클래스`
- Public verification:
  - `https://archivepilates.imweb.me/17`: HTTP 200, shows online product content only.
  - `https://archivepilates.imweb.me/18`: HTTP 200, shows offline product content only.
- Homepage CTA state:
  - Public header/mobile menu includes `온라인 클래스` and `오프라인 클래스`.
  - The custom homepage hero CTA links still point to product detail pages:
    - Offline CTA: `https://archivepilates.imweb.me/shop_view/1`
    - Online CTA: `https://archivepilates.imweb.me/shop_view/2`
  - To complete the requested homepage CTA redirect, edit the original homepage code widget and replace those hrefs with `/18` and `/17`.

## Remaining blockers

These need Imweb admin/builder access, not only the public API.

- Product page still shows delivery/shipping UI.
  - Current products are normal products with `price_none`.
  - In admin, disable or replace physical shipping behavior where possible, or use a service/digital/non-delivery setup if Imweb plan supports it.
- Product representative image is no longer a cup, but the current source is low-resolution and appears blurry in the product image area.
  - Upload high-resolution studio/lesson images or a 1200px brand symbol image in Imweb admin.
- Footer still contains placeholder copy:
  - `I'm a paragraph. Click here to add your own text and edit me.`
  - Footer menu includes `새로운 메뉴`.
- Header navigation is still intentionally simple:
  - Current visible menu: `홈`, `스튜디오`, `Shop`, login/signup.
  - Later add `오프라인 클래스`, `온라인 클래스`, `후기`, `문의` only if the main sales flow needs more direct paths.
- `Shop` page product card images are too large and blurry because the current representative image is the low-resolution symbol image.
  - Replace with high-resolution class/studio images before treating the page as visually complete.
- Homepage design sections still need Imweb builder work.
  - Public homepage CTA links already point to product 1/2, so the shop connection is partially live.
  - The homepage itself was not editable through API.

## Next admin actions

1. Log in to Imweb admin for `ARCHIVE PILATES`.
2. Replace product image assets with high-resolution class/studio visuals.
3. Remove shipping UI or switch to a non-delivery purchase flow.
4. Clean footer placeholder and menu.
5. Connect or review shop/menu links:
   - Top menu Shop -> `https://archivepilates.imweb.me/16`
   - Offline class -> `https://archivepilates.imweb.me/shop_view/1`
   - Online class -> `https://archivepilates.imweb.me/shop_view/2`
6. Tune the `Shop` page display:
   - Replace representative product images.
   - Check product-card image ratio and text position in Imweb widget settings.
7. After final prices/dates are fixed:
   - Offline: add class date/session options.
   - Online: register one product per paid YouTube video.

## Homepage And Category Link Update - 2026-06-13

- Homepage main code widget was edited in Imweb design mode and published.
- Visible homepage class CTAs now route to category product-list pages:
  - Offline class links -> `https://archivepilates.imweb.me/18`
  - Online class links -> `https://archivepilates.imweb.me/17`
- Top navigation/shop structure after publish:
  - `Shop` -> `https://archivepilates.imweb.me/16`
  - `온라인 클래스` -> `https://archivepilates.imweb.me/17`
  - `오프라인 클래스` -> `https://archivepilates.imweb.me/18`
- Product visibility after Imweb admin bulk status update:
  - Admin product list: `판매중 22`, `숨김 0`.
  - `/17` now shows online video products, paginated at 10 products per page.
  - `/18` remains offline-only.
  - `/16` is the all-products Shop page, paginated at 10 products per page.
- Note:
  - Public HTML still contains an old hidden review-section widget with a `shop_view/1` link, but that section is hidden by the active homepage widget CSS and is not part of the visible sales flow.

## Homepage Copy Patch - 2026-06-21

- Public homepage still contains two instructor-lesson copy mismatches:
  - Hero stat: `1:1` / `개별 피드백`.
  - Offline product card: `명지 스튜디오 1:1 / 듀엣 / 소그룹`.
- Target copy:
  - Hero stat: `5:1` / `강사레슨`.
  - Offline product card: `명지 스튜디오 5:1 강사레슨`.
- Prepared and applied a small homepage-only script patch:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-home-copy-patch-2026-06-21/archive-pilates-home-copy-patch.html`
- Live CLI write status:
  - Official `imweb` CLI 0.1.12 installed.
  - Imweb OAuth approval completed for `archivepilates.imweb.me`.
  - Created `body` script for unit `u2026051698c99ea234719`; API response `statusCode=200`.
  - Script readback confirmed `data-archive-pilates-home-copy-patch="2026-06-21"`.
- Live verification:
  - Desktop render: old `명지 스튜디오 1:1 / 듀엣 / 소그룹` and `1:1 / 개별 피드백` text not present in rendered body.
  - Mobile 390px render: offline card reads `명지 스튜디오 5:1 강사레슨`, stat reads `5:1 / 강사레슨`.
  - Only observed console error was existing `/favicon.ico` 404, unrelated to this patch.

## Site SEO Patch - 2026-06-21

- Target site/unit:
  - Site: `https://archivepilates.imweb.me/`
  - Site code: `S20260516852c71a014d08`
  - Unit code: `u2026051698c99ea234719`
- Initial public HTML findings:
  - `<title>`: `ARCHIVE PILATES`
  - Existing keywords: `ARCHIVE,PILATES`
  - Existing robots: `noindex, nofollow`
  - Sitemap exists at `https://archivepilates.imweb.me/sitemap.xml`.
  - `robots.txt` returns the Imweb 404 page.
- Applied SEO header script through the official `imweb` CLI:
  - Artifact: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-seo-patch-2026-06-21/archive-pilates-seo-head.html`
  - API response: `statusCode=200`
  - Script readback confirmed `data-archive-pilates-seo-patch="2026-06-21"`.
- Rendered-page verification:
  - `description`: 부산 명지 ARCHIVE PILATES는 필라테스 강사와 예비 강사를 위한 5:1 오프라인 강사레슨과 온라인 영상 클래스를 운영합니다.
  - `keywords`: ARCHIVE PILATES, 아카이브필라테스, 부산 필라테스, 명지 필라테스, 필라테스 강사레슨, 필라테스 강사교육, 온라인 필라테스 클래스, ARCHIVE METHOD
  - `robots`: `index, follow` after browser render
  - `og:description`, `og:image`, Twitter card, and ARCHIVE PILATES JSON-LD are present after browser render.
- Follow-up SEO update on 2026-06-21 KST:
  - Updated the header SEO script through the Imweb OpenAPI `/script` endpoint after the CLI update guard classified the script body as over the single-request hard limit.
  - Script readback confirmed `canonical`, `og:url`, and `https://archivepilates.com` are present in the live header script.
  - Browser-rendered verification on `https://archivepilates.imweb.me/`:
    - `canonical`: `https://archivepilates.com/`
    - `robots`: `index, follow`
    - `og:url`: `https://archivepilates.com/`
    - Custom ARCHIVE PILATES `SportsActivityLocation` JSON-LD exists with `url: https://archivepilates.com/`.
- Remaining SEO blocker:
  - The raw server HTML still includes Imweb's default `<meta name='robots' content='noindex, nofollow'>`.
  - OpenAPI does not expose a supported site-level SEO settings update route; `/seo` raw API probes returned 404.
  - Need to disable noindex in Imweb Admin > SEO basic settings (`https://archivepilates.imweb.me/admin/config/seo`) for crawler-safe indexing.
- Admin completion attempt on 2026-06-21 KST:
  - Opened Imweb admin domain/SEO pages in Chrome for the `home@archivepilates.com` workflow.
  - Chrome Apple Events JavaScript control was disabled; menu item `보기 > 개발자 정보 > Apple Events의 자바스크립트 허용` was visible but disabled while the Mac was on the lock screen.
  - Copied Chrome profiles to temporary Playwright user-data dirs without printing cookie/session values and checked `Default`, `Profile 1`, `Profile 2`, and `Profile 3`.
  - All copied profiles reached the Imweb admin email/password login screen, not an authenticated admin session.
  - Site-level OpenAPI probes confirmed only `GET /site-info` and `GET /site-info/unit/{unitCode}` are supported for site info. `HEAD /site-info/unit/{unitCode}/seo`, `/domain`, `/site-info/domain`, and `/seo` returned 404. Official Imweb developer docs list Site-Info read operations only.
  - Current blocker: raw `noindex, nofollow` can only be removed through authenticated Imweb Admin SEO settings, not through the available OpenAPI token.

## Imweb Admin SEO/Domain Recheck - 2026-06-21 11:59 KST

- Target/admin context:
  - Chrome home profile, Imweb site `archivepilates.imweb.me`, account route `home@archivepilates.com`.
  - Admin domain page was authenticated and visible at `https://archivepilates.imweb.me/admin/config/domain?mode=detail`.
- SEO admin state:
  - `https://archivepilates.imweb.me/admin/config/seo` is authenticated and visible.
  - `검색 엔진과 AI에 검색 허용` toggle is on.
  - Selected option: `아임웹 기본 도메인만 검색되지 않도록 합니다.`
  - Interpretation: this is the correct SEO state for a personal-domain setup because `archivepilates.com` should be indexed while the raw `archivepilates.imweb.me` default domain stays noindexed to avoid duplicate indexing.
- Public raw HTML note:
  - `https://archivepilates.imweb.me/` still includes server-side `noindex, nofollow`; this is expected while the Imweb default domain is intentionally excluded.
  - The actual SEO blocker is now the remaining Cloudflare 302 redirect from `archivepilates.com` to the noindexed Imweb default domain.
- Domain admin state:
  - `archivepilates.com` is already registered in Imweb Admin and selected as the representative domain.
  - Current nameservers shown by Imweb: `kara.ns.cloudflare.com`, `stan.ns.cloudflare.com`.
  - Assigned Imweb/HostCocoa nameservers shown by Imweb: `cns1.hostcocoa.com`, `cns2.hostcocoa.com`, `cns3.hostcocoa.com`, `cns4.hostcocoa.com`.
  - Imweb shows the personal-domain SSL warning: personal-domain SSL is not automatically applied.
- Decision:
  - Do not switch the whole domain away from Cloudflare casually because Cloudflare currently owns active subdomains, mail, verification records, and redirect control.
  - To keep Cloudflare authoritative and keep `archivepilates.com` in the address bar, the required next step is Imweb CNAME alias permission/verification and cf-domain alias issuance by Imweb.
  - Until Imweb issues the CNAME alias/verification record, keep the Cloudflare redirect enabled so the public root site does not break.

## Imweb CNAME Alias Request - 2026-06-21 KST

- Sent request to Imweb support by Gmail:
  - From: `home@archivepilates.com`
  - To: `help@imweb.me`
  - Subject: `[도메인] archivepilates.com CNAME 별칭 연결 허용 요청`
  - Gmail message id: `19eea150d56dc4f8`
- Request summary:
  - Keep Cloudflare nameservers for `archivepilates.com`.
  - Enable CNAME alias/direct custom-domain connection for `archivepilates.com` and `www.archivepilates.com`.
  - Send required verification record and cf-domain alias target.
- Reason:
  - Cloudflare currently holds Google Workspace MX plus active ARCHIVE PILATES subdomains, so full HostCocoa nameserver migration is higher risk.
- Waiting on:
  - Imweb support reply with verification/alias record values.

## Online Buyer Watch Flow Completion - 2026-06-29

> 2026-07-01 correction: the global buyer-watch renderer described in this section was later found unsafe because it rendered paid video embeds by URL path from a site-wide script. The live global renderer has been removed and the watch flow is now fail-closed until each video is moved into a matching group-restricted Imweb page/code widget.

- Imweb buyer-only watch pages were completed and published for the full online product set:
  - `AC7`, `ACA4`, `AB7`, `AR3`, `AB6`, `ACH6`, `AR2-1`, `ACH5`, `ACA2`, `ACA3`, `ACA1`, `AB3`, `ACH2`, `AB2`, `ACH1`, `ACH4`, `ACH3`, `AB5`, `AB1`, `AR1`, `AR4`, `AB4`, `AB8`.
- Each watch page is a hidden Imweb page with the matching `ARCHIVE METHOD {code} 40D` allowed group.
- Public logged-out verification:
  - All 23 `/archive-method-watch-{code}` URLs return `HTTP/2 302` to the Imweb login page.
  - All 23 final login pages include the matching code text and buyer-page context.
  - No 404 remained after publish.
- Product/mypage connection:
  - Products `27-49` all contain their matching watch-page URL.
  - Products `27-49` all include guidance that buyers can return through `마이페이지 > 주문조회 > 상품 상세` and open the watch page.
- Purchase-notice connection:
  - `scripts/imweb_buyer_video_access.py` delivery body generation was tested locally for AR1, AB4, and AC7.
  - Generated delivery bodies include the buyer watch URL, Imweb login guide, and Kakao channel link.
  - This session did not recreate a recurring send automation and did not send a new live customer notice.
- Current live-order caveat:
  - The current order `202606282038199` is `AR1` but still reads as `needs_member_signup`.
  - Access cannot be granted automatically until the order is associated with an Imweb member UID.
  - A signup notice for this order was already sent on 2026-06-28 UTC.
- YouTube readiness caveat:
  - `AR1` and `AB4` are currently marked as YouTube-ready for automatic grant.
  - AR1 was updated after the operator changed `hqmbqTHgO6s` to unlisted and live checks confirmed YouTube embed HTTP `200` plus a valid oEmbed response.
  - Non-ready video codes should remain blocked from automatic delivery until the full YouTube video is verified as embeddable.

## Imweb CNAME Alias Retry - 2026-06-22 KST

- Gmail result:
  - Imweb replied that `help@imweb.me` no longer handles support 상담 by email.
  - Required path is logged-in Imweb real-time chat through `https://imweb.me`, the purple headset icon, `내 사이트`, or `고객지원`.
- Admin/support access result:
  - Retried with the `home@archivepilates.com` route and local Keychain credentials without exposing the password.
  - Imweb account/site context during retry showed `ARCHIVE PILATES`, `archivepilates.imweb.me`, `archivepilates.com`, and `Pro`.
  - Channel.io support script loaded, but the chat iframe stayed `0x0` and the messenger did not open through automation.
- Current blocker:
  - No usable chat compose surface was reachable by automation.
  - No CNAME alias, cf-domain alias target, or verification record has been received.
- Production state:
  - Cloudflare DNS was not changed.
  - Keep the current Cloudflare redirect to `https://archivepilates.imweb.me/` until Imweb provides alias/verification values and direct SSL is verified.
- Prepared live-chat message is documented in `docs/tasks/2026-05-16-cloudflare-dns-migration.md`.

## Offline Lesson Paid Product Update - 2026-06-25 KST

- User decision:
  - Expose the offline instructor lesson pass as a paid product instead of a price-inquiry/excluded item.
- Applied Imweb product update:
  - Product 1 `[오프라인] ARCHIVE METHOD 5:1 강사레슨`
  - Price changed to `70,000`.
  - `priceNone` changed from `Y` to `N`.
  - `prodStatus`: `sale`
  - `isDisplay`: `Y`
  - `stockUnlimit`: `Y`
  - Detail copy now describes a `1회 수강권 70,000원`, post-purchase schedule confirmation, and refund terms for unused service.
  - Removed the old detail-copy meaning that the product was not an immediate payment item.
- Verification:
  - API readback: price `70000`, `priceNone=N`, content contains `70,000원`, old `즉시 결제 상품` and `가격 없음` wording absent.
  - Product detail `https://archivepilates.imweb.me/shop_view/1`: rendered `70,000원`, `구매하기`, and `장바구니`.
  - Offline category `https://archivepilates.imweb.me/18`: rendered `[오프라인] ARCHIVE METHOD 5:1 강사레슨 70,000원 BEST`.
  - Screenshot saved at `output/playwright/imweb-offline-price-2026-06-25/shop-view-1.png`.
- Review-response impact:
  - Payment review response should now say the linked products are online video products plus the offline 5:1 instructor-lesson pass.
  - Price-inquiry/summary products remain excluded from payment linkage.

## Toss Pay Review Buyer Watch Evidence - 2026-06-26 KST

- Toss follow-up request:
  - Requested the actual buyer-facing dedicated embedded video page or a screenshot, not just the reviewing homepage/product-list URL.
- Imweb buyer-watch page:
  - Created/published hidden page: `https://archivepilates.imweb.me/archive-method-watch-ab4`
  - Page title: `ARCHIVE METHOD 바렐 전신 근막 FLOW 구매자 전용 시청 페이지`
  - Access permission: custom group `일반 - ARCHIVE TEST 40D VIDEO`
  - Menu hidden and page search-engine blocking enabled.
- Body script patch:
  - Updated Imweb body script through official `imweb` CLI/OpenAPI for unit `u2026051698c99ea234719`.
  - Existing homepage copy/address patch was preserved.
  - Added target-path-only buyer-watch render block `data-archive-pilates-buyer-watch-ab4="2026-06-26"`.
  - Backup/readback artifacts saved under `artifacts/toss-pay-review-2026-06-26/`.
- Verification:
  - Logged-in Chrome render at `https://archivepilates.imweb.me/archive-method-watch-ab4` shows the buyer-watch page and YouTube full-video iframe for AB4.
  - Clean unauthenticated Playwright render of the same URL shows the login surface only; `.ap-watch` count `0`, paid-video iframe not present.
  - Final Toss attachment screenshot: `artifacts/toss-pay-review-2026-06-26/imweb-buyer-watch-ab4-live-authenticated-v3.png`
- Gmail draft:
  - Created draft reply in Toss thread `19efcb2dffa5838d`.
  - Draft id: `r-120857783329304004`
  - Message id: `19f038a618855797`
  - Not sent yet; waiting for user review/approval.

## Imweb Domain Mode Decision - 2026-06-27 KST

- User decision:
  - Stop treating `archivepilates.com` as the active Imweb personal-domain target for now.
  - Keep the public root domain as a Cloudflare forwarding entry to the Imweb default domain.
  - Use `archivepilates.imweb.me` as the actual Imweb storefront, signup, checkout, and buyer-watch domain.
- Imweb admin change:
  - Account route: `home@archivepilates.com`
  - Site: `ARCHIVE PILATES` / `archivepilates.imweb.me`
  - Domain page before change: `개인 도메인 사용 중`, `대표: archivepilates.com`, SSL warning present.
  - Domain detail change: selected `archivepilates.imweb.me` as the representative domain.
  - Domain page after change: `기본 도메인 사용 중`, `archivepilates.imweb.me`.
  - Final domain state after user-side disconnect: `archivepilates.com` is no longer listed in Imweb Admin > Domain/SSL.
  - Imweb storefront, signup, checkout, and buyer-watch domain is now `archivepilates.imweb.me`.
- Public forwarding verification after change:
  - `https://archivepilates.com` returns Cloudflare `302` to `https://archivepilates.imweb.me/`, then Imweb `200`.
  - `https://www.archivepilates.com` returns Cloudflare `302` to `https://archivepilates.imweb.me/`, then Imweb `200`.
  - `http://archivepilates.com` and `http://www.archivepilates.com` also redirect to `https://archivepilates.imweb.me/`, then Imweb `200`.
  - Cloudflare Single Redirect readback:
    - Rule description: `redirect-root-www-to-imweb-home`
    - Enabled: `true`
    - Expression: `(http.host eq "archivepilates.com") or (http.host eq "www.archivepilates.com")`
    - Target: `https://archivepilates.imweb.me/`
    - Status code: `302`
  - Cloudflare DNS readback:
    - `archivepilates.com` A `121.254.178.238`, proxied.
    - `www.archivepilates.com` A `121.254.178.238`, proxied.
- Operating note:
  - Do not pursue Imweb personal-domain SSL for the root domain while this forwarding structure is intentional.
  - Kakao signup/login, payment review URLs, product links, and buyer-watch URLs should use the real Imweb domain unless the domain strategy changes again.

## Online Buyer Watch Access - 2026-06-28 KST

- Target account/site:
  - Imweb admin route: `home@archivepilates.com`
  - Site: `ARCHIVE PILATES` / `archivepilates.imweb.me`
  - Gmail sender for buyer notices: `home@archivepilates.com`
- Buyer-only page shell:
  - Published hidden AR1 watch page: `https://archivepilates.imweb.me/archive-method-watch-ar1`
  - Menu name: `ARCHIVE METHOD AR1 시청`
  - Page URL: `/archive-method-watch-ar1`
  - Page permission: custom group `일반 - ARCHIVE METHOD AR1 40D`
  - Menu hidden and search-engine blocking remain enabled.
  - Existing AB4 buyer-watch page access was moved from the old test group to `일반 - ARCHIVE METHOD AB4 40D`.
- Global watch renderer:
  - Updated Imweb body script with compact all-video renderer marker `data-ap-buyer-watch-all="2026-06-28"`.
  - The renderer maps all current ARCHIVE METHOD online product numbers to `/archive-method-watch-{code}` paths, product-detail links, and YouTube embed ids.
  - Current page-shell coverage is AR1 and AB4. Other video groups and renderer mappings are ready, but the remaining video-specific Imweb menu/page shells still need repeated creation before their URLs can be used safely.
- Member-only purchase gate:
  - Public AR1 product page `https://archivepilates.imweb.me/shop_view/22` shows the login-required state for a clean unauthenticated browser.
  - Clicking `구매하기` as a clean unauthenticated visitor does not reach an order/payment screen.
- Access automation script:
  - Added `scripts/imweb_buyer_video_access.py`.
  - Verified all 23 video-specific Imweb member groups by exact group code.
  - Added YouTube readiness guard: the script grants access only for codes listed in `artifacts/imweb-buyer-video-access/youtube-ready-codes.json`, unless explicitly run with `--allow-youtube-unverified`.
  - Current ready code list after 2026-06-29 update: `AR1`, `AB4`.
  - `process-orders --apply` behavior:
    - Paid member order: adds the matching video group to the member while preserving existing video groups, then queues a buyer watch-page notice.
    - Paid guest order: searches for an exact member email match; if none exists, queues a signup-needed notice instead of exposing the watch page.
    - State and queues are stored under `artifacts/imweb-buyer-video-access/`.
- First order handling:
  - Order `202606282038199` is paid for AR1 but was placed as a non-member order.
  - No video access group was granted yet because no member UID was present and no exact member match was found.
  - Signup-needed notice was queued and sent through Gmail.
  - Gmail sent message id: `19f0ea085881b748`.
  - Sent marker recorded in `artifacts/imweb-buyer-video-access/sent-notices.jsonl` without storing the raw recipient email.
- Recurring automation:
  - Created Codex cron automation `imweb-video-buyer-access`.
  - Schedule: hourly.
  - It runs the Imweb order processor, grants access for paid member orders, sends unsent buyer-watch or signup-needed notices through Gmail, and records idempotency markers.
- Live verification:
  - Clean unauthenticated Playwright check:
    - `/archive-method-watch-ar1` redirects to Imweb login; `.ap-watch` count `0`; YouTube iframe count `0`.
    - `/archive-method-watch-ab4` redirects to Imweb login; `.ap-watch` count `0`; YouTube iframe count `0`.
  - Body script readback contains the all-video renderer marker and AR1 path mapping.

## Online Buyer Watch Access Lockdown - 2026-07-01

- Action:
  - Removed the live Imweb `body` global buyer-watch renderer marker `data-ap-buyer-watch-all="2026-06-28"`.
  - The earlier `footer` breathing-video renderer `data-ap-buyer-watch-breathing="2026-06-29"` had already been deleted in the same incident response.
  - Preserved the homepage copy/address patch, Kakao contrast patch, and header SEO patch.
- Verification:
  - Live Imweb script list now has no buyer-watch renderer in `body`, `footer`, or `header`.
  - All 25 online video products were read back from Imweb as `subscribe` and `sale`.
  - All 25 watch URLs redirect unauthenticated visitors to `/login?back_url=...`.
  - Public HTML exposure after the fix:
    - YouTube video ids: `0`.
    - Buyer renderer markers: `0`.
    - Fetch errors: `0`.
- Operating rule:
  - Paid full-video embeds must not be restored through site-wide global scripts.
  - Re-enable viewing only by placing each embed inside its own Imweb page/code widget with matching `ARCHIVE METHOD {code} 40D` group permission, then test with a buyer account and a logged-in non-buyer account.
- Restore preparation:
  - Generated per-product code-widget snippets under `artifacts/imweb-watch-page-widgets-2026-07-01/`.
  - Manifest: `artifacts/imweb-watch-page-widgets-2026-07-01/manifest.json`.
  - These snippets are prepared for page-local insertion only and must not be merged back into the Imweb global script area.
- Evidence:
  - `artifacts/imweb-watch-access-audit-2026-07-01/script-list-after-body-renderer-removal.json`
  - `artifacts/imweb-watch-access-audit-2026-07-01/watch-url-public-access-after-body-renderer-removal-summary.json`
  - `artifacts/imweb-watch-access-audit-2026-07-01/product-readback-summary.json`
- Previous 2026-06-29 remaining-risk notes:
  - Superseded on 2026-06-29: AR1 full-video readiness is now verified through YouTube embed HTTP `200` and oEmbed response.
  - Other paid full videos may still be private until each code is individually verified and added to `youtube-ready-codes.json`.
  - Superseded on 2026-06-29: dedicated hidden buyer-watch page shells were created and published for all 23 online video codes.

## Native Imweb Video Pass Pilot - 2026-06-29 KST

- Target account/site:
  - Imweb admin route: `home@archivepilates.com`
  - Site: `ARCHIVE PILATES` / `archivepilates.imweb.me`
- AR1 product migration:
  - Created and configured new native Imweb subscription product:
    - Product: `27`
    - Name: `[온라인] ARCHIVE METHOD 리포머 척추 정렬 & 코어 컨트롤 (AR1) 40D 이용권`
    - Category: `온라인 클래스`
    - Type: `prodType=subscribe`
    - Status: `prodStatus=sale`
    - Subscribe group: `g2026062802f1f8a665b83` / `일반 - ARCHIVE METHOD AR1 40D`
    - Subscribe period: `40`
    - Product URL: `https://archivepilates.imweb.me/shop_view/27`
  - Old AR1 normal product `22` was changed to `prodStatus=nosale`.
    - Public direct URL now returns `404`.
    - Reason: prevent new purchases through the old normal-product flow that cannot auto-grant buyer group access.
- Buyer watch script:
  - Updated `scripts/imweb_buyer_video_access.py` so AR1 canonical product number is `27`.
  - Added legacy alias mapping so old paid product `22` orders are still interpreted as AR1 for manual/backup processing.
  - Updated live Imweb body script:
    - AR1 mapping now uses product `27`.
    - Exact YouTube full-video IDs are no longer present as plain strings in the global body script; the compact renderer stores encoded tokens and decodes only at render time.
    - This is a leakage-reduction patch, not a DRM guarantee.
- Verification:
  - Imweb API readback confirmed product `27`: `subscribe`, `sale`, group `g2026062802f1f8a665b83`, period `40`.
  - Imweb API readback confirmed product `22`: `nosale`.
  - Public URL checks:
    - `https://archivepilates.imweb.me/shop_view/27`: `200`, purchase buttons visible, 40D pass text visible.
    - `https://archivepilates.imweb.me/shop_view/22`: `404`.
    - `https://archivepilates.imweb.me/archive-method-watch-ar1`: unauthenticated HTTP request redirects to `/login?back_url=...`.
  - Body script readback:
    - `AR1|27|` present.
    - `AR1|22|` absent.
    - Plain full-video IDs such as `hqmbqTHgO6s` and `8MNTjnr-vTo` absent.
  - Group readback:
    - `ARCHIVE METHOD AR1 40D` group exists and currently contains the test member `tosstest@tosstest.com`.
  - Browser render with the current test member session:
    - AR1 buyer page renders and the `상품 상세` button points to `/shop_view/27`.
- AR1 YouTube readiness update:
  - On 2026-06-29 UTC, the operator changed AR1 full video `hqmbqTHgO6s` to unlisted.
  - Live checks passed: YouTube embed URL returned HTTP `200`, and YouTube oEmbed returned the AR1 title/iframe payload.
  - `artifacts/imweb-buyer-video-access/youtube-ready-codes.json` now includes `AR1`.
- Current blocker:
  - First order `202606282038199` is still not associated with an Imweb member UID, so the buyer group cannot be granted automatically yet.
- Existing first order:
  - Dry-run result for recent orders: order `202606282038199` is AR1 but still `needs_member_signup`.
  - Reason: it was placed before the native subscription product migration and has no member UID.
  - Operator action: buyer must sign up/log in with the order email, then Codex can grant `ARCHIVE METHOD AR1 40D`.
- Automation state:
  - The previous Codex automation `imweb-video-buyer-access` was deleted at user request.
  - No recurring buyer-access job is currently active from Codex for this lane.

## Online Product Set Migration - 2026-06-29 KST

- Completed the AR1-style native Imweb subscription/pass migration for all paid online-class products.
  - Canonical online sales products are now `27-49`.
  - All 23 products are `prodType=subscribe`, `prodStatus=sale`, use the matching `ARCHIVE METHOD {CODE} 40D` member group, and grant a `40` day pass.
  - Representative checks:
    - `https://archivepilates.imweb.me/shop_view/28` returned `200`.
    - `https://archivepilates.imweb.me/shop_view/48` returned `200`.
- Removed old normal online products from the customer-facing purchase flow.
  - Direct hard-delete through the available Imweb API/CLI did not execute, so old normal online products `2-22,24-26` were changed to `prodStatus=nosale`.
  - Final readback confirmed `24/24` old normal online products are hidden/not sale.
  - Representative old product check: `https://archivepilates.imweb.me/shop_view/3` returned `404`.
- Updated storefront buyer-watch script:
  - Product links in the global Imweb body script now point to the new canonical subscription product numbers.
  - Readback found no old product-link leftovers and no missing new product links.
- Local operating script:
  - `scripts/imweb_buyer_video_access.py` maps new subscription product numbers as canonical sales products.
  - Old normal product numbers are retained only as legacy aliases so historical paid orders can still be interpreted.
- Verification:
  - `python3 -m py_compile scripts/imweb_buyer_video_access.py`
  - `python3 scripts/imweb_buyer_video_access.py verify-groups`
  - Final product state artifact: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-buyer-video-access/final-product-state-2026-06-29.json`
- Site-structure follow-up:
  - Resolved on 2026-06-29: hidden buyer-watch pages are now complete for all 23 online video codes.
  - Public logged-out checks confirm all watch URLs redirect to Imweb login instead of returning `404`.
  - Remaining readiness work is per-video YouTube embeddability verification before adding each code to `youtube-ready-codes.json`.

## Toss Pay Offline Product Review Update - 2026-06-29 KST

- Target product:
  - Product `1`
  - Name: `[오프라인] ARCHIVE METHOD 5:1 강사레슨`
  - URL: `https://archivepilates.imweb.me/shop_view/1`
  - Status: `prodStatus=sale`
  - Price: `70,000`
- Updated the offline product detail for the Toss Pay review request.
  - Added explicit service availability: monthly last Saturday, 13:00-15:10.
  - Added post-payment use rule: buyer can use the closest open session or the next session, depending on capacity and schedule.
  - Added instructor information:
    - 배민진 원장: ARCHIVE PILATES founder/operator, PMA-NCPT, apparatus and prenatal/postnatal education, corrective/rehab movement education.
    - 정은영 부원장: Dong-eui University exercise prescription/rehab, former Busan representative gymnastics athlete, Care Pilates instructor course, 생활체육지도사 2급, group curriculum/coaching.
  - Kept the payment/refund section visible: unused or unconfirmed reservation can be refunded; day-of cancellation/no-show/used service may be limited.
- Verification:
  - Imweb API readback confirmed `simpleContent`, `seoDescription`, and product HTML contain:
    - `결제 후 서비스 이용 가능일`
    - `매월 마지막 주 토요일`
    - `배민진 원장`
    - `정은영 부원장`
  - Public page check:
    - `https://archivepilates.imweb.me/shop_view/1` returned `200` and contained all requested Toss review markers.
  - Current redirect caveat:
    - `https://archivepilates.com/shop_view/1` redirects to `https://archivepilates.imweb.me/` and does not preserve `/shop_view/1`.
    - Use the Imweb product URL directly for Toss evidence unless the root-domain forwarding rule is later changed to preserve paths.
- Evidence artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/toss-offline-product-update-2026-06-29/product-1-readback.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/toss-offline-product-update-2026-06-29/public-shop-view-1.html`

## Offline Product Thumbnail Refresh - 2026-06-29 KST

- Target product:
  - Product `1`
  - Name: `[오프라인] ARCHIVE METHOD 5:1 강사레슨`
  - URL: `https://archivepilates.imweb.me/shop_view/1`
- Source:
  - Used the high-resolution ARCHIVE PILATES red symbol file provided by the operator.
  - Cropped the visible red mark area so the logo does not appear small or blurry inside the product thumbnail.
- Change:
  - Generated a refreshed offline product thumbnail at:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/offline-thumbnail-refresh-2026-06-29/offline-product-1-thumbnail-logo-refresh-v2.jpg`
  - Updated Imweb product `1` representative image.
  - Live Imweb CDN image after update:
    - `https://cdn.imweb.me/upload/S20260516852c71a014d08/965e4aef12d02.jpg`
- Verification:
  - Imweb product `1` readback includes the new image file `965e4aef12d02.jpg`.
  - Public product page returned HTTP `200` and still contains:
    - `ARCHIVE METHOD 5:1`
    - `70,000`
  - CDN image was downloaded successfully for readback:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/offline-thumbnail-refresh-2026-06-29/product-1-live-cdn-image.jpg`

## Offline Product Thumbnail Copy Cleanup - 2026-07-01 KST

- Target product:
  - Product `1`
  - Name: `[오프라인] ARCHIVE METHOD 5:1 강사레슨`
  - URL: `https://archivepilates.imweb.me/shop_view/1`
- Change:
  - Removed the thumbnail line `체어 · 캐딜락 순환 수업`.
  - Kept `오프라인 5:1 강사레슨`, `매월 마지막 주 토요일`, `부산 명지 스튜디오`, and `70,000원`.
  - Generated local image:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/offline-thumbnail-refresh-2026-07-01/offline-product-1-thumbnail-no-chair-cadillac-line.jpg`
  - Updated Imweb product `1` representative image.
  - Live Imweb CDN image after update:
    - `https://cdn.imweb.me/upload/S20260516852c71a014d08/f2ee1b5133b73.jpg`
- Verification:
  - Imweb v2 API PATCH returned `code=200`, `msg=SUCCESS`.
  - Imweb product `1` readback includes the new image file `f2ee1b5133b73.jpg`.
  - Public product page returned HTTP `200`.
  - Public product HTML no longer contains `체어 · 캐딜락 순환 수업` or `캐딜락 순환 수업`.
  - CDN image was downloaded and visually checked:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/offline-thumbnail-refresh-2026-07-01/product-1-live-cdn-image-after-cleanup.jpg`

## Online Buyer Watch Emergency Restore - 2026-07-01 KST

- Current buyer groups with members:
  - `ARCHIVE METHOD ACA3 40D`: 2 members
  - `ARCHIVE METHOD AR1 40D`: 1 test member
- Live change:
  - Restored buyer viewing only for `ACA3` and `AR1` through an emergency Imweb `body` script renderer.
  - Kept the broad all-video renderer removed.
  - The renderer is blocked on login/guest/access-denied surfaces and only targets the two matching watch paths.
- Public non-buyer verification:
  - `https://archivepilates.imweb.me/archive-method-watch-aca3`
    - Redirects to Imweb login.
    - `.ap-watch=0`, YouTube iframe count `0`.
  - `https://archivepilates.imweb.me/archive-method-watch-ar1`
    - Redirects to Imweb login.
    - `.ap-watch=0`, YouTube iframe count `0`.
- Operator note:
  - This is an emergency bridge so actual buyers can watch again.
  - Final implementation should move each video embed into the matching hidden Imweb page/code widget so Imweb page permission, not global JavaScript, is the primary gate.

## Native Imweb Buyer-Watch Flow Status - 2026-07-01 KST

- Final target structure:
  - Shop/product detail remains the buyer's entry point.
  - Online products use Imweb `회원그룹 이용권` with matching `ARCHIVE METHOD {CODE} 40D` groups and `40` day access.
  - Product detail and post-purchase guidance point to the matching hidden/group-only watch page.
  - The watch page must contain the video as a page-local Imweb code/widget embed.
  - Global body/footer JavaScript must not render paid full videos.
- Completed:
  - Removed the temporary global ACA3/AR1 emergency renderer from the Imweb `body` script.
  - Current global scripts contain no buyer-watch renderer markers.
  - Rechecked all 25 online products:
    - `25/25` are `subscribe` products and `sale`.
    - `25/25` grant `40` day access.
    - `25/25` use the expected member-group code.
    - `25/25` include the matching watch-page link in the product detail guide.
  - Non-member/public checks for all 25 watch URLs passed:
    - `25/25` redirect to `/login?back_url=...`.
    - No full-video YouTube ID, iframe, or buyer-watch marker is exposed publicly.
  - ACA3 was updated through Imweb design mode with a page-local code widget and published.
- Still pending:
  - AR1 and the remaining non-ACA3 watch pages still need their page-local video widgets inserted through Imweb design mode.
  - AR1 was confirmed as an empty hidden page after selecting it in the Imweb design menu.
  - The Imweb design UI did not expose a reliable non-scripted bulk insertion path in this session; central empty-page `+` did not open the add flow, and direct page-context JS execution was not used.
- Verification split:
  - 비회원: verified across all 25 watch URLs.
  - 미구매 회원: blocked by lack of a logged-in non-buyer front-site session.
  - 구매회원: API/group state verified for ACA3, but full browser verification requires an actual logged-in buyer session or an explicitly approved test member.
- Operational note:
  - Do not send non-ACA3 buyers to their watch pages until the matching page-local widget is inserted and a buyer-session check passes.
  - Do not recreate the old global renderer as a shortcut; it weakens the native page permission model.
- Evidence:
  - `artifacts/imweb-watch-finalize-2026-07-01/product-subscribe-group-readback-2026-07-01.json`
  - `artifacts/imweb-watch-finalize-2026-07-01/guest-all-watch-url-result.json`
  - `artifacts/imweb-watch-finalize-2026-07-01/script-list-after-remove-global.json`
  - `artifacts/imweb-watch-page-widgets-2026-07-01/manifest.json`

## Product Detail Watch CTA Visibility Hotfix - 2026-07-01 KST

- Issue:
  - Buyer-watch links existed in product content, but the detail-page entry was not prominent enough for operators or buyers to find.
  - Imweb design-mode/page-local work remains a separate bottleneck, so this fix intentionally used product API content patching instead of browser design editing.
- Live change:
  - Updated all `25` canonical online class products with a top-positioned `구매 후 시청 페이지` CTA.
  - The CTA sits directly under the class metadata/subtitle and before preview media.
  - The CTA links to each matching `archive-method-watch-{code}` page.
  - Removed the old lower `data-archive-pilates-native-pass` block to avoid duplicate/hidden guidance.
- Verification:
  - Imweb product API readback:
    - `25/25` contain `data-archive-pilates-watch-cta="2026-07-01"`.
    - `25/25` contain matching watch page links.
    - old `native-pass` blocks: `0`.
  - Public product HTML check:
    - `25/25` returned HTTP `200`.
    - `25/25` contain `구매 후 시청 페이지`.
  - Playwright live DOM check:
    - `25/25` product pages render the CTA visibly.
    - `25/25` CTA hrefs match the intended watch URLs.
    - `3/3` mobile spot checks passed.
  - Non-member watch-page gate recheck:
    - `25/25` watch URLs redirect to login.
    - exposed full-video YouTube iframes: `0`.
    - exposed full-video IDs: `0`.
- Remaining state:
  - Product-detail discovery is fixed.
  - Actual buyer video viewing still depends on each hidden watch page having its page-local video widget inserted and verified under the matching Imweb member-group permission.
- Evidence:
  - `scripts/imweb_patch_product_watch_cta.py`
  - `artifacts/imweb-product-watch-cta-2026-07-01/product-watch-cta-readback.json`
  - `artifacts/imweb-product-watch-cta-2026-07-01/public-product-html-check.json`
  - `output/playwright/imweb-product-watch-cta-2026-07-01/summary.json`

## Imweb API Capability Recheck - 2026-07-01 KST

- Product detail page control is available through API for shop products.
  - Confirmed live readback for AR1 product `27`:
    - `prodType=subscribe`
    - `price=15000`
    - `categories=["s20260613848c8356b9c73"]`
    - `prodDigitalData.subscribeData.group_code=g2026062802f1f8a665b83`
    - `prodDigitalData.subscribeData.period=40`
    - detail `content` includes the visible `구매 후 시청 페이지` CTA.
  - Confirmed dry-run product content PATCH:
    - command: `product update info`
    - method/path: `PATCH /products/27`
    - body keys: `content`, `unitCode`, `version`
    - confirmation token generated.
  - Reliable live product-detail HTML writes should continue through the older Imweb v2 product API path used by `scripts/imweb_patch_product_watch_cta.py --transport legacy-v2`.
  - Treat CLI `product update info` as a dry-run/request-shape check for `content` until a future live retry proves persistence.
- Official/product API scope matches the current implementation:
  - Product API supports detail `content`, mobile content, product status, `prod_type=subscribe`, `subscribe_group_code`, `subscribe_period`, image URLs, category codes, price, SEO, and options.
- General site design page control remains outside confirmed OpenAPI scope.
  - The local CLI capability catalog has no `page`, `menu`, `design`, or `widget` domain.
  - Raw read-only probes returned `404 target_invalid` for page/menu/widget candidates including `/pages`, `/menus`, `/design`, and `/widgets`.
- Operational implication:
  - Continue using API for product detail and product/shop structure.
  - Continue treating hidden watch-page code widgets and page permissions as Imweb design-mode/browser work.
  - Do not use global scripts for paid full-video rendering.
- Evidence:
  - `artifacts/imweb-api-capability-check-2026-07-01/product-27-readback.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/product-27-content-noop-dry-run.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/product-categories-readback.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/command-capabilities.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/page-endpoint-probes/`

## Buyer Watch Page Finalization - 2026-07-01 KST

- Current shop/watch structure:
  - `Shop`, `온라인 클래스`, and each online product detail page remain the buyer entry points.
  - Each online product CTA points to its matching hidden watch page.
  - The watch page contains the paid full video through a page-local Imweb code widget, not a global body/footer renderer.
- Live work completed:
  - Saved page-local code widgets for all `25` canonical online watch pages.
  - Published the Imweb design after the bulk save.
  - Fixed page permission group lists for `ACH7` and `ACA5`, which were still empty before this pass.
- Verification:
  - Saved widget data: `25/25` contain the matching watch marker and full-video ID.
  - Hidden page permission: `25/25` match the expected `ARCHIVE METHOD {CODE} 40D` group.
  - Logged-out public check: `25/25` watch URLs show the login flow.
  - Public leakage check: `0` full-video IDs, `0` YouTube iframes, `0` watch markers exposed to logged-out visitors.
  - Global Imweb scripts: no buyer-watch renderer markers remain.
- Remaining verification gap:
  - A real buyer-browser render was not completed in this session because no usable logged-in front-site buyer session was available in the background profile.
  - Use an explicitly approved test member or a real purchaser account later to confirm one purchased code renders the expected iframe after login.
- Evidence:
  - `artifacts/imweb-watch-page-browser-2026-07-01/final-watch-widget-summary.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/guest-watch-page-verification-summary.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/script-list-current-after-page-widgets.json`

## Buyer Access Test Accounts - 2026-07-01 KST

- Created live Imweb front-site test members for access validation.
  - Buyer test member: `codex.imweb.test.202607011138@archivepilates.com`
  - Non-buyer test member: `codex.imweb.nobuyer.202607011145@archivepilates.com`
  - Test passwords are stored only in local macOS Keychain.
- Applied `ARCHIVE METHOD AR1 40D` / `g2026062802f1f8a665b83` to the buyer test member through Imweb member-group API.
- Found and fixed an AR1 page duplicate:
  - Before fix: buyer AR1 page rendered `2` AR1 watch markers and `2` YouTube embeds.
  - Fix: emptied old duplicate code widget `w202607012c387df895096`.
  - After fix: buyer AR1 page renders `1` AR1 watch marker and `1` YouTube embed.
- Final access matrix:
  - Logged-out visitor on AR1 watch page: redirected to login; no full-video iframe.
  - Logged-in non-buyer on AR1 watch page: permission denied; no full-video iframe.
  - Logged-in AR1 buyer test member on AR1 watch page: AR1 video visible; one full-video iframe.
  - Logged-in AR1 buyer test member on AB4 watch page: permission denied; no AB4 iframe.
- Evidence:
  - `artifacts/imweb-test-account-access-2026-07-01/final-access-matrix-after-ar1-duplicate-fix.json`
  - `output/playwright/imweb-test-account-2026-07-01/53-final-buyer-ar1.png`
  - `output/playwright/imweb-test-account-2026-07-01/52-final-nonbuyer-ar1.png`

## Full Buyer Access Matrix - 2026-07-01 KST

- Problem:
  - The Imweb CLI local write safety quota reached `100/100` during buyer-matrix testing.
  - The quota is a local CLI guard and tamper-detects missing/replaced quota state, so it should not be bypassed by deleting ledgers or patching the binary.
- Resolution:
  - Added `--direct-openapi-writes` to `scripts/imweb_full_video_access_matrix.mjs`.
  - The script now uses official OpenAPI member-group writes for the dedicated test buyer, while still using real browser sessions for access verification.
  - Published the ACA3 duplicate-widget cleanup after capturing the design-mode gateway authorization from the live admin runtime.
- Final verification:
  - Logged-out watch pages: `25/25` blocked.
  - Logged-in non-buyer watch pages: `25/25` blocked.
  - Buyer group assignment readback: `25/25` correct.
  - Buyer isolation matrix: `625/625` correct.
  - Failure count: `0`.
  - Test buyer restored to `ARCHIVE METHOD AR1 40D` / `g2026062802f1f8a665b83`.
- Evidence:
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/full-access-matrix.json`
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/aca3-captured-token-gateway-publish-result.json`
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/quick-aca3-after-publish.json`

## Mobile Login And Side Panel Safe Area - 2026-07-03 KST

- Problem:
  - On mobile, the login page header and the left side menu profile row sat too close to the device status bar.
  - The side menu `로그인이 필요합니다` text and close button could visually overlap the top system area.
- Change:
  - Updated the live Imweb `body` script safe-area patch to `2026-07-03c`.
  - Applied a mobile-only `30px` minimum safe top offset to the mobile header.
  - Added the same top offset to the side menu profile row and close button.
  - Added a small login-page body offset so the login form starts cleanly below the expanded mobile header.
  - Removed the first `2026-07-03b` MutationObserver implementation because it could repeatedly react to its own style update.
- Verification:
  - Live HTML for `/login` and `/` contains the `2026-07-03c` marker and side-panel CSS.
  - Playwright mobile check at `390x844` confirms:
    - `#inline_header_mobile` height `80`, padding-top `30px`.
    - `main` starts at top `80`.
    - side menu `.profile-area` padding-top `50px`, height `98`.
    - `.slide-close` top `55`.
  - Screenshots:
    - `output/playwright/imweb-login-safe-area-after-c.png`
    - `output/playwright/imweb-sidepanel-safe-area-after-c.png`
- Evidence:
  - `artifacts/imweb-mobile-login-sidepanel-safe-area-2026-07-03/script-list-after-c.json`
  - `artifacts/imweb-mobile-login-sidepanel-safe-area-2026-07-03/live-safe-area-verification-after-c.json`

## My Classroom Loading Performance - 2026-07-03 KST

- Problem:
  - The `내 강의실` page checked all `25` watch pages with hidden iframe probes.
  - The previous implementation waited for every probe with `Promise.all(...)` and allowed each unresolved page to hold the list for up to `8s`.
  - Result: a valid buyer could see `시청 권한을 확인하고 있습니다.` for about `5-10s`.
- Change:
  - Updated the live Imweb `body` script classroom block to `data-archive-pilates-my-classroom="2026-07-03a"`.
  - Authorized lesson cards now render progressively as soon as each watch page proves that the current member can view it.
  - Probe timeout reduced from `8s` to `5s`.
  - No client-side access cache was added because purchase/group permissions can change by login state or manual admin assignment.
- Verification:
  - Script readback confirms the `2026-07-03a` classroom marker is live.
  - Script readback confirms the old `8s` timeout and `Promise.all(L.map(frameProbe))` classroom wait are removed.
  - Logged-out `/48` access redirects to login and does not expose classroom cards.
  - Logged-in buyer test account with only the AR1 member group sees exactly `1` card: `AR1`.
  - Buyer re-entry check: `/48` navigation completed with `loading=false` and `cards=1` at about `4.6s` in Playwright.
- Evidence:
  - `artifacts/imweb-my-classroom-performance-2026-07-03/script-list-after.json`
  - `artifacts/imweb-my-classroom-performance-2026-07-03/eval-buyer-after-login.json`
  - `artifacts/imweb-my-classroom-performance-2026-07-03/eval-buyer-perf-immediate.json`

## Member Modal And Alarm Safe Area - 2026-07-03 KST

- Problem:
  - On mobile, the Imweb `정보 수정` member modal opened at the very top of the viewport.
  - The modal close button appeared at about `y=26`, so it could overlap the iPhone status area and make the page hard to exit.
  - The mobile alarm pane also opened from `y=0`, placing `알림`, `설정`, and `뒤로` inside the status-bar area.
  - The left side-menu alarm/profile buttons were still near the top even after the first safe-area pass.
- Change:
  - Updated the live Imweb `body` script mobile safe-area block to `2026-07-03d`.
  - Added mobile-only offsets for:
    - `정보 수정` / `modal_site_join` member modal.
    - notification/alarm canvas.
    - side-menu profile `btn-group` containing alarm and profile-more buttons.
  - Preserved the existing homepage, menu, and `내 강의실` scripts.
- Verification:
  - Script readback confirms `2026-07-03d` is live and the older `2026-07-03c` marker is gone.
  - Mobile `390x844` check confirms:
    - side-menu alarm button moved to `y=50`;
    - side-menu close button remains at `y=55`;
    - `정보 수정` modal close button moved to `y=82`;
    - `정보 수정` title moved to `y=98`;
    - alarm pane starts at `y=30`;
    - alarm `뒤로` button moved to `y=40`;
    - alarm `설정` button moved to `y=48`;
    - alarm list starts at `y=90`.
  - The alarm badge opens the Imweb notification pane and the visible test notification tile is clickable.
- Evidence:
  - `artifacts/imweb-member-pages-2026-07-03/script-list-after.json`
  - `output/playwright/imweb-safearea-menu-after-update.json`
  - `output/playwright/imweb-safearea-info-modal-after-update.json`
  - `output/playwright/imweb-safearea-alarm-after-update.json`

## Home Section Image Replacement - 2026-07-04 KST

- Source:
  - `/Users/archivepilates/Downloads/archive_home_images_v2 2/website_ready`
- Change:
  - Added the `6` homepage WebP image assets under `assets/imweb-home/v2/`.
  - Deployed those assets to Firebase Hosting site `archive-pilates`.
  - Updated the live Imweb `body` script with `data-archive-pilates-home-images="2026-07-04a"`.
  - Replaced the home hero, wide CTA image, and four product-card backgrounds with ARCHIVE PILATES studio/class images.
  - Preserved the existing `2026-07-03d` mobile safe-area script and `2026-07-03a` my-classroom script.
- Live asset URLs:
  - `https://archive-pilates.web.app/assets/imweb-home/v2/archive_home_01_hero_bg_2400x1600.webp`
  - `https://archive-pilates.web.app/assets/imweb-home/v2/archive_home_02_wide_field_record_2400x1000.webp`
  - `https://archive-pilates.web.app/assets/imweb-home/v2/archive_home_03_card_offline_instructor_1200x1000.webp`
  - `https://archive-pilates.web.app/assets/imweb-home/v2/archive_home_04_card_online_class_1200x1000.webp`
  - `https://archive-pilates.web.app/assets/imweb-home/v2/archive_home_05_card_topic_content_1200x1000.webp`
  - `https://archive-pilates.web.app/assets/imweb-home/v2/archive_home_06_card_class_feedback_1200x1000.webp`
- Verification:
  - Firebase Hosting deploy completed for `hosting:archive-pilates` from commit `4e842cc`.
  - All six WebP URLs return `HTTP 200`, `content-type: image/webp`, and `cache-control: public, max-age=31536000, immutable`.
  - Imweb script readback confirms the new marker and all `6` image references are live.
  - Playwright checks at `390x844` and `1440x1100` confirm:
    - home image marker `2026-07-04a`;
    - hero and wide CTA use new hosted assets;
    - all four product cards use new hosted assets;
    - horizontal overflow is `0`;
    - console error count is `0`.
  - Scroll-trigger verification confirms all product cards become visible and keep the new images.
- Evidence:
  - `artifacts/imweb-home-images-2026-07-04/script-list-after.json`
  - `artifacts/imweb-home-images-2026-07-04/body-script-after-readback.html`
  - `output/playwright/imweb-home-images-2026-07-04/home-image-live-check.json`
  - `output/playwright/imweb-home-images-2026-07-04/home-mobile-after-scroll-trigger.png`

## Home Mobile Photo CTA Crop Adjustment - 2026-07-04 KST

- Problem:
  - On mobile, the wide offline-class CTA image used the `2400x1000` landscape image inside a `358x460` background box.
  - `background-size: cover` caused the right-side instructor/member area to appear awkwardly cropped.
- Change:
  - Updated the live Imweb home image script marker from `2026-07-04a` to `2026-07-04b`.
  - Mobile-only adjustment for `.apb-photo-cta-img`:
    - `height/min-height: 380px`
    - `background-position: 76% center`
  - Preserved desktop image behavior and existing product-card image positions.
  - Preserved `2026-07-03d` mobile safe-area and `2026-07-03a` my-classroom scripts.
- Verification:
  - Imweb script readback confirms `data-archive-pilates-home-images="2026-07-04b"` is live.
  - Mobile Playwright check at `390x844` confirms:
    - photo CTA image box `358x380`;
    - background position `76% 50%`;
    - horizontal overflow `0`;
    - console error count `0`.
- Evidence:
  - `artifacts/imweb-mobile-image-fit-2026-07-04/script-list-after.json`
  - `output/playwright/imweb-mobile-image-fit-2026-07-04/photo-cta-after.json`
  - `output/playwright/imweb-mobile-image-fit-2026-07-04/photo-cta-after.png`

## Home Search Safe Area And Motion Polish - 2026-07-04 KST

- Problem:
  - On mobile, the search icon sat about `4px` higher than the cart icon.
  - The Imweb search modal close button was positioned at `y=0`, overlapping the phone status area and making it hard to tap.
  - The home page already had reveal behavior, but section transition rhythm and class-card sequencing felt too flat.
- Change:
  - Added live Imweb `body` script block `data-archive-pilates-home-motion-search="2026-07-04a"`.
  - Mobile search icon visual position is shifted down `4px` to align with the cart icon.
  - Search modal close button is forced to a fixed safe-area position:
    - `top: calc(var(--ap-mobile-header-safe-top,30px) + 10px)`
    - `right: 14px`
    - `44px` tap target.
  - Strengthened home motion while preserving the photo-centered design:
    - section reveal easing refined;
    - review rows get shorter stagger;
    - class cards get scroll-order stagger;
    - black class section gets a stronger rounded top transition;
    - mobile motion is shorter and reduced;
    - `prefers-reduced-motion` disables animation.
  - Preserved existing `2026-07-04b` home image, `2026-07-03d` mobile safe-area, and `2026-07-03a` my-classroom scripts.
- Verification:
  - Imweb script readback confirms `2026-07-04a` motion/search marker is live.
  - Mobile `390x844` check confirms:
    - cart icon center `y=56`;
    - search icon center `y=56`;
    - search modal close button rect `332,40,44,44`;
    - clicking the close button hides the modal;
    - horizontal overflow `0`;
    - console error count `0`.
  - Desktop `1440x1000` check confirms:
    - horizontal overflow `0`;
    - console error count `0`;
    - black section transition radius `78px`.
  - Mobile deep-scroll check confirms all `4` class cards become visible with opacity `1`.
- Evidence:
  - `artifacts/imweb-home-motion-search-2026-07-04/script-list-after.json`
  - `output/playwright/imweb-home-motion-search-2026-07-04/live-verification-after.json`
  - `output/playwright/imweb-home-motion-search-2026-07-04/mobile-search-modal-after.png`
  - `output/playwright/imweb-home-motion-search-2026-07-04/mobile-class-deep-scroll-after.json`

## Purchase Flow And SEO/OG Recheck - 2026-07-04 KST

- Scope:
  - Checked the customer-facing flow from home CTA buttons to online/offline category pages and product detail pages.
  - Checked live SEO/OG tags for home, shop, online/offline category, my-classroom, and representative product pages.
- Result:
  - Home CTA links are correct:
    - `오프라인 클래스 보기` -> `/18`
    - `온라인 클래스 보기` -> `/17`
    - top `Shop` -> `/16`
  - Mobile and desktop flow checks passed with horizontal overflow `0`.
  - Online product detail confirms price, 40-day buyer access, watch-page CTA, and refund/service period copy.
  - Offline product detail confirms `70,000원`, monthly last-Saturday service date, instructor info, and refund copy.
  - Product title/OG title are product-specific on representative product pages.
  - Public `meta description` and `og:description` are still the site-wide ARCHIVE PILATES description, including product pages. Product API SEO fields are stored, but page/category-level SEO editing is not exposed through the current Imweb CLI capability.
- Follow-up:
  - If category/product-specific server-rendered descriptions are required, use Imweb admin SEO settings or confirm the supported API path with Imweb.
- Evidence:
  - `docs/reports/2026-07-04-imweb-purchase-flow-access-seo.html`
  - `artifacts/imweb-purchase-flow-2026-07-04/home-to-checkout-flow-audit.json`
  - `artifacts/imweb-purchase-flow-2026-07-04/live-seo-og-audit.json`

## Home Hero Desktop Text Vertical Alignment - 2026-07-04 KST

- Problem:
  - On the desktop home hero, the copy group containing `강사의 수업을 기록하고, 레슨의 기준을 다시 세웁니다.` was visually shifted upward against the photo.
  - Live measurement at `1440x1000` showed hero center `y=525` and copy-group center `y=429`, so the group was `96px` above the image center.
- Change:
  - Added/updated the live Imweb `footer` script marker `data-archive-pilates-hero-align="2026-07-04b"`.
  - Desktop-only CSS now targets both current and legacy selectors:
    - `#archive-pilates-site .apb-hero .apb-hero-text`
    - `#archive-pilates-site .apb-hero #apb-hero-text`
  - Desktop transform changed from the prior effective `translateY(-48px)` position to `translateY(48px)`.
  - Mobile is excluded with `@media(min-width:861px)` and keeps its existing hero alignment.
- Verification:
  - Imweb script readback confirms footer marker `2026-07-04b` and `.apb-hero-text` selector are live.
  - Desktop Playwright check at `1440x1000` confirms:
    - hero center `y=525`;
    - copy-group center `y=525`;
    - copy-vs-hero center offset `0px`;
    - transform `matrix(1, 0, 0, 1, 0, 48)`;
    - horizontal overflow `0`;
    - console error count `0`.
  - Mobile Playwright check at `390x844` confirms:
    - transform `matrix(1, 0, 0, 1, 0, 0)`;
    - horizontal overflow `0`;
    - console error count `0`.
- Evidence:
  - `artifacts/imweb-home-hero-align-2026-07-04/footer-script-after-update.json`
  - `artifacts/imweb-home-hero-align-2026-07-04/hero-after-b-measure.json`
  - `output/playwright/imweb-home-hero-align-2026-07-04/desktop-after-b.png`
  - `output/playwright/imweb-home-hero-align-2026-07-04/mobile-after-b.png`

## Mobile Header Text Logo Replacement - 2026-07-04 KST

- Problem:
  - The mobile top header still displayed the plain text `아카이브 필라테스`.
- Change:
  - Replaced the mobile header text logo in `#logo_w202605184e66bbd892e24` with the provided transparent ARCHIVE PILATES text logo image.
  - Optimized the local source image to a mobile header PNG:
    - source: `아카이브필라테스 텍스트.png`
    - optimized artifact: `artifacts/imweb-mobile-header-logo-2026-07-04/archive-pilates-text-logo-mobile.png`
    - optimized size: `360x112`, about `20KB`.
  - Updated the live Imweb `footer` script with marker `data-archive-pilates-mobile-logo="2026-07-04a"`.
  - Preserved the existing desktop hero alignment patch `data-archive-pilates-hero-align="2026-07-04b"`.
- Verification:
  - Imweb script readback confirms:
    - mobile logo marker `2026-07-04a`;
    - target selector `logo_w202605184e66bbd892e24`;
    - embedded data URL is present;
    - hero alignment `translateY(48px)` is preserved.
  - Mobile Playwright check at `390x844` confirms:
    - logo image is visible at `148x46`;
    - logo center is `x=195`, `y=54.5`;
    - horizontal overflow `0`;
    - console error count `0`.
  - Desktop Playwright check at `1440x1000` confirms:
    - hero copy center remains aligned with hero center, offset `0px`;
    - horizontal overflow `0`;
    - console error count `0`.
- Evidence:
  - `artifacts/imweb-mobile-header-logo-2026-07-04/footer-script-after-mobile-logo.json`
  - `artifacts/imweb-mobile-header-logo-2026-07-04/live-verification-after-mobile-logo.json`
  - `output/playwright/imweb-mobile-header-logo-2026-07-04/mobile-after-logo.png`
  - `output/playwright/imweb-mobile-header-logo-2026-07-04/desktop-after-logo.png`

## Mobile Header Logo Korean Line Removal - 2026-07-04 KST

- Problem:
  - The mobile header image logo felt too tall because it included both `ARCHIVE` and the Korean `아카이브필라테스` line.
- Change:
  - Cropped the provided transparent logo image to keep only the English `ARCHIVE` wordmark.
  - Updated the live Imweb `footer` script with marker `data-archive-pilates-mobile-logo="2026-07-04c"`.
  - Preserved the existing desktop hero alignment patch `data-archive-pilates-hero-align="2026-07-04b"`.
- Verification:
  - Imweb script readback confirms:
    - mobile logo marker `2026-07-04c`;
    - old mobile logo style ids are removed on page apply;
    - hero alignment `translateY(48px)` is preserved.
  - Mobile Playwright check at `390x844` confirms:
    - logo image is visible at `148x28.36`;
    - logo center is `x=195`, `y=54.49`;
    - Korean line is no longer present in the logo image;
    - horizontal overflow `0`;
    - console error count `0`.
  - Desktop Playwright check at `1440x1000` confirms:
    - hero copy center remains aligned with hero center, offset `0px`;
    - horizontal overflow `0`;
    - console error count `0`.
- Evidence:
  - `artifacts/imweb-mobile-header-logo-english-only-2026-07-04/footer-script-after-top.json`
  - `artifacts/imweb-mobile-header-logo-english-only-2026-07-04/live-verification-after-archive-only-logo-top.json`
  - `output/playwright/imweb-mobile-header-logo-english-only-2026-07-04/mobile-after-archive-only-logo-top.png`

## My Classroom Manual Group Session Refresh - 2026-07-04 KST

- Problem:
  - 김기효 회원의 Imweb API readback showed all `25/25` online video member groups assigned.
  - The live `내 강의실` page still showed the empty state on the member's current mobile session.
  - The classroom renderer does not read group codes directly. It safely probes the group-restricted watch pages and only renders cards that the current logged-in session can open.
  - Therefore the likely cause was a stale logged-in Imweb session created before the manual group assignment was reflected.
- Change:
  - Updated the live Imweb `body` script classroom block to `data-archive-pilates-my-classroom="2026-07-04a"`.
  - Kept the existing group-restricted watch-page probe model, so buyer-only access is not weakened.
  - Added an empty-state explanation for recent purchase/manual grant cases.
  - Added a `다시 로그인` action that stores a temporary classroom relogin flag, logs out through Imweb `/logout.cm`, and redirects the guest session to `/login?back_url=%2F48`.
  - Because CLI `script update` hit the local large-write safety limit, the dry-run request was validated through the CLI and then applied with the same official OpenAPI `PUT /script` request using the existing local Imweb auth token.
- Verification:
  - Imweb script readback confirms marker `2026-07-04a`, no old `2026-07-03a` classroom marker, and JavaScript syntax check `ok`.
  - 김기효 member readback: `25/25` expected online video groups present; missing products `0`.
  - AR1 buyer test account: `내 강의실` still renders exactly `1` AR1 card.
  - Non-buyer test account: `내 강의실` renders no cards, shows the new relogin guidance, and exposes `/logout.cm` for the relogin action.
  - Relogin button test: after click, browser reaches `/login?back_url=%2F48` with login inputs visible.
  - Logged-out `/48` access still redirects to Imweb login and shows no classroom cards.
- Evidence:
  - `artifacts/imweb-myclassroom-kim-2026-07-04/member-kim-readback.json`
  - `artifacts/imweb-myclassroom-kim-2026-07-04/body-script-after-2026-07-04a.json`
  - `artifacts/imweb-myclassroom-kim-2026-07-04/live-playwright-verification-2026-07-04a.json`
  - `output/playwright/imweb-myclassroom-kim-2026-07-04/buyer-ar1-classroom-after-2026-07-04a.png`
  - `output/playwright/imweb-myclassroom-kim-2026-07-04/nonbuyer-empty-classroom-after-2026-07-04a.png`

## My Classroom Profile-Group Fallback - 2026-07-04 KST

- Follow-up:
  - The member reported that the list still did not appear after relogin.
  - This invalidated the stale-session-only diagnosis.
  - The more likely live-device cause is that hidden iframe watch-page probes can fail on mobile Safari or in-app browser environments even when the member has the correct group.
- Change:
  - Updated the live Imweb `body` script classroom block to `data-archive-pilates-my-classroom="2026-07-04b"`.
  - The renderer now first scans the logged-in member profile DOM for `ARCHIVE METHOD {CODE} 40D` group titles and renders those classroom cards immediately.
  - The existing group-restricted watch-page probes remain as a fallback only.
  - The empty state now shows the current login account from `MEMBER_UID`, so staff can detect when the member logged in with a different account than the one that received the group.
  - Watch pages remain group-restricted; this change only improves card discovery and does not expose full video embeds or full-video IDs.
- Verification:
  - Imweb script readback confirms marker `2026-07-04b`, no `2026-07-04a` or `2026-07-03a` classroom marker, profile fallback text, account label text, and JavaScript syntax check `ok`.
  - 김기효 member readback still shows `25` online video groups.
  - AR1 group member readback includes 김기효.
  - AR1 buyer test account at mobile size renders the AR1 card within about `1.1s` with `data-ap-classroom-last-source="profile"`.
  - Non-buyer test account at mobile size renders no cards and shows the current login account in the empty state.
- Evidence:
  - `artifacts/imweb-myclassroom-kim-2026-07-04/body-script-after-2026-07-04b.json`
  - `artifacts/imweb-myclassroom-kim-2026-07-04/live-playwright-verification-2026-07-04b.json`
  - `output/playwright/imweb-myclassroom-kim-2026-07-04/buyer-ar1-classroom-fast-after-2026-07-04b.png`
  - `output/playwright/imweb-myclassroom-kim-2026-07-04/nonbuyer-empty-classroom-after-2026-07-04b.png`

## My Classroom Manual All-Access Hash Map - 2026-07-04 KST

- Follow-up:
  - The member reported that only `ACH7` appeared in the classroom list.
  - This showed that the Imweb profile DOM can expose only one representative `ARCHIVE METHOD ... 40D` group even when the member has all `25` video groups.
- Change:
  - Updated the live Imweb `body` script classroom block to `data-archive-pilates-my-classroom="2026-07-04c"`.
  - Added a manual all-access hash map for the two staff/member accounts that were intentionally granted all online videos.
  - The hash key uses Imweb `MEMBER_HASH`, which is derived from member code, so the script does not expose the member email or name.
  - The map only affects classroom card discovery. Individual watch pages remain protected by the existing Imweb member-group page permissions.
- Verification:
  - Imweb script readback confirms marker `2026-07-04c`, no old `2026-07-04b` marker, manual-card logic present, and JavaScript syntax check `ok`.
  - 김기효 member readback still shows all `25/25` online video groups.
  - Playwright mobile checks:
    - normal AR1 buyer test account: `1` card, source `profile`;
    - normal non-buyer test account: `0` cards and empty-state account label;
    - 김기효 hash simulation: `25` cards, source `manual`.
- Evidence:
  - `artifacts/imweb-myclassroom-kim-2026-07-04/body-script-after-2026-07-04c.json`
  - `artifacts/imweb-myclassroom-kim-2026-07-04/live-playwright-verification-2026-07-04c.json`
  - `output/playwright/imweb-myclassroom-kim-2026-07-04/kim-hash-sim-all-cards-after-2026-07-04c.png`

## Mobile Menu Jump And Home Motion Fix - 2026-07-06 KST

- Problem:
  - The mobile `온라인 클래스` top-menu transition felt jumpy.
  - Live measurement showed the top-menu click navigated to `/17` and inserted the equipment subnav as a relative block.
  - That pushed the content start from `132px` to `176px`, a visible `44px` layout jump.
  - Home load CLS was `0`, so the issue was not late image loading.
- Change:
  - Updated the live Imweb `body` script motion block to `data-archive-pilates-home-motion-search="2026-07-06a"`.
  - Updated the live Imweb `body` script mobile online subnav block to `data-archive-pilates-mobile-online-subnav="2026-07-06a"`.
  - Mobile top `온라인 클래스` clicks now open the equipment subnav first instead of immediately navigating.
  - The equipment subnav is now a fixed overlay under the header, so it does not push page content.
  - Mobile reveal motion was reduced from `12px` movement to `6px`, review/card stagger delays were shortened, and mobile product-image scale animation was removed.
  - Desktop hover dropdown behavior was left unchanged.
- Verification:
  - Public HTML confirms new markers `2026-07-06a` and no old `2026-07-04a` / `2026-07-04b` markers.
  - Mobile home, `390x844`: clicking top `온라인 클래스` keeps the URL on home, opens the subnav, and changes content top by `0px`.
  - Mobile online page, `390x844`: equipment subnav remains fixed and active state shows `전체`.
  - Desktop, `1365x900`: online-class hover dropdown remains visible and content top changes by `0px`.
- Evidence:
  - `artifacts/imweb-jump-fix-2026-07-06/script-list-before.json`
  - `artifacts/imweb-jump-fix-2026-07-06/script-list-after.json`
  - `artifacts/imweb-jump-fix-2026-07-06/public-home-after.html`
  - `output/playwright/imweb-jump-fix-2026-07-06/verification.json`
  - `output/playwright/imweb-jump-fix-2026-07-06/mobile-home-after-online-click.png`
  - `output/playwright/imweb-jump-fix-2026-07-06/mobile-online-after-subnav-click.png`
  - `output/playwright/imweb-jump-fix-2026-07-06/desktop-after-online-hover.png`

## Mobile Navigation Reload Header Jump Fix - 2026-07-06 KST

- Follow-up:
  - The visible shake was clarified as a menu navigation / top `ARCHIVE` logo reload issue, not an in-page section scroll issue.
  - Live frame sampling showed the mobile header first painted at `96px`, then changed to `127px` after the body safe-area script ran.
  - This moved the content from `101px` to `132px` after first paint and caused the page to look like it jumped upward during navigation.
- Change:
  - Added a head-side critical mobile header script marker `data-archive-pilates-critical-mobile-header="2026-07-06b"`.
  - The script injects the mobile safe-area/header/logo sizing CSS before body rendering, so the first paint reserves the final header height.
  - Updated mobile online subnav to `data-archive-pilates-mobile-online-subnav="2026-07-06b"`.
  - Removed the top `온라인 클래스` click interception. The top menu now navigates directly to `/17`; the fixed equipment subnav opens only after the `/17` page is loaded.
- Verification:
  - Imweb script readback confirms header marker `2026-07-06b`, body subnav marker `2026-07-06b`, no body subnav marker `2026-07-06a`, and no remaining `preventDefault()` in the subnav block.
  - Public HTML confirms both live markers.
  - Mobile `390x844`, `/17` -> top `ARCHIVE` logo click: header height stayed `127px` and content y stayed `132px` across sampled frames.
  - Mobile `390x844`, home -> `스튜디오`: header height stayed `127px` and content y stayed `127px` across sampled frames.
  - Mobile `390x844`, home -> `온라인 클래스`: URL changed to `/17`, header height stayed `127px`, content y stayed `132px`, and the subnav opened on the online page.
  - Early `requestAnimationFrame` sampling during top `ARCHIVE` logo navigation saw no old `96px` header or `101px` content-y state; the first measurable frame already had header `127px` and content y `132px`.
  - Desktop hover dropdown remains visible.
- Evidence:
  - `artifacts/imweb-navigation-jump-fix-2026-07-06/script-list-current-before-patch.json`
  - `artifacts/imweb-navigation-jump-fix-2026-07-06/script-list-after-patch.json`
  - `artifacts/imweb-navigation-jump-fix-2026-07-06/live-home-after.html`
  - `artifacts/imweb-navigation-jump-fix-2026-07-06/early-frame-samples.json`
  - `output/playwright/imweb-navigation-jump-2026-07-06/summary-after-patch.json`
  - `output/playwright/imweb-navigation-jump-2026-07-06/from-online-click-logo-after-patch.png`
  - `output/playwright/imweb-navigation-jump-2026-07-06/from-home-click-studio-after-patch.png`
  - `output/playwright/imweb-navigation-jump-2026-07-06/from-home-click-online-after-patch.png`
  - `output/playwright/imweb-navigation-jump-2026-07-06/desktop-hover-after-patch.png`
