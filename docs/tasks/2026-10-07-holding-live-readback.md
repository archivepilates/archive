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
