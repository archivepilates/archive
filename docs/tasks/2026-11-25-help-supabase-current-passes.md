# ARCHIVE PILATES Help: daily current-pass snapshot

## Scope and source

Use the existing hourly StudioMate collector as a trigger, not as an identity
authority. The November 25 native member workbook had 3,740 rows, neither a
native member ID nor an issued-pass ID, and 436 duplicate-key groups under the
old importer grouping. The separately verified native current-card read for
one exact StudioMate operator test member had both remaining and bookable counts
and dates, but did not expose issued IDs. Do not import the member workbook or
reuse its Firebase projection as the member-visible balance.

Only explicitly enrolled test subjects can be selected by a private verified
binding with a native ID and exact observed identity; existing native browser
locking and double read-back apply. Scope is at most five verified subjects.
Publish only a complete set for the configured scope. If a subject, card,
catalog classification, count or freshness cannot be verified, withhold the
batch. Preserve separately verified current cards rather than manufacturing
issued IDs or merging cards using name and count. The published data is read
only for display, never for dispatch, enrollment, reservation, refund or payment.

## Runtime

1. The existing scheduled collector, when download and canonical imports
   succeed, invokes the optional snapshot sidecar. Manual reruns and refreshes
   never publish. No additional scheduler exists. The sidecar is disabled
   without `HELP_CURRENT_PASS_SNAPSHOT_ENABLED=enabled` and its private writer
   enrollment. The writer checks today's KST manifest before opening StudioMate;
   the database allows one atomic successful publication for that day.
2. The dedicated schema keeps latest validated category, status, period and
   counts with source time, HMAC member binding, revision and aggregate receipt.
   No native IDs, names, phones, payments, raw Excel or GPT data are exported.
   The existing historical schemas and MCP roles are not consulted or changed.
3. The hosted issuer associates an opaque passkey session digest with its exact
   binding revision; a distinct role reads only that digest. The borrower cannot
   pass a member selector. Expired or revoked sessions, changed binding, unknown
   coverage and snapshots older than 26 hours return no data, not a zero balance.
   Use verified observation time and link to the StudioMate app. Do not create
   new account, billing, auth or browser permissions merely to supply a read.

## Launch gate

The permission-only schema was installed in the Seoul Supabase pilot with
migration `20261125085249`. Independent readback found three RLS-enforced
tables, zero snapshots/member/session rows, and four nonlogin roles.
Anonymous, authenticated API, and service roles cannot read the new data.
The snapshot reader has only the session-bound read routine; ingest and
session-issuer roles cannot read the cards. Existing history permissions
and public Help behavior were not changed. The schema and tested code are
not an activated pipeline.
Dedicated writer, hosted session issuer and hosted reader credentials must be
provisioned separately, plus a hosted persistent passkey/OTP service on the
Help origin. Current local SQLite cannot back a stateless cloud instance. Wire
authoritative enrollment/registered contact and binding revocation before
enabling the job. Verify readback, real owner-only login and the stale/error
fallback before enabling public member access. No actual OTP or passkey record
was created for this preflight. No Mac mini relay is intended between Help
and Supabase; only source collection may depend on the Mac mini.
