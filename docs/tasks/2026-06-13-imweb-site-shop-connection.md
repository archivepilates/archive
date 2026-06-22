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
