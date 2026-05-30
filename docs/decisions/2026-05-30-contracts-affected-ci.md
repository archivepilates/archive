# ARCHIVE IN Contracts And Affected Deploy Rule

Decision date: 2026-05-30

## Decision

ARCHIVE IN uses three safeguards after the Firebase Functions codebase split:

- Shared contracts package: `firebase/packages/contracts`
- Affected-only deploy detection: `scripts/detect-affected-function-codebases.mjs`
- CI changed-file detection: `.github/workflows/functions-affected-check.yml`

## Rules

Shared event names, queue payloads, Firestore collection names, and codebase ownership constants should be added to `firebase/packages/contracts` before being copied into feature code.

Before deploying Functions, run:

```bash
npm run detect:affected-functions
```

Use the resulting `deployOnly` value for Firebase deploy scope. For example:

```bash
firebase deploy --only functions:functions-alimtalk
```

For local dry-run:

```bash
npm run deploy:affected-functions:dry
```

Use real affected deploy only after explicit go-live approval:

```bash
npm run deploy:affected-functions -- --base <sha> --head HEAD
```

## Shared Change Rule

Changes in these paths affect all four Functions codebases:

- `firebase.json`
- `firebase/codebase-boundaries.json`
- `firebase/packages/contracts/**`
- `firebase/kangsain-functions/functions/src/config/**`
- `firebase/kangsain-functions/functions/src/runtime/**`
- `firebase/kangsain-functions/functions/src/firestore/**`
- `firebase/kangsain-functions/functions/src/types/**`
- `firebase/kangsain-functions/functions/src/utils/**`
- Functions deployment scripts under `scripts/`

## Thread Handoff

Other Codex threads should not guess deploy scope. They should read `AGENTS.md`, run affected detection, and report the affected codebases before deploy.

## Operator Record

Notion:

https://www.notion.so/ARCHIVE-IN-contracts-affected-only-CI-2026-05-30-370d49eae4bf8107bf75dab923e03ad5
