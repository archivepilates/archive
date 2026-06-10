# ARCHIVE CORE Command Thread And Worktree Split

Decision date: 2026-06-04

## Decision

ARCHIVE CORE uses one main command thread as the control surface for requirements, priority, final judgment, and release approval.

Feature-specific Codex threads, Spark tasks, and Subagents may investigate or implement bounded work, but they must report back to the main ARCHIVE CORE command thread before their output becomes project direction.

## Reason

ARCHIVE CORE, Kakao Alimtalk, StudioMate automation, Firebase Functions, and member data modeling are connected. If each thread receives separate instructions, the same rule must be repeated and dirty worktrees can mix unrelated changes.

The main command thread keeps the shared rule. Lane worktrees keep implementation changes separated.

## Worktree Map

```txt
command / integration
  worktree: /Users/archivepilates/codex-worktrees/archive-core-transition
  branch:   codex/mini/archive-core-transition
  scope:    command coordination, integration review, release readiness, emergency shared fixes

ui
  worktree: /Users/archivepilates/codex-worktrees/archive-core-ui
  branch:   codex/mini/archive-core-ui
  scope:    /core UI, routing, responsive layout, visual states, operator UX

data
  worktree: /Users/archivepilates/codex-worktrees/archive-core-data
  branch:   codex/mini/archive-core-data
  scope:    members, member360Cards, imports, data quality, read-model rebuilds, shadow compare

functions
  worktree: /Users/archivepilates/codex-worktrees/archive-core-functions
  branch:   codex/mini/archive-core-functions
  scope:    Firebase Functions, contracts, Firestore rules/indexes, API surfaces, deploy boundaries

alimtalk
  worktree: /Users/archivepilates/codex-worktrees/archive-alimtalk
  branch:   codex/mini/archive-alimtalk
  scope:    Kakao Alimtalk candidates, sends, templates, dedupe, approval flow, communication logs

studiomate automation
  worktree: /Users/archivepilates/codex-worktrees/studiomate-automation
  branch:   codex/mini/studiomate-automation
  scope:    StudioMate Excel download/import, Playwright automation, staff scan, memo write queue

docs
  worktree: /Users/archivepilates/codex-worktrees/archive-core-docs
  branch:   codex/mini/archive-core-docs
  scope:    Notion drafts, decision docs, handoffs, operating rules, transition checklists
```

## Lane Rules

- One worktree equals one functional lane.
- Do not mix Alimtalk, StudioMate automation, CORE UI, Functions, and data mirror changes in one commit.
- The command worktree is for coordination and integration review, not ordinary feature edits.
- If a shared worktree is dirty with another lane's changes, create or use the lane worktree instead of committing through the mixed tree.
- Work lane data stays in `workLanes/archive-core-transition` until a production source collection is approved.

## Report Contract

Every feature thread, Spark task, or Subagent must report back with:

```txt
lane
changed files
behavior change
checks run
failed or skipped checks
remaining risks
handoff needed from another lane
```

The main command thread then decides whether to merge, deploy, update ARCHIVE CORE operating rules, or hand off to another lane.

## Production Boundary

External sends, StudioMate writes, Google Contacts writes, payment/reservation decisions, data source switching, Firebase deploys, GitHub pushes, and IAM or organization-policy changes still require explicit main command thread approval.

## Operating Rules And Firestore Record

The same operating map should be recorded in:

```txt
Firestore: workLanes/archive-core-transition
ARCHIVE CORE: /core/rules/
```

ARCHIVE CORE `운영규칙` is the concise operator-facing rule page. Firestore `workLanes` remains the machine-readable coordination state. Notion `아카이브 운영 규칙` is legacy reference only and should not receive duplicate current-rule updates unless a specific Notion-dependent workflow still requires it.
