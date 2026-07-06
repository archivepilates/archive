# Imweb Online Video Product Registration

Date: 2026-06-13 KST

## Goal

Register ARCHIVE PILATES paid online lesson videos as one Imweb product per YouTube full-class video.

## Current Decision

- Use the first-phase sales model.
- Main site routes:
  - Offline class CTA -> offline lesson product/detail page.
  - Online class CTA -> online video product list or product detail pages.
- Online lesson sales model:
  - One YouTube full-class video = one Imweb product.
  - Product detail shows preview video only.
  - Full private/unlisted video link is not exposed in public product content.
  - Purchase price follows the existing Notion guide: KRW 15,000 per video.
  - Buyer receives account/page access after order verification.
  - Full video is watched through a login-gated embedded page, not through a publicly shared link.
  - Viewing period follows the existing Notion guide: 40 days from access grant.

## Source References

- Notion page: `아카이브 강사레슨 유료 영상 안내`
  - Page ID: `257d49eae4bf8048a2bcf4f83200a07e`
  - Price: `1편당 15,000원`
  - Original buyer flow text: Gmail account + requested video title + payer name.
  - Current site implementation copy: order/member account gets access to a login-gated embedded page.
  - Delivery/access timing: after payment/application check.
  - Viewing period: 40 days.
- Notion inline DB: `아카이브 유튜브 영상 리스트`
  - Data source: `collection://2cdd49ea-e4bf-807c-92cf-000b955a05c8`
  - Columns seen: `NO.`, `수업강사`, `리포머`, `체어`, `캐딜락`, `바렐`.
- YouTube inventory source:
  - `/Users/archivepilates/Documents/ARCHIVE-G/artifacts/youtube-video-inventory-2026-05-25.csv`
- YouTube project:
  - `/Users/archivepilates/Documents/ARCHIVE-G`
  - Google Cloud project: `archive-pilates-youtube`
  - YouTube OAuth account: `archivepilates@gmail.com`

## Generated Outputs

- Candidate CSV:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/imweb-online-video-products-candidates.csv`
- Candidate JSON with product HTML:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/imweb-online-video-products-candidates.json`
- Review report:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/imweb-online-video-products-report.html`
- Dry-run registration script:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/scripts/imweb_register_online_video_products.py`

## Candidate Count

- Final product candidates: 20
- Included only likely ARCHIVE METHOD full-class products with private YouTube full videos and class codes.
- Excluded personal instructor feedback/evaluation-like videos and private lesson-like titles.

## Product Registration Defaults

- `prod_status`: `nosale`
- `price`: `15000`
- `prod_type`: `normal`
- `stock_use`: `false`
- `stock_unlimit`: `true`
- Product detail content:
  - ARCHIVE PILATES class description.
  - Preview YouTube embed when a preview was matched.
  - Purchase/access guide.
  - No full private video URL in public content.

## Dry Run

Command:

```sh
/Users/archivepilates/Documents/ARCHIVE-IN/scripts/imweb_register_online_video_products.py
```

Result:

- 20 candidate products would be created as `nosale`.
- No Imweb write was performed during dry-run.

## Execute Attempt

An execute attempt was made with `--status nosale`.

Result:

- No successful product creation.
- Imweb returned `code=-10`, `잘못된 파라미터(categories)` for the product create calls.
- One call also returned `code=-7`, `TOO MANY REQUEST`.
- The registration script was updated so execute mode now requires an explicit `--category-code` and treats non-success API codes as failures.

Cause:

- Imweb product creation requires a valid product category.
- Current API readback showed only the existing category `cup`, which is not appropriate for ARCHIVE METHOD online lessons.

## Completed Registration - 2026-06-13

- Confirmed the active Imweb category code from existing products:
  - `s2026051668d24d49ef360`
  - Public display category after admin rename: `클래스`
- Updated registration script:
  - Uses Imweb `images` field with public YouTube preview thumbnail URLs.
  - Uses fallback ARCHIVE PILATES symbol image when no public preview thumbnail exists.
  - Replaces email/link-send copy with account/page access copy:
    - Buyer receives access to a login-gated embedded page.
    - Full video URL is not exposed in public product detail.
    - Viewing period is 40 days from access grant.
  - Adds high-contrast Kakao CTA style:
    - Yellow background
    - Black text
    - `color:#171717 !important`
- Patched existing products:
  - Product 1 `[오프라인] ARCHIVE METHOD 5:1 강사레슨`: Kakao CTA color fixed.
  - Product 2 `[온라인] ARCHIVE METHOD 영상 클래스`: Kakao CTA color fixed and online access copy changed to embedded-page access model.
- Registered 20 online video products in Imweb:
  - Status: `nosale`
  - Price: `15000`
  - Product image: public preview thumbnail when available, fallback image for products without preview.
  - Public detail: preview embed only; no full private video URL.
- Saved API verification:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/registered-products-2026-06-13.json`
- Captured public verification screenshots:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/verification/shop-view-1-kakao-cta-fixed.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/verification/shop-view-2-access-copy-fixed.png`
- API verification result:
  - ARCHIVE METHOD products matched: 22
  - `sale`: 2 existing summary/core products
  - `nosale`: 20 newly registered video products

## Shipping UI Cleanup - 2026-06-13

- Patched all ARCHIVE METHOD product detail content with a scoped CSS rule that hides Imweb's default physical-delivery blocks:
  - `.prod-detail-section--select-group`
  - `.prod-detail-section--delivery`
  - `.prod-detail-section--delivery-guide`
- Scope:
  - Product 1 offline summary product
  - Product 2 online summary product
  - Product 3-22 hidden online video products
- Verification:
  - `https://archivepilates.imweb.me/shop_view/1` screenshot no longer shows `배송 방법`, `배송비 결제`, `배송` UI.
  - `https://archivepilates.imweb.me/shop_view/2` screenshot no longer shows `배송 방법`, `배송비 결제`, `배송` UI.
- Screenshot outputs:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/verification/shop-view-1-shipping-hidden.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-13/verification/shop-view-2-shipping-hidden.png`

## Access Model Decision

- Recommended structure:
  - Use Imweb product purchase as the payment entry point.
  - Grant buyer access to a member-only video page after payment.
  - Place the private/unlisted YouTube embed inside the member-only page.
  - Keep the full video URL out of public product detail.
- Better long-term Imweb-native direction:
  - Use `prod_type=subscribe` when the target member group and access page are ready.
  - Imweb API documents `subscribe` as `회원그룹 이용권`, with `subscribe_group_code` and `subscribe_period`.
  - `digital` exists in the API docs but is struck through, so it should not be treated as the reliable path.
- Not recommended as the primary model:
  - Imweb board-only delivery.
  - Reason: board permissions can show posts to a group, but a board does not naturally represent one video purchase = one entitlement unless separate groups/pages are carefully mapped.
- Practical operating model:
  - One video product = one access group or one group/page entitlement rule.
  - 40-day access is implemented through `subscribe_period=40` if using Imweb member-group pass products.
  - If group-per-video becomes too many groups, use a dedicated external entitlement app later and keep Imweb as checkout only.

## Execute Command

Use only after confirming the category/visibility plan:

```sh
IMWEB_API_KEY=... IMWEB_SECRET_KEY=... \
/Users/archivepilates/Documents/ARCHIVE-IN/scripts/imweb_register_online_video_products.py \
  --execute \
  --status nosale \
  --category-code ONLINE_CATEGORY_CODE
```

Do not put the real API key or secret in Git, docs, or chat logs.

## Current Blockers

1. YouTube OAuth token needs refresh before relying on fresh channel inventory.
   - Existing token path: `/Users/archivepilates/Documents/ARCHIVE-G/.youtube-gcloud/youtube-token.local.json`
   - Current read check failed with `invalid_grant`.
   - Re-run YouTube OAuth with `archivepilates@gmail.com` before relying on latest channel data.

2. Newly registered video products are now public/sale.
   - 2026-06-13 update: Imweb admin bulk status changed products 1-22 to `판매중`.
   - Remaining risk is no longer product visibility; it is buyer-specific embedded-page entitlement and access-period automation.

3. Notion DB row query tool was unstable.
   - Page and schema were fetched.
   - Direct data-source query tool was exposed by discovery but returned `tool not found` at runtime.
   - Candidate list therefore uses YouTube inventory plus Notion guide/schema, not a confirmed full row export from the DB.

4. Imweb physical shipping UI is hidden by product-detail CSS, not removed from the server-side Imweb template.
   - Source HTML still contains the default delivery labels.
   - The public screen no longer displays the delivery blocks.
- A more native cleanup may be possible if the product is converted to `subscribe` member-group pass.

## Category Reassignment And Category Pages - 2026-06-13

- Imweb category readback:
  - `s2026051668d24d49ef360`: `클래스`
  - `s20260613848c8356b9c73`: `온라인 클래스`
  - `s20260613a41f3d6464dfe`: `오프라인 클래스`
- Product category assignment completed through the Imweb API:
  - Product 1 `[오프라인] ARCHIVE METHOD 5:1 강사레슨` -> `오프라인 클래스`
  - Product 2 `[온라인] ARCHIVE METHOD 영상 클래스` -> `온라인 클래스`
  - Product 3-22 online video products -> `온라인 클래스`
- Public URL experiment:
  - `https://archivepilates.imweb.me/?mode=shop&category=...` and `https://archivepilates.imweb.me/16?category=...` returned HTTP 200 but did not filter products.
  - Conclusion: plain query-string category URLs are not reliable for this Imweb site.
- Imweb design-mode implementation:
  - Created/published `온라인 클래스` page: `https://archivepilates.imweb.me/17`
  - Created/published `오프라인 클래스` page: `https://archivepilates.imweb.me/18`
  - Added Imweb shopping widgets and set each widget's displayed category:
    - `/17` -> `온라인 클래스`
    - `/18` -> `오프라인 클래스`
- Public verification after publish:
  - `/17`: contains `[온라인]`, does not contain `[오프라인]`
  - `/18`: contains `[오프라인]`, does not contain `[온라인]`
