# Sale Opening Safety

The operator confirmed that a product must remain non-purchasable before its approved opening time, including while Codex waits for answers. This corrects the earlier ordering error: the November product remained open while the required end-time question was pending.

## Default Sequence

1. Verify the exact product/site and current state.
2. Save a purchase-blocking state for that product, then independently read back and test the direct buyer URL.
3. Edit the intended offering and ask any remaining questions while it stays closed.
4. Open only at the explicitly approved KST time, with current source/clock and latest editor/API stock reconciliation.
5. Independently verify actual sale state and buyer availability, distinguishing scheduling from opening.

Keep closure through missing required inputs, approvals, authentication, interruption and failure. Do not invent an end date because a platform requires one. Keep unrelated valid products on sale. Do not reset existing orders, live stock, prices or option codes, save stale drafts, or repeat uncertain writes.

## Current One-Time Opening

The existing November product is already hidden and its direct buyer URL is blocked. Its approved opening remains 2026-10-26 22:00 KST, without an end date, through the existing single-use automation 11-22. This decision does not re-close or reopen the product, alter its stock, add a scheduler, send members a message or change other operations. The existing automation prompt receives the same safety rule and preserves its one-time schedule.

## Implementation And Verification

- Shared instructions: root AGENTS.md and the Mac mini global ~/.codex/AGENTS.md, Product Sale Opening Safety. The global file was backed up under ~/project-backups/sale-opening-safety-20261026 before its scoped update; no memory files or unrelated instructions were changed.
- Operator hub: existing CORE rules page, added note imweb-sale-opening-safety-policy.
- Source of truth: direct operator approval, live Imweb product/options/orders/stock, existing owner-only product ledger.
- Release: one CORE HTML path on each existing Hosting site, all unrelated files/config preserved; no Functions deployment.
- Validation: synthetic release scope/argument tests, preserved historical guards, source/live hash checks, current one-time schedule and hidden product checks.
- This is an operating default and agent instruction, not a claim that a new universal product-status enforcement service was deployed.

## Release Result

- Policy source commit a251d1cc was promoted to origin/main and fast-forwarded into the operating runtime. The existing release guard requires exact origin/main before deployment.
- At 2026-10-26 19:46 KST, only /core/rules/index.html on archive-pilates and /rules/index.html on archive-pilates-core were released. Versions b6f2c60f198563b2 and 4fd4f13af6ff47c0 preserved all other 222 and 62 files plus Hosting configuration.
- Both live HTTP 200 responses exactly match source SHA-256 b61285bbef7d6b9a0153b193b5fee8b36749be5c140f4e1a05f050191d8e54f8. Release receipts remain in the existing private automation evidence directory.
- 150 focused tests, syntax check and git diff check passed. Global instruction byte-preservation check passed after removing the one added policy block.
- Product fresh read remains nosale without native sale period; direct product URL redirects to home. Existing one-time 11-22 remains ACTIVE at 22:00 with COUNT=1. No further product, stock, order, member or message writes occurred.
- CORE authenticated UI inspection was not completed because login was required. Local report visual QA was unavailable because the browser blocked file URLs. Task-owned browser tabs were closed and the temporary viewport override reset.
