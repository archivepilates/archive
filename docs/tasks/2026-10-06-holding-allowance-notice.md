# Holding allowance notice

- Worktree: /Users/archivepilates/codex-worktrees/holding-allowance-notice
- Branch: codex/mini/holding-allowance-notice
- Initial base: origin/main 1f485993; reviewed feature rebased onto 7fd3777e.
- Scope: calculation, shadow planner, template creation/inspection, operating-rule source.
- User confirmed floor rounding: floor(initial purchased duration days / 5).
- User authorized SOLAPI template creation/inspection, not member sends.
- No production deployment or canonical schema/source promotion in this stage.

## Implemented

- Inclusive, unique calendar-day union of active and scheduled member holds; cancelled holds excluded.
- Original-duration evidence required; current extended expiry and name inference rejected.
- Explicit center-closure classification is excluded from member usage; do not infer this from dates.
- Stable native studio/member/issued-ticket/hold identity, template-independent duplicate key.
- Incomplete source/history, missing initial baseline and unapproved/mismatched templates block proposals.
- Shadow planner always returns sendAllowed=false. No network, DB mutation, member sends or baseline persistence.
- CORE operating-rule source marks this as not activated, pending data adapter.

## Source gaps / required promotion

Member Excel currently captures current holding status but has no complete hold intervals, immutable original purchased duration or hold event identity. Existing purchase discovery intentionally ignores hold expiry changes and must remain unchanged.

1. Read-only StudioMate UI collector under the shared browser lock: native issued ticket identity, original issuance/contract period evidence, complete holding history. No API-mode migration.
2. Preserve first verified original period. Missing historical terms require operator review, not a guessed product-name duration. Months use the issuance calendar dates, never an assumed 30 days/month.
3. Create initial shadow baseline in workLanes/holding-allowance-notice; do not backfill sends. Compare source counts and selected member examples. Baseline has to observe inactive as well as active holds; an Excel status flag alone is not sufficient.
4. Review a canonical source promotion separately. Proposed production source: memberTicketHolds + immutable issued-ticket original period (not created yet). Identity must survive hold-date edits; if native hold ID is unavailable, require explicit event reconciliation before notifying. WorkLane proposals must never feed sends directly.
5. Add explicit holding notice candidate type to existing candidate rebuilding/queue/eligibility/template variables, keeping staff exclusions and manual approval rules. Do not select from member360 mirrors or derive holding members from activeTickets, which excludes stopped tickets.
6. Revalidate latest complete source and dedupe all candidate/send/provider records immediately before durable claim. Provider unknown outcomes require ledger reconciliation, never blind retries. Tests must cover concurrency, replay, edits/cancellation after queue, and provider timeout after acceptance.
7. Template approval and exact BA/IMAGE/logo/body/button check, approved test recipient, then scoped deployment approval. Daily candidate schedule is 11:30 in source; do not promise immediate delivery unless a validated event hook is added.

## Verification

node --test scripts/tests/holding-allowance-notice.test.mjs

Result: 18 passed, 0 failed. Independent read-only review findings were fixed and regression-tested: overlapping event identities, object property order, malformed ledger keys, literal text rendering and null inputs. git diff --check passed. Full app build/live send tests are not applicable to the unconnected shadow module; no production queue behavior changed.

SOLAPI creation/inspection readback at 2026-10-06T04:47:29.094Z:
- Template: KA01TP261006054728079NtSGrYdtSQH
- Name: 수강권 홀딩 현황 안내 v1
- Status: INSPECTING (not approved)
- BA / IMAGE / ST01FZ260602081207381GWsxSyw1Yo5
- Member sends: 0

No operational source changes, browser sessions, new recurring jobs, historical sends, or source-state writes were performed by this feature task.

## Approved connection and isolated test, 2026-10-06

- Latest human request authorized template connection and one test to Kim Ki-hyo.
- SOLAPI direct readback: APPROVED, exact channel / BA / IMAGE / original logo / eight variables / no buttons.
- Production account: archive-codex-operator@archive-pilates.iam.gserviceaccount.com, project archive-pilates.
- Synced alimtalkTemplateStates/KA01TP261006054728079NtSGrYdtSQH and settings/holdingNotice (operator_sample_only, autoSendEnabled=false, canonicalSourcePromoted=false).
- Sent a synthetic [test] 12-week ticket example only to the registered Kim recipient, ending 8585. Total allowance 16 days, used 7, remaining 9. No StudioMate ticket, hold, payment or booking was created/changed.
- Provider receipt: M4V20261006203146QOI3B62KARGLDDZ, group G4V20261006203146GZMLONOSWFXONYA, created 2026-10-06T11:31:46.734Z, COMPLETE / 4000 at 11:31:51.726Z.
- Durable candidate/send: holding_notice_sample_2853e590c098400005549b3a5033d67dd08d34055b53129625a6fa9e6441b690.
- Initial dispatcher conservatively held the accepted response because the documented send-many/detail messageList omits recipient. Fixed by independently resolving the message ID using GET /messages/v4/list. Reconciled exact recipient/template/text/eight variables and completed delivery without another POST. Reference: https://solapi.com/developers/api/messages.
- Replay verified against live ledgers: duplicateBlocked=true, providerPostCount=0, ledger done, delivery COMPLETE/4000.
- Candidate uses reviewed/manual_review, not the automatic queue. Synthetic content exists only in the audit ledger and provider message; there are no synthetic source documents to delete. Preserve these audit records for dedupe.
- Read-only StudioMate holding UI confirms full intervals but exposes no stable event IDs in rendered fields. Excel status alone still cannot provide immutable original duration and complete holding history. General automatic detection/queue connection remains blocked, not complete.
- CORE names the template in Korean and separately records sample success and automatic detection pending. Deploy scope is CORE Hosting only; no Functions or source schema rollout.
- Verification: 181 focused calculator, dispatcher/reconciliation and catalog tests passed; CORE Hosting validator and data-source policy validator passed; affected Functions codebases empty; whitespace check passed.
- Existing approval heartbeat was updated, not duplicated. It records the completed test and forbids another test even on a later date; its remaining purpose is verified real-source integration.
