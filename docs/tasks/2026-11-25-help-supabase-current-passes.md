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

## Cloud authentication preflight

The hosted service uses a dedicated PostgreSQL auth store, not the process disk.
WebAuthn challenges, OTP claims and passkey sessions use atomic transactions. A
separate issuer binds the authenticated session digest to the verified member
key and a separate reader returns only that member's cards. The service checks
the binding again after reading and does not release results after revocation.
The browser cannot select a member. The history route is intentionally closed
in this service. Neither route calls StudioMate or the Mac mini on demand, and
personal results are not sent to the public GPT consultation backend.

The private enrollment adapter needs two uncached canonical loaders: a
time-limited operator approval reference and an exact current active binding
with the approved in-person sign-up, registered contact and revision. A dated
StudioMate observation is never presented as a live check; it expires after
26 hours for a binding and one hour for an OTP recipient. Contact changes or
revocation must invalidate the current canonical binding, not wait for the next
daily snapshot. The OTP transport still verifies the approved template and
communication window immediately before dispatch. Do not derive authority from
the anonymous chatbot, pass snapshots, a historical spreadsheet, or a staff
member's name/phone search.

Startup requires three different restricted connections: auth transaction,
session issuer and pass reader. Use TLS-verified pools and separate secrets.
The previous authenticated Mac relay is superseded for this current-pass
design. The Mac mini is still the existing source refresh host; an unavailable
refresh does not break the cloud API, but expired or unverified data stays
unavailable rather than being shown as zero.

The empty auth schema was installed in the existing Seoul pilot in migration
`20261125094757`. Independent readback confirmed forced RLS, two NOLOGIN roles,
four runtime-only routines, no login or unintended grants, and zero auth or
snapshot records. The native pilot and the hosted synthetic browser tests pass;
the hosted browser uses a real virtual passkey verifier, local PostgreSQL auth
storage, and mocked OTP and snapshot boundaries. SQL tests separately exercise
the actual session-bound snapshot routines and deny access from other roles.
No real member records, credentials or member messages were created by this
preflight. The public member route is still not wired to a live service.

Release order: provision scoped connections and wire the canonical enrollment
and revocation loaders, resolve the exact product policy and publish/read back
one verified pilot snapshot, then verify the HTTPS member route with a real
member-controlled passkey and provider delivery. Do not enable broad ingestion
or public member lookup from tests alone. Keep the public Help fallback and
welcome Alimtalk unchanged until the owner-only live check passes.

## Single-member cloud release

- Cloud Run package: `services/archive-help-member-access`. The source and
  container copy allowlists exclude fixtures, private files and the Mac-only
  adapter. `HELP_MEMBER_MODE=disabled` starts without member credentials.
  `pilot` requires three verified TLS logins with independent rights, a
  single pseudonymous member scope, and separate contact, session and OTP
  secrets. The deployment does not accept an administrator or history login.
- Source authority: `archive_help_enrollment` on the same Seoul Supabase pilot.
  Migration `20261125122318` installed the private schema. Readback verified
  three forced-RLS tables, two auth-only reads, three writer-only operations,
  no unintended grants and zero binding, approval or snapshot rows. The
  authority writer is not the read API. Use AEAD for registered contact, bound
  to the exact member and revision; never give decrypted contact to chat.
  A same-revision freshness refresh preserves the existing encrypted box.
  A changed contact or explicit revocation requires a newly verified revision.
- Operator approval must use the exact, completed StudioMate signup and the
  current unique native member/contact status, not a sheet or contract status.
  Publish the verified binding, record an expiring staff approval by digest,
  independently read both back, and invoke the server-side `issueInvite`
  contract privately. There is no public staff approval or invite-mint route.
  The first snapshot must use the exact same revision and HMAC key.
- Release target: Cloud Run `archive-help-member-access` in
  `archive-pilates` / `asia-northeast3`, using the dedicated
  `archive-help-member@archive-pilates.iam.gserviceaccount.com` runtime identity.
  Do not attach the operations service account, default Compute service account
  or another workload's identity. Allow access only to the exact Secret Manager
  versions needed by this service. Do not create a project-wide secret grant or
  weaken organization policy. Tenant-wide deployment remains disabled.
