# ARCHIVE IN Firebase Functions Boundary Split

Decision date: 2026-05-29

## Decision

ARCHIVE IN will separate Firebase Functions work by operating boundary before physically splitting Firebase codebases.

The current production deployment remains on the existing Firebase Functions codebase `default`. This avoids accidental function deletion, duplicated schedules, or changed HTTPS/callable function names.

The source exports are now grouped by domain:

- `src/exports/alimtalk.ts`: Kakao Alimtalk queueing, sending, template status, and approval endpoint.
- `src/exports/privateChart.ts`: private survey intake, private lesson chart/report generation, Notion webhook, short links, and InBody webhook dispatch.
- `src/exports/sync.ts`: StudioMate/API legacy sync, Mac mini sync request bridge, dashboard sync, contacts/write queue processing, and attendance reminder.
- `src/exports/app.ts`: ARCHIVE IN app callable APIs and staff auth callables.
- `src/runtime/functionOptions.ts`: shared region, timezone, secret, timeout, memory, and invoker options.

`firebase/codebase-boundaries.json` is the manifest for the intended future physical split:

- `functions-alimtalk`
- `functions-private-chart`
- `functions-sync`
- `functions-app`

## Why

The previous single `src/index.ts` mixed unrelated concerns. A small change in private chart, Alimtalk, StudioMate sync, or app callable logic could block the whole Functions build/deploy or make reviewers inspect unrelated secrets and schedules.

The export boundary split gives immediate maintainability benefits while preserving live function names. Physical Firebase codebase split should be a separate deploy migration with explicit delete-prevention checks.

## Deployment Rule

Do not enable separate physical Firebase codebases in `firebase.json` until a dedicated go-live task performs:

1. Current live function inventory capture.
2. Expected function ownership comparison against `firebase/codebase-boundaries.json`.
3. Dry-run or discovery validation for every new codebase.
4. Explicit no-delete migration plan for existing function names.
5. Limited deploy of one codebase at a time.
6. Live smoke checks for changed HTTPS/callable/scheduled surfaces.
7. Rollback notes and operator documentation update.

## Verification

Run:

```bash
cd firebase/kangsain-functions/functions && npm run typecheck && npm run build
cd ../../.. && npm run validate:function-boundaries
```

The validation script fails if a compiled export is missing from the manifest, a manifest function is not exported, or physical codebase split is accidentally enabled.

## 2026-05-30 Physical Split Deployment

The physical codebase split was enabled and deployed on 2026-05-30.

- `functions-alimtalk`: 4 functions.
- `functions-private-chart`: 13 functions.
- `functions-sync`: 12 functions.
- `functions-app`: 9 functions.
- Total live functions verified by `functions:list`: 38.

The old `default` single source is no longer the deployment source in root `firebase.json`.

Each physical codebase source is generated during Firebase predeploy from `firebase/kangsain-functions/functions/src`. This keeps the deployment independent from a hardcoded local worktree path and prevents broken imports when another Codex thread runs from a different repo path.

Operator Notion record:

https://www.notion.so/ARCHIVE-IN-Functions-codebase-2026-05-30-36fd49eae4bf81c6901bf7c0b116ad85
