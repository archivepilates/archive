# AGENTS.md

## Project

- Name: archive-in
- Canonical live app: `https://archive-pilates.web.app/archivein/`
- Firebase/GCP project: `archive-pilates`
- Primary rule: preserve existing user work and avoid production-impacting commands unless explicitly requested.

## Working Guidelines

- Read the current files before changing behavior.
- Keep edits scoped to the requested task.
- Prefer read-only checks before live automation or deploy actions.
- Do not run `git push`, deploy commands, StudioMate writes, Google Contacts writes, Secret Manager writes, or SOLAPI sends without explicit approval.
- Treat go-live language such as `배포`, `배포해줘`, `반영`, `publish`, or `release` as explicit approval for the full scoped sequence: validation, commit if needed, deploy, live verification, and GitHub push. Do not split deploy and push unless the user explicitly says deploy-only/local-only or a blocker applies.
- For production-facing ARCHIVE PILATES code changes, a task is not complete merely because the local fix works. Once the user has asked for the change to go live, carry it through the complete set in the same work session: scoped validation, scoped commit, push/main promotion when appropriate, scoped deploy, live verification, GitHub Actions check, and final clean status.
- Do not leave completed production fixes only in a local branch, unpushed worktree, or deployed-but-not-main state. If a blocker prevents commit, deploy, push, or main promotion, report that blocker explicitly before calling the task complete.
- When several requests arrive in a row, preserve this finish discipline per finished change. Batch compatible changes when safe, but before switching to an unrelated task, either complete the deploy/push set for the current production change or clearly report that it remains local/unreleased.
- Continue to stop before deploy/push when the user explicitly says `로컬만`, `검토만`, `배포하지마`, `push 하지마`, or when production target, auth, secrets, member privacy, payment/reservation policy, or unrelated dirty changes make the safe scope unclear.
- Put task notes under `docs/tasks/`, durable decisions under `docs/decisions/`, and generated outputs under `artifacts/`.

## ARCHIVE IN Work Coordination

- Use the main ARCHIVE IN project chat as the control surface for cross-cutting decisions about the web app, Firebase model, StudioMate sync, Google Contacts, Kakao Alimtalk, and deployment readiness.
- If a separate chat or agent is used for a narrow subtask, bring the decision/result back into the main ARCHIVE IN chat before treating it as project direction.
- ARCHIVE CORE transition work uses `workLanes/archive-core-transition` as the shared work lane. New subthreads should read that lane first, update handoffs there, and use lane-specific worktrees for code changes.
- Active integration/runtime repository: `~/dev/archive-in-runtime`; GitHub `origin/main` is the source of truth.
- Keep the active runtime checkout fast-forward aligned with `origin/main` (the Mac mini runtime branch is `archive-runtime-main`). For new non-trivial changes, use a dedicated `codex/mini/<task-name>` branch/worktree under `~/codex-worktrees`, then promote reviewed changes to `origin/main` and deploy from a clean local `main` worktree. Do not deploy from old transition or live-setup worktrees.
- ARCHIVE CORE now uses one main command thread. The main command thread owns requirements, priorities, final judgment, go-live approval, ARCHIVE CORE operating-rule status, and cross-lane handoff decisions.
- Feature-specific Codex threads or subagents may investigate or implement bounded work, but they must report results back to the main ARCHIVE CORE command thread before their output becomes project direction.
- Do not repeat cross-cutting instructions across feature threads. Put shared instructions in the command thread, the relevant `workLanes` record, this `AGENTS.md`, and ARCHIVE CORE > `운영규칙` (`/core/rules/`).
- ARCHIVE CORE `운영규칙` is the active operating-rules hub. Do not duplicate new operating rules into Notion; retain Notion only for historical references, existing private-chart workflows, or an explicit user request.
- Record each active lane's actual worktree, branch, file ownership, checks, and handoff in the command thread. Historical transition/UI/data/Functions worktree names are not active deployment paths.
- One worktree equals one functional lane. Do not commit Alimtalk, StudioMate automation, CORE UI, Functions, and data mirror changes together unless the main command thread explicitly approves an integration commit.
- ARCHIVE CORE is an operator-only web platform. It should not be treated as a teacher app, member app, or immediate StudioMate replacement.
- Keep existing Alimtalk, StudioMate sync, and member-facing writes on their current canonical sources until a shadow-compare migration explicitly approves a source change.
- When speed helps and the task can be split safely, use parallel agents, including the Spark model for quick read-only exploration or bounded implementation checks.
- Use worktrees when a change is non-trivial, experimental, or should be isolated from the current branch.
- Start live checks with read-only verification of the deployed ARCHIVE IN app, Firebase/Hosting configuration, and visible browser errors before proposing fixes.

## Browser Cleanup Rules

