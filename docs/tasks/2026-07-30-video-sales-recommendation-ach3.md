# Video recommendation update: ACH3

Date: 2026-07-30

## Request

Replace `체어 호흡 (ACH8)` with `체어 정렬 인지 & 체간 안정화 (ACH3)` where
the former appears as a recommended target.

## Scope

- Video-purchase landing `BEST 01`: product 50 ACH8 to product 44 ACH3.
- Next-video target after `캐딜락 호흡 (ACA5)`: product 50 ACH8 to product 44
  ACH3.
- Keep ACH8 in the `호흡과 중심` learning path.
- Keep the existing ACH8 to ACA5 recommendation for members who already own
  ACH8.
- Do not change products, prices, buyer access, My Classroom source data, or
  follow-up message sending.

## Release safety

- Publish as a new immutable asset:
  `official-home/assets/imweb-video-sales-20260730b.js`.
- Update the Imweb header loader only after the new asset is live.
- Verify the video list at mobile and desktop widths.
- Verify a My Classroom fixture where ACA5 is owned and ACH3 is recommended.
- Recheck the protected My Classroom asset hash after the release.

## Production result

- Source commit: `c042738`
- Firebase project: `archive-pilates`
- Hosting site: `archive-pilates-home`
- New asset:
  `https://archivepilates.com/assets/imweb-video-sales-20260730b.js`
- Local/live asset SHA-256:
  `29b33829d5de7fe0f18a1eae151c11dfe1f0382d1760a475eed68409aa1bcb6c`
- Imweb header loader version: `2026-07-30b`
- Imweb saved-header SHA-256:
  `70cfae792960d81ed2e8110b044a838ca8e5cf54eef8c707228a8d410cb51748`

## Verification

- Static validation and JavaScript syntax checks passed.
- Fixture UI checks passed at 320, 390, 768, and 1440 pixels.
- Fixture My Classroom with ACA5 owned showed ACH3 as the next recommendation
  and linked to product 44.
- Live `/17` at 390 and 1440 pixels:
  - `BEST 01`: ACH3
  - target: `/17/?idx=44`
  - curated asset version: `2026-07-30b`
  - best cards: 3
  - learning paths: 4
  - horizontal overflow: 0
  - console errors: 0
- Protected My Classroom asset remained unchanged:
  `d558c8cf656e47c9c5a9d6342b0432c6f228a8e3e29b91f8fe9cdec36e7d161c`
- Anonymous access still returned HTTP 302 for My Classroom and a watch page.

This recommendation-only change does not alter a staff operating rule, member
communication, purchase access, or an automation send path, so no ARCHIVE CORE
operating-rule update was needed.