- At cutover, add only the `/api/member-access/**` rewrite before the Help
  catch-all. The public GPT endpoint and other Hosting sites are unchanged.
  After Cloud Run readiness and first-source readback succeed, verify the exact
  Help HTTPS origin, secure host-only session cookie, no-store and member-only
  responses. Then verify one authorized real receipt, member-held passkey and
  self-only lookup. Keep the existing member-app fallback if any gate fails.

The local build, 69 automated tests and synthetic browser flow through the
actual Node HTTP gateway passed. A read-only StudioMate lookup showed one exact
live test subject with a current pass result. SOLAPI returned the exact security
template in APPROVED status; no code was requested. This is not a deployed
endpoint or live authentication proof.

### Private Cloud Run stage

The home account completed the Google Cloud CLI authorization without changing
the default operator identity. The dedicated Help runtime identity exists and
has no user-managed service-account keys. No DB or provider secrets were added
to it. Cloud Run built the allowlisted source at `da9086a8` and deployed the
private disabled revision `archive-help-member-access-00002-88k` in Seoul.
The managed startup HTTP probe succeeded on `/healthz`. A separate external
probe to the published Run addresses received an HTML 404, including with the
authenticated home invoker. This is not successful external routing. Do not
weaken IAM or connect Hosting simply to make the health test pass.

Supabase Help login grants, canonical pilot binding and first snapshot remain
unconfigured. The Help Hosting rewrite, scheduled collector, existing
member-facing behavior and SOLAPI delivery were not changed. Investigate the
provider routing result before the public HTTPS passkey test.

### External routing follow-up

At 22:31 KST, both the home user and the existing operator service account
had `run.routes.invoke`. A Google-issued, unexpired ID token for the exact
member-access Cloud Run URL still returned the Google HTML 404 on
`GET /healthz`. The new and existing Help services resolved to the same set
of public addresses and used the same local network route with verified
Google TLS. The existing Help API control returned its expected GET 405
and logged that request. The member service had no matching request log
despite its successful managed HTTP startup probe.

Evidence for a provider-side routing inquiry: Seoul revision
`archive-help-member-access-00002-88k`, 2026-11-25 13:31:23 UTC,
caller-supplied trace `d37e906d140aeb7d02638f84c18b2034`. This trace did
not appear in service logs. The failure is before the application handler;
the mechanism at the Google ingress is not established. No support case
was submitted and no network, IAM, Hosting, data or message settings changed.

### Firebase OTP consultation trial

The operator confirmed the alternate Firebase Hosting to Cloud Functions
path, without the direct Cloud Run service or an on-demand Mac mini relay.
The current Mac collector remains the snapshot refresh source. The public
pilot uses only the registered 010 contact and a six-digit SOLAPI Alimtalk
code. There is no passkey setup, legacy welcome-link requirement or member
selection by ID in the new public protocol. Registering the number in
StudioMate alone does not bypass the OTP. The live authority is pinned to
one verified pilot subject; a roster-wide contact index was not enabled.

Verification is tied to the same open consultation, via the opaque
in-memory conversation key and scoped secure cookie. The former 20-minute
sign-in cutoff is removed. Valid activity renews a 24-hour inactivity limit;
closing or resetting the consultation cannot recover that key. Selecting
another chat or logging out prevents reuse. Revoked or stale authority fails
closed. Missing or expired snapshot data is not a zero or an OTP prompt.
Each Supabase read has a separate two-minute, revocable capability; it does
not define the member's session duration. Chat and GPT receive neither the
phone nor verification code. Attendance/history remain in the member app.

The inactive probe uses only `firebase.help-member-probe.json` and the
dedicated identity. The real OTP handler has its own staged deployment
configuration `firebase.help-member-runtime.json`. It is not in the
default deployment or the probe and requires separately scoped Google and
Supabase secrets plus a verified source binding and first snapshot.

