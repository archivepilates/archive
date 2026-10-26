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
