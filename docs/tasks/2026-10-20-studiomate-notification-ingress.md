# StudioMate Notification Ingress

- Worktree: `/Users/archivepilates/codex-worktrees/studiomate-notification-ingress-20261020`
- Branch: `codex/mini/studiomate-notification-ingress-20261020`
- User scope: connect notification hints, verify real receipt and duplicate prevention, preserve Excel holding detection and existing automation ownership.
- Base: `926ae1a2` from origin/main. Production promotion must recheck origin/main and runtime cleanliness.

## Architecture And Source Policy

The Mac mini existing admin-sync LaunchAgent remains the only timer for this observer. It polls rendered StudioMate notifications every two minutes, takes a short shared browser lease, and releases it after reading. This is browser-list polling, not verified Web Push interception. No direct private API requests, token capture, new login permissions, new listener, new model or notification sender.

Canonical business source stays `memberProfiles`, `bookings`, StudioMate normalized source imports and existing contract/send records. The only queue destination is existing `adminSyncRequests` with existing `emergency_excel` mode. Hints select no members and authorize no message/reservation/refund/contract operation.

The local derived hint cursor is `~/ArchiveIN/automation/state/studiomate-notification-ingress.json`. It is a disposable discovery read-model, not business truth: content SHA-256, type, observation timestamp, bounded seen window, pending keys, and request receipt only. No member names, phones, message bodies, secrets or token data are persisted. Allowed reader: observer, diagnostics/operator only. Forbidden: member-facing target selection, first-class/holding calculation, send authorization. Source scopes: latest rendered list, not complete event history. A missing overlap is disclosed and existing hourly Excel remains fallback.

First snapshot is a no-action baseline. A content hash excludes relative display time and is only a hint identity. Identical separate business events may coalesce and must still be reconciled from canonical sources. Batch request IDs survive retries/restarts. Firestore transaction creates either the original existing refresh request or a receipt pointing to an existing pending refresh. Never coalesce into an in-flight export whose snapshot may precede the notification.

Notification refresh imports source data but does not invoke holding discovery/dispatch, contract observer/completion/signature SMS, contact sync or staff sidecars. Existing hourly Excel retains those hooks. The parent Excel pipeline has a host-wide run lock through download, imports, cleanup and reporting. Existing shared browser lock remains separate to avoid child deadlock. Scheduled runs wait for the run lease; queued runs defer instead of starting another pipeline. Notification source reports/status cannot replace the normal hourly report or hide an existing contract/holding warning.

## Verification

- Implemented reader obtained 15 actual source notifications, followed by repeat collection with newHints=0, actionable=0, queue/send operations=0.
- Synthetic and isolated fixture tests cover first baseline, same batch/restart/replay, content/time normalization, pending coalescing, collision transaction retry, holding/unknown exclusion, cooldown, partial acknowledgement, corrupt state and competing process lease.
- Keep actual source receipt, replay proof, production queue creation, canonical import, and actual member delivery separate. No real member changes or messages for testing. Do not treat a replayed source sample as a new natural notification or Web Push event.
- Before production enable: independent diff review, required regression checks, commit/main promotion, runtime fast-forward and existing LaunchAgent env flag only, CORE Hosting, live marker, source re-read, final Git/CI checks.

## Rollback

Remove only `STUDIOMATE_NOTIFICATION_INGRESS=enabled` from the existing admin LaunchAgent and reload it when idle. Preserve local cursor/receipts, hourly Excel, browser lock, existing jobs and send ledgers. Do not reset a baseline, delete member documents, replay sends or install another watcher.

## Status

Implemented and baseline/readback verified; production rollout and natural post-baseline event result pending. Report: `docs/reports/2026-10-20-studiomate-notification-ingress.html`.
