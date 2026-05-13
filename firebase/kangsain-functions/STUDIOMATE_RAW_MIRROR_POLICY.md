# StudioMate Raw Mirror Policy

ArchiveIN mirrors StudioMate source payloads only as an operational debugging and migration reference layer.

## Principles

- Do not increase StudioMate API traffic for raw mirroring.
- Save raw payloads opportunistically from calls ArchiveIN already performs.
- Keep raw data server-only. Client apps must read normalized ArchiveIN collections, not raw mirrors.
- Keep retention short by default. Raw mirror documents include `expireAt` for a 90-day retention window.
- Avoid backfills during business-critical times. If a backfill is needed, run it in small date ranges around lunch time.

## Firestore Layout

```text
studiomateRaw/{studioId}/datasets/{dataset}/dates/{yyyy-mm-dd}/items/{sourceId}
```

Current datasets:

- `staffLectures`: raw `/v2/staff/lectures` records.
- `staffMemberMemos`: raw `/v2/staff/memo` records fetched for members in the synced lecture window.
- `staffMemberProfiles`: raw `/v2/staff/members/{memberId}` responses fetched for members in the synced lecture window.
- `managerStaffs`: raw `/api/staff` records.
- `managerNotices`: raw `/api/staff/notice/common` records.
- `managerCounsels`: raw `/api/schedule/counsel` records.
- `managerEtcSchedules`: raw `/v2/staff/etcSchedule` 기타일정 records.

Each item stores:

- `studioId`
- `dataset`
- `sourcePath`
- `sourceId`
- `sourceHash`
- `mirrorDate`
- `mirroredAt`
- `expireAt`
- `payload`

## Security

Firestore rules explicitly deny client read/write access to `studiomateRaw/**`.
Only Firebase Admin SDK code can write this mirror.

## Backfill Rule

If historical raw data is needed:

1. Prefer one day at a time.
2. Prefer lunch-window execution.
3. Stop immediately if StudioMate errors, throttling, or warning signals appear.
4. Never use raw mirror data directly in the app UI. Transform it into normalized ArchiveIN collections first.

## 2026-05-13 StudioMate Security Hardening Snapshot

StudioMate announced security hardening at `2026-05-13 02:00`.
ArchiveIN has a guarded one-time lunch-window mirror job:

- Function: `scheduledPreSecurityRawMirror`
- Schedule: `2026-05-12 12:20 Asia/Seoul`
- Guard: function body only runs when KST date is `2026-05-12`
- Range: current production sync range, `today - 30 days` through `today + 14 days`

This job reuses the normal sync flow and does not crawl unknown endpoints.
After confirming the hardening window is past, remove or leave the guarded function inert.