- Treat Chrome tabs, windows, Playwright pages, contexts, temporary profiles, and browser processes opened by Codex for debugging or verification as task-owned state.
- Close and verify all task-owned browser state before the final response. Put browser/context shutdown and lock release in `finally` blocks.
- Never close the user's pre-existing Chrome tabs, windows, profiles, or generic Chrome processes. Broad `pkill`, `killall`, and profile deletion are not cleanup methods.
- Remove an orphaned process only when its PID, command line, profile path, or session proves that the current task owns it. Leave uncertain processes alone and report them.
- Keep a browser open only for an explicit user request or an immediate login/approval handoff, and report exactly what remains open and why.

## StudioMate Sync Mode

- Until ARCHIVE PILATES operates its own site, treat StudioMate Excel download/import as the default ARCHIVE IN sync mode.
- Do not use StudioMate API mode for normal ARCHIVE IN operations, manual sync, contact sync, Alimtalk candidate generation, or dashboard-facing app sync.
- Legacy internal names such as `emergency_excel`, `run-studiomate-excel-emergency-mode.mjs`, and `com.archive.studiomate-excel-emergency-mode` may remain for compatibility, but staff-facing copy and operating decisions should call it Excel sync/default sync, not temporary emergency mode.
- API-mode work should only be a read-only investigation or a future migration plan unless the user explicitly approves a switch after ARCHIVE PILATES own-site operations are ready.

## Brand Writing Rules

- Always write the app/product name as `ARCHIVE IN` in new chat responses, UI text, reports, documents, commit summaries, and operator-facing materials.
- Do not use `ArchiveIN`, `Archive In`, `archive in`, or other mixed/lowercase variants unless quoting an exact file path, URL, command, package name, branch name, or historical source text.

## Local Setup

- Active integration/runtime repository: `~/dev/archive-in-runtime`
- Base branch and source of truth: `origin/main`
- Development worktrees: `~/codex-worktrees/<task-name>`; preserve unrelated work and use disjoint file ownership for explicitly shared worktrees.
- Local branch convention: `codex/mini/<task-name>`
- Service account key path: `/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json`
- Service account email: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`

Before starting automation, system-health, or production-error triage work, check the Codex action queue:

```bash
npm run codex:queue
```

`codexActionQueue` contains unresolved `critical` or `action_required` findings from the Mac mini health checker that need Codex follow-up. Treat it as triage evidence, not permission to run production writes, member-facing sends, deploys, or destructive fixes.

Firebase CLI may prefer a stale signed-in user token. For service-account-backed CLI reads or approved deploys, generate an access token in the current shell:

```bash
source scripts/use-archivein-firebase-service-account.sh
```

## Build Checks

```bash
npm ci
npm run build:dashboard
npm --prefix firebase/kangsain-functions/functions ci
npm --prefix firebase/kangsain-functions/functions run build
```

The Functions package declares Node.js `22`. If the machine default is newer, expect npm engine warnings unless Node 22 is selected.

## Functions Codebase Rules

- Firebase Functions are split into five physical codebases: `functions-alimtalk`, `functions-private-chart`, `functions-sync`, `functions-app`, and `functions-social`.
- Shared cross-codebase contracts live in `firebase/packages/contracts`. Put shared event names, queue payloads, Firestore collection names, and codebase ownership constants there before duplicating them in feature code.
- Before changing a Functions deployment path, run `npm run detect:affected-functions` to see which codebases are affected.
- For local deploys, prefer `npm run deploy:affected-functions:dry` first. Use `npm run deploy:affected-functions -- --base <sha> --head HEAD` only when the user explicitly approves deploy/go-live.
- All root Functions predeploy entries run `scripts/validate-functions-predeploy.mjs` before the existing prepare/build hooks. The guard verifies Firebase's `GCLOUD_PROJECT`, `PROJECT_DIR`, and `RESOURCE_DIR` against this script's repository and the selected codebase, then requires a clean local `main` equal to freshly fetched `origin/main` and the existing live rollback guards.
- Firebase dry-run also runs those predeploy guards. It is not a branch/dirty-state bypass and may contact Firebase or enable APIs. Use affected detection and local tests for offline feature-branch review; do not use inherited dry-run flags to relax production guards.
- Use root `firebase.json` and explicit affected targets, one codebase per Firebase process. Direct targeted Functions deploys still run the guards. The alternate `firebase/kangsain-functions/firebase.json` default-codebase deploy remains blocked; it is not a fallback release path.
- Shared files such as `firebase.json`, `firebase/codebase-boundaries.json`, `firebase/packages/contracts/**`, `firebase/kangsain-functions/functions/src/config/**`, `runtime/**`, `types/**`, and broad utility/firestore files affect all five codebases.
- Do not deploy all Functions by habit. Deploy only the affected codebase unless a shared contract or shared runtime file changed.
- GitHub CI runs affected-codebase detection, boundary validation, Functions predeploy safety tests, and the current instructor lesson registration validator. Root `firebase.json` and `.firebaserc` changes trigger these checks too.
