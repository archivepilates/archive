# ARCHIVE PILATES Reel Approval Runtime Recovery

- Purpose: recover a valid approved ACH9 request without reuploading or relaxing approval gates.
- Canonical source: youtubeReelApprovals plus the private Mac mini media/publication journal. No member mirror or workLanes selects publication targets.
- Confirmed: the ACH9 button approval persisted, while the worker logged 29 failures. Its old generic logs did not retain sufficient evidence to identify the historical exception. Do not invent a token/TCC/schema root cause.
- Implemented: secret-free exception type, timestamp and code-location diagnostics; read-only credential/channel/content verification; an empty queue after failures now requires successful YouTube access before reporting recovery.
- Production runs only on the explicit user command. The daily Codex schedule remains paused. The five-minute local worker only processes approvals.
- Verification: offline approval/publication/health tests and an actual background authentication probe. Public release preserves approved metadata, one-publication-per-day and shared locks.
- Scope: local approval worker, focused tests and CORE rules only. No Functions, permissions, products or paid source video changes.
- Last updated: 2026-10-14. Live release and playback evidence are recorded in the task report, separately from code tests.
