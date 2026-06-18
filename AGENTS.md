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
- Put task notes under `docs/tasks/`, durable decisions under `docs/decisions/`, and generated outputs under `artifacts/`.

## ARCHIVE IN Work Coordination

- Use the main ARCHIVE IN project chat as the control surface for cross-cutting decisions about the web app, Firebase model, StudioMate sync, Google Contacts, Kakao Alimtalk, and deployment readiness.
- If a separate chat or agent is used for a narrow subtask, bring the decision/result back into the main ARCHIVE IN chat before treating it as project direction.
- ARCHIVE CORE transition work uses `workLanes/archive-core-transition` as the shared work lane. New subthreads should read that lane first, update handoffs there, and use lane-specific worktrees for code changes.
- Current ARCHIVE CORE transition integration worktree: `/Users/archivepilates/codex-worktrees/archive-core-transition`.
- Keep this integration worktree on `main` after merged cleanup/deploy work. For new non-trivial changes, create a temporary `codex/mini/<task-name>` branch, fast-forward/merge it back to `main` after validation, then delete the temporary branch when it is no longer needed.
- ARCHIVE CORE now uses one main command thread. The main command thread owns requirements, priorities, final judgment, go-live approval, Notion status, and cross-lane handoff decisions.
- Feature-specific Codex threads or subagents may investigate or implement bounded work, but they must report results back to the main ARCHIVE CORE command thread before their output becomes project direction.
- Do not repeat cross-cutting instructions across feature threads. Put shared instructions in the command thread, `workLanes/archive-core-transition`, this `AGENTS.md`, and the relevant Notion page.
- ARCHIVE CORE worktree map:
  - `/Users/archivepilates/codex-worktrees/archive-core-transition` / `codex/mini/archive-core-transition`: command coordination, integration review, release readiness, and emergency shared fixes only.
  - `/Users/archivepilates/codex-worktrees/archive-core-ui` / `codex/mini/archive-core-ui`: `/core` UI, routing, responsive layout, visual states, and operator UX.
  - `/Users/archivepilates/codex-worktrees/archive-core-data` / `codex/mini/archive-core-data`: `members`, `member360Cards`, source import logs, data quality issues, read-model rebuilds, and shadow-compare reports.
  - `/Users/archivepilates/codex-worktrees/archive-core-functions` / `codex/mini/archive-core-functions`: Firebase Functions, contracts, Firestore rules/indexes, affected deploy boundaries, and API surfaces.
  - `/Users/archivepilates/codex-worktrees/archive-alimtalk` / `codex/mini/archive-alimtalk`: Kakao Alimtalk candidates, sends, templates, dedupe, approval flow, and communication logs.
  - `/Users/archivepilates/codex-worktrees/studiomate-automation` / `codex/mini/studiomate-automation`: StudioMate Excel download/import, Playwright automation, staff scan, memo write queue, and LaunchAgent-facing scripts.
  - `/Users/archivepilates/codex-worktrees/archive-core-docs` / `codex/mini/archive-core-docs`: Notion drafts, decision docs, handoff summaries, operating rules, and transition checklists.
- One worktree equals one functional lane. Do not commit Alimtalk, StudioMate automation, CORE UI, Functions, and data mirror changes together unless the main command thread explicitly approves an integration commit.
- ARCHIVE CORE is an operator-only web platform. It should not be treated as a teacher app, member app, or immediate StudioMate replacement.
- Keep existing Alimtalk, StudioMate sync, and member-facing writes on their current canonical sources until a shadow-compare migration explicitly approves a source change.
- When speed helps and the task can be split safely, use parallel agents, including the Spark model for quick read-only exploration or bounded implementation checks.
- For deployment, verification, and live-check workflows, treat parallel Spark/Subagent verification as the default. The main thread should run the production command and final judgment, while parallel workers handle UI smoke checks, API/function probes, Firestore/read-model spot checks, deploy-output review, GitHub Actions watch, and ARCHIVE CORE `운영규칙` consistency checks.
- Do not serialize all verification in the main thread unless the task is tiny, the required tool is unavailable, or a shared browser/session lock makes parallelism unsafe.
- Use worktrees when a change is non-trivial, experimental, or should be isolated from the current branch.
- Start live checks with read-only verification of the deployed ARCHIVE IN app, Firebase/Hosting configuration, and visible browser errors before proposing fixes.

## StudioMate Sync Mode

- Until ARCHIVE PILATES operates its own site, treat StudioMate Excel download/import as the default ARCHIVE IN sync mode.
- Do not use StudioMate API mode for normal ARCHIVE IN operations, manual sync, contact sync, Alimtalk candidate generation, or dashboard-facing app sync.
- Legacy internal names such as `emergency_excel`, `run-studiomate-excel-emergency-mode.mjs`, and `com.archive.studiomate-excel-emergency-mode` may remain for compatibility, but staff-facing copy and operating decisions should call it Excel sync/default sync, not temporary emergency mode.
- API-mode work should only be a read-only investigation or a future migration plan unless the user explicitly approves a switch after ARCHIVE PILATES own-site operations are ready.

## Brand Writing Rules

- Always write the app/product name as `ARCHIVE IN` in new chat responses, UI text, reports, documents, commit summaries, and operator-facing materials.
- Do not use `ArchiveIN`, `Archive In`, `archive in`, or other mixed/lowercase variants unless quoting an exact file path, URL, command, package name, branch name, or historical source text.

## Local Setup

- Active development worktree: `/Users/archivepilates/codex-worktrees/archivein-live-setup`
- Base branch: `origin/archivein-canonical-20260514`
- Local branch convention: `codex/mini/<task-name>`
- Service account key path: `/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json`
- Service account email: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`

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

- Firebase Functions are split into four physical codebases: `functions-alimtalk`, `functions-private-chart`, `functions-sync`, and `functions-app`.
- Shared cross-codebase contracts live in `firebase/packages/contracts`. Put shared event names, queue payloads, Firestore collection names, and codebase ownership constants there before duplicating them in feature code.
- Before changing a Functions deployment path, run `npm run detect:affected-functions` to see which codebases are affected.
- For local deploys, prefer `npm run deploy:affected-functions:dry` first. Use `npm run deploy:affected-functions -- --base <sha> --head HEAD` only when the user explicitly approves deploy/go-live.
- Shared files such as `firebase.json`, `firebase/codebase-boundaries.json`, `firebase/packages/contracts/**`, `firebase/kangsain-functions/functions/src/config/**`, `runtime/**`, `types/**`, and broad utility/firestore files affect all four codebases.
- Do not deploy all Functions by habit. Deploy only the affected codebase unless a shared contract or shared runtime file changed.
- GitHub CI runs affected-codebase detection and boundary validation so other Codex threads can see the expected deployment scope.
