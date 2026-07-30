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
