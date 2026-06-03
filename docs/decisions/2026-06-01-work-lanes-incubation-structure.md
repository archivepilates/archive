# ARCHIVE IN Work Lanes Incubation Structure

Decision date: 2026-06-01

## Decision

New ARCHIVE IN and ARCHIVE CORE project lanes start in a shared Firestore incubation area named `workLanes`.

The purpose is to prevent short-lived Codex threads, temporary automations, and exploratory reports from attaching directly to production source collections or forcing a new independent database/codebase before the lane proves it needs one.

## Default Structure

```txt
workLanes/{laneId}
workLanes/{laneId}/inputs/{docId}
workLanes/{laneId}/outputs/{docId}
workLanes/{laneId}/reports/{docId}
workLanes/{laneId}/decisions/{docId}
workLanes/{laneId}/jobs/{jobId}
workLanes/{laneId}/handoffs/{docId}
```

## Worktree Rule

`workLanes` separates provisional data. It does not separate local Git file changes.

Any new ARCHIVE IN or ARCHIVE CORE thread that may touch code, scripts, deployment config, contracts, package files, or operator docs should use a lane-specific worktree or branch.

Default operating pair:

```txt
provisional data -> workLanes/{laneId}
provisional code -> dedicated lane worktree/branch
```

If a shared worktree already contains unrelated Alimtalk, StudioMate, app, docs, or package changes, do not commit or push a new lane from that mixed tree. Isolate the lane changes first, or report the mixed state and wait for the responsible lane to finish.

Functions codebase separation and affected-only deploy reduce deployment collisions, but they do not make mixed Git changes safe to commit.

## Operating Rule

`workLanes` is not a source-of-truth collection and not a member-facing action source.

It may store exploratory inputs, dry-run outputs, reports, decisions, draft jobs, and handoff summaries. It must not be used directly to choose targets for Kakao Alimtalk sends, StudioMate writes, Google Contacts writes, attendance writes, memo writes, payment/refund decisions, reservation decisions, or ticket decisions.

## Promotion Rule

A lane may be promoted out of `workLanes` only after a promotion review records:

- source-of-truth collection or file
- target collection
- target Functions codebase
- canonical identity key
- duplicate handling rule
- allowed readers
- forbidden downstream actions
- dry-run report path
- verification method