Local verification uses synthetic contacts and provider responses, with no
real OTP delivery. It proves authenticated lookup at 45 minutes, rejection
in another tab, invalidation after chat reset, and auth retention on a
missing snapshot. Browser widths verified: 320, 390, 768 and 1440. Separate
Functions Framework smoke checks show a disabled probe can receive the
exact cookie and conversation header and the inactive OTP runtime does not
read or send member data. Production Help was not changed.

The Firebase CLI interactive login was expired; the existing isolated
operator ADC profile deployed only the probe. Cloud Functions direct-from-
source CLI attempts failed because the provider-stored archive was empty
despite the local source allowlist. The Firebase CLI packaged the source
and the Gen 2 function became ACTIVE. Authenticated probes returned 200
at both generated function addresses, with the two synthetic headers
observed and member access confirmed disabled.

The one-day Hosting channel `help-otp-connect-probe` on
`archive-pilates-help` returned 200 from the expected function when called
by the authenticated operator, with `private, no-store`, `__session` and
the conversation header forwarded. The anonymous call returned 403 under
the private probe policy. This verifies the alternate Hosting rewrite
for trusted callers, not member authentication without Google IAM.
The public Help homepage still served its existing content. No member
records, SOLAPI sends, public IAM changes, or live Hosting rewrites were
made. The old direct Cloud Run service was not changed or repaired.

Before any real-member launch, establish the exact secure production
invocation path, provision dedicated database connections and secrets,
publish and reconcile the approved single-member source, and test the
complete OTP flow from the member origin without a staff Google token.

## Dedicated Pilot Connections And First Source Readback

- Five restricted Help roles were staged in the Seoul pilot and activated
  through the one-time local hidden database-password prompt. All five
  production TLS connections and the exact role memberships were independently
  verified. No existing credential, history grant or job schedule was changed.
- One approved member's exact StudioMate name, full registered contact and
  current count card were re-read, then one encrypted binding and one
  pseudonymous current-pass snapshot were published. The independent count
  was one member and one card. The dedicated reader matched the expected card
  through the correct server-only grant. An unknown token, a synthetic other
  member key and a revoked grant produced no data. Both test grants were
  revoked. No histories, payments or refunds were copied.
- On the isolated, disabled Firebase probe only, a no-Google Hosting request
  returned 200 and forwarded the synthetic cookie and conversation header.
  The probe's private invoker check was restored and anonymously returned
  403 afterwards. This was not the member OTP endpoint. The public site was
  unchanged. The exact SOLAPI security template is approved.
  The actual member runtime also started locally with the restricted
  production pools and current binding. Its HTTP contract returned 200 for
  availability and 403 for wrong origin, anonymous cards and a forged
  session. The local runtime check never called OTP dispatch. All 87 focused
  service and SQL tests passed.
- `scripts/Enroll-Help-Member-DB.command` is a one-time operator bootstrap;
  after a saved candidate or uncertain result use the script's readback-only
  activation verification, not another password change. No credentials
  belong in a terminal argument, chat, Git or SQL Editor.
- `scripts/seed-help-member-pilot.mjs --verify` compares the private source
  digest with the one-member batch and tests scoped reads with short grants
  which it revokes. `--refresh` takes the exact approved member name and
  registered contact suffix, keeps the original revision, checks the current
  full contact before updating, and can publish only a new KST-day batch.
  It is an explicit pilot operation, not a second scheduler. A changed
  contact, uncertain save or missing source requires review.
- Actual device receipt and OTP entry remain unverified. Use a fresh binding
  observed within the preceding hour and the 09:00--23:00 KST window.
  Remaining deployment gate: bind only the dedicated Help runtime secrets
  and test the HTTPS member endpoint from the pilot browser origin, with no
  staff Google token, once through SOLAPI and without SMS fallback. Confirm
  the member can read their own card and a separate unauthenticated or
  mismatched consultation cannot. Do not enable broad public rollout before
  that evidence, and do not present a simulated code or API health as delivery.