- Homepage CTA state:
  - Header/mobile menu now includes links to `/17` and `/18`.
  - The custom homepage hero CTA source still points to `https://archivepilates.imweb.me/shop_view/1` and `https://archivepilates.imweb.me/shop_view/2`.
  - The safer next step is to edit the original homepage code widget and change:
    - `data-apb-link="offlineClass"` href -> `https://archivepilates.imweb.me/18`
    - `data-apb-link="onlineClass"` href -> `https://archivepilates.imweb.me/17`
  - A temporary extra code/widget insertion was attempted in design mode, then undone before publishing to avoid leaving an unconfigured widget on the homepage.

## Recommended Next Step

1. User or Codex refreshes YouTube OAuth for `archivepilates@gmail.com`.
2. Convert/verify each paid full video as `unlisted` or public and embeddable before adding that code to `artifacts/imweb-buyer-video-access/youtube-ready-codes.json`.
3. After the payment module is fully available, run one real member-order E2E test and confirm automatic group grant, buyer watch page access, and buyer notice delivery.

## Buyer Watch Pages And Access Test - 2026-06-29

- Imweb design-mode buyer-only watch pages were created and published for all 23 ARCHIVE METHOD online video codes:
  - `AC7`, `ACA4`, `AB7`, `AR3`, `AB6`, `ACH6`, `AR2-1`, `ACH5`, `ACA2`, `ACA3`, `ACA1`, `AB3`, `ACH2`, `AB2`, `ACH1`, `ACH4`, `ACH3`, `AB5`, `AB1`, `AR1`, `AR4`, `AB4`, `AB8`.
- Page pattern:
  - URL: `https://archivepilates.imweb.me/archive-method-watch-{code}`
  - Menu state: hidden menu.
  - Access state: login required and only the matching `ARCHIVE METHOD {code} 40D` member group is allowed.
  - Page rendering: shared body script renders the matching buyer-only YouTube embed page after the allowed member logs in.
- Public logged-out verification:
  - All 23 watch URLs returned first response `HTTP/2 302`.
  - All 23 redirected to `https://archivepilates.imweb.me/login?back_url=...`.
  - `BAD_COUNT 0`; no watch URL returned 404.
- Product detail readback:
  - Products `27-49` all contain their matching watch path.
  - Products `27-49` all contain purchase-after guidance with `구매 후 시청`, `마이페이지`, and `주문조회`.
- Member group verification:
  - `scripts/imweb_buyer_video_access.py verify-groups` confirmed all 23 expected group titles and group codes match Imweb.
- Purchase-notice generation test:
  - Local dry test generated AR1, AB4, and AC7 delivery bodies without sending mail.
  - Each generated notice includes the watch URL, the Imweb-member login guide, and the Kakao channel link.
  - This session did not create a new recurring send automation and did not send a new live customer notice.
  - To make future paid-member orders fully automatic, re-enable a controlled order-processing job after the payment module and YouTube-ready list are finalized.
- Current real order state:
  - `scripts/imweb_buyer_video_access.py process-orders --limit 20` read-only result found order `202606282038199` for `AR1`.
  - Status: `needs_member_signup`.
  - Reason: the order is not currently tied to an Imweb member UID, so the buyer-only group cannot be granted automatically.
  - A signup notice for that order was already queued and sent on 2026-06-28 UTC according to `sent-notices.jsonl`.
- YouTube-ready update:
  - `AR1` full video `hqmbqTHgO6s` was changed to unlisted by the operator.
  - Verification on 2026-06-29 UTC: YouTube embed URL returned HTTP `200`, and YouTube oEmbed returned the AR1 full-video title/iframe payload.
  - `artifacts/imweb-buyer-video-access/youtube-ready-codes.json` now marks `AR1` and `AB4` as YouTube-ready.
  - Future member orders for non-ready codes should not auto-grant until the corresponding YouTube video is verified.

## Live Visibility Update - 2026-06-13

- Imweb admin product list verified through the logged-in `home@archivepilates.com` Chrome session:
  - Before change: `판매중 2`, `숨김 20`.
  - All hidden products were online video products in `온라인 클래스`.
  - Bulk status change applied to selected 22 products: `판매중`.
  - After change: `판매중 22`, `숨김 0`.
- Public verification after the bulk status change:
  - `https://archivepilates.imweb.me/17`: online category page now shows individual online video products.
  - The Imweb shopping widget paginates the online category at 10 products per page, currently 3 pages.
  - `https://archivepilates.imweb.me/18`: offline category page remains offline-only.
  - `https://archivepilates.imweb.me/16`: Shop page is the all-products listing, also paginated at 10 products per page.

## Missing Video Product Completion - 2026-06-14

- YouTube OAuth was refreshed for the `archivepilates@gmail.com` channel through the local ARCHIVE-G OAuth helper.
- Fresh YouTube inventory confirmed the three Notion-listed videos that were not yet represented as Imweb online products:
  - `AR4` Reformer / 순환: `RSJpy2ncQPE`, private, 51:59.
  - `AB4` Barrel / 전신 근막 FLOW: `8MNTjnr-vTo`, public, 54:22; short preview `7MWDVlmiABM`, public, 00:59.
  - `AB8` Barrel / 순환: `Rro16e1EKcM`, private, 55:13.
- Generated or selected thumbnails:
  - AR4 generated thumbnail: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-work-2026-06-14/output/archive-method-ar4-reformer-circulation-thumbnail.jpg`
  - AB4 kept the existing YouTube-style full-video thumbnail because the original already matched the current visual system.
  - AB8 generated thumbnail: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-work-2026-06-14/output/archive-method-ab8-barrel-circulation-thumbnail.jpg`
  - Contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-work-2026-06-14/output/contact-sheet.jpg`
- YouTube thumbnail updates:
  - Set the generated AR4 thumbnail on `RSJpy2ncQPE`.
  - Set the generated AB8 thumbnail on `Rro16e1EKcM`.
  - Result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-work-2026-06-14/youtube-thumbnail-set-results.json`
- Imweb products registered in `온라인 클래스` category `s20260613848c8356b9c73`:
  - Product 24: `[온라인] ARCHIVE METHOD 리포머 순환 (AR4)` -> `https://archivepilates.imweb.me/shop_view/24`
  - Product 25: `[온라인] ARCHIVE METHOD 바렐 전신 근막 FLOW (AB4)` -> `https://archivepilates.imweb.me/shop_view/25`
  - Product 26: `[온라인] ARCHIVE METHOD 바렐 순환 (AB8)` -> `https://archivepilates.imweb.me/shop_view/26`
- Imweb image patch:
  - Product 24 and 26 were patched after YouTube custom thumbnails propagated, so Imweb copied the updated thumbnails to its CDN.
  - Patch/readback file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/patched-thumbnail-products-2026-06-14.json`
- Public verification:
  - Online category: `https://archivepilates.imweb.me/17`
  - Top visible products are now product 26, 25, 24, then earlier online products.
  - Product 24, 25, and 26 detail pages render on mobile.
  - Visible delivery/taxi UI check returned empty results for all three product detail pages.
  - Full paid video IDs were not present in the rendered product-detail HTML.
  - Product 25 embeds only the short preview `7MWDVlmiABM`.
- Verification screenshots:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/online-category-after-thumbnail-patch-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/online-category-after-thumbnail-patch-desktop.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/shop-view-24-ar4-after-patch-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/shop-view-25-ab4-after-patch-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/shop-view-26-ab8-after-patch-mobile.png`

Remaining risks:

- AB4 full video `8MNTjnr-vTo` is still public on YouTube. The Imweb product detail exposes only the short preview, but the full video should be changed to private or unlisted before real paid sales.
- Purchase-to-view entitlement is still the next operational layer: one paid product should grant access to a buyer-only embedded page for 40 days.

## AB5 Thumbnail Cleanup - 2026-06-14

- Target product:
  - Product 20: `[온라인] ARCHIVE METHOD 바렐 크로스패턴 (AB5)`
  - Product URL: `https://archivepilates.imweb.me/shop_view/20`
  - Online category URL: `https://archivepilates.imweb.me/17`
- Source YouTube video:
  - `B8fCeYATptE`
  - Title: `크로스패턴이 뭐야? 체간·자세교정에 필요한 핵심 움직임 #AB5`
  - Privacy: private
  - Duration: 53:09
- Generated thumbnail:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-work-2026-06-14/output/archive-method-ab5-barrel-cross-pattern-thumbnail.jpg`
- YouTube thumbnail update:
  - Applied the generated thumbnail to `B8fCeYATptE`.
  - Result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-work-2026-06-14/ab5-youtube-thumbnail-set-result.json`
- Imweb image patch:
  - Product 20 patched to use the updated AB5 thumbnail.
  - API readback:
    - `prod_status`: `sale`
    - `categories`: `s20260613848c8356b9c73` (`온라인 클래스`)
    - CDN image: `S20260516852c71a014d08/a0d6f84f407e7.jpg`
  - Patch result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/ab5-thumbnail-patch-2026-06-14.json`
- Public verification:
  - `/17` category card for product 20 is visible with the new CDN image.
  - `/shop_view/20` mobile detail renders with the new image.
  - Visible delivery/taxi UI check returned empty results.
  - Full paid video ID `B8fCeYATptE` was not present in rendered product-detail HTML.
- Verification screenshots:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/online-category-ab5-thumbnail-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-online-video-products-2026-06-14/verification/shop-view-20-ab5-after-thumbnail-mobile.png`

## Full Thumbnail Standardization - 2026-06-14

- Scope:
  - Standardized product/listing thumbnails for all remaining ARCHIVE METHOD online full-video products that had not already been cleaned up in the AR4/AB4/AB5/AB8 pass.
  - Kept the already cleaned products unchanged:
    - Product 20 `AB5`
    - Product 24 `AR4`
    - Product 25 `AB4`
    - Product 26 `AB8`
