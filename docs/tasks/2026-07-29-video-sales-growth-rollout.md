# ARCHIVE PILATES Video Sales Growth Rollout

Date: 2026-07-29

## Scope

1. Add a curated video-purchase entry screen above the native Imweb product list.
2. Add one non-duplicating next-video recommendation to My Classroom and buyer watch pages.
3. Add the same GA4 tag to the official home and Imweb, with cross-domain linking.
4. Prepare canonical, deduplicated day-7 and day-30 buyer follow-up candidates before any member-facing send.

## Production Targets

- Official home: Firebase project `archive-pilates`, Hosting site `archive-pilates-home`
- Imweb site: `S20260516852c71a014d08`
- Imweb unit: `u2026051698c99ea234719`
- Imweb owner route: `home@archivepilates.com`

## Curated Entry

- Best 3: ACH8, AB9, AR4
- Breathing and center: ACH8 to ACA5
- Pelvis and hip: AB9 to AR5
- Circulation and FLOW: AB8 to AR4
- Alignment and core: AR1 to ACH3

The native 27-product list remains the source for live images, prices, ordering, and checkout.

## Measurement

- The existing Firebase measurement id `G-KG5SQ5HE6S` belongs to the ARCHIVE IN app configuration and is not reused.
- Public-site collection remains disabled until the correct Google account owns a dedicated public website/shop GA4 stream.
- The shared loader reads only an explicit `window.ARCHIVE_PUBLIC_GA4_ID`; without it, the loader is a no-op and sends nothing.
- Cross-domain linker:
  - `archivepilates.com`
  - `archivepilates.imweb.me`
- Events:
  - `video_shop_click`
  - `view_item_list`
  - `select_item`
  - `view_item`
  - `begin_checkout`
  - `next_product_click`

`purchase` remains intentionally disabled until a confirmed Imweb payment-completion surface provides a stable transaction id, value, and purchased items.

## Member Communication Guard

Day-7 and day-30 messages must be created from canonical Imweb paid-order detail records. The stable candidate key is the hashed `orderNo + memberUid + followupType + sorted product codes` for each paid order. Creating candidates and sending them are separate states. No current buyer receives a message from a dry-run or candidate-generation test.

The current rollout adds `scripts/imweb_video_followup_candidates.py`. It:

- reads paid, non-refunded Imweb order records;
- ignores the unreliable order-level `isCancelReq` flag;
- computes D7 and D30 from the completed-payment timestamp in KST;
- requires exact-member SMS consent;
- suppresses recommendations already purchased by that member;
- emits only hashed order/member keys and no name, email, phone, or payment details;
- keeps every candidate held until an approved message template and one explicit operator test exist.

## Pre-deploy My Classroom Baseline

- Protected asset SHA-256: `d558c8cf656e47c9c5a9d6342b0432c6f228a8e3e29b91f8fe9cdec36e7d161c`
- Protected asset response: HTTP 200, JavaScript, `no-store`
- Imweb loader: version `2026-07-28d`, one external loader plus one inline fallback
- Authorized staff/owner session: 27 sale-video cards plus 3 private-lesson cards, total 30
- KakaoPay review non-buyer session: 0 cards and the expected empty state
- Logged-out access: `/48` and a watch page both redirect to login with HTTP 302
- No source change exists in the My Classroom asset or loader.

## Local Verification

- `npm run validate:archive-home-classroom`
- `npm run verify:archive-home-classroom-live`
- `npm run validate:video-sales-growth`
- `npm run verify:video-sales-growth-ui`
- `npm run validate:video-followups`
- Live read-only candidate audit: 32 recent orders scanned, one D7 review candidate held, one unpaid/cancelled/refunded order excluded, zero member sends

The follow-up rollout changes no live member communication yet, so ARCHIVE CORE operating rules are not changed in this release. Add the rule when an approved template and real send automation are enabled.

## Production Result

- Source commit deployed: `5ca81d0`
- Firebase target: project `archive-pilates`, Hosting site `archive-pilates-home`
- Official home: HTTP 200; three video-purchase links point directly to Imweb `/17`
- New public assets: HTTP 200 with the expected versioned SHA-256 values
- Existing My Classroom asset: SHA-256 unchanged at `d558c8cf656e47c9c5a9d6342b0432c6f228a8e3e29b91f8fe9cdec36e7d161c`
- Imweb header exact change:
  - before: 14,800 bytes, SHA-256 `edbb2a0b04f4406a91a1ece00d2707d88c4f995ab5f2115b6354988812701b10`
  - after: 15,387 bytes, SHA-256 `d927e64f83c77da11cb87bdcb5ac8c965575924f769da8fbe800a2aa85d29e8b`
- Live `/17` at 390px and 1,440px:
  - Best cards: 3
  - learning paths: 4
  - native products: 27
  - horizontal overflow: 0
- Post-Imweb My Classroom:
  - authorized staff/owner: 27 sale videos plus 3 private lessons, total 30
  - KakaoPay review non-buyer: 0 cards and expected empty state
  - logged out: classroom and watch page redirect to login

The public analytics runtime is deployed in a disabled state marked `pending-public-stream`. The Chrome Analytics session was `archivepilates@gmail.com`, not the intended operational account `home@archivepilates.com`, and no public property existed. No GA4 property was created and no ARCHIVE IN measurement id was reused.
