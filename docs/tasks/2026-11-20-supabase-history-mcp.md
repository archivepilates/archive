# Supabase history reader for ARCHIVE PILATES MCP

- Scope: opt-in, local stdio MCP read of a verified closed-month Supabase history snapshot. StudioMate and Firebase live/operational paths are unchanged.
- Destination: existing Seoul Free pilot `vrmtkewdqgcrhpbeijhr`; no public API, new scheduler, production data write, or historical import.
- Identity: exact StudioMate member ID confirmed through the existing live search, with the existing active owner/manager check on each call. The native ID is HMAC-transformed locally with the same key and namespace as the importer. No name-based join.
- Database privileges: a private, static-query security-definer routine with a pinned search path; dedicated role has no table SELECT, publication EXECUTE, or write privileges. Schema changes are gated on the scoped operator decision and a separate verified credential setup. Do not activate using administrative credentials.
- The optional MCP tool does not affect the existing allowlist while its config is absent. No CORE behavior or rules have changed in the implementation-only state.
- Release gate: live DB role and fingerprint readback, TLS/tenant confirmation with dedicated credentials, usage freshness, non-data-bearing empty-month check, stdio allowlist verification, and CORE operating rules update for actual activation. Real data loading is a separate work item and cannot be assumed from a successful connection.

## 2026-11-20 approved rollout checkpoint

- Installed the function and dedicated `NOLOGIN` role in the confirmed Free Supabase project. Provider catalog readback confirms function EXECUTE, no directly accessible history name table, no booking writes, and no import EXECUTE. The administrator-side function check returned `not_loaded` for October. No real data was imported.
- Read the exact session pooler host from the project dashboard. The Mac mini verified that host using the official CA and hostname validation without attempting authentication.
- Credential enrollment is operator-owned. Run `node services/archivepilates-mcp/scripts/enroll-history-reader.mjs --activate-reader` from this worktree in the Mac mini's local Terminal. The explicit option requests enrollment of the one new role; the only prompt is for the existing **pilot database** administrator password (hidden). The helper verifies the target before mutation, registers only the dedicated role, writes its generated credentials privately, and logs no password. The separately verified usage file remains required before enabling MCP detail reads. Use the same HMAC key for the future verified import. Do not rerun a stopped enrollment with a pending credential until the role has been independently reconciled.
- After the operator submitted the verifier, real TLS authentication as the dedicated role succeeded. A direct query with the local reader returned `not_loaded`, no history, `liveReadback=false`, and `allowedForExternalActions=false`. No real data was imported.
- Verified live dashboard usage with both egress classes displayed as 0.00 GB. The short-lived local usage sample stores a conservative combined ceiling for the rounded dashboard figures. Details fail closed when that observation expires; no scheduler was added.
- Dashboard fallback for operator-authenticated Supabase accounts: `--prepare-dashboard` writes the pending config and the verifier-only SQL in the private Supabase secrets directory. It performs no database write and never prints a credential. The operator submits that SQL in the exact project after confirming the role and leaving the existing administrator password unchanged. After operator submission, `--verify-dashboard` makes one dedicated-role readback and publishes the private config only upon success. Pending artifacts are not overwritten or replayed.

## October 2026 verified subset

- The separate private `archive_history_partial.booking_pass_snapshot` holds the independently verified 1,284 bookings and 123 linked passes only. The 726 held bookings and payment/refund data are not exposed; the full-month table and the non-October reader are unchanged.
- `sql/october-partial-read-only.sql` installs a static-query function pinned to this batch's source and payload hashes. Only the existing dedicated reader is granted execution. No schema/table access, new credential, API publication, or write capability is granted. Keep rollback scoped to the October function and its caller; never modify the approved source snapshot.
- October requests keep the owner check, recent live StudioMate selection, and existing usage gate. The response clearly marks partial coverage, returns no native identifiers and uses per-member response-local pass references. Missing verified rows must never be used to infer inactivity or drive messages, reservations, membership changes, or payment decisions.

## Verification

- `node --test tests/history-reader.test.mjs`: actor, exact live identity, month bounds, egress guard, minimized query and response, failure and connection cleanup.
- `node scripts/verify-history-sql.mjs /path/to/local-history-pilot`: isolated PGlite migration with the existing pilot schema; default permissions, role and ACL failure, and two synthetic same-name members.