- Generated 19 standardized full-video thumbnails using the current full-video thumbnail frame as the background and the current ARCHIVE PILATES purple label format:
  - Product 3 `AC7`
  - Product 4 `ACA4`
  - Product 5 `AB7`
  - Product 6 `AR3`
  - Product 7 `AB6`
  - Product 8 `ACH6`
  - Product 9 `AR2-1`
  - Product 10 `ACH5`
  - Product 11 `ACA2`
  - Product 12 `ACA3`
  - Product 13 `ACA1`
  - Product 14 `AB3`
  - Product 15 `ACH2`
  - Product 16 `AB2`
  - Product 17 `ACH1`
  - Product 18 `ACH4`
  - Product 19 `ACH3`
  - Product 21 `AB1`
  - Product 22 `AR1`
- YouTube updates:
  - Applied the 19 generated thumbnails to the matching private full-video YouTube IDs through the YouTube API.
  - Result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/youtube-thumbnail-set-batch-2026-06-14.json`
- Imweb updates:
  - Patched each matching Imweb product image so Imweb copied the new YouTube thumbnail to its CDN.
  - API readback confirmed all 19 products are `sale`, assigned to `온라인 클래스` (`s20260613848c8356b9c73`), and have new CDN image paths.
  - Patch/readback file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/imweb-thumbnail-patch-batch-2026-06-14.json`
- Public verification:
  - `/17` page 1: product 26, 25, 24, 22, 21, 20, 19, 18, 17, 16 visible with updated thumbnails.
  - `/17?mode=shop&page=2`: product 15, 14, 13, 12, 11, 10, 9, 8, 7, 6 visible with updated thumbnails.
  - `/17?mode=shop&page=3`: product 5, 4, 3 visible with updated thumbnails.
- Verification screenshots:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/verification/online-category-page1-standard-thumbnails-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/verification/online-category-page2-standard-thumbnails-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/verification/online-category-page3-standard-thumbnails-mobile.png`
- Source/contact-sheet artifacts:
  - Current thumbnail inventory: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/online-full-video-thumbnail-inventory.json`
  - Before contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/current-full-thumbnail-contact-sheet.jpg`
  - Generated thumbnail contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-thumbnail-standardization-2026-06-14/generated/generated-thumbnail-contact-sheet.jpg`

## Preview Video Source Check - 2026-06-14

- Missing preview products remain:
  - Product 9 `AR2-1`: full video `8a9y3T-9ZZE`, duration 46:24.
  - Product 20 `AB5`: full video `B8fCeYATptE`, duration 53:09.
  - Product 24 `AR4`: full video `RSJpy2ncQPE`, duration 51:59.
  - Product 26 `AB8`: full video `Rro16e1EKcM`, duration 55:13.
- Attempted source paths:
  - Local video duration scan over Desktop, Downloads, Documents, Movies, and Photos originals found only two near-duration candidates:
    - `/Users/archivepilates/Movies/TV/Media.localized/Home Videos/민진풀영상.m4v`
    - `/Users/archivepilates/Movies/TV/Media.localized/Home Videos/은영 컴파운드.m4v`
  - Frame inspection showed these are not safe matches for the missing-preview products:
    - `은영 컴파운드.m4v` is a reformer class despite being close to AB8 duration, so it must not be used for AB8 barrel preview.
    - `민진풀영상.m4v` appears to be a barrel class and does not safely match AR4.
  - Google Drive search for `AR4`, `순환`, `크로스패턴`, `챌린지`, `컴파운드`, `풀영상`, `아카이브메소드`, `민진 풀영상`, and `은영 풀영상` returned no matching video files.
  - `yt-dlp` Chrome-cookie private-video test was attempted against `RSJpy2ncQPE`, but Chrome cookie extraction stalled and was interrupted. No YouTube private video download was completed.
- Current blocker:
  - Real preview upload needs the original full video file or a reliable way to export/download the owned private YouTube video.
  - Do not create fake motion-graphic previews from thumbnails only; previews should show actual class footage.
- Next action:
  - Operator provides or places the four matching original files for `AR2-1`, `AB5`, `AR4`, and `AB8`, or opens a reliable YouTube Studio export/download route.
  - Once source files are available, create 30-60 second preview clips, upload them as public/unlisted YouTube previews, then patch the matching Imweb product detail with preview thumbnail + iframe.

## Preview Video Completion - 2026-06-14

- YouTube Studio owner/download route:
  - Confirmed `archivepilates@gmail.com` YouTube Studio access to the target private full videos.
  - Confirmed the Studio video options menu exposes `오프라인 저장` for the owned videos.
  - Downloaded the four owned full-video MP4 files through YouTube Studio:
    - `/Users/archivepilates/Downloads/세팅은 최소 감각은 최대! 민진쌤 리포머 #AR2-1.mp4`
    - `/Users/archivepilates/Downloads/크로스패턴이 뭐야_ 체간·자세교정에 필요한 핵심 움직임 #AB5.mp4`
    - `/Users/archivepilates/Downloads/아카이브 메소드 리포머 클래스 순환 민진썜 풀영상 #AR4.mp4`
    - `/Users/archivepilates/Downloads/아카이브 메소드 바렐 클래스 순환 은영쌤 풀영상 #AB8.mp4`
- Generated preview clips:
  - Cut approximately 59 seconds from the 5-minute point of each source video.
  - Output folder: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/preview-video-work-2026-06-14/generated-previews/`
  - Contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/preview-video-work-2026-06-14/generated-previews/generated-preview-contact-sheet.jpg`
- YouTube uploads:
  - Uploaded all four preview clips to the ARCHIVE PILATES YouTube channel as `unlisted`.
  - Set ARCHIVE-style custom thumbnails on all four preview videos.
  - Upload result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/preview-video-work-2026-06-14/youtube-preview-upload-results-2026-06-14.json`
  - Thumbnail result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/preview-video-work-2026-06-14/youtube-preview-thumbnail-set-results-2026-06-14.json`
  - Preview IDs:
    - Product 9 `AR2-1`: `HPvfL99EN5s`
    - Product 20 `AB5`: `ntp7ZQfhUe8`
    - Product 24 `AR4`: `Sksd2TXhP9k`
    - Product 26 `AB8`: `hGBpA4IIfWY`
- Imweb updates:
  - Patched product detail content for products 9, 20, 24, and 26 to embed the matching preview video.
  - Kept product category, price, sale status, and listing image unchanged.
  - Patch result file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/preview-video-work-2026-06-14/imweb-preview-embed-patch-2026-06-14.json`
- Verification:
  - YouTube API confirmed all four preview videos are `unlisted`, `processed`, processing status `succeeded`, duration `PT1M`, and `madeForKids=false`.
  - Public Imweb product-detail HTML returns HTTP 200 for products 9, 20, 24, and 26.
  - Each product detail contains the new preview ID.
  - The private full-video IDs `8a9y3T-9ZZE`, `B8fCeYATptE`, `RSJpy2ncQPE`, and `Rro16e1EKcM` are not present in the rendered product-detail HTML.
- Homepage code widget updated and published:
  - `offlineClass` now links to `https://archivepilates.imweb.me/18`.
  - `onlineClass` now links to `https://archivepilates.imweb.me/17`.
  - Main card copy now says product list/category movement instead of product-detail movement.
  - Online FAQ now describes buyer-login embedded-page access instead of private/unlisted link delivery.
  - Kakao CTA text contrast was reinforced in the homepage widget CSS.
- Remaining implementation risk:
  - Online products are now purchasable before the buyer-specific embedded-page entitlement automation is fully tested end to end.
  - Imweb's product list is paginated; if the desired public behavior is truly "all 22 products visible at once", adjust the shopping widget page size/layout in design mode.

## Subscribe Access Test - 2026-06-13

- Test member group created in Imweb admin:
  - Group name: `ARCHIVE TEST 40D VIDEO`
  - Group code observed from member-list URL: `g20260613c8ed67e64d239`
- Test subscribe product created:
  - Product no: `23`
  - Public URL: `https://archivepilates.imweb.me/shop_view/23`
  - Name: `[TEST] ARCHIVE 40D 영상 권한 테스트`
  - Status: `판매중`
  - Price: `0`
  - Product type: `subscribe` / 회원그룹 이용권
  - Category currently shown in admin as `클래스`; move to `온라인 클래스` after the entitlement test if this test product remains visible.
- Implementation detail:
  - Initial API creation accepted `prod_type=subscribe`.
  - API GET still returns `subscribe_group_code=null` and `subscribe_period=null`.
  - Admin product editor was therefore used to set the target group and period.
  - Reopening the editor confirmed:
    - 지정그룹: `일반 - ARCHIVE TEST 40D VIDEO`
    - 이용기간: `40`
  - Interpretation: the Imweb API readback may not expose subscribe-specific values even when the admin UI stores them.
- Checkout state:
  - Clicking public `구매하기` opened the checkout screen.
  - Checkout shows product 23, total order amount `무료`, and payment method text `결제금액이 0원 입니다`.
  - The checkout URL contains a generated pending order number.
  - Final `결제하기` was not clicked yet because it creates the actual 0 KRW order and may grant the group to the logged-in account.
- Current blocker / confirmation needed:
  - Before finalizing the 0 KRW order, confirm whether to use the current owner login `home@archivepilates.com` with test contact data.
  - This owner-account test can verify automatic group assignment, but a separate normal member account is still recommended before using this as the production access model.

## Added Test Helper - 2026-06-13

- Added script:
  - `scripts/imweb_create_subscribe_test_product.py`
- Purpose:
  - Create a single Imweb `subscribe` product for access testing.
  - Credentials are read only from `IMWEB_API_KEY` and `IMWEB_SECRET_KEY`.
  - No credentials are stored in the file.

## Notion vs Imweb Product List Compare - 2026-06-14

- Created comparison report:
  - `docs/reports/2026-06-14-imweb-online-video-notion-compare.html`
- Notion source checked:
  - Page: `아카이브 강사레슨 유료 영상 안내`
  - Data source: `collection://2cdd49ea-e4bf-807c-92cf-000b955a05c8`
  - Price/period guideline remains `1편당 15,000원`, `40일`.
- Notion row query status:
  - Direct `notion-query-data-sources` still failed at runtime with `Tool notion-query-data-sources not found`.
  - Used Notion search plus individual row fetches for the 8 visible rows.
