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
2. User creates/checks Imweb `온라인 강의` category in admin if category creation is not available via API.
3. Re-run YouTube inventory.
4. Rebuild candidates from fresh inventory.
5. Review the 20 hidden products in Imweb admin.
6. Connect order completion to the buyer-access grant flow for embedded pages.
7. Create or confirm the Imweb member group/page access setup for online lessons.
8. Test whether `prod_type=subscribe`, `subscribe_group_code`, and `subscribe_period=40` removes shipping UI natively and grants the target access group.
9. Complete an end-to-end paid order test for one online video product and confirm that the buyer receives the intended embedded-page access.

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
