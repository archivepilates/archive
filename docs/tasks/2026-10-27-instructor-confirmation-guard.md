# Instructor Confirmation Guard Recovery

- Approval: correct validation and dispatch the exact two November 29 instructor-lesson confirmations. Existing forms/SMS and verified native jobs must not be replayed.
- Root cause: rendered pass cards omit native ticket IDs; candidate empty string and missing registration evidence were compared without normalization. A follow-up error-derived action_required then incorrectly blocked the paid attendee family.
- Fix: normalized ticket-ID binding; absent IDs agree, one-sided/changed known IDs fail closed. Only action_required with both member/ticket verified and a recognized failed/review_required form/memo/confirmation step is exempted from the family status hold. All order, identity, amount, approval, cancellation and source-review guards remain.
- Current native readback: both exact identities have one future November 29 instructor-lesson pass, two remaining/reservable uses and KRW 70,000. Live MCP readback is supporting evidence only; canonical registrations and fresh paid order remain action sources.
- Pre-send proof: exact canonical candidate IDs, no accepted/ambiguous send; full bounded provider recipient/template history and current Imweb source. Reuse existing recovery callable and canonical sender; no new scheduler or broad queue execution.
- Verification and deployed/delivered state: record in the matching HTML report after independent readback. CORE rules updated in the same source change.

## Pre-deployment Verification

- Node regression suite: 515 passed; TypeScript integration suite: 363 passed. Includes exact absent/empty ticket-ID source shapes, known-ID mismatch, follow-up attention isolation, final source changes, quiet crossing and accepted/unknown replay guards.
- Functions physical builds, 105 export boundaries, instructor registration validator, rollback guards, calendar/address checks and Hosting/catalog validator passed.
- CORE responsive smoke: 95 checks at 320, 390, 768, 1440 and 1920 widths passed; browser/server closed by the verifier.
- 10:11 KST fresh read-only paid-order/family verification passed for both. Canonical sends and bounded SOLAPI recipient/template history since October 26 each contained zero prior confirmations. The earlier candidate lease is retained metadata of the pretransport skipped state, not an active processing job or send proof.
