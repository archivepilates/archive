# ARCHIVE PILATES Reservation Mirror

Authenticated operator-only read-only server and UI. This is not the operating
booking system. StudioMate remains authoritative; no message, ticket mutation,
reservation, refund, contract, or production automation adapter exists here.

## Environments

- Project: `archive-pilates`.
- Isolated named database: `reservation-mirror`, Seoul; never `(default)`.
- Intended Cloud Run service/account: `archive-reservation-mirror`.
- Dedicated Hosting site: `archive-pilates-booking-test`.
- Intended domain: `booking-test.archivepilates.com`.
- The runtime must have only conditional `roles/datastore.viewer` access to this
  named database; it must be denied access to the default database. Do not run
  the cloud service with an existing broad operator/default service account.
- Source importing uses the already-authorized local operator identity, with a
  separate read-only source client and explicitly named target client. The
  source client is never passed to a mutation helper.
- Direct web/client Firestore access is denied. The browser uses GET APIs only.

## Authentication

Existing CORE email/password identity is reused (`p` + phone digits +
`@archivepilates.com`). Passwords and Firebase user accounts are not migrated.
Firebase JWT signature, issuer, audience and expiry are verified first. Every
private read then calls the fixed existing `getCoreAccessSession` endpoint to
verify the current active owner/manager profile and fresh-session gate. Token
claims alone do not grant access. No auth-source fallback, password reset, new
user provisioning, or first-login bypass is provided here.

Only health/config are public. Config contains Firebase's already-public web
configuration, never server credentials. All other API GETs are authorized;
all non-GET requests return 405 before reaching a repository.

## Source And Coverage

Source canonical collections scoped to studio 5330: memberProfiles, bookings,
lectures, staffs, memberTicketHolds, studiomateDeletedClassLogs. Historical
retained issued-pass JSON from 2026-05-27 can supplement the read-only view.
Older member profiles without studioId are included only through an explicit
member foreign key in a studio-scoped source booking, with canonical alias
validation. No name-only matching or source repair is performed.

Target records: mirrorSnapshots/{generation}/{members,entitlements,bookings,
occurrences,staff,products,sourceAux}; mirrorMeta/current is updated atomically
only after all writes settle and collection counts match. Source paths,
observation/update times, source count drift, duplicate suppression and hashes
are preserved. Failed generations do not replace the active pointer.

This copies the existing collection/export coverage, not every record currently
stored inside StudioMate. Native and fallback IDs are distinguished. Distinct
native booking IDs survive even if they share member/class/time. Fallback
copies of a native event are suppressed when a complete shared event key is
available. Original source records remain unchanged.

Issued-pass original/remaining/bookable/cancellable counts stay separate.
Missing counts remain unknown, not zero. Historical pass observations are
labelled by their source date and are never summed into current balances.
Products inferred from issued-pass labels are not a complete product master.
Holding events/periods, contracts, payments, health and memo contents are not
invented or copied. Classes with no booking and unavailable history are not
guaranteed complete. Captures span an observation window, not a single atomic
snapshot of the operating source.

No periodic synchronization has been activated yet. Do not claim a continuously
updated mirror from an initial verified capture. A future incremental collector
needs a separate source-reader/import-worker identity, watermarks, deletion
evidence and failure/duplicate tests before scheduling; never rebuild all
100,000+ records every few minutes or attach this viewer to outbound queues.

## Local Checks

```sh
npm ci --ignore-scripts
npm test
npm run build
npm audit --omit=dev
```

The loopback-only `node test/preview-server.mjs` serves synthetic UI fixtures on
4313. Its auth mocks and output stay in ignored `.runtime/preview`; Docker and
Hosting never include them. The production build always uses real Firebase
Auth. Do not use the fixture harness with real data.

The source importer defaults to dry-run. It requires explicit project/database,
read-only mode and dispatch=false environment gates. `node import-source.mjs
--apply` writes only a new private target generation. It has no source write,
global reset, deletion, message or reservation command. Large imports are
throttled, bounded and locked; do not start overlapping runs.

## Release Gates

1. Confirm runtime account creation and conditional named-DB read-only IAM.
2. Test default DB denied, named DB allowed under the runtime identity.
3. Verify imported generation/counts and actual indexed GET pagination.
4. Commit only mirror app/docs; deploy this service/site, not root multi-site config.
5. Verify anonymous denial and a real authorized CORE login on deployed surface.
6. Add only booking-test CNAME at Cloudflare and verify HTTPS ownership/cert.
7. Update CORE operating-rule lane with actual scope/coverage/deployed state;
   promote reviewed code/main, verify CI and push. Do not call an incomplete
   domain or auth setup a completed deployment.