- Comparison result:
  - Notion source has 23 apparatus/topic combinations.
  - Imweb currently exposes 20 individual online video products at `https://archivepilates.imweb.me/17` and `https://archivepilates.imweb.me/17?page=2`.
  - `https://archivepilates.imweb.me/17?page=3` exposes the online summary product `[온라인] ARCHIVE METHOD 영상 클래스`.
  - Missing from Imweb individual products:
    - Reformer / `순환`
    - Barrel / `전신 근막 FLOW`
    - Barrel / `순환`
- Public shop note:
  - `https://archivepilates.imweb.me/16` currently exposes the 0 KRW test product `[TEST] ARCHIVE 40D 영상 권한 테스트` before the normal product list.
  - Hide or isolate product 23 before public payment testing or launch.
- Payment-test implication:
  - Before attaching the payment module, decide whether to create the 3 missing products from fresh YouTube inventory or mark them intentionally unavailable.
  - End-to-end payment testing should verify order completion, purchaser group/page access, 40-day expiry behavior, and test product visibility cleanup.

## Thumbnail Overlap Cleanup And Online Product Ordering - 2026-06-15

- Live target:
  - Imweb admin product category: `온라인 클래스` / `s20260613848c8356b9c73`
  - Public online category page: `https://archivepilates.imweb.me/17`
  - YouTube channel context: ARCHIVE PILATES channel under `archivepilates@gmail.com`
- Thumbnail overlap cleanup:
  - Regenerated and applied ARCHIVE-style thumbnails for products whose added title blocks overlapped old source-thumbnail text:
    - Product `6` / `AR3` / Reformer lumbar stability
    - Product `12` / `ACA3` / Cadillac high intensity pilates
    - Product `18` / `ACH4` / Chair pelvic stability and asymmetry correction
    - Product `10` / `ACH5` / Chair high intensity pilates
    - Product `5` / `AB7` / Barrel lumbar stability
  - Applied the corrected images both to the owned YouTube full-video thumbnails and to the Imweb product representative images.
  - Verification note: small original labels such as `촬영영상` can remain visible in a few frames, but the newly added ARCHIVE title blocks no longer overlap the old thumbnail text.
- Final online product display order:
  - `AR1` product `22`
  - `AB1` product `21`
  - `ACH1` product `17`
  - `ACA1` product `13`
  - `AR2-1` product `9`
  - `AB2` product `16`
  - `ACH2` product `15`
  - `ACA2` product `11`
  - `AR3` product `6`
  - `AB3` product `14`
  - `ACH3` product `19`
  - `ACA3` product `12`
  - `AR4` product `24`
  - `AB4` product `25`
  - `ACH4` product `18`
  - `ACA4` product `4`
  - `AB5` product `20`
  - `ACH5` product `10`
  - `AB6` product `7`
  - `ACH6` product `8`
  - `AB7` product `5`
  - `AC7` product `3`
  - `AB8` product `26`
  - Online summary product `2` at the bottom
- Verification:
  - Admin product order exactly matched the target sequence after using the Imweb product-list order controls.
  - Public page `https://archivepilates.imweb.me/17` returned the same product index sequence:
    - `22, 21, 17, 13, 9, 16, 15, 11, 6, 14, 19, 12, 24, 25, 18, 4, 20, 10, 7, 8, 5, 3, 26, 2`
  - Imweb official guidance says product-list ordering is controlled in `상품관리` by drag/drop or row menu movement, and the shopping widget should use `등록순` when the manual product order should be reflected publicly.
- Evidence artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-order-fix-2026-06-15/current-imweb-online-thumbnail-contact-sheet.jpg`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-order-fix-2026-06-15/after-thumbnail-fix-v2-contact-sheet.jpg`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-order-fix-2026-06-15/final-admin-online-product-order.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-order-fix-2026-06-15/final-public-online-page-order.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-order-fix-2026-06-15/final-public-online-page-screenshot.png`

## Thumbnail Alignment Second Pass - 2026-06-15

- Trigger:
  - User flagged product `12` / `ACA3` as still visually under-aligned after the first overlap cleanup.
- Live recheck:
  - Rebuilt a contact sheet from the current public Imweb page image URLs, not from stale local files.
  - Live source: `https://archivepilates.imweb.me/17`
  - Before contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-alignment-fix-2026-06-15/live-thumbnail-contact-sheet.jpg`
- Corrected products:
  - Product `6` / `AR3`
  - Product `12` / `ACA3`
  - Product `18` / `ACH4`
  - Product `10` / `ACH5`
  - Product `5` / `AB7`
- Design correction:
  - Replaced the heavy full-width purple lower label with a consistent lower information zone and centered title panel.
  - Aligned all top tags to the same right-side position and width.
  - Reframed `AR3` and `AB7` so old source-thumbnail text no longer remains visible in the main image area.
  - Kept the correction scoped to the visually problematic products rather than regenerating every online product.
- External updates:
  - Updated the five owned YouTube full-video custom thumbnails through the YouTube API for the `archivepilates@gmail.com` channel.
  - Patched the five Imweb product representative images so Imweb copied the new thumbnails to its CDN.
  - Imweb PATCH result: all five returned `200` / `SUCCESS`.
- Verification:
  - Public Imweb page readback shows new CDN image URLs for products `6`, `12`, `18`, `10`, and `5`.
  - Live after contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-alignment-fix-2026-06-15/after-alignment-live-contact-sheet.jpg`
  - Public page screenshot: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-alignment-fix-2026-06-15/after-alignment-public-page-screenshot.png`
- Evidence artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-alignment-fix-2026-06-15/aligned-thumbnails-final-v4/aligned-thumbnail-contact-sheet.jpg`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-alignment-fix-2026-06-15/aligned-thumbnails-final-v4/youtube-thumbnail-set-results.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-thumbnail-alignment-fix-2026-06-15/aligned-thumbnails-final-v4/imweb-thumbnail-patch-results.json`

## YouTube Playlist Cleanup And AB4 Paid Conversion - 2026-06-20

- Live target:
  - YouTube channel: `아카이브필라테스` / `@archivepilates`
  - OAuth account context: `archivepilates@gmail.com`
- AB4 paid conversion:
  - Full video `8MNTjnr-vTo` / `[무료공개] 바렐 전신 근막 FLOW 풀영상 (AB4)` was changed from `public` to `unlisted`.
  - Final readback: `privacyStatus=unlisted`, `embeddable=true`.
  - Paid-sale title cleanup:
    - Full video title is now `바렐 전신 근막 FLOW 풀영상 (AB4) | ARCHIVE METHOD · 민진쌤`.
    - Preview video `7MWDVlmiABM` title is now `[미리보기] ARCHIVE METHOD 바렐 전신 근막 FLOW (AB4)`.
    - Final title/status readback passed for both AB4 videos.
  - Other paid full videos that were already `private` were not changed to `unlisted` in this pass. Convert those when the buyer-only Imweb watch pages and entitlement flow are ready to test end to end.
- Playlist cleanup applied:
  - `아카이브 필라테스 | 풀버전 미리보기` -> `ARCHIVE METHOD 미리보기`
    - Privacy: `public`
    - Final count: `19`
    - Removed the AC7 full video from the preview playlist.
    - Added the missing preview videos.
  - `아카이브 필라테스 | 50분 풀버전 클래스` -> `[관리용] ARCHIVE METHOD 풀영상 전체`
    - Privacy: `private`
    - Final count: `23`
    - Removed duplicate entries and added the five missing full videos.
  - `체어 클래스 풀버전` -> `[관리용] 체어 풀영상`
    - Privacy: `private`
    - Final count: `7`
  - `바렐 클래스 풀버전` -> `[관리용] 바렐 풀영상`
    - Privacy: `private`
    - Final count: `8`
  - `캐딜락 클래스 풀버전` -> `[관리용] 캐딜락 풀영상`
    - Privacy: `private`
    - Final count: `4`
  - `리포머 클래스 풀버전` -> `[관리용] 리포머 풀영상`
    - Privacy: `private`
    - Final count: `4`
    - Removed the legacy/non-current full video from the paid-management list.
- Verification:
  - Final YouTube API readback passed for all target playlists:
    - Expected title matched actual title.
    - Expected privacy matched actual privacy.
    - Expected video count matched actual count.
    - No missing, extra, or duplicate target video IDs remained.
  - Verification file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/final-youtube-playlist-readback.json`
  - AB4 paid-title verification file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/ab4-paid-title-final-readback.json`
- Limitation:
  - YouTube API returned `manualSortRequired` when attempting to set explicit playlist item positions.
  - This pass completed membership/count/privacy cleanup, but did not force visual item order inside the playlists.
  - If exact playlist order matters in YouTube Studio, set the playlist sort mode to manual or reorder manually in Studio.
- Evidence artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/before-live-youtube-playlists.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/youtube-playlist-apply-plan.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/youtube-playlist-apply-results.partial.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/youtube-playlist-apply-results-no-position.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/final-youtube-playlist-readback.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/ab4-paid-title-update-results.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-20/ab4-paid-title-final-readback.json`

## YouTube Playlist Ordering, Covers, And Metadata - 2026-06-21

- Live target:
  - YouTube channel: `아카이브필라테스` / `@archivepilates`
  - OAuth account context: `archivepilates@gmail.com`
