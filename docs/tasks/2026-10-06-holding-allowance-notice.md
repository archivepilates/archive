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

## Approved v2 connection and single test, 2026-10-07

- Latest human request authorized approval verification, connection and test send. Dedicated lane updated cleanly to origin/main 01510e6b; unrelated private UI work excluded.
- Direct SOLAPI readback: KA01TP2610061247076605VQTRV7FTPK, APPROVED, BA/IMAGE, channel KA01PF260511123220162lk0NUjstpVl, image ST01FZ261006124706032WUA50TaQpg0. Exact user body/eight variables and one WL button, name `홀딩규정 보기`, PC/mobile https://archivepilates.notion.site/hold. Public content verified in desktop and 390px mobile browser. Deleted v1 was not queried or reused.
- Updated settings/holdingNotice and v2 template state using archive-codex-operator in archive-pilates. Mode remains operator_sample_only, autoSendEnabled=false, canonicalSourcePromoted=false.
- Frozen test identity holding_v2_operator_test_20261006 and sample date 2026-10-06; one approval covers one send across all execution dates. Synthetic 12-week ticket: allowance 16, usage 7, remaining 9. No real StudioMate changes.
- Initial preflight: no candidate, send or v2 provider receipt. Exactly one POST performed at 2026-10-07 14:44 KST. Initial identity lookup did not yet prove acceptance; provisional receipt preserved and no POST retried. GET-only reconciliation subsequently proved COMPLETE/4000 and matched exact recipient, template, text, eight variables and stored receipt.
- Message M4V20261007144407GMUNAIAT107LQYE; group G4V20261007144407HOZQQR8KLTKSZLI. Candidate sent, send done/delivered_reconciled. Audit records retained for duplicate protection.
- Independent review found and fixed malformed-history fail-open, lost provisional receipt, response-shape acceptance mismatch, receipt replacement during reconciliation, unfrozen internal sample date, and weak delivery status checks. Regression tests include these cases plus contention and timeout replay.
- CORE v2 Korean label/catalog and operating rules updated. Existing real-source integration remains pending; approval/test completion is not automatic member-dispatch completion. Deploy scope: CORE Hosting only, no Functions or database source/schema promotion.
- Verification: 188 focused tests passed; CORE Hosting, rollback guards, data-source policy and syntax validators passed; affected Functions codebases empty. Read-only final check confirmed exactly one v2 provider receipt and matching sent/done audit records. Existing heartbeat updated with completed v2 proof and prohibition of another test; remaining purpose is real-source integration.
