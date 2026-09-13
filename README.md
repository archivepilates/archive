# ARCHIVE PILATES Runtime

Runtime source for ARCHIVE IN member flows, ARCHIVE CORE operator tools, and Firebase Functions. The active Mac mini checkout is `~/dev/archive-in-runtime`; GitHub `origin/main` is the source of truth. Use dedicated branches/worktrees for changes and follow `AGENTS.md` for approval and release requirements.

## Deployment Safety

The former ARCHIVE-DASH GitHub Pages instructions are retired. GitHub Pages is not the release path for this runtime. Broad direct Firebase deployment of Functions, Hosting, and Firestore together is also retired as routine guidance; each target needs explicit scope and approval.

For local review without deployment:

```bash
node scripts/detect-affected-function-codebases.mjs --base <base-sha> --head HEAD
node --test scripts/tests/functions-predeploy.test.mjs
node scripts/validate-live-release-rollback-guards.mjs
node scripts/validate-instructor-lesson-registration-release.mjs
```

After review, main promotion, and explicit release approval, use the affected-only Functions flow from the repository root:

```bash
npm run deploy:affected-functions:dry -- --base <base-sha> --head HEAD
npm run deploy:affected-functions -- --base <base-sha> --head HEAD
```

The five codebases are `functions-alimtalk`, `functions-private-chart`, `functions-sync`, `functions-app`, and `functions-social`. The wrapper deploys one codebase per Firebase process. Direct targeted deploys using root `firebase.json` also run the predeploy guard before preparation/build: Firebase project/resource verification, clean local `main`, exact freshly fetched `origin/main`, and live rollback checks. The alternate legacy default-codebase config remains blocked.

Firebase dry-run has the same predeploy requirements; it is not an offline command and may enable project APIs. Inherited dry-run flags and predeploy arguments do not relax the checks. Local tests mock Git for guard rejection cases and do not deploy.

Hosting releases use the existing scoped `deploy:archivein-live` or `deploy:archive-core-live` scripts only when approved. Firestore rules/index changes require their own approved scope. Authentication and member-write controls remain in force.

## Operating Rules

ARCHIVE CORE > Operating Rules (`/core/rules/`) is the active hub. Notion is historical or used only by existing private-chart workflows or explicit requests. See `firebase/kangsain-functions/README.md` for Functions guidance and `docs/decisions/2026-06-25-bookings-single-reservation-source.md` for the current reservation source policy.