- Playlist visual order:
  - Re-ran playlist item ordering after the playlist sort mode was changed to manual.
  - Final readback passed for all six target playlists:
    - `ARCHIVE METHOD 미리보기`
    - `[관리용] ARCHIVE METHOD 풀영상 전체`
    - `[관리용] 체어 풀영상`
    - `[관리용] 바렐 풀영상`
    - `[관리용] 캐딜락 풀영상`
    - `[관리용] 리포머 풀영상`
  - Verification file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/playlist-reorder-results.json`
- Playlist cover thumbnails:
  - Generated 16:9 draft covers first, but YouTube `playlistImages.insert` requires 1:1 square images for playlist images.
  - Generated final 1080x1080 square playlist covers.
  - Applied playlist covers through YouTube `playlistImages` API for:
    - `ARCHIVE METHOD 미리보기`
    - `[관리용] ARCHIVE METHOD 풀영상 전체`
    - `[관리용] 체어 풀영상`
    - `[관리용] 리포머 풀영상`
  - Remaining API blocker:
    - `[관리용] 바렐 풀영상` and `[관리용] 캐딜락 풀영상` currently return no hero image from `playlistImages.list`, but `playlistImages.insert` still returns `IMAGE_TYPE_ALREADY_EXISTS`.
    - `playlistImages.update` also rejects the existing/ghost image ids with `unexpectedPart`.
    - Current state is therefore `4/6` playlist covers applied, `2/6` blocked by YouTube API image-state inconsistency.
  - Final cover/order readback file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/final-playlist-order-image-readback.json`
  - Generated square cover contact sheet: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/playlist-thumbnails-square/playlist-thumbnail-square-contact-sheet.jpg`
- Video descriptions and tags:
  - Updated descriptions and tags for `42` target videos:
    - `23` paid full videos
    - `19` preview videos
  - Full-video descriptions now include class info, purchase URL, buyer-only usage notice, and no-redistribution warning.
  - Preview descriptions now include preview/class info and the online-class purchase URL.
  - Tags were standardized around `ARCHIVE METHOD`, `ARCHIVE PILATES`, apparatus, class code, topic, online class, and instructor terms.
  - YouTube reorders tags in readback, so final verification uses set equality rather than list order.
  - Final set-wise readback passed for all `42` videos.
  - Plan file: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/video-description-tags-update-plan.json`
  - Write result: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/video-description-tags-update-results.json`
  - Final verification: `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/video-description-tags-final-readback-setwise.json`
- Remaining next action:
  - Retry the two blocked playlist covers later, or apply the generated square files manually in YouTube Studio:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/playlist-thumbnails-square/archive-method-barrel-full-square.jpg`
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-playlist-apply-2026-06-21/playlist-thumbnails-square/archive-method-cadillac-full-square.jpg`

## AR1 Native Imweb Pass Pilot - 2026-06-29 KST

- Canonical AR1 sales product changed from old normal product `22` to native subscription product `27`.
- Product `27` readback:
  - `prodType=subscribe`
  - `prodStatus=sale`
  - `prodDigitalData.type=subscribe`
  - `subscribeData.group_code=g2026062802f1f8a665b83`
  - `subscribeData.period=40`
  - URL: `https://archivepilates.imweb.me/shop_view/27`
- Product `22` was changed to `prodStatus=nosale`; public direct URL now returns `404`.
- `scripts/imweb_buyer_video_access.py` now uses product `27` for AR1 and keeps product `22` as a legacy purchase alias.
- Live buyer-watch body script now maps AR1 to `/shop_view/27` and does not expose exact full-video IDs as plain strings in global script source.
- Verification:
  - AR1 product `27`: `200`, purchase UI visible, 40D pass text visible.
  - AR1 product `22`: `404`.
  - AR1 watch page unauthenticated HTTP request redirects to Imweb login.
  - Current test-member browser session renders the AR1 buyer page and points `상품 상세` to `/shop_view/27`.
- AR1 YouTube readiness update:
  - On 2026-06-29 UTC, the operator changed AR1 full video `hqmbqTHgO6s` to unlisted.
  - Live checks passed: YouTube embed URL returned HTTP `200`, and YouTube oEmbed returned the AR1 title/iframe payload.
  - `artifacts/imweb-buyer-video-access/youtube-ready-codes.json` now includes `AR1`.
  - Remaining first-order blocker is no longer YouTube readiness; it is that order `202606282038199` is still not associated with an Imweb member UID.

## All Native Imweb Video Pass Products - 2026-06-29 KST

- Converted the remaining paid-video sales products to the same native Imweb subscription/pass model as AR1.
  - Canonical online product set is now product `27` through `49`.
  - Product `27` is AR1; products `28` through `49` cover the remaining paid ARCHIVE METHOD videos.
  - All 23 canonical products are `prodType=subscribe`, `prodStatus=sale`, mapped to their exact `ARCHIVE METHOD {CODE} 40D` member group, and set to `subscribeData.period=40`.
- Old normal-product online sales records were removed from the customer-facing flow.
  - A direct OpenAPI/CLI hard delete was not available in this session, so old normal online products `2-22,24-26` were changed to `prodStatus=nosale`.
  - Final readback: `24/24` old normal online products are `nosale`; no old normal online product remains `sale`.
  - Public sample check: old normal product `/shop_view/3` now returns `404`.
- Live Imweb buyer-watch body script was updated so the product detail links use the new canonical subscription products.
  - Old product-link leftovers: `0`.
  - New product-link missing count: `0`.
- Local buyer-access script was updated so purchases map to the new subscription products while old normal product numbers remain as legacy aliases for historical order handling.
- Verification artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-buyer-video-access/final-product-state-2026-06-29.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-buyer-video-access/old-normal-products-backup-2026-06-29.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-buyer-video-access/old-normal-products-status-after-hide-2026-06-29.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-buyer-video-access/body-script-after-new-product-links-2026-06-29.json`
- Checks run:
  - `python3 -m py_compile scripts/imweb_buyer_video_access.py`
  - `python3 scripts/imweb_buyer_video_access.py verify-groups`
  - Public product samples: `/shop_view/28` and `/shop_view/48` returned `200`; old `/shop_view/3` returned `404`.
- Buyer-watch page follow-up on 2026-06-29:
  - Resolved. Dedicated hidden buyer-watch pages were created and published for all 23 video codes.
  - Public logged-out check: all 23 watch URLs return `HTTP/2 302` to login; no 404 remained.
  - Remaining blocker is YouTube readiness per code, not Imweb page-shell coverage.

## Imweb Product Thumbnail Logo Refresh - 2026-06-29 KST

- Target:
  - Current canonical online sales products: `27-49`.
  - Site: `ARCHIVE PILATES` / `archivepilates.imweb.me`.
- Source logo:
  - Used the provided high-resolution ARCHIVE PILATES red symbol source.
  - The source file is a `1080x1080` RGBA image even though the filename extension is `.jpg`.
  - Cropped the visible red symbol area to avoid shrinking the mark together with the large transparent/white canvas.
- Change:
  - Downloaded the current Imweb CDN product images for all `23` canonical online-class products.
  - Generated new `1280x720` product thumbnails that preserve the existing class footage and purple ARCHIVE METHOD text layout.
  - Added a crisp red ARCHIVE PILATES symbol mark at the lower-left of each thumbnail.
  - Updated all `23` Imweb product representative images through the Imweb product API using `data:image/jpeg;base64` upload payloads.
- Verification:
  - Imweb API patch result: `23/23` returned `SUCCESS`.
  - Imweb readback: `23/23` product image URLs changed.
  - CDN readback: `23/23` new image URLs downloaded successfully.
  - Live online-class category check:
    - `https://archivepilates.imweb.me/17?mode=shop` renders products `27-49`.
    - DOM readback confirmed all product image URLs are new `cdn-optimized.imweb.me/upload/...jpg?w=800` URLs.
    - Mobile screenshot shows the refreshed red logo mark on visible product thumbnails.
  - Known unrelated console message on the Imweb page: `MagnetShell: manifest-url is required`.
- YouTube thumbnail note:
  - YouTube OAuth token at `/Users/archivepilates/Documents/ARCHIVE-G/.youtube-gcloud/youtube-token.local.json` currently fails refresh with `invalid_grant: Token has been expired or revoked`.
  - Therefore this pass updated Imweb shop/product thumbnails only.
  - YouTube channel thumbnails can be refreshed with the same generated files after `archivepilates@gmail.com` YouTube OAuth is reauthorized.
- Evidence artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/thumbnail-logo-refresh-2026-06-29/generated-logo-refresh-contact-sheet.jpg`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/thumbnail-logo-refresh-2026-06-29/after-imweb-cdn-logo-refresh-contact-sheet.jpg`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/thumbnail-logo-refresh-2026-06-29/imweb-logo-refresh-patch-results.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/thumbnail-logo-refresh-2026-06-29/imweb-logo-refresh-readback-after.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/output/playwright/imweb-online-category-logo-refresh-mobile.png`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/output/playwright/imweb-online-category-logo-refresh-desktop.png`

## Breathing Video Registration - 2026-06-29 KST

- Live account targets:
  - YouTube OAuth: `archivepilates@gmail.com`.
  - Imweb admin/API: `home@archivepilates.com`, site `archivepilates.imweb.me`.
- New YouTube full videos found and standardized:
  - ACH7 `_pTvw4neHZk`: `체어 호흡 풀영상 (ACH7) | ARCHIVE METHOD · 민진쌤`, duration `01:00:50`, privacy `unlisted`.
  - ACA5 `ranZEI7SAYg`: `캐딜락 호흡 풀영상 (ACA5) | ARCHIVE METHOD · 은영쌤`, duration `53:56`, privacy `unlisted`.
  - Both descriptions and tags now follow the paid ARCHIVE METHOD format: class code, apparatus, 호흡 topic, instructor, 40-day buyer-only access, and no-redistribution notice.
- Imweb membership groups created:
  - `ARCHIVE METHOD ACH7 40D`: `g2026062956772b09976a1`.
  - `ARCHIVE METHOD ACA5 40D`: `g202606290bc066cba328e`.
- Imweb sale products created:
  - Product `50`: `[온라인] ARCHIVE METHOD 체어 호흡 (ACH7) 40D 이용권`, `15000`, category `온라인 클래스`, `prodType=subscribe`, group `g2026062956772b09976a1`, period `40`.
  - Product `51`: `[온라인] ARCHIVE METHOD 캐딜락 호흡 (ACA5) 40D 이용권`, `15000`, category `온라인 클래스`, `prodType=subscribe`, group `g202606290bc066cba328e`, period `40`.
- Buyer-watch flow:
  - Added ACH7 and ACA5 to `scripts/imweb_buyer_video_access.py`.
  - Added ACH7 and ACA5 to `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-buyer-video-access/youtube-ready-codes.json`.
  - Added a small Imweb footer script for only ACH7/ACA5 because the main body-script update was blocked by Imweb CLI script-size quota.
  - Created and published hidden, search-blocked watch page shells:
    - `https://archivepilates.imweb.me/archive-method-watch-ach7`
    - `https://archivepilates.imweb.me/archive-method-watch-aca5`
