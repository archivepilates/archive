# ARCHIVE PILATES Help: daily current-pass snapshot

## Scope and source

Use the existing hourly StudioMate collector as a trigger, not as an identity
authority. The November 25 native member workbook had 3,740 rows, neither a
native member ID nor an issued-pass ID, and 436 duplicate-key groups under the
old importer grouping. The separately verified native current-card read for
one exact StudioMate operator test member had both remaining and bookable counts
and dates, but did not expose issued IDs. Do not import the member workbook or
reuse its Firebase projection as the member-visible balance.

In the initial pilot, only explicitly enrolled test subjects can be selected by
a private verified binding with a native ID and exact observed identity; existing native browser
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

## Whole roster rollout

The expanded mode reads the StudioMate members screen through its existing
paginated browser adapter. It compares every page on a second pass and validates
the reported total, exact member and issued-pass IDs, and duplicate issuance.
A shared class pass without an owner ID in the list must also match the exact
issued ID and owner in both reads of the member detail. Unknown owner, product,
state or count prevents publication, never generates an empty balance.

The November 25 read-only audit reconciled 1,067 members on 22 pages and 523
issued records. 203 records for 177 members used the native class-pass codes
under review (162 in use, 34 future, seven held). The other 320 records use a
different code and are not counted as class-pass candidates. The 46 roster
members without a usable registered phone had no class-pass candidates. The
list supplied distinct source fields for remaining and bookable counts. Direct
group/private count and held card samples matched the separate bookable field
in the UI. The detail check verified the owners of all nine shared class-pass
candidates. SQL, projection and browser tests passed (58 tests).

`--check-roster` produces counts only and never opens the database. In scheduled
mode, writer config can select `scope: verified_roster` with a separate private
`help-current-pass-roster-authority.json` issued by the verified enrollment
authority. It must provide the current checked-at time, exact product ID/source
code classifications, and matching member ID/name/registered-contact/revision
for each member reachable by registered phone. A missing phone may be omitted
only when no member-visible cards remain after verified catalog classification.
Shared or unclassified cards cannot silently produce zero balances.

The batch still writes only pseudonymous keys, revisions and display fields.
It uses the existing daily atomic publication and session-bound read contract.
Cloud enrollment and revocation, exact production catalog review, dedicated DB
credentials and the first owner-only live verification are pending. The
production Help fallback and schedule have not been changed.
