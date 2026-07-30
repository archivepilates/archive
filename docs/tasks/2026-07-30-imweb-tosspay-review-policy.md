# Imweb TossPay re-review policy update

## Scope

- Site: `S20260516852c71a014d08`
- Offline class product: product 1
- Live online subscribe products: 27 products
- Live Knitido physical products: 27 products
- Hidden/non-sale entitlement products: excluded

## Required statements

### Online video

- Access begins immediately after payment and entitlement grant.
- Streaming is available in `내 강의실`.
- Access ends 40 days after entitlement grant.
- Download is not provided.
- Full refund is available within seven days if playback has not started.
- After playback or seven days, refund uses the 40-day service period:
  - before one third has elapsed: two thirds;
  - after one third and before one half: one half;
  - after one half: no refund.
- Duplicate payment, missing entitlement, or merchant-side playback failure is refunded or extended after verification.

### Offline instructor class

- The current service date is August 29, 2026, 13:00-15:10.
- The one-use reservation expires when the class ends.
- A confirmed class proceeds regardless of enrollment and is not cancelled for low enrollment.
- Customer cancellation before the class starts is fully refunded.
- After the class starts, refund uses elapsed class time:
  - before one third has elapsed: two thirds;
  - after one third and before one half: one half;
  - after one half: no refund.
- The same elapsed-time rule applies to a no-show request received after the class starts.
- Merchant cancellation is fully refunded; a schedule change allows transfer or full refund.

### Knitido physical goods

- Dispatch: one to two business days after stock confirmation.
- Average delivery completion: two to three business days after payment.
- Maximum delivery completion: 14 calendar days after payment.
- If completion within 14 days is not possible, notify the buyer and fully refund an undelivered order on request.
- Shipping fee: KRW 3,000 with no free-shipping threshold.

## Safety

- Run `product get` before every change and preserve the full response.
- Map the read-only response field `content` to the official PATCH request
  field `description`; an unknown `content` write can return HTTP 200 without
  changing the product.
- Run `product update info --dry-run` before every write.
- Use both confirmation tokens returned by the CLI when required.
- Verify each write with `product get` and the policy marker.
- Do not change orders, members, entitlements, prices, stock, payment settings, or delivery templates.

## Live physical-goods verification

The Knitido category page and a representative product detail already display:

- average delivery completion: two to three business days;
- dispatch: one to two business days after stock confirmation;
- maximum delivery completion: 14 days after payment;
- shipping fee: KRW 3,000 with no free-shipping threshold.

The category page already displayed these statements through the shared site
asset. Product pages also displayed a script-injected notice, but the saved
product descriptions did not contain the delivery period. All 27 live Knitido
descriptions are therefore updated directly. The saved markup reuses the
current shared-asset marker so the browser script does not add a duplicate
shipping notice.

## Execution result

- Applied: July 30, 2026, approximately 17:10-17:22 KST
- Updated product descriptions: 55
  - offline class: 1
  - online video: 27
  - Knitido physical goods: 27
- Hidden and non-sale entitlement products: not changed
- Other untouched domains: orders, members, entitlements, prices, stock,
  payment settings, and delivery templates

The first offline update attempt used the read-response field name `content`.
The API returned success but did not change the saved description. The
mandatory readback guard stopped the run before any other product was changed.
The payload was corrected to the official writable field `description`, then
all 55 product descriptions were updated and read back successfully.

## Verification

- API readback found exactly one expected policy marker in every target:
  - offline: 1 of 1
  - online: 27 of 27
  - physical: 27 of 27
- Representative live pages:
  - offline: `https://archivepilates.imweb.me/shop_view/?idx=1`
  - online: `https://archivepilates.imweb.me/shop_view/?idx=27`
  - latest online: `https://archivepilates.imweb.me/shop_view/?idx=80`
  - physical first sample: `https://archivepilates.imweb.me/shop_view/?idx=52`
  - physical last sample: `https://archivepilates.imweb.me/shop_view/?idx=78`
  - Knitido category: `https://archivepilates.imweb.me/16?ap_shop=knitido`
- Responsive layout checks passed at 320, 390, 768, and 1440 pixels without
  horizontal overflow.
- Physical-product samples 52 and 78 each displayed one shipping notice, with
  no duplicate block from the shared fallback script.
- A final read-only rerun across the full product inventory returned offline 1,
  online 27, physical 27, excluded non-live 4, and `changeCount: 0`. This
  confirms all 55 targets already contain the current policy version and the
  updater is idempotent.
- No real payment, cancellation, refund, or delivery transaction was created
  as part of verification.

## Operational note

The offline policy names the current August 29, 2026 class date and completion
time. When the product is reused for another class date, update the product
description policy in the same operation as the product name and schedule.

No TossPay email or re-review submission was sent in this task.