- Notion product inventory:
  - Updated the Notion data source `아카이브 유튜브 영상 리스트`.
  - Added `호흡` as a select option under both `체어` and `캐딜락`.
  - Created row `NO. 9` with ACH7 and ACA5 full-video/product/watch-page details.
  - Notion row URL: `https://app.notion.com/p/38ed49eae4bf810ca7b0f2b70e6df9a1`.
- Verification:
  - `python3 -m py_compile scripts/imweb_buyer_video_access.py`
  - `python3 scripts/imweb_buyer_video_access.py verify-groups`
  - YouTube embed and oEmbed checks returned HTTP `200` for `_pTvw4neHZk` and `ranZEI7SAYg`.
  - Public product pages returned HTTP `200`:
    - `https://archivepilates.imweb.me/shop_view/50`
    - `https://archivepilates.imweb.me/shop_view/51`
  - Logged-out watch URLs redirect to Imweb login and no longer return 403/404.
  - Logged-in browser render confirmed the ACH7/ACA5 watch pages render `.ap-watch` and the correct YouTube embed IDs.
- Evidence artifacts:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/youtube-breathing-2026-06-29/`
- Notes:
  - Notion SQL data-source query remains blocked by Notion plan limitation, so the final Notion verification used direct page fetch/readback.
  - The ACA5 watch page was created under the footer menu area in Imweb design mode, but it is hidden and search-blocked; the public URL shell works as intended.

## ACH7 YouTube Studio Cut Edit - 2026-07-01 KST

- Target:
  - YouTube account/channel: `archivepilates@gmail.com` / `아카이브필라테스`.
  - Video code: `ACH7`.
  - YouTube video id: `_pTvw4neHZk`.
  - Title: `체어 호흡 풀영상 (ACH7) | ARCHIVE METHOD · 민진쌤`.
- Requested cut ranges applied through YouTube Studio Editor:
  - `0:02:52-0:03:12`
  - `0:07:42-0:07:49`
  - `0:13:21-0:13:29`
  - `0:15:08-0:15:29`
  - `0:18:59-0:20:19`
  - `0:22:41-0:22:51`
  - `0:29:48-0:29:51`
  - `0:30:06-0:30:10`
  - `0:30:21-0:30:30`
  - `0:33:45-0:33:56`
  - `0:38:58-0:39:01`
  - `0:41:40-0:41:53`
  - `0:43:56-0:44:04`
  - `0:47:06-0:47:36`
  - `0:48:03-0:48:08`
  - `0:49:50-0:50:03`
  - `0:51:28-0:51:35`
  - `0:52:42-0:52:53`
  - `0:53:13-0:53:50`
- Save state:
  - YouTube Studio confirmation dialog showed new length `55:49`.
  - Permanent-change checkbox was confirmed.
  - `변경사항 확인` was submitted.
  - Final Studio state after submit: `동영상 편집 진행 중...`.
- Operating note:
  - YouTube says processing can take from minutes to hours; while processing, viewers continue to see the current version and editor functions may be unavailable.

## ACH7/ACA5 Buyer-Watch Access Hotfix - 2026-07-01 KST

- Issue:
  - Recent breathing videos `ACH7` and `ACA5` were added through a separate Imweb `footer` global script because the main body buyer-watch script hit the Imweb script-size limit.
  - This was weaker than the original buyer-only model because the renderer was not fully tied to the matching `ARCHIVE METHOD {code} 40D` page permission.
  - Logged-out requests still redirected to Imweb login, but a logged-in non-buyer could potentially render the watch page if the page permission was broader than the product group.
- Emergency mitigation:
  - Backed up the footer script to:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-hotfix-2026-07-01/footer-script-before.html`
  - Deleted the Imweb `footer` script containing `data-ap-buyer-watch-breathing="2026-06-29"`.
  - Imweb CLI delete result: `statusCode=200`, `data=true`.
- Verification:
  - Imweb script list now has only `body` and `header` scripts.
  - `data-ap-buyer-watch-breathing` is no longer present in the live script list.
  - Logged-out checks for `/archive-method-watch-ach7` and `/archive-method-watch-aca5` still land on `/login?back_url=...`.
  - The final login pages no longer contain `체어 호흡` or `캐딜락 호흡` from the removed footer renderer.
- Follow-up:
  - Re-enable ACH7/ACA5 only after each watch page is verified as a hidden Imweb page restricted to its matching group:
    - `ARCHIVE METHOD ACH7 40D`
    - `ARCHIVE METHOD ACA5 40D`
  - The safer long-term fix is to create/verify dedicated page shells with group-only permission instead of relying on a separate global footer renderer.

## All Online Video Buyer-Watch Fail-Closed Hotfix - 2026-07-01 KST

- Issue:
  - A full audit found the remaining Imweb `body` global script still contained `data-ap-buyer-watch-all="2026-06-28"` for 23 watch URLs.
  - That renderer selected the video only from `location.pathname`, so it could bypass the intended page permission if a logged-in non-buyer stayed on a matching `/archive-method-watch-{code}` path.
  - Client-side global rendering is not acceptable for paid full videos because the embed ids are shipped to every page before Imweb page permission can be trusted.
- Live mitigation:
  - Backed up the live body script to:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/body-script-before-renderer-removal.html`
  - Updated Imweb `body` script and removed only the buyer-watch renderer block.
  - Preserved the home copy/address patch and Kakao button contrast patch.
  - Imweb CLI update result: `statusCode=200`, `data=true`.
- Verification:
  - Current live Imweb script list:
    - `body`: `data-ap-buyer-watch-all=false`, `data-ap-buyer-watch-breathing=false`, `data-archive-pilates-home-copy-patch=true`, `data-ap-kakao-fix=true`
    - `header`: SEO patch only, no buyer-watch renderer.
  - Product API readback checked all 25 online video products:
    - `AC7`, `ACA4`, `AB7`, `AR3`, `AB6`, `ACH6`, `ACH7`, `AR2-1`, `ACH5`, `ACA2`, `ACA3`, `ACA5`, `ACA1`, `AB3`, `ACH2`, `AB2`, `ACH1`, `ACH4`, `ACH3`, `AB5`, `AB1`, `AR1`, `AR4`, `AB4`, `AB8`.
    - All 25 read as `prodType=subscribe` and `prodStatus=sale`.
  - Public unauthenticated URL audit checked all 25 `/archive-method-watch-{code}` URLs:
    - All 25 land on `/login?back_url=...`.
    - Matching YouTube video id exposure: `0`.
    - Buyer renderer marker exposure: `0`.
    - Fetch errors: `0`.
- Current state:
  - Unauthorized viewing risk from global scripts is closed.
  - Buyer viewing is intentionally fail-closed until each watch page is rebuilt/verified with the video embed inside an Imweb page/code widget that is restricted to the matching `ARCHIVE METHOD {code} 40D` group.
  - Do not restore a global buyer-watch renderer for paid videos.
- Restore preparation:
  - Generated 25 page-local Imweb code-widget snippets for rebuilding the watch pages without a global renderer.
  - Manifest:
    - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-page-widgets-2026-07-01/manifest.json`
  - Each snippet must be placed only inside the matching hidden watch page after confirming the page permission is restricted to its exact `ARCHIVE METHOD {code} 40D` group.
- Evidence:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/script-list-after-body-renderer-removal.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/watch-url-public-access-after-body-renderer-removal-summary.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/product-readback-summary.json`

## ACA3/AR1 Buyer-Watch Emergency Restore - 2026-07-01 KST

- Reason:
  - The full global buyer-watch renderer was removed correctly to close non-buyer bypass risk, but that also made real buyers temporarily unable to watch.
  - Current Imweb member-group readback shows active group members only for:
    - `ACA3`: 2 members
    - `AR1`: 1 test member
- Emergency live change:
  - Updated the Imweb `body` script with a restricted emergency renderer for only:
    - `/archive-method-watch-aca3`
    - `/archive-method-watch-ar1`
  - The full 25-video renderer remains removed.
  - The emergency renderer does not include the plain YouTube ids, but it still ships reversible client-side tokens, so this is not the final secure structure.
  - The renderer refuses to run when the page is `/login`, shows guest/login/signup UI, or contains access-permission denial text.
- Verification:
  - Imweb script readback after update:
    - `data-ap-buyer-watch-emergency="2026-07-01"` present.
    - `data-ap-buyer-watch-all` absent.
    - Plain `ACA3` and `AR1` YouTube ids absent from the live script content.
  - Logged-out Playwright checks:
    - `ACA3` final URL: `/login?back_url=...`, `.ap-watch=0`, YouTube iframe count `0`.
    - `AR1` final URL: `/login?back_url=...`, `.ap-watch=0`, YouTube iframe count `0`.
- Remaining risk:
  - This is a conservative emergency bridge, not the desired final state.
  - Final restore still needs page-local code widgets inside each hidden Imweb watch page restricted to the exact matching `ARCHIVE METHOD {code} 40D` group.
  - Browser editor access was unstable during this restore, so buyer-side authenticated rendering could not be directly checked with a real ACA3 buyer login in this session.
- Evidence:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/video-group-member-counts-redacted-2026-07-01.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/body-script-emergency-buyer-restore-payload.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/body-script-emergency-buyer-restore-update-result.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-access-audit-2026-07-01/script-list-after-emergency-buyer-restore.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/output/playwright/imweb-watch-access-2026-07-01/aca3-public-dom-check.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/output/playwright/imweb-watch-access-2026-07-01/ar1-public-dom-check.json`

## Native Buyer-Watch Finalization Check - 2026-07-01 KST

- Target direction:
  - Remove global video rendering for paid full videos.
  - Use Imweb native `회원그룹 이용권` products.
  - Keep each full video inside its matching hidden/group-only watch page as a page-local code/widget embed.
