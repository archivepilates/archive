# archivepilates-mcp local MVP

- User direction: keep Mac mini as server; start StudioMate-focused operational MCP, not a CORE chatbot.
- Branch: codex/mini/archivepilates-mcp-local.
- Worktree: /Users/archivepilates/codex-worktrees/archivepilates-mcp-local.
- Base: origin/main fbab6e75c6c54438ae6855fbf42b4c2a7013b8df.
- Ownership: services/archivepilates-mcp/**, this task, scoped report, CORE rule draft and two message-date Firestore index definitions.
- Implementation: six bounded read tools; local memo proposal plus approval-gated existing-queue adapter. Production memo disabled.
- Transport: local stdio only. No HTTP endpoint, no model inference, no added scheduler/LaunchAgent, no arbitrary browser/shell tools.
- Production actions: read-only Firestore calls through archive-codex-operator; no member/queue/send/StudioMate writes. No DB workLane created because the local incubation has no provisional database data.
- Existing interrupted MCP/chat worktree preserved untouched. Existing archive-ai-server preserved.

## Source contract and promotion review

- Canonical collections: memberProfiles, bookings, studiomateMembershipContracts, alimtalkCandidates, alimtalkSends and allowlisted feature jobs. Never member360/members/workLanes.
- Destination of future memo writes: memberMemos plus existing studiomateMemoWriteJobs only, atomically.
- Identity: direct native member ID only for writes; verified lookup and bounded explicit merge evidence for reads. Temporary IDs are not renamed or promoted by this service.
- Memo duplicate key: SHA-256 of fixed studio, canonical member ID and normalized exact memo content. Immutable local plan binds target/content/operator/source hash/expiry. Existing record returns status without requeue; partial journal fails closed.
- Allowed client: trusted Mac mini OS operator via stdio; active owner/manager canonical staff record rechecked per call. Not a multiuser or instructor endpoint. Existing service-account IAM is broader than the application surface; dedicated IAM required before remote exposure.
- Forbidden actions: schedules, membership/pass/reservation/holding edits, refunds/transfers, contract signatures, Alimtalk sends, arbitrary collection/shell operations, initiating existing workers from MCP.
- Target codebase: local service only; no Firebase Functions codebase touched.
- Source freshness: persistence age only; no source import download linkage, so freshness unknown, no native readback claim.
- Verification: isolated in-memory adapters/transactions, real SDK protocol tests, read-only stdio smoke on registered Kim test profile. Memo production E2E and source promotion NOT completed.
- Report: docs/reports/2026-10-15-archivepilates-mcp-local.html.

## Review and verification

- Read-only source mapping subagent: native contracts use nested member bindings; signatureReceipt/completion/observation/welcome separate. Integrated nested query and status projections.
- Transport subagent: official SDK low-level stdio adapter and protocol tests; main reviewed/integrated.
- Test subagent: service tests only, no production access; main fixed inherited input-key validation finding.
- Independent review found signature-receipt binding, displayed-plan approval hash, private reason-code projection, stdin EOF cleanup and date-constrained message reads. Main added fixes and isolated regressions; final checks below.
- Local dependencies updated from existing runtime-compatible firebase-admin 12.7.0 to current 14.5.0 after scoped audit found vulnerabilities in the inherited version. No runtime/global dependency changes. Scoped audit then returned zero advisories.
- First live read found old test records with noncanonical studio IDs. Strict studio query now excludes them instead of widening tenant matching; no records edited.
- Real stdio read-only smoke passed: discovery 8 tools, 6 reads, write disabled. Responses 161-497 ms in one sample, excluding startup. Not StudioMate browser speed or a production SLA.
- Repeat after hardening: six reads 195-638 ms, discovery and write-disabled check passed. Message date composite indexes are absent live (read-only probe returned code 9). Source definitions added; bounded legacy member query is disclosed through coverage until index deployment. No production index deployment occurred.
- No browser created; no shared StudioMate profile lock acquired. MCP child processes closed by client finally blocks; temporary smoke directories deleted.

## CORE rule status

Local draft only: archivepilates-mcp is development/read-only; Mac mini remains execution host; existing canonical source/queue/locking/schedules remain unchanged. No live CORE update because no production operating rule or service activation occurred. The scoped source draft must explicitly remain unreleased until promotion.

## Remaining rollout gates

1. Independent review findings addressed; 85/85 local tests passed. Final syntax/JSON/whitespace checks and scoped audit passed. Live read-only stdio smoke passed with explicit missing-index coverage. No production-write or browser E2E claim.
2. User go-live request before commit/push/main promotion, Codex config registration and CORE Hosting rule deployment.
3. Memo: human-approved limited E2E, queue/source verification, proposal retention/expiry cleanup and rollout decision. Keep writes false until then.
4. Browser native readback, general booking/cancel and other modification tools are future scope, not delivered by this initial read-only facade.

## Read-only operational connection request

- User explicitly requested completing the MCP, connecting it and testing commands. Scope: six read tools, existing canonical sources, Mac mini stdio. Memo writes remain disabled and hidden.
- Deployment set: scoped commit/main promotion/push, two message date indexes, CORE/root Hosting rule publication and source exclusion, runtime dependency install, local Codex registration and registered-command verification. No Functions, Firestore rules, schedules, browser jobs or member mutations.
- Server defaults to ARCHIVE_MCP_READ_ONLY=true and omits both memo tools. Codex enabled_tools additionally restricts the six reads. Operator staff 1979746, project archive-pilates, existing archive-codex-operator service account. No secrets copied to source/config.
- Root Hosting must ignore services/** so this private server implementation is not published as a static asset.
- Final evidence and deployed source revision: docs/reports/2026-10-15-archivepilates-mcp-connection.html.
