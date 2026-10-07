# Holding Live Readback

## Decision And Scope

- Human requested calculation directly from StudioMate immediately before dispatch, without a separately maintained balance/history.
- Reuse holding-source-queue lane and branch; base f41cbcdc. No unrelated changes at start.
- Source: complete native rendered ticket history for original issuance and stable event binding; current holding list/controls for effective ranges.
- Canonical memberProfiles/current staffs and SOLAPI ledger remain recipient and send authority. workLanes roster is discovery only.
- No new source collection, member360 input, StudioMate writes, actual test sends, global auto-send promotion or native-ID fabrication.

## Implementation

- calculateLiveHolding recomputes from a fresh complete ticket. No cached total is accepted.
- Current list/controls determine effective periods. Original issuance determines the 20 percent floor limit; extended expiry is never substituted.
- Truncated past intervals explicitly retained in the latest list count actual dates. Pre-start cancellation is zero only when proven.
- A cancellation on/after its start with no retained actual interval blocks: cancellation timestamp alone does not prove consumed days.
- Mandatory browser acquisition after provider checks, before claim/POST. Snapshot age is not a replacement for acquisition.
- Reader failures, contention, source change, wrong member/ticket, partial pages and displayed-day disagreement fail closed; no cached fallback.
- Source evidence stays in process memory in the new sender. Ledger keeps calculated variables, original/creation/observation fingerprints, approval and receipt, not the complete raw ticket history.
- Immutable operator event key remains compatible with previous real-member receipts. A fully reconciled different event does not suppress a subsequent registration; unknown/same-event receipts still block.
- Periodic worker in live mode records discovery hints only, without browser detail scans or workLane observation snapshots. Legacy canonical promotion is disabled in this mode.

## State Boundaries

- The approved operator send entrypoint is converted to live readback; it is not a new automatic sender.
- Release config target: settings/holdingNotice calculationMode=live_studiomate_readback; autoSendEnabled/canonicalSourcePromoted stay false. Read-back evidence follows below.
- Existing cloud queue stays inactive; no Functions source changes are required.
- No historical baseline reset, no deletion of send claims or audit evidence.
- Early-release real source completeness is not universally proven: the sampled Bae ticket loses a period following cancellation after its start.
- Main must report this specific source limitation, not claim complete unattended member automation.

## Verification

- Mock progression: 365-day allowance 73, original planned 25 days shortened in current list to 10, plus new 7 = used 17 / remaining 56.
- Mock transport: mandatory new acquisition, changed approval block, unknown outcomes, concurrent once, distinct subsequent event, same event resend block.
- Live read-only preview: Lee Jiyoung2 total 73 / used 25 / remaining 48, no extra send.
- Bae missing actual-range case must report review, never used zero by inference. Kim same-minute cancellation may also be ambiguous.
- Final regression counts, actual deploy/runtime/CI and cleanup evidence are recorded after verification.
- Node holding regressions: 328 passed; TypeScript holding regressions: 236 passed.
- Independent review found same-hold resend through changed issuance display metadata; now any issuance change blocks, with a regression.
- Verified earlier receipts must remain byte-equivalent by structured fingerprint in the claim transaction; new receipts appearing after provider verification block.
- Live read-only Bae preview returned early_release_actual_period_required, an expected safety block, with no send.

## Live Release Evidence

- Implementation d81ef1ddc0e28863b9100ee9aab2e6a792012a83 promoted and pushed to origin/main and codex/mini/holding-source-queue.
- Clean main deployment checkout and Mac mini runtime fast-forwarded to the implementation.
- Operator service account transaction changed only settings/holdingNotice.calculationMode. Read-back confirmed all other settings identical, including both global send gates false and mode operator_sample_only.
- Runtime roster worker dry-run returned ok with zero pending jobs and no writes or browser acquisition. Deferral with pending hints is covered by code-path guards, not a fabricated live job.
- Runtime Lee preview reconfirmed 73/25/48 and the same observation fingerprint without a send or a source file.
- Runtime Kim preview returned ambiguous_live_hold_change for same-minute history; this is an intentional no-send review boundary, not proof that actual usage is zero.
- Existing v2 send ledger still contains exactly two earlier delivered rows (Kim synthetic test and Lee approved one-off). Lee candidate sent, send done/COMPLETE/4000, and claim delivered agree. No new send this turn.
- CORE Hosting deployed to archive-pilates and archive-pilates-core; local and live responsive checks passed 95 checks each at 320, 390, 768, 1440 and 1920 widths.
- Canary passed on custom domain and web.app identifying d81ef1dd. All three live rules URLs returned HTTP 200 with the live-readback and no-accumulating-balance rules.
- Functions affected set is empty. Functions deploy/build not required for this scoped change; existing CI performs the broader generated build independently.
- Production deploy completed without errors. The quota-project warning refers to a separate local ADC setting; deployment and scoped operations used the explicit operator account/project successfully.
- Browser collectors closed through finally and shared lock absent after live previews. No user Chrome process was terminated.
- Final process check found no task collector, shared-profile Chrome, Playwright temporary profile or responsive QA process.
- GitHub Functions Affected Check completed success for main run 37615910755 and lane run 37616038434. No CI failure remains.
- This audit record is documentation-only; a second Hosting release is not needed.
