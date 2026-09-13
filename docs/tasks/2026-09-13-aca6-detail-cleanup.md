# ACA6 detail guide cleanup

## Scope

- User approved a one-product live sample, not a catalogue-wide change.
- Verified target: product 84, ARCHIVE METHOD ACA6, on ARCHIVE PILATES Imweb
  site `S20260516852c71a014d08`, unit `u2026051698c99ea234719`.
- Public detail: https://archivepilates.imweb.me/17/?idx=84
- Preserved the first 2,575 characters of the saved detail, including the
  title, class summary, watch destination and dedicated preview assets.
- Replaced the bottom usage/policy block with always-visible usage and refund
  sections, responsive label/value rows, thin dividers, and one contact button.
- Preserved 40-day access, seven-day unplayed refund, elapsed-time partial
  refunds, provider-error remedies, statutory withdrawal periods and the
  consumer-favorable rule. This does not introduce a playback refund ban.

## Saved

- Imweb CLI profile `default`, refreshed through `auth doctor`.
- Two product-only PATCH requests after exact-payload dry runs, both HTTP 200.
- Request fields: `description`, `unitCode`, `commonFooterSettingType`.
- `commonFooterSettingType=disabled` is documented in the official
  `UpdateShopProductInfoRequestDto`. The native product editor independently
  showed `상품 상세 하단 공통: 사용 안함` using the existing home administrator.
- The legacy public template nevertheless continued appending three common
  footer paragraphs. A product-local stylesheet suppresses those duplicate
  paragraphs only when the ACA6 guide marker is present. Their substantive
  information remains visible in the new refund section.
- No shared Header Code, site setting, other product, access logic, order,
  member or payment setting was changed. No Firebase deployment needed.

## Verification

- Product API readback exactly equals the requested description.
- Full before/after comparison: only `content` and `editTime` differ among
  fields exposed by product GET. Price, period discount, stock, sale status,
  categories, product images and `prodDigitalData` are unchanged.
- Preview and watch/contact URLs are unchanged, checked structurally.
- Fresh public loads at 320, 390, 768 and 1440 pixels: both guide headings
  visible, no horizontal overflow, no broken visible product images, legacy
  duplicate footer hidden, contact target at least 44 pixels high.
- Public screenshots retained in ignored `artifacts/aca6-detail/`.
- Existing site JavaScript needed a fresh navigation after viewport changes;
  resizing an already-loaded desktop page alone is not mobile-load proof.
- No purchase, refund, message send, or authenticated buyer playback test was
  performed: this sample changes only public presentation and the product
  footer display. Do not characterize these checks as full classroom QA.
- No ARCHIVE CORE operating-rule change: this task changes no operational or
  refund policy. The source and payload preparation script are scoped to ACA6.

## Maintenance

- Source fragment: `docs/previews/2026-09-13-aca6-use-refund.html`.
- Preparation script reads ignored `artifacts/aca6-detail/before.json` and
  generates a payload without writing to Imweb.
- Snapshot the live product and compare before every future write. Do not
  blindly reapply this historical description over later product changes.
- Recheck the three legacy paragraph selectors if Imweb changes its detail
  template. Never extend this suppression to unrelated product content.
- Generalizing this layout to additional products requires a new approval.
