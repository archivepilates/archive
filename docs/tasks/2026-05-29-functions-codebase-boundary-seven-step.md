# ARCHIVE IN Functions Boundary 7-Step Checklist

Date: 2026-05-29

## Status

1. Inventory current Functions exports: completed.
2. Separate source export boundaries by operating domain: completed.
3. Move shared runtime options out of the mixed root index: completed.
4. Add codebase ownership manifest for future physical split: completed.
5. Add export-boundary validation script: completed.
6. Run typecheck, build, and boundary validation: completed in local worktree.
7. Report result to operator by email: completed. Gmail message id `19e725ec82e9af46`.

## Current Boundary

The live Firebase codebase remains `default`. This is intentional. Physical codebase split is not enabled yet because enabling it without a migration deploy plan can delete or duplicate production functions.

## Test Commands

```bash
cd firebase/kangsain-functions/functions
npm run typecheck
npm run build
cd ../../..
npm run validate:function-boundaries
```

## Next Migration Gate

The next go-live step is not a normal refactor. It should be a controlled Firebase migration that deploys one physical codebase at a time and verifies live function URLs, callable names, and schedules.

## 2026-05-30 Completion

Physical codebase split was completed and deployed.

- `functions-alimtalk`: deployed 4 functions.
- `functions-private-chart`: deployed 13 functions.
- `functions-sync`: deployed 12 functions.
- `functions-app`: deployed 9 functions.
- `functions:list`: verified 38 ACTIVE functions split across the four codebases.
- Live HTTP smoke checks:
  - `https://in.archivepilates.com/api/privateLessonReport`: returned 400 without token, confirming the function is reached.
  - `https://in.archivepilates.com/s/not-existing-codebase-check`: returned 404, confirming the short-link function is reached.
- Notion record:
  - https://www.notion.so/ARCHIVE-IN-Functions-codebase-2026-05-30-36fd49eae4bf81c6901bf7c0b116ad85

Path safety was handled by generating each physical codebase source during predeploy from the current repo root instead of hardcoding an absolute worktree path.
