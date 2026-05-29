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
