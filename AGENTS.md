# AGENTS.md

## Project

- Name: archive-in
- System display name: `ARCHIVE PILATES OPS`
- Canonical operator app: `https://core.archivepilates.com/`
- Existing member-link compatibility surface: `https://archive-pilates.web.app/archivein/`
- Firebase/GCP project: `archive-pilates`
- Primary rule: preserve existing user work and avoid production-impacting commands unless explicitly requested.

## Working Guidelines

### Direct Text Transport Standard

- Effective 2026-10-31, ARCHIVE-authored SMS/LMS/MMS uses SOLAPI only. Direct StudioMate general-message UI/API dispatch is retired; do not use it as a fallback on SOLAPI failure.
- Keep the existing canonical job, approval, source/identity/ticket/cancellation/refund checks, document-scoped deduplication and time windows. Existing provider-managed StudioMate/eformsign contract invitations remain native; never replace their secure invitation with a guessed signing link.
- General text uses scripts/lib/member-sms-solapi.mjs. Registered sender is bound in the private local config, not selected arbitrarily from available numbers. Native source browsers remain read-only for text delivery.
- Preserve legacy StudioMate receipts and attempts. Store SOLAPI provider/message/group IDs on the same canonical job, separate acceptance from final delivery, and never retry accepted, failed-after-transport or unknown requests or reset jobs merely to change provider. No new scheduler or historical bulk send is authorized by transport migration.

### Highest-Priority Member Communication Window

- All member-facing Alimtalk, SMS/LMS, email and electronic-contract signature requests are forbidden daily from 23:00 KST through 08:59:59 KST. Dispatch is allowed only in [09:00, 23:00), including manual, MCP/Codex, recovery and real-phone test sends.
- Approval or test mode is not a quiet-hour override. Internal operator/system reports and read-only/preparation work remain separate.
- Explicit operator amendment 2026-10-29: only the single `meal-choice-test-20261029` recommended-meal survey invitation to the canonical operator test recipient Kim Ki-hyo may use the documented once-only time-window exception. It requires a current private approval bound to the exact candidate, native identity, normalized phone hash, approved template and at-most-24-hour interval, with a durable pretransport claim. It does not waive duplicates, identity, consent, template or privacy checks. Other tests, reports, contracts, members and scheduled sends retain the normal window. A consumed or ambiguous claim is never replayed.
- Defer before claims and attempts where possible, retain stable canonical keys/approvals, and re-check the real clock immediately before the irreversible send. Resume after 09:00 only after all current source, exclusion, cancellation, signature and duplicate guards pass. Never replay accepted/ambiguous requests or create a duplicate scheduler.

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

## Imweb Local Quota Native Continuation

- When the official CLI positively reports a local `write_quota_exceeded` before dispatch, continue the same approved operation through a separate Codex in-app administrator tab without asking again solely because the route changed. Do not reset the quota/audit log or repeat the blocked CLI write.
- Preserve the original approval, canonical action key, exact account/site/unit/targets and intended fields. A route change never authorizes new recipients, products, payment/refund actions, broader access, or member messages.
- Authentication/permission errors, remote HTTP 429/API limits, CAPTCHA/security warnings, contradictory metadata, transport failures and accepted/unknown writes are not local-quota fallback triggers. Reconcile uncertain outcomes read-only before any further action; follow existing approval/handoff requirements.
- Acquire the same product/member lock, save native-write intent in the existing private ledger, refresh the canonical source and administrator form immediately before saving, and independently re-read afterward. Preserve unrelated groups/purchases, original 40-day clocks, stock/options/prices and sale-closure guards. Restore test-only changes and close task-owned tabs in finally cleanup.
- Active Codex work continues immediately when the administrator session is usable. Unattended Node workers may create one durable deduplicated native follow-up only; a queue record is not execution or completion. Do not add polling, a second scheduler, or an unaudited browser worker. Missing login or a genuinely new approval still requires operator action.

## Product Sale Opening Safety

