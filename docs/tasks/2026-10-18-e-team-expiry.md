# E-team Access Expiry

- Approval: user selected 40 days from each individual grant, with removal of only the E-team group.
- Worktree: `codex/mini/e-team-expiry-20261018`; preserve dirty historical and student-share checkouts.
- Canonical attendance: StudioMate classes 97134045 and 97134052; exact name and phone identity match before grants.
- Canonical state: local protected `student-share-e-261017/state.json`; no personal member state is committed.
- Policy: first verified grant instant plus 40 x 24 hours. Adopt existing verified transition receipts, never reset at a later scan.
- Expiry: remove only `g2026101715ef28611dff4` at/after expiry during the next scheduled check. Existing schedule remains 10:30, 14:30, 18:30 KST; this is not second-accurate immediate revocation.
- Worker: `node scripts/e261017-access.mjs --adopt-verified-grants` is read-only. Add `--apply` for approved policy adoption and due expiry processing. No CLI clock override.
- Future grants: durable intent before write; keep first `grantedAt`, before/after groups and independent verified receipt in `manualImmediateGrants`; run adoption immediately afterward. Record and reconcile unknown grant results before any repeated write.
- Stop regranting terminal expired/externally removed entries. Late registration gets 40 days from its own first verified grant only after current attendance and account identity check.
- Preserve purchases, other groups, grade, points, coupons, identity, original videos and existing page layout.
- Use shared `run.lock`; atomic state saves, no automatic lock deletion, no broad retry. Review unknown writes using live member and group reads.
- Existing automation e-2 remains until all five attendees have completed the grant/expiry lifecycle or operator resolves outstanding unmatched identities; do not delete after everyone joins.
- No new member-facing message, YouTube visibility change, Imweb page publish or Functions deploy in this fix.
- CORE release: replace only E-team note against pinned live source; copy all other Hosting hashes/config and retain concurrent-release guards. New source records policy; future real expiry remains pending verification.
