# ARCHIVE IN LG Climate Event Receiver

Isolated Mac mini MQTT invalidation daemon. This package has no appliance control
API, generic LG request helper, registration helper, certificate issuer, state
poller, or client/subscription deletion operation. Main owns LG setup, promotion,
activation, live verification, notifications, and ARCHIVE CORE operating rules.

## Contract

- Accept only `DEVICE_STATUS` with an allowlisted `deviceId` and a JSON object
  `report`. Reject `DEVICE_EVENT`, `DEVICE_PUSH`, arrays, invalid UTF-8/JSON,
  unknown topics/devices, and payloads over 65,536 bytes.
- Exactly eight distinct device IDs; MQTT topics are exact, unique strings from
  the certificate response's `subscriptions` array. No wildcard subscriptions,
  inferred topics, or subscription changes from message payloads.
- Replace only `facilityClimateSignals/{sha256(deviceId)}` with exactly
  `{ deviceId, revision, eventHash, updatedAt }`. `revision` is a new UUID;
  `updatedAt` is local processing time in ISO format, not a device timestamp.
  Never store/apply report state, raw payloads, tokens, or certificates there.
- Replace `facilityClimateSignals/__receiver__` with exactly
  `{ connected, updatedAt, version: 'lg_climate_events_v1' }` every 60 seconds
  and on connectivity changes. True requires MQTT SUBACK QoS1 and successful LG
  event renewal for all eight devices. Stale heartbeat means unknown, not online.
- Coalesce each device's burst for 500ms from the first hint (no starvation),
  serialize that device's writes, and retain only its latest pending hint.
- Deduplicate explicit top-level `messageId`/`messageID` by hash. Persist the last
  explicit ID hash per device, including across subsequent no-ID events; retain
  128 recent ID hashes/device in memory. Never use MQTT packet IDs as event IDs.
  No-ID events use the last raw-byte SHA256/device with a five-second window.
  An older unseen event remains an invalidation hint, never a state update.
- Durable state is a bounded eight-device replacement JSON file, not an event
  history. Write Firestore first, then fsync/atomic-rename the local ledger. A
  crash between those steps can repeat an invalidation; this is not an
  exactly-once delivery guarantee. Earlier coalesced IDs are not all persisted.

## External Configuration

Main creates `/Users/archivepilates/ArchiveIN/secrets/lg/thinq-events.json` with
mode 0600 owned by the current operator. No configuration or certificate belongs
in Git. Accepted keys are exactly:

```json
{
  "pat": "<separate MQTT PAT supplied by main>",
  "clientId": "<stable separate MQTT UUID>",
  "allowedDeviceIds": ["<id1>", "<id2>", "<id3>", "<id4>", "<id5>", "<id6>", "<id7>", "<id8>"],
  "mqttHost": "<server-issued hostname>.iot.ap-northeast-2.amazonaws.com",
  "subscriptions": ["<exact server-issued topic>"],
  "certificatePath": "/absolute/path/to/client-certificate.pem",
  "privateKeyPath": "/absolute/path/to/client-key.pem",
  "caPath": "/absolute/path/to/AmazonRootCA1.pem"
}
```

Optional `firebaseCredentialPath` defaults to
`/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json`.
Only project `archive-pilates` and account
`archive-codex-operator@archive-pilates.iam.gserviceaccount.com` are accepted.
Private key and Firebase credential require 0600/current-owner access.
Certificate/CA expiry, PEM parsing, and client key pairing are checked offline;
this does not prove server-side authorization or certificate-chain acceptance.

Host accepts a bare AWS IoT hostname or `mqtts://hostname:8883`, restricted to
`*.iot.*.amazonaws.com`. TLS requires supplied CA, hostname verification, SNI,
and TLS 1.2 or later. No insecure fallback, automatic certificate rotation, or
modification/revocation of the existing REST PAT. `controlsEnabled` is rejected.

## Connection And Lifecycle

Persistent MQTT 3.1.1 session (`clean: false`), keepalive 30 seconds, subscription
QoS1. Manual reconnect backoff is 1, 2, 4, 8, 16, 32, 60 seconds (capped at 60),
reset after subscription readiness. Resubscribe exact topics on every connect.
Renew only `POST https://api-kic.lgthinq.com/event/{allowlistedId}/subscribe`
on connection and every 12 hours, with a 24-hour expiry and `x-service-phase: OP`.
Requests reject redirects, use 15-second deadlines, and validate bounded 64KB
JSON success envelopes; HTTP200 `error` is a failure. Renewal failures keep
status false and retry after 60 seconds. There is no appliance status polling.