- For a new offering, a replacement lesson round, or a product with a future opening time, block purchasing before editing content or asking follow-up questions. Do not close unrelated products that are legitimately on sale.
- First independently verify the intended product/site and current status, then use the approved hidden, sold-out, or native scheduled-sale state that actually blocks purchase. Read back the saved state and test the direct buyer URL. If closure cannot be verified, report that risk immediately; a draft or a question is not a closed product.
- Keep the product closed while timing, required fields, approval, login, or other operator input is pending, and after an interrupted or failed preparation. Never keep it purchasable merely to wait for a reply.
- Opening requires the exact approved KST time and scope, a final clock/source check, and independent status and buyer-flow verification. Scheduling an opening is not proof that the product has opened.
- If native scheduling requires an unapproved end time, keep purchasing blocked and ask. Never invent an end time or temporarily open the product. A separately approved one-time opening must not become a recurring job.
- Preserve current orders, prices, option codes and live stock. Compare API and editor values immediately before saving; discard stale drafts instead of restoring earlier stock. Change only the approved sale-state or scheduling fields, and never replay an unknown write.
- Record approval, closure proof, opening time, pending questions, execution intent and verified result in the existing private product ledger. Do not add recurring polling or member-facing messages without separate authorization.

## Instructor Lesson Video Completion Notices

- Video delivery completion requires fresh media processing/playback, protected-page and classroom/catalog connection proof, followed by `scripts/complete-imweb-video-access.mjs --ready-file=<private-proof>` (schema in `validateVideoReadiness`). Keep the private proof with the canonical upload ledger; do not commit member data. Upload alone is not delivery completion. Failure leaves access pending and notices unsent.
- The upload gate and existing worker use the same `runStaffVideoSync` handler and member-group lock. Success requires independent member details and native group-membership readbacks, with original purchase/student-share clocks and ownership preserved. Do not add another scheduler.
- Common STAFF mode (`common_staff_group_v1`) uses native group-only page ACLs: every protected page, including each new page, must allow its original buyer/student-share groups OR `ARCHIVE STAFF`. Never replace original groups with STAFF-only access, public access or a client-side visibility check. Native staff grade, not membership in the STAFF group alone, selects staff grants. Activation requires independently verified native ACLs and ordinary-account access tests.
- In common mode, add only the STAFF membership; do not assign each video group or apply the legacy 48-video assignment ceiling. Keep the 1000-group catalog source bound separate from the unchanged native 50-group limit per member. Legacy mode retains its existing catalog assignment and 48-video ceiling.
- Preserve current memberships, original `baselineGroups` and `ownedAddedGroups` classification, and original 40-day purchase/student-share clocks during the initial common-mode transition. Do not bulk-remove old memberships or move baseline STAFF into worker ownership. A successful active common-mode sync records only the additional role-management flag `commonStaffGroupManaged=true`. On staff exit, that exact flag permits removal of the STAFF role even if STAFF was originally baseline; all other baseline permissions remain protected. Fresh purchase/student-share checks still apply: a protected STAFF role requires manual review and blocks automatic removal. Without the flag, or in legacy mode, baseline preservation is unchanged. Existing worker-owned, non-baseline groups retain their existing protected-removal rules, and pending or unknown writes retain the no-replay rules.
- Do not mark video delivery or staff access complete until the completion guard has verified fresh media/playback, protected-page ACLs, classroom connection and independent member/group readbacks. Common mode rechecks native ACLs before writes and independently during verification, requiring STAFF membership rather than every video membership. Every native STAFF membership row must resolve to a tracked current native STAFF-grade member, even during targeted verification or when no active staff remain. Residual ordinary/untracked STAFF access requires manual review, not a success result or removal of personal entitlements. Keep implemented, verified, pending and deployment states distinct. The existing five-minute worker, upload completion handler and shared lock remain unchanged; no new poller or scheduler is authorized.
- Signup/grade events must enter this same current-source handler only after approved OAuth/site integration and canonical queue promotion. Shadow webhook receipts are not permission authority; do not activate them or select mutations from `workLanes` merely because an app is approved.
- A legacy unknown staff-group intent stays blocked in unattended runs. An operator-approved recovery must bind the exact pending digest/member, verify unchanged metadata and before-groups, preserve the original uncertain intent in history and permit only a fresh additive catalog plan. Never infer historical non-dispatch from current absence. Positively identified local quota is retained as `blocked_before_dispatch`/native continuation, not transport uncertainty.

