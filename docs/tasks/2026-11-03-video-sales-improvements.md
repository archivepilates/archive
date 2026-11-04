# Video Sales Conversion Improvements

- Approval: operator requested restoring product links, featuring AB11/AR7, recommending one paid next lesson after the free experience, and observation/correction/cueing copy with Shorts linkage.
- Branch: `codex/mini/video-sales-improvements-20261103`; base `b4f52707`.
- Scope: official homepage index and two redirect rules, Imweb products 88/89 description/summary/SEO, descriptions of their two existing public previews, one CORE rule note.
- No price, coupon, visibility, member group, first-grant clock, stock, payment, Functions, scheduler or member-send changes.
- Canonical source: native Imweb product and protected-page state; official YouTube channel; tracked homepage; existing private product/reel ledgers.
- Private evidence: `~/Library/Application Support/ARCHIVE PILATES/video-sales-improvements-20261103/` (never commit).

## Verification

- Product patches use official write fields `description`/`summaryDescription`, mapped to GET `content`/`simpleContent`. Initial GET-named payload returned 200 without changing content; independent readback caught it, and the no-op intent was retained before a corrected, separately recorded write.
- Independent product readbacks preserve unrelated fields including price, coupon configuration and 40-day digital entitlement.
- Existing YouTube API refresh returned invalid_grant. No retry/bypass: the already-authorized Studio session was used, with channel/account verification, original description preservation, shared reel lock and independent saved-page readbacks.
- Product and homepage responsive checks: actual 320/390/768/1440px widths, no horizontal overflow. Public preview images loaded; primary product links are at least 44px high.
- Ordinary account AR7 checkout reached, 20,000 KRW shown. A native unpaid checkout draft was generated; no agreement accepted and final payment not clicked.
- Existing AB11 buyer playback reached readyState 4 with advancing time. AR7 nonbuyer denied; logged-out AB11 requires login with no paid player.
- Preview Hosting redirects returned 301 and retained product identity and source query parameters. Homepage manifest retains 80 files; CORE manifest changes only rules HTML.
- New guard tests: 21 pass. Live publication and CI receipts are summarized in the execution report.

## Rollout

Use the scoped release helper only from clean main equal to freshly fetched origin/main. Preserve captured live configuration and all unrelated hashes. Existing release intent blocks replay; reconcile ambiguous results before any retry. Do not deploy the partial official-home folder as a full site because live-only assets must survive.

Report: `docs/reports/2026-11-03-video-sales-improvements.html`.
