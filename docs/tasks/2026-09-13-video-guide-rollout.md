# Native video product guidance: saved and verified

## Final status: 2026-09-13

- Saved through the authorized home@archivepilates.com Imweb administrator.
- Native common footers are live for products 27-51, 79, 80, 84 and 85: 29
  forty-day videos. No Firebase Hosting or Functions deployment is required.
- Live source: Imweb > 쇼핑 > 쇼핑 설정 > 상품 상세 페이지 > 하단 공통.
- `온라인 영상 · 이용 및 환불 안내`: 27 videos, including hidden AR2-1 (34).
- `온라인 영상 · 미시청 전액 환불`: products 79 and 80 only, preserving their
  broader existing pre-entitlement/unplayed full-refund condition.
- Mobile uses PC content. All 29 existing common-header settings were checked
  as `사용 안함` and preserved during the native bulk assignment.
- Shared use/refund headings, redundant legal copy and script/CSS suppression
  workarounds were removed from individual descriptions. Curriculum, preview
  assets and protected watch links remain in each product.
- Products 1-2, 52-78 and 81-83 were excluded. The global default footer was not
  edited. AR2-1 remains hidden, verified by native admin `판매 설정 숨김`.

## Final verification

- Both templates were saved and reloaded in native settings. Pilot ACA6 was
  assigned and publicly verified before description cleanup. Native bulk
  assignment then saved the 27 standard and two special products separately.
- All 29 descriptions equal their prepared cleanup payloads. Independent
  comparison of both original baselines with final GET snapshots found only
  `content` and `editTime` changed; 80 other fields per product unchanged.
- No added/removed keys or unexpected nested differences. Prices, discounts,
  stock, sale/display flags, 40D settings, groups and product images unchanged.
- All preview embeds and watch links preserve full attributes and order.
- All 28 sale pages render exactly one native footer, one use heading and one
  refund heading; zero individual-guide markers or legacy legal-footer copies.
  Products 79/80 render the special variant. Checks inspect all matching
  `prod_detail_body` containers because desktop lazy loading can duplicate IDs.
- Hidden 34 was checked in native admin: cleaned description, correct saved
  footer and hidden state. Public rendering is not claimed for this hidden item.
- ACA6 live screenshots at actual 320, 390, 768 and 1440px widths: no page
  horizontal overflow or guide text overflow. Reloaded at each breakpoint.
  Disclosure opens on touch; summary is 56px high and contact link is 54px high.
  PC 1920px was also visually checked.
- Physical product 52 and offline product 1 render no video footer.
- Six historical and four native Python regression tests passed. Read-only
  independent audit reproduced all 29 content/media/field comparisons.
- The superseded script's browser fixture rerun could not execute because its
  old named browser session was closed. It was archived locally rather than
  reopening a browser for code no longer present in production. Native live
  browser checks above replace that obsolete check; no active test depends on it.
- No real checkout, refund, member/group mutation or protected-video playback
  test was run. Existing browser sessions were used for page QA; this is not
  anonymous or ordinary-member video-authorization proof.

## Maintenance and evidence

- Edit these named native footers for future common-guide changes. Do not paste
  them back into product descriptions or alter the default for other goods.
- The superseded individual batch is permanently blocked in
  `scripts/apply-video-guide-rollout.mjs`; its local PAUSED gate remains too.
  Old preparation/parser and tests are historical migration support only.
- Native cleanup requires an explicit native-linked evidence file, fresh
  description preflight, dry-run/token and immediate field readback. Uncertain
  writes are read back without automatic resubmission.
- Native source: `scripts/prepare-native-video-guide.py`, using the approved
  `docs/previews/2026-09-13-aca6-use-refund.html` fragment.
- Local ignored evidence: `artifacts/native-video-guide/` before/preflight/after
  snapshots, prepared footers, plan, native-linked record and verified ledger.
- No auth, classroom, entitlement, tracking, refund processing, notification or
  reservation code changed. ARCHIVE CORE rules remain unchanged because this
  is presentation/content consolidation, not an operating-policy change.
- Close task-owned browser tabs and reset temporary viewport overrides at
  finish; preserve all pre-existing user tabs.
- Finish check confirmed all five task-owned tabs closed, both viewport
  overrides reset and the home-account work window closed. The user's original
  StudioMate and Notion tabs remain unchanged. Read-only review agent closed.

## Earlier phase history (superseded)

The following records describe the paused individual-guide approach. The final
native migration above includes its nine already-modified products, so no
abandoned workaround remains live.

## Current state

- User authorized the ACA6 layout across video products, then asked whether
  Imweb's native product-detail common-footer feature would be preferable.
- Stopped the description-write process with SIGINT; no write process remains.
- Reviewed 61 product snapshots. Scope is 29 forty-day video subscriptions,
  including hidden AR2-1; excludes physical goods, offline lessons and private
  non-sale sharing records. No scope or status expansion was performed.
- This turn saved eight products: 27-33 plus pilot 85. ACA6 (84) was already
  saved in the preceding task. Remaining targets were not updated this turn.
- Product 34 readback after interruption confirms no new guide and `nosale`.
- For 27-33, immediate full product GET comparisons show only `content` and
  `editTime` changed. Pilot 85 was verified publicly at 320/390/768/1440 px.
- No price, discount, stock, group, period, member, order or watch-page write.

## Prepared but not fully applied

- Bounded HTML-node replacement preserves content outside verified regions.
- Prepared 79/80 variants preserve their broader existing unplayed refund.
- Exact-text footer suppression replaces the earlier positional CSS approach;
  mismatched paragraphs remain visible and changes restore managed visibility.
- Six Python regression tests and eight isolated browser fixtures passed.
- Source and task files are local/uncommitted. The batch has an explicit
  `artifacts/video-guide-rollout/PAUSED` gate. Do not restart it as-is.

## Recommended next approach

- Create a named video-only native common footer, not the default for all goods.
- Keep product-specific curriculum, preview and watch URLs in each description.
- Move shared usage/refund guidance into the common footer and remove duplicate
  guide fragments and workaround scripts from descriptions when connecting it.
- Preserve special existing terms for 79/80 in a separately named variant or
  product-specific exception; do not tighten policy as part of layout cleanup.
- The official Imweb guides confirm multiple common footers and per-product
  selection. CLI can reference a custom `commonFooterCode` but does not expose
  a common-footer creation command. Native admin creation remains pending.
- Verify actual native rendering on one product before migrating all targets.
- No ARCHIVE CORE rule update is needed yet: no operational/refund policy change.

## Sources

- https://www.imweb.me/qna?mode=faq&q=71216
- https://imweb.me/qna?mode=faq&q=71988
- Official UpdateShopProductInfoRequestDto: commonFooterSettingType / commonFooterCode.

## Native migration approved, pending unlock

- User explicitly approved native common-footer conversion and duplicate checks.
- Computer-use reports that the Mac is locked and automatic unlock failed.
  Asked the operator to unlock; no attempt to bypass the lock or use another
  UI automation technology was made.
- Refreshed all 29 target snapshots in `artifacts/native-video-guide/before`.
- Prepared two native footer fragments and bounded individual-guide removals
  through `scripts/prepare-native-video-guide.py`. Native fragments contain no
  scripts or stylesheet-based duplicate suppression.
- Plan: create named standard and broader-unplayed-refund templates using the
  home administrator, verify one product, then connect only the intended video
  products and remove their now-duplicated guide nodes. Do not alter the default
  common footer for physical goods/offline lessons.
- No native template, product-footer assignment or description removal has
  been saved in this native-migration phase. Existing live guidance is intact.