- After a requested instructor-lesson YouTube upload, independently verify processing, intended visibility/playback and the existing website/classroom connection before proposing a completion notice. Describe pending signup/access exceptions rather than promising immediate playback.
- Ask the operator in the current chat whether to send the completion Alimtalk to instructors. Present lesson/date, teams, eligible recipient count, signup/access exceptions, exact approved text and buttons. An upload request, Kakao template approval or silence is not recipient-send approval.
- Send only after explicit approval of that notice's audience and content. Declined/unanswered proposals stay unsent; material audience/content changes need renewed approval. No new poller, scheduled dispatch or operator-directed Alimtalk is authorized by this default.
- Before dispatch, revalidate canonical registered rosters including absentees, cancellations/refunds/identity exclusions, the exact APPROVED template/channel/content/image/buttons, the real KST communication window and cross-channel send history. Never replay accepted/unknown sends or resend an existing SMS as Alimtalk.
- Reuse existing private upload/access/notice ledgers, original first-grant 40-day clocks and canonical action keys. Upload, classroom access, send approval, provider acceptance and final delivery are distinct states.

## OPS Work Coordination

- Use the main ARCHIVE PILATES OPS project chat as the control surface for cross-cutting decisions about the web app, Firebase model, StudioMate sync, Google Contacts, Kakao Alimtalk, and deployment readiness.
- If a separate chat or agent is used for a narrow subtask, bring the decision/result back into the main OPS chat before treating it as project direction.
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
- Start live checks with read-only verification of the deployed OPS/member surfaces, Firebase/Hosting configuration, and visible browser errors before proposing fixes.

## Bounded CORE Investigation

- For supported CORE stored-record work, use the CORE MCP first with an exact ID or bounded filter. Discover unknown support once, then select only the required `operation` or `area`; do not dump the full catalog every turn.
- Keep StudioMate live source checks separate. Use them when current native evidence is required or the CORE connector does not support the action; do not duplicate the same saved-record read through the browser and direct database.
- Return short evidence summaries to the command chat. Do not load entire unrelated chat histories or logs for a narrow task. Never trade authorization, source freshness, duplicate guards, or independent completion proof for speed.

## Browser Cleanup Rules

- Treat Chrome tabs, windows, Playwright pages, contexts, temporary profiles, and browser processes opened by Codex for debugging or verification as task-owned state.
- Close and verify all task-owned browser state before the final response. Put browser/context shutdown and lock release in `finally` blocks.
- Never close the user's pre-existing Chrome tabs, windows, profiles, or generic Chrome processes. Broad `pkill`, `killall`, and profile deletion are not cleanup methods.
- Remove an orphaned process only when its PID, command line, profile path, or session proves that the current task owns it. Leave uncertain processes alone and report them.
- Keep a browser open only for an explicit user request or an immediate login/approval handoff, and report exactly what remains open and why.

## StudioMate Sync Mode

- Until ARCHIVE PILATES operates its own site, treat StudioMate Excel download/import as the default OPS sync mode.
- Do not use StudioMate API mode for normal OPS processing, manual sync, contact sync, Alimtalk candidate generation, or dashboard-facing app sync.
- Legacy internal names such as `emergency_excel`, `run-studiomate-excel-emergency-mode.mjs`, and `com.archive.studiomate-excel-emergency-mode` may remain for compatibility, but staff-facing copy and operating decisions should call it Excel sync/default sync, not temporary emergency mode.
- API-mode work should only be a read-only investigation or a future migration plan unless the user explicitly approves a switch after ARCHIVE PILATES own-site operations are ready.

## Brand Writing Rules

- Use `ARCHIVE PILATES OPS` as the current system/project display name. Do not mix it with a Korean suffix for the same name. ARCHIVE CORE remains the existing operator web surface.
- `ARCHIVE IN` is a historical label, not a current product name. Retain it only in literal paths, URLs, package/code identifiers, approved historical content, or exact quotations. Do not bulk-rename project/app/database/collection IDs or existing member links.
- New member-facing brand copy uses `ARCHIVE PILATES`; existing approved message templates and member links are not changed by this naming rule.
- For Google administration, use the Chrome profile signed into `home@archivepilates.com` (currently shown as the official-account profile). Switching Google accounts inside another Chrome profile is not the same as selecting that profile. Verify profile and account before writes.

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
