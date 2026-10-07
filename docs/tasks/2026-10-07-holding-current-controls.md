# Current Holding Controls And Approved One-Off

## Scope

- User requested current-hold collection hardening and one real holding v2 notice to Lee Jiyoung2.
- Existing lane/worktree: holding-source-queue, codex/mini/holding-source-queue. Base origin/main 0b8d4202.
- No StudioMate writes, no global dispatch activation, no native ticket ID fabrication or source promotion.

## Confirmed Cause And Implementation

- StudioMate renders an ongoing hold in start/end controls, while its holding list may be empty.
  The old collector only read list children. An empty list was incorrectly reported as zero registered holds.
- Read the saved disabled-start controls and union with listed ranges. Exact current/list match counts once;
  duplicate list rows, partial dates, editable draft controls, invalid dates, or changed double-read evidence block.
- Reviewed hold lifecycle must contain exactly one creation; dates must follow evidenced changes and cancellation
  state must agree. Unsupported event types, ambiguous ordering and contradictory date chains block.
- Operator one-off uses canonical native rendered history/controls file plus memberProfiles and current staffs.
  It does not select from workLanes or forge canonical memberTicketHolds IDs.
- Manual identity: hash(studioId, memberId, issuanceFingerprint, immutableCreationEvidenceFingerprint), in the
  holding_operator_notice namespace. Approval binds current phone, member, entire observation and creation.
- Narrow manual support: unchanged creation rows only. Edits/cancellations require full identity review instead.
- Before one POST: exact approved template contract, provider family history since its 2026-10-06 inception,
  local recipient/member ledgers, current exclusion rules and transactionally inactive global config.
- Atomic candidate/send/claim persistence precedes POST. Unknown outcomes retain claims and provisional receipts;
  reconciliation never posts. Automatic provider audits conservatively block unrecognized manual receipts.

## Data Contract

- Sources: StudioMate normalized rendered source files; memberProfiles; staffs; approved live SOLAPI template/history.
- Destinations: existing alimtalkCandidates, alimtalkSends, holdingNoticeClaims audit records.
- Allowed readers: operators, current audit/reconciliation; automated queue must not send these manual records.
- Forbidden: workLane target selection, mirrored member data, automatic baseline backfill, global activation,
  native ticket/hold creation, StudioMate member/ticket/hold/payment changes.
- Verification: original issuance vs current controls vs all unchanged creation history; exact eight variables;
  recipient/template/content/variables read back using provider message ID; local receipt/claim agreement.

## Validation

- Node regressions: 319 passed including actual DOM fixture tests and operator dispatch races/unknown outcomes.
- TypeScript holding queue/provider/scheduling/roundtrip regressions: 236 passed.
- Read-only live collector now returns one registered hold for the requested member, original period 365 days.
- Independent review cleared stored-ID and mutable-plan fixes before real send.
- Exactly one real POST: SOLAPI M4V20261007201421XGIXGNWGBH8OQTW,
  group G4V20261007201421KY5UNRUQZQZO1VN, COMPLETE/4000; member, text and all eight variables match.
- Initial JSON-array messageIds receipt query returned zero rows despite delivery. Corrected to a complete
  recipient/time query and exact durable message-ID selection. Reconciled without another POST; all three
  audit records now agree. Added regression cases for unrelated records, pagination, and wrong content.
- Real member result: 2026-10-07 through 2026-10-31, total 73, used 25, remaining 48 days.
- Global autoSendEnabled and canonicalSourcePromoted remain false. No native member/ticket/hold changes.
- Deployment scope: Mac mini runtime scripts and CORE operating-rule Hosting only; no Functions changes.

## Live Release Evidence

- Implementation d7099ef130aa9fb828110cdc01d0ea483885e6d7 promoted to origin/main and pushed to lane branch.
- Runtime checkout fast-forwarded cleanly. Read-only runtime collector returns the same observation fingerprint,
  original 365 days and one registered hold; no send or StudioMate write in this verification.
- CORE Hosting release completed on archive-pilates and archive-pilates-core. Live custom-domain rules contain
  current-controls hardening, one-off receipt evidence and the explicit global-send hold.
- Local and live responsive smoke each passed 95 checks across 320, 390, 768, 1440 and 1920 widths.
- Live release canary passed on custom domain and web.app, both identifying d7099ef.
- No Functions rebuild/deploy was needed: affected-codebases output was empty.
- Candidate sent, send done/COMPLETE/4000 and claim delivered verified directly; global settings remain false.
- Task-owned collectors/QA browsers closed and shared profile lock released. No browser process cleanup of user sessions.
- This final record is documentation-only; it does not require a second Hosting release.
