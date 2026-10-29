# ARCHIVE PILATES OPS CORE MCP

User scope: finish the CORE MCP connection, verify reads and modifications. Existing
business capabilities are available to the existing owner; individual member sends,
publication, cancellation and destructive actions still require exact task approval.

Worktree: `/Users/archivepilates/codex-worktrees/core-ops-mcp-20261029`.
Branch: `codex/mini/core-ops-mcp-20261029`.
Base: `af06646964c0dff68e44b8eabd09445c88f28630`.

Implementation: local stdio package `services/archive-core-mcp`, fixed action and
record registries, existing Firebase Auth owner, existing deployed callable handlers,
sealed preparation, source/actor revalidation, local exclusive intent, no automatic
retry after dispatch uncertainty. Existing read-only StudioMate MCP stays unchanged.

No public endpoint, new IAM privilege, model API, polling schedule, arbitrary DB
mutation, auth/password/reset tool or credential output is authorized by this lane.

Implementation: 45 fixed operations (18 read, 27 write), 46 explicitly projected
canonical record areas, eight MCP tools. Sequence attachment changes are explicitly
unsupported; existing image references and tombstones are preserved. Fixed REST
adapters use the existing Firebase user token and existing Firestore security rules,
not Admin SDK writes. No Functions or Firestore rules deployment is needed.

Verification: fake-only suite currently passes; exact final counts in HTML report.
Real stdio/owner/callable read passed. Existing operator meal draft save returned
reused; four canonical records, draft history and related invitation/report ledgers
were independently hash-compared unchanged. Internal owner-only sequence note was
created revision 1, modified revision 2, repeated execution blocked, then tombstoned
revision 3 with empty payload. No member messages or publication. Private evidence:
`~/ArchiveIN/operations/core-mcp/live-test-20261029.json` plus sealed plans/receipts.
Registered configuration, runtime/main promotion, CORE rule deployment and CI are
pending until the final release verification below is recorded.

Live modification test scope: the existing Kim Ki-hyo meal test only, unpublished
draft. First reuse the identical current draft through the native save handler and
independently compare response, draft, report and related message ledger hashes.
No survey resubmission, publication, message, actual cancellation or device command.
