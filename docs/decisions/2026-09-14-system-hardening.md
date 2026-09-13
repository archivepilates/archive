# ARCHIVE PILATES System Hardening

Date: 2026-09-14
Canonical source: `/Users/archivepilates/dev/archive-in-runtime`, GitHub `origin/main`.

## Boundaries

- `bookings` and `memberProfiles` remain canonical. Notion is a private display projection, not a booking/report source.
- Rebound chart requests keep their original request ID. Matching the current booking ID, member ID, instructor and exact lesson occurrence prevents another request being created on the next run.
- Renamed members reuse an existing source-linked member page for the same member ID and instructor. Unknown or public/archived/out-of-instructor pages fail closed. Page ownership protection is not relaxed.
- Two empty duplicate display records were linked to the previously owned page records as aliases. Three old `writeQueue` attendance requests were retired without replay; no StudioMate write, message or contact operation was performed.
- `notionProjectionControl` is display-only. Its readers are the Notion projector and health checker; it must not select recipients, change bookings, calculate rounds or authorize external business writes.

## Recovery

- Project: `archive-pilates`, database `(default)`, location `asia-northeast3`.
- Database delete protection and PITR enabled. Version retention: 604800 seconds.
- One daily native backup schedule, seven-day retention. Native backup scheduling is asynchronous; configuring a schedule is not proof of a completed backup.
- A new schedule has a 26-hour first-run grace period. Thereafter missing, unavailable, expired or stale backups are reported. A recent READY backup must match both database name and database generation UID.
- Restore into a separate private database. Do not overwrite or switch the application database during a drill. Compare counts and sampled document contents at the same snapshot time, confirm unauthenticated access is denied, then delete only the named drill database.
- Clone/restore verification and first scheduled backup verification are distinct. Native backups exclude TTL policies; retain rules, indexes, TTL configuration, IAM and deployment configuration in their respective controlled sources and recheck them before any real recovery cutover.
- Added backup/PITR storage is billable. Reassess retention against monthly billing; do not disable protection automatically for cost savings.

## Deployment And Host

- Five root Functions codebases require a clean local `main`, exact freshly fetched `origin/main`, correct project/resource paths and rollback contracts, including direct Firebase CLI invocations. There is no dry-run bypass.
- The retired `Documents/ARCHIVE-IN` root and nested Firebase configurations are locally quarantined with rejecting predeploy hooks. Original configurations were backed up outside Git; historical user work remains untouched. This local quarantine is not a deployment of the historical repository.
- Worktree cleanup requires merge into current `origin/main`, no user files/changes, no active process/runtime references, and explicit path allowlisting. Pushed-but-unmerged is not safe to remove. No blanket cache deletion or forced worktree removal.
- StudioMate shared locks require a dead local process plus stale age for automatic recovery. Live/foreign/unknown owners are preserved. A unique owner token is checked on release; simultaneous recovery is serialized.

## Health

- Queue age uses due/created time for pending/retry, not recent bookkeeping. Future jobs are not late.
- Recent failure queries filter/order by timestamp before applying the cap. Missing indexes, capped reads and unknown timestamps cannot become an all-clear.
- Explicitly retired requests and Notion display aliases are excluded, without deleting history. The legacy API write worker is never auto-retried or re-enabled.
- Stable check identities resolve only after complete, positive verification. Partial reads must preserve unresolved findings.
- Current enabled ten-minute workers: Alimtalk queue, contact sync and private survey response sync. Legacy write queue, dashboard daily API sync and attendance reminder remain paused.
- Caddy MCP probes are optional explicitly configured diagnostics. They are not Codex native remote connectivity and unconfigured legacy endpoints must not generate recurring failures.

## Evidence

- Focused Spark tests are reviewed and rerun by the main agent; they do not authorize production writes.
- Live evidence and operational before-images are under `~/ArchiveIN/backups/system-hardening-20260914` and task-specific local reports, not committed member records.
- CORE `/rules/` contains the staff-facing policy. No Notion operating-rule duplication.
