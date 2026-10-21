# LG climate live refresh

- Lane: existing LG climate control; worktree `lg-thinq-control-20261021`, branch `codex/mini/lg-thinq-control-20261021`, base `87ab554e31524ea818e83f375c73e28def545b6b`.
- Approval: user requested improvements through deployment. No real HVAC control test; the user tests hardware.
- Scope: three existing climate callables, climate UI, isolated Mac mini MQTT receiver, narrowly scoped Firestore signal rules, CORE operating rules.

## Promotion and data contract

- Canonical device state/capabilities: LG Korea REST devices/profile/state. Commands continue using the existing server-only `facilityClimateCommands` and `facilityClimateGuards` ledgers. No member or StudioMate source changes.
- `facilityClimateSignals` is a promoted invalidation read model, not a state mirror or command source. Allowed readers: existing active owner/manager sessions, query limit16. All client writes denied. No member, Alimtalk, reservation, payment or control target selection from signals.
- Signal identity: SHA256 of exact allowlisted LG device ID. Fields are deviceId, random revision, eventHash and updatedAt. Receiver status is `__receiver__` with connected/updatedAt/version. No PAT, certificate, raw event, reported state or member data stored in Firestore.
- Receiver: one persistent MQTT connection on the Mac mini, mutually authenticated TLS, strict hostname/CA validation, exclusive PID lock, bounded reconnect/backoff and payload/queue limits. QoS1 duplicate filtering, per-device coalescing and restricted local hash ledger; no control endpoint or client deletion path. Reconnect and12-hour renewal subscribe to24-hour LG state events for exactly8 units.
- New event PAT was issued by the user, separately stored outside Git with private0600 permissions. The user selected all scopes; the receiver intentionally exposes event-subscription operations only. The production REST secret is unchanged. Initial1309 scope failure was resolved by the newly issued PAT; no existing token was revoked.
- Browser uses signals only to request fresh LG state for affected device IDs. Initial snapshots are baselines, not change events. Foreground healthy receiver fallback60s; disconnected/missing/stale fallback15s; errors back off to120s. Hidden pages/navigation/signout pause subscriptions and timers; no background control/retry.
- Dashboard: maximum4 concurrent device workers; each profile/state pair settles before a worker is released. Per-user full read throttle10s, targeted read throttle2s uses the same guard. Unknown/duplicate/out-of-allowlist IDs fail before provider access.
- Control: force-fresh list/profile/state preflight remains. After the sole control POST, reuse only just-checked list/profile and obtain fresh state, reducing7 LG requests to5. UUID/transactional locks/unknown-result holds/no automatic control retry unchanged. This is offline call-count proof, not a measured real control speed claim.
- UI: only the affected device shows mutation loading, other units remain usable. Bulk-off retains its exclusive serial workflow. Reads cannot overwrite concurrent command results; form drafts, focus and open details are preserved.

## Verification and release

- Registration setup succeeded: exact8 devices,2 MQTT topics; no HVAC control request. Credentials and original private source files are not committed.
- Backend109 focused tests and typechecks passed. Full physical Functions builds, boundaries, canonical-source, rollback and Hosting validation passed. The first boundary check ran before the build completed and was rerun successfully.
- UI64, receiver27 and setup12 tests passed. Responsive screenshots at320/390/768/1440 were reviewed; browser fixtures/servers closed. Isolated real Firestore emulator350/350 passed. Default Java was absent; checksum-verified temporary Adoptium21 was used and removed. Two pre-existing timestamp lexical-sort assertions failed initially; normalizing optional fractional seconds fixed the test comparator only, not production rules. Full suite rerun passed.
- All562 focused checks passed. Dependencies mqtt5.16.1/firebase-admin14.5.0 are isolated and integrity locked; registry audit0 vulnerabilities,2 transitive deprecated warnings.
- Pending: main promotion, scoped Functions/rules/Hosting deployment, runtime alignment and single receiver activation, live authenticated read and MQTT connection evidence.
- Live comparison must distinguish MQTT handshake/subscription, received device event, browser invalidation/read and physical control. Never synthesize hardware activity to claim a natural remote-control test.