- Live global-script state:
  - Removed the temporary `data-ap-buyer-watch-emergency="2026-07-01"` renderer from the Imweb `body` script.
  - Current global Imweb scripts contain no `data-ap-buyer-watch*` renderer and no page-local watch marker.
  - Preserved the existing home copy/address patch, Kakao button contrast patch, and header SEO patch.
- Product/group readback:
  - Rechecked all 25 online class products from the page-widget manifest.
  - All 25 are `prodType=subscribe`, `prodStatus=sale`, `period=40`.
  - All 25 product `group_code` values match their expected `ARCHIVE METHOD {CODE} 40D` member group.
  - All 25 product detail pages include the native-pass guide marker and the matching watch-page link.
- Public/non-member verification:
  - Fresh browser check covered all 25 `/archive-method-watch-{code}` URLs.
  - Result: `25/25` redirected to Imweb login.
  - Exposed full-video YouTube IDs: `0`.
  - Exposed YouTube embed iframes: `0`.
  - Exposed buyer-watch/page-local markers: `0`.
- Page-local widget state:
  - `ACA3` was rebuilt in Imweb design mode with the page-local code widget and published.
  - The admin/owner Chrome session renders the ACA3 page-local widget, but that session is not a valid buyer/non-buyer test because it can bypass normal page restrictions.
  - `AR1` was selected in Imweb design mode and confirmed as an empty hidden page; it still needs a page-local code/widget added before buyer viewing is restored there.
  - Remaining non-ACA3 watch pages are intentionally fail-closed until their matching page-local widgets are inserted and published.
- Member-state verification:
  - 비회원: verified. All 25 watch URLs are gated and do not expose videos.
  - 미구매 회원: not fully verified in browser in this session because no usable logged-in non-buyer front-site member session was available.
  - 구매회원: API confirms current ACA3 group members exist, but real buyer-browser verification still needs an actual logged-in buyer session or a dedicated test member flow.
- Do not restore:
  - Do not restore a global body/footer buyer-watch renderer for paid videos.
  - Do not grant or alter real member groups only for testing unless the operator explicitly approves the exact test account flow.
- Evidence:
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-finalize-2026-07-01/script-list-after-remove-global.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-finalize-2026-07-01/guest-all-watch-url-result.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-finalize-2026-07-01/product-subscribe-group-readback-2026-07-01.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-finalize-2026-07-01/aca3-group-members.json`
  - `/Users/archivepilates/Documents/ARCHIVE-IN/artifacts/imweb-watch-page-widgets-2026-07-01/manifest.json`

## Product Detail Watch CTA Visibility Hotfix - 2026-07-01 KST

- Issue:
  - The product detail pages technically contained watch-page guidance, but the buyer-facing `구매 후 시청 페이지` entry was too low/weak to find reliably.
  - The first attempted Imweb CLI `product update info` path returned `200` but did not persist the `content` field. Treat that command as unsuitable for product-detail HTML updates.
- Live change:
  - Patched all `25` canonical online video products through the older Imweb v2 product API.
  - Removed the old trailing `data-archive-pilates-native-pass="2026-06-29"` block.
  - Inserted a prominent `data-archive-pilates-watch-cta="2026-07-01"` block directly below the product subtitle on every product detail page.
  - Each CTA links to the matching `https://archivepilates.imweb.me/archive-method-watch-{code}` watch page and explains:
    - the matching `ARCHIVE METHOD {CODE} 40D` group is granted after purchase;
    - the page can be found again from My Page > order detail;
    - non-members or non-buyers remain on login/permission flow.
- API verification:
  - Product readback after patch:
    - `25/25` contain `data-archive-pilates-watch-cta="2026-07-01"`.
    - `25/25` contain the matching watch path.
    - `25/25` contain literal `구매 후 시청 페이지`.
    - Old `data-archive-pilates-native-pass` blocks: `0`.
- Public/live verification:
  - Raw public product HTML:
    - `25/25` product pages returned HTTP `200`.
    - `25/25` include the CTA marker, literal text, and matching watch path.
  - Playwright DOM check:
    - Product detail pages: `25/25` CTA blocks visible.
    - CTA href matches: `25/25`.
    - Mobile spot checks: `3/3` visible and linked correctly.
  - Watch-page gate recheck:
    - `25/25` watch URLs redirect unauthenticated visitors to Imweb login.
    - YouTube embed iframes exposed publicly: `0`.
    - Full-video YouTube IDs exposed publicly: `0`.
- Evidence:
  - `scripts/imweb_patch_product_watch_cta.py`
  - `artifacts/imweb-product-watch-cta-2026-07-01/product-content-before.json`
  - `artifacts/imweb-product-watch-cta-2026-07-01/product-watch-cta-plan.json`
  - `artifacts/imweb-product-watch-cta-2026-07-01/product-watch-cta-apply-results.json`
  - `artifacts/imweb-product-watch-cta-2026-07-01/product-watch-cta-readback.json`
  - `artifacts/imweb-product-watch-cta-2026-07-01/public-product-html-check.json`
  - `output/playwright/imweb-product-watch-cta-2026-07-01/summary.json`

## Imweb API Capability Recheck - 2026-07-01 KST

- Product detail API control: confirmed.
  - Current AR1 product readback through the authenticated Imweb CLI shows:
    - `prodNo=27`
    - `prodType=subscribe`
    - `prodStatus=sale`
    - `content` contains the visible `data-archive-pilates-watch-cta="2026-07-01"` block.
    - `prodDigitalData.subscribeData.group_code=g2026062802f1f8a665b83`
    - `prodDigitalData.subscribeData.period=40`
  - A no-op dry-run for AR1 product detail content generated a write confirmation token for:
    - command: `product update info`
    - method: `PATCH`
    - path: `/products/27`
    - body keys: `content`, `unitCode`, `version`
  - Reliable live product-detail HTML writes should continue to use the older Imweb v2 product API path used by `scripts/imweb_patch_product_watch_cta.py --transport legacy-v2`.
  - Treat CLI `product update info` as a request-shape/dry-run confirmation path for `content` until a future live retry proves that it persists product HTML reliably.
  - The older Imweb v2 product API and official product add/update documentation also support product `content`, `prod_type=subscribe`, `subscribe_group_code`, `subscribe_period`, categories, images, price, status, SEO, and options.
- Product category API control: confirmed.
  - Current category readback includes:
    - `클래스`: `s2026051668d24d49ef360`
    - `온라인 클래스`: `s20260613848c8356b9c73`
    - `오프라인 클래스`: `s20260613a41f3d6464dfe`
- Member group / entitlement API state:
  - CLI capability catalog includes `member groups list`, `member groups members`, and `member update groups`.
  - Product-level buyer entitlement is already represented by subscribe products and `prodDigitalData.subscribeData`.
  - Do not manually alter real member group state for testing without an explicitly approved test account flow.
- General Imweb design/page/widget API control: not confirmed.
  - CLI capability catalog exposes `product`, `member`, `order`, `script`, `site`, `community`, `payment`, and `promotion`; it does not expose a `menu`, `page`, `design`, or `widget` domain.
  - Read-only raw endpoint probes returned `404 target_invalid` for:
    - `/menus`, `/menu`, `/site/menus`, `/site/menu`
    - `/pages`, `/page`
    - `/design`
    - `/widgets`, `/widget`
  - Treat hidden watch-page shell creation, page permissions, and page-local code-widget insertion as Imweb design-mode/browser work unless a supported private/internal endpoint is deliberately reverse-engineered and tested separately.
- Working rule:
  - Use API for product creation, product detail HTML, category mapping, product images, SEO, sale status, subscribe group mapping, and product CTA fixes.
  - Do not use global `script` injection to render paid full videos.
  - Use page-local widgets inside the matching hidden/group-only watch page for paid full-video embeds.
- Evidence:
  - `artifacts/imweb-api-capability-check-2026-07-01/product-27-readback.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/product-27-content-noop-dry-run.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/product-categories-readback.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/site-capabilities.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/command-capabilities.json`
  - `artifacts/imweb-api-capability-check-2026-07-01/page-endpoint-probes/`

## Page-Local Buyer Watch Widgets Finalization - 2026-07-01 KST

- Supersedes the earlier 2026-07-01 pending note that only `ACA3` had a page-local widget.
- Live change:
  - Inserted/saved page-local Imweb `code` widgets for all `25` canonical online video watch pages from `artifacts/imweb-watch-page-widgets-2026-07-01/manifest.json`.
  - Published the Imweb design after the bulk widget save.
  - Corrected the two watch pages that still had an empty group list:
    - `ACH7` -> `ARCHIVE METHOD ACH7 40D` / `g2026062956772b09976a1`
    - `ACA5` -> `ARCHIVE METHOD ACA5 40D` / `g202606290bc066cba328e`
- Final saved-data verification:
  - `25/25` page-local widgets saved successfully.
  - `25/25` saved widget HTML contains the matching `data-archive-pilates-watch-code="{CODE}"` marker.
  - `25/25` saved widget HTML contains the matching full-video YouTube ID.
  - `25/25` hidden watch-page menu permissions now match `permission_type=group`, `is_hide=Y`, and the expected `ARCHIVE METHOD {CODE} 40D` group.
- Public/non-member verification:
  - Fresh logged-out Playwright check covered all `25` watch URLs.
  - Result: `25/25` showed the Imweb login flow.
  - Public exposed full-video YouTube IDs: `0`.
  - Public exposed YouTube embed iframes: `0`.
  - Public exposed page-local watch markers: `0`.
  - Public global buyer-watch renderer markers: `0`.
- Global script state:
  - Re-read live Imweb `script list` after the page-local widget finalization.
  - `header` and `body` scripts contain no `data-ap-buyer-watch*`, `data-archive-pilates-buyer-watch`, `data-ap-buyer-watch-all`, or `data-ap-buyer-watch-emergency` renderer.
  - The body script still preserves the home copy/address patch and Kakao button color fix.
- Buyer-session note:
  - The background Imweb admin session is not a front-site buyer session; it still lands on the login flow for watch URLs.
  - Real `구매회원` browser rendering should be checked later with an actual member account that has a matching purchased `ARCHIVE METHOD {CODE} 40D` group.
  - Do not grant or alter real customer groups just for testing unless an explicit test account flow is approved.
