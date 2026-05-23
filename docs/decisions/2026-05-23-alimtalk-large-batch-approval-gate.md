# ARCHIVE IN Alimtalk Large Batch Approval Gate

Date: 2026-05-23

## Decision

ARCHIVE IN daily Alimtalk automation must not automatically send a daily batch when 10 or more sendable candidates are rebuilt.

## Operating Rule

- If the daily sendable candidate count is fewer than 10, the automation can queue and send normally.
- If the daily sendable candidate count is 10 or more, candidates remain unqueued and an approval email is sent to `home@archivepilates.com`.
- The approval email contains the candidate list and a bottom approval button.
- Alimtalk sending starts only after the email approval link is opened.
- Approved large batches are marked as operator-approved email batches.

## Reason

On 2026-05-23, an overly broad first group survey classification produced a large unexpected batch. The approval gate limits future blast radius when candidate logic or imported StudioMate Excel data changes unexpectedly.
