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

## Deployment And Scoped Recovery

- Source ed5f13e950c2786d1bf001772ba5291b2b06f958 promoted to origin/main after clean fast-forward check and independent review (no findings). Clean local main used for deployment.
- app + alimtalk deploy exit 0, 62 successful updates, two deploy completions, no reported function failures. Confirmation callable, ticket trigger and regular sender independently described ACTIVE with fresh updateTime.
- CORE two-site Hosting exit 0; live 95 responsive checks and release canary passed. Public custom-domain and web.app manifests agree at ed5f13e; live rules include the new policy.
- GitHub Actions 40431377481 succeeded; only Ubuntu runner migration informational annotation. No failed CI checks.
- Runtime fast-forwarded to ed5f13e without restart or schedule changes. Unrelated generated scripts/__pycache__/ appeared later; it is not included or removed.
- 10:19 KST immediately preceding recovery: fresh paid-order/family, exact canonical zero-send and provider zero-history checks passed again. Live approved template/channel/image and two-button contract checked at 10:14 KST.
- Existing CORE recovery callable invoked once per approved registration: first candidate requeued 10:19:39.644 KST, second 10:20:18.071. Exact original candidate IDs preserved, attempts still 0, sends absent at 10:20:27; original native jobs done and form states preserved. No global queue execution, new scheduler, native writes or form replay.
- Final provider receipt and related canonical readback remain pending at this entry. Queue recovery is not dispatch or delivery proof.

## Final Delivery Evidence

- Existing scheduled sender processed both at 10:22 KST. Second candidate sentAt 10:22:04.419, first 10:22:06.002; each attempts 1, same original candidate IDs and corresponding send status done. Both registration confirmation steps verified; native jobs unchanged done.
- 10:23:09 KST recipient-filtered SOLAPI GET returned exactly one confirmation for each, exact stored message ID, recipient and template match, COMPLETE/4000. No provider completion timestamp field; report the lookup verification time, not dateUpdated/dateReceived as completion time.
- The legacy exact-messageIds audit query returned empty even after acceptance; recipient/date-filtered GET was used to obtain and strictly match the exact IDs. This was a read-query limitation, never a reason to replay sends. Canonical source and provider histories were checked without member-facing writes.
- Form state intentionally preserved: one waiting_completion with the original 09:08 SMS, the other pre-existing failed/source-held. No eform requeue/reset, native rerun, memo write or extra confirmation.
- Private receipt evidence remains outside Git. Final report contains aggregate outcomes only. Documentation-only follow-up does not change deployed assets from ed5f13e.
- 10:25 KST independent assertion audit repeated canonical/provider comparisons successfully, confirmed one provider record each and unchanged native/form states, and stored minimized receipt evidence in the owner-only operations folder.
- Task-owned Chrome tab 2059975484 closed and absent from fresh tab inventory; pre-existing user tabs preserved. All deploy/read/watch sessions completed; temporary Firestore listeners unsubscribed. No shared StudioMate profile or lock was opened directly by this task.