- Operating rule for future uploads:
  - Product creation/update, product detail CTA, images, price/status, category, SEO, and `subscribe_group_code + subscribe_period=40` are API work.
  - Hidden watch-page page-local code widget insertion and page permission checks remain Imweb design-mode/browser work.
  - Never restore global body/footer JavaScript as the paid full-video renderer.
- Evidence:
  - `artifacts/imweb-watch-page-browser-2026-07-01/bulk-watch-widget-save-publish-result.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/bulk-publish-confirm-result-v2.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/guest-watch-page-verification-summary.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/final-watch-widget-summary.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/script-list-current-after-page-widgets.json`

## Test Member Access Matrix - 2026-07-01 KST

- Created and used dedicated Imweb front-site test members; generated passwords are stored in local macOS Keychain and are not written to docs.
- Buyer test member:
  - Email: `codex.imweb.test.202607011138@archivepilates.com`
  - Confirmed Imweb member exists.
  - Assigned group: `ARCHIVE METHOD AR1 40D` / `g2026062802f1f8a665b83`
- Non-buyer test member:
  - Email: `codex.imweb.nobuyer.202607011145@archivepilates.com`
  - Confirmed Imweb member exists.
  - Group list: empty.
- AR1 duplicate widget correction:
  - Buyer-browser verification initially found duplicate AR1 watch blocks: `2` AR1 watch markers and `2` YouTube embeds.
  - The duplicate old AR1 code widget `w202607012c387df895096` was saved as an empty code widget.
  - Final buyer-browser verification after the correction: `1` AR1 watch marker and `1` YouTube embed.
- Final live access matrix:
  - Logged-out visitor -> `/archive-method-watch-ar1` redirects to login; YouTube iframes `0`.
  - Logged-in non-buyer -> `/archive-method-watch-ar1` shows Imweb permission-denied surface; YouTube iframes `0`.
  - Logged-in AR1 buyer test member -> `/archive-method-watch-ar1` shows the AR1 buyer page; YouTube iframes `1`.
  - Same AR1 buyer test member -> `/archive-method-watch-ab4` shows Imweb permission-denied surface; YouTube iframes `0`.
- Result:
  - The native Imweb model is working for the tested path: `회원그룹 이용권` group assignment controls the matching hidden watch page, and other video pages remain blocked.
  - Keep future paid-video validation in this same order: logged-out, logged-in no-group, logged-in matching-group, logged-in wrong-video.
- Evidence:
  - `artifacts/imweb-test-account-access-2026-07-01/final-access-matrix-after-ar1-duplicate-fix.json`
  - `artifacts/imweb-test-account-access-2026-07-01/50-ar1-after-empty-old-widget-live-recheck.json`
  - `artifacts/imweb-test-account-access-2026-07-01/nonbuyer-test-summary.json`
  - `artifacts/imweb-test-account-access-2026-07-01/precise-login-summary.json`

## All Product Read-Only Access Audit - 2026-07-01 KST

- Scope:
  - Covered all `25` canonical ARCHIVE METHOD online video watch pages.
  - Test surfaces:
    - Logged-out visitor.
    - Logged-in non-buyer test member.
    - Logged-in buyer test member with the current `AR1` group only.
    - Product API subscribe/pass settings.
    - Imweb member-group master data.
    - Saved watch-page widget and page-permission summary from the page-local widget finalization pass.
- Live Playwright result:
  - Logged-out visitor: `25/25` blocked; full-video markers/IDs exposed `0`.
  - Logged-in non-buyer: `25/25` blocked; full-video markers/IDs exposed `0`.
  - Current AR1 buyer test member: `25/25` passed; AR1 opened, the other `24` pages stayed blocked.
  - Failure count: `0`.
- Product/API result:
  - `25/25` video products are `prodType=subscribe`.
  - `25/25` `prodDigitalData.type=subscribe`.
  - `25/25` `subscribeData.group_code` matches the expected `ARCHIVE METHOD {CODE} 40D` group.
  - `25/25` `subscribeData.period=40`.
  - `25/25` product detail content contains the matching buyer watch-page CTA URL.
- Group/page structure result:
  - `25/25` expected member groups exist and match the configured group codes.
  - `25/25` saved watch widgets contain the matching `data-archive-pilates-watch-code="{CODE}"` marker and full-video YouTube ID.
  - `25/25` hidden watch-page permissions were already verified as group-restricted in the finalization artifact.
- Full buyer-write matrix completed:
  - CLI local write safety quota could not be safely disabled; deleted/alternate quota state is detected as tampering by the Imweb CLI.
  - Added a direct official OpenAPI write path to the matrix script with `--direct-openapi-writes`.
  - The direct path updates only the test buyer's member-group list through `PUT /member-info/members/{uid}/groups`; it does not print or persist API tokens.
  - Fixed the remaining ACA3 duplicate watch block by emptying old code widget `w202607015909be28eafde`, keeping `w202607011bae1a4edd1d7`, and publishing the Imweb design through the gateway design publish API.
  - Full matrix result after publish: logged-out `25/25` blocked, logged-in non-buyer `25/25` blocked, buyer assignment `25/25` correct, buyer isolation `625/625` correct, failure count `0`.
  - The buyer test member was confirmed restored to its original `AR1` group after the full matrix.
- Evidence:
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/full-access-matrix.json`
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/aca3-captured-token-gateway-publish-result.json`
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/quick-aca3-after-publish.json`
  - `artifacts/imweb-full-video-access-matrix-2026-07-01/product-subscribe-settings.json`
  - `artifacts/imweb-watch-page-browser-2026-07-01/final-watch-widget-summary.json`
  - `scripts/imweb_full_video_access_matrix.mjs`

## No-Text Product Thumbnail Refresh - 2026-07-03 KST

- Scope:
  - Replaced representative images for all `25` canonical online-class products, product `27-51`.
  - Source images are direct video-frame captures from the matching full-video IDs, with YouTube captions/player overlays removed.
  - Final thumbnail files are stored under `output/imweb-thumbnail-refresh-2026-07-03/final-jpg-no-text-tightcrop/`.
- Change:
  - Updated Imweb product images through the legacy v2 product API with `images: [data:image/jpeg;base64,...]`.
  - The current OpenAPI `product update info` path did not persist `productImages`, and `product images upload` rejected JPG uploads with error `30046`; keep the v2 data-URL path as the working image-update method for now.
- Verification:
  - API patch result: `25/25` returned `SUCCESS`.
  - Imweb readback: `25/25` product image URLs changed from the previous CDN URLs.
  - CDN readback: `25/25` new images downloaded successfully.
  - Live online-class category DOM: `25` products and `25` unique optimized image URLs detected on `https://archivepilates.imweb.me/17?mode=shop`.
  - Mobile and desktop Playwright checks loaded all images successfully.
- Evidence:
  - `artifacts/imweb-thumbnail-refresh-2026-07-03/imweb-no-text-thumbnail-v2-patch-results.json`
  - `artifacts/imweb-thumbnail-refresh-2026-07-03/imweb-no-text-thumbnail-readback-after.json`
  - `artifacts/imweb-thumbnail-refresh-2026-07-03/imweb-no-text-thumbnail-cdn-readback-summary.json`
  - `output/imweb-thumbnail-refresh-2026-07-03/contact-sheet-after-imweb-cdn-no-text.jpg`
  - `output/playwright/imweb-online-category-no-text-thumbnails-mobile-loaded.png`
  - `output/playwright/imweb-online-category-no-text-thumbnails-desktop-loaded.png`

## Purchase Flow, Access, And ACH7/ACH8 Watch Map Fix - 2026-07-04 KST

- Scope:
  - Re-checked the live Imweb purchase flow from home -> online/offline category -> product detail.
  - Re-checked all `25` online video products and the offline lesson product.
  - Re-checked buyer-only watch-page access by logged-out, logged-in non-buyer, and buyer states.
- Change:
  - Corrected local automation mapping for product `28` from old `AC7` to `ACH7`.
  - Corrected local automation mapping for product `50` from old `ACH7` to `ACH8`.
  - Updated `scripts/imweb_buyer_video_access.py`, `scripts/imweb_full_video_access_matrix.mjs`, and the local watch-widget manifest so future automation uses the live ACH7/ACH8 codes.
  - Applied a live Imweb body script patch `data-archive-pilates-watch-map-fix="2026-07-04"` that corrects ACH7/ACH8 buyer-watch page title/code/group/product-link text without putting full YouTube video IDs into global public HTML.
- Verification:
  - Home flow: mobile and desktop both passed.
  - Product detail: online product body, watch CTA, 40-day period, refund copy, and offline lesson service-date/instructor/refund copy passed.
  - Group master data: `25/25` expected Imweb member groups matched.
  - Public watch URLs for ACH7/ACH8 redirect to login and do not expose the full video IDs.
  - Buyer own-page test: `25/25` online video groups opened their matching watch page.
  - Access matrix: logged-out visitor `25/25` blocked, logged-in non-buyer `25/25` blocked, current AR1 buyer check `25/25` passed, failure count `0`.
  - Test buyer member was restored to its original AR1 group after write-based checks.
- Notes:
  - `simpleContent` still lacks the video code on `21` product cards. The current Imweb API returns success but does not persist that field, so this remains a browser/admin or Imweb API-support follow-up. Product names, product detail body, and SEO stored fields already contain the codes.
  - Recent order dry-run returned one AR1 order as `needs_member_signup`; no live grant was applied.
- Evidence:
  - `docs/reports/2026-07-04-imweb-purchase-flow-access-seo.html`
  - `artifacts/imweb-purchase-flow-2026-07-04/home-to-checkout-flow-audit.json`
  - `artifacts/imweb-purchase-flow-2026-07-04/product-detail-consistency-audit.json`
  - `artifacts/imweb-purchase-flow-2026-07-04/buyer-video-group-verify.json`
  - `artifacts/imweb-purchase-flow-2026-07-04/buyer-own-page-access-final.json`
  - `artifacts/imweb-full-video-access-matrix-2026-07-04-skip/full-access-matrix.json`