Singleton lock:
`/Users/archivepilates/ArchiveIN/automation/locks/lg-climate-events.lock`.
Exclusive creation, PID+random-token ownership and ownership-checked finally
release. Reclaim only after three minutes AND a dead PID; EPERM means live.
Malformed owners fail closed. The short-lived `.reap` sidecar serializes stale
reclamation; a crash leaving it requires operator inspection of its recorded
PID and age before manual recovery. Never kill an unrelated process.

SIGTERM/SIGINT stop reconnect/renewal/heartbeat timers, abort management requests,
close MQTT, flush the bounded pending hints, mark status false, and release the
lock in finally. Shutdown has a 20-second worker and five-second Firebase cleanup
budget. Unexpected power loss cannot send offline status; consumers must check
heartbeat freshness. Shutdown never deletes LG clients or subscriptions.

State: `~/ArchiveIN/automation/state/lg-climate-events.json` (0600).
Diagnostics: `~/ArchiveIN/automation/logs/lg-climate-events.log` (0600), fixed
category codes only, one entry/code/minute, 256KiB rotation plus one previous
file. No per-event append log. Launchd stdout/stderr files are normally empty;
the daemon does not print payloads or exception stacks. Do not enable DEBUG,
NODE_DEBUG, or GRPC_TRACE; the daemon refuses those diagnostic environments.

## Main-Only Activation

Do not activate until main has confirmed LG registration and produced valid
configuration, client certificate/key, CA, and Firebase credentials. A working
`GET /route` alone is not proof of MQTT authorization. A 401/1309 registration
failure requires main's human reauthorization flow, not a worker retry/revoke.

After review and promotion, main updates canonical
`/Users/archivepilates/dev/archive-in-runtime` from freshly fetched `origin/main`.
Both installer modes require that exact non-symlink runtime, clean Git status,
HEAD equal to local `origin/main`, and executable `/opt/homebrew/bin/node` >=22.
The installer does not fetch Git, commit, push, register LG, or repair credentials.

```sh
cd /Users/archivepilates/dev/archive-in-runtime
/opt/homebrew/bin/node scripts/install-lg-climate-events.mjs --prepare
# Main only, after credential/registration validation and release approval:
/opt/homebrew/bin/node scripts/install-lg-climate-events.mjs --apply
```

`--prepare` only verifies source/runtime/plist; it does not read credentials or
install anything. `--apply` checks configuration/TLS/Firebase credentials BEFORE
npm, directory creation, plist copying, or bootstrap. Missing configuration
returns `CONFIG_MISSING`; missing/invalid credentials reject installation, not a
new daemon crash loop. Existing loaded agents are not stopped or overwritten.
Offline validation cannot establish that a PAT has current MQTT permission.

Apply installs only this package via pinned `npm ci --ignore-scripts`, then
bootstraps `gui/<uid>/com.archive.lg-climate-events`. The template uses absolute
runtime/node paths, RunAtLoad, literal KeepAlive, 30-second throttle and umask077;
there is no polling LaunchAgent. Main verifies launchctl state, fresh receiver
heartbeat, exact hashed signal docs, and the frontend's `revision` invalidation.
If credentials disappear after activation, the runtime exits with a bounded
sanitized diagnostic; main should disable the existing agent until repaired.
Main owns failure notification email and CORE rule updates; this service sends
no email or member messages. This implementation session did not activate it.

## Offline Checks

```sh
npm --prefix services/lg-climate-events ci --ignore-scripts
npm --prefix services/lg-climate-events test
npm --prefix services/lg-climate-events audit --omit=dev
plutil -lint ops/launchagents/com.archive.lg-climate-events.plist
```

Tests inject MQTT, Firestore, clocks, fetch and temporary synthetic ledgers/locks.
No actual LG network, credentials, Firestore, or launchd calls. Dependencies are
exact registry versions `mqtt@5.16.1` and `firebase-admin@14.5.0`, integrity-locked
in the isolated `package-lock.json`; root dependencies remain unchanged.

Protocol references: [LG SDK management implementation](https://github.com/thinq-connect/pythinqconnect/blob/main/thinqconnect/thinq_api.py),
[LG SDK MQTT implementation](https://github.com/thinq-connect/pythinqconnect/blob/main/thinqconnect/mqtt_client.py),
[SDK integration message constants](https://github.com/home-assistant/core/blob/dev/homeassistant/components/lg_thinq/const.py),
[MQTT.js API](https://github.com/mqttjs/MQTT.js).
