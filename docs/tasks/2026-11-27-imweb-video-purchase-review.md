# AB10 purchase review on the video catalog

- Scope: public ARCHIVE PILATES video catalog at `/17` only. Display one verbatim, unattributed AB10 review excerpt before the product grid and link to product 87. Separate the review excerpt from the point notice; the notice asks for honest, specific viewing experiences regardless of rating.
- This is storefront copy only. Review order, author identity, payment, stock, access and reward settings were not changed. No points were issued and no reward job was scheduled.
- Source: `imweb/video-purchase-review-20261127.html`. Deployment: existing operator session, native SEO Body Code, previously blank. The CLI update was rejected before dispatch because the existing unit script exceeded the per-request unit cap. Do not repeat that CLI write or substitute the SEO code for a unit script.
- Saved editor readback equals the tracked block. Unauthenticated HTTP HTML contains the exact CSS, template and JavaScript contents once. Independent CLI readback confirmed the existing header, body and footer unit scripts were unchanged.
- A local DOM contract check passed duplicate prevention, detail/offline exclusion and catalog route re-entry. Live viewport checks at 320, 390, 768 and 1440 CSS pixels confirmed the block is immediately above the grid without horizontal overflow or text/button overlap. At 320 and 390 pixels the button is 44px high. At 390 pixels a click opened the correct product and the native purchase control remained visible. No purchase was initiated.
- Rollback: verify current native SEO Body Code and remove only the marked review block. Leave any newer unrelated content and unit scripts untouched. Reopen the live catalog and confirm the block is gone without altering the grid. Private before/after evidence is in the canonical automation `operations` directory.

## Review-writing link

- Added one `구매평 작성하기` link beside the point notice. It points to the site's native `/shop_mypage/?m2=order` route, not a single product or custom review form. Anonymous visitors receive the native login redirect with the exact order route as the return path.
- Existing AB10 action, point-notice copy, routing code and native purchase/review eligibility stay unchanged. No test purchase or review was submitted.
- Native SEO Body Code reload matched the scoped patch. Anonymous HTTP readback matched the exact tracked content once; existing unit scripts remained byte-for-byte unchanged. At 320, 390, 768 and 1440px the new CTA neither overlapped the notice nor caused horizontal overflow. At 320 and 390px it measured 44px high. Clicking at 390px opened the native order list.

## Class title and button contrast

- Renamed the review heading to the human-readable class name. The site theme had overridden the button foreground to `#363636` over `#242424`; the scoped rule preserves white text over the default and hover backgrounds. Existing links, notice text and purchase eligibility are unchanged.
- Verified the saved editor, the public heading and button's computed colors at 320, 390, 768 and 1440px. No horizontal overflow; both phone widths retain a 44px touch target.
