# Membership Welcome History Classification

## Scope And Ownership
- Worktree: `welcome-history-classification`; branch: `codex/mini/welcome-history-classification`.
- Main: read-only inspector, provider regression tests, CORE rules, release and one explicitly authorized member recovery.
- Bounded worker: exact non-welcome template audit helper/CLI and synthetic tests only. No worker production access.
- User approved validation, scoped production configuration/Hosting release, commits/push, and exactly one welcome only after confirmed no prior attempt. Contract resend is not approved or needed.
- Unrelated cancellation coverage baselines and Notion placeholder warnings are outside this lane.

## Diagnosis
- Existing production provider loader already supports independently audited non-welcome template IDs.
- The configured list was empty. A legitimate group-first-class survey receipt therefore returned `unknown_welcome_template`; source welcome status was `review/complete_welcome_history_required`.
- Read-only source inspection confirmed contract signed, two canonical member aliases, no welcome local record, no candidate/send/claim for the permanent welcome key. Provider all-time verification was incomplete only because of the unclassified survey template.

## Design
- Retain backend send code, permanent phone/alias dedupe, claims, first-purchase/signature/source readback gates, and all existing schedules.
- Audit only the exact group survey contract against current SOLAPI GET evidence and repo identity. Do not infer classification from message text or broadly ignore unknown IDs.
- Update only `systemSettings/membershipContractAutomation.providerHistoryCoverage.nonWelcomeTemplateAllowlist`, preserving general coverage/start time and all enable/scope settings. Compare the prior configuration atomically before writing.
- Read-only inspector exposes local/provider history reasons separately, never produces send authority, never writes or sends.
- Recovery uses the existing exact-contract completion reader, existing queue and exact-candidate processor if needed. Never reset prior claims or generate alternate IDs. Unknown delivery outcomes require reconciliation, not retry.
- No backend source edit or Functions release is needed if the deployed loader already passes the independent-audit contract. Deploy CORE Hosting only for staff rules and adopt tools in the runtime repo.

## Verification And Release
- Tests: welcome TS 609, audit/inspector/native-completion Node 215, existing send policy 137: 961 passed, no skips. Local CORE responsive QA: 95 passed at 320/390/768/1440/1920px. Release/data-source/catalog guards pass.
- Actual audit dry-run passed APPROVED exact template body/image/button contract; no writes. Initial source inspection reproduced `unknown_welcome_template` with local history complete and no prior welcome candidate/send/claim.
- Independent review confirmed exact-ID/transaction/no-resend behavior and found inherited CLI HTTP logging risk; inspector now overrides HTTP/debug logging and regression guards passed. No backend source edit. Affected Functions: zero.
- Runtime/main adopted source `896cdcd3effc2c616c98d1a2ffb7626e211dd8fb`; the single audited allowlist was applied at 2026-10-18T23:54:46.066Z. Source contract hash: `f80ef17f6b46b3dbb24db79c3c3edfb16eb11785ec7c6e77f8676775cff0b433`. No general coverage, schedule or enable flag changed.
- CORE Hosting release and live canary passed at the same SHA; all 95 live responsive checks passed. GitHub affected-functions run `39178451405` succeeded with zero failed/warning annotations. Backend Functions unchanged.
- Exact native completion dry-run and apply each checked one signed contract, with no StudioMate writes or messages. The regular queue created the permanent welcome candidate at 2026-10-19T00:02:03.619Z; the existing readback worker completed its post-candidate verification at 00:02:15.026Z.

## Additional Recovery Blocker
- The one authorized exact-candidate dispatch stopped before the provider transport: `history_time_limit`, the local Firestore history loader's 15-second bound. The generic sender catch recorded candidate/send `failed`, `attempts=1` at 2026-10-19T00:06:29Z even though no welcome claim or provider-attempt timestamp was created.
- A subsequent independent read-only inspection exhausted both local and provider history successfully: two aliases, two failed local history rows, zero provider welcome receipts, valid v6 template. This proves recovery was NOT delivered; a stored failed send row is not provider acceptance.
- Preserve candidate/send/claim evidence and the permanent identity. Do not reset counters, remove failure records, create another candidate or bypass the welcome history guard. No contract resend or second dispatch was attempted.
- Remaining work: a reviewed pre-dispatch-failure recovery design that distinguishes a read failure from an actual/ambiguous outbound attempt, followed by explicitly scoped recovery. Do not weaken the 15-second completeness gate or infer that a provider history GET alone authorizes a retry. Member delivery remains blocked, not complete.
