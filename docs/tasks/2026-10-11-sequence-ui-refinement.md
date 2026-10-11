# Sequence Notes UI Refinement

- Worktree: `/Users/archivepilates/codex-worktrees/sequence-ui-refinement`
- Branch: `codex/mini/sequence-ui-refinement`
- Base: `ad645099`
- User approved scoped validation, CORE Hosting deployment, commit and push.

## Scope

- Remove promotional masthead, duplicate how-to copy and decorative sidebar.
- Use compact writing, preview and library views with aligned form sections.
- Retain example, AI prompt, license, import and backup controls in disclosures.
- Keep server save/conflict/error status, creation dates and record actions.
- Fresh notes no longer prefill a specific instructor; the source example retains
  its original author and existing saved authors remain untouched.
- Retain exact PDF generation, canonical ownership and deletion semantics.
- Preserve `sequenceNotes`, `sequenceNoteImages`, UID scope and all real records.
- No Functions, Auth, Firestore rules, scheduler or external-send changes.

## Checks

- [x] Hosting validator passes.
- [x] Isolated Sequence editor and PDF regression: 26/26, no skipped checks.
- [x] Isolated instructor/manager access and geometry regression: 154/154.
- [x] Independent scoped source review; menu focus finding fixed and tested.
- [x] Responsive screenshots at 320, 390, 768 and 1440px.
- [x] CORE operating rule updated with actual verification state.
- [x] Scoped commit, clean main promotion, Hosting deployment.
- [x] Actual live asset checks, UI regression and GitHub CI.
- [x] Git clean status and task-owned browser cleanup before audit recording.

## Verification Boundary

Browser harnesses use the actual app and adapter with isolated synthetic Auth and
Firestore SDK fixtures. They do not prove real authentication, persistence or
security-rule behavior. No real account writes are needed for this UI-only change.
Chromium emulated viewports are not a physical iPhone Safari test.

## Local Evidence

- Sequence report: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/archive-core-sequence-cloud-qa-YLBAgy/report.html`
- UI report: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/core-instructor-access-ui-GA9XdA/report.json`
- Access unit tests: 224 passed.
- Both browser reports confirm all contexts, servers and fixtures closed.
- The real-Firestore harness only received current label updates; not executed.

## Release Evidence

- Deployed code: `79a7171934816750502e40228474425d1aa74310`.
- Clean `main` Hosting release via `npm run deploy:archive-core-live`, exit 0.
- Service account: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`.
- Firebase project `archive-pilates`; only `hosting:archive-pilates` and
  `hosting:archive-pilates-core`. No Functions, Auth or rules deployment.
- Live: `https://core.archivepilates.com/sequence/` and
  `https://archive-pilates.web.app/core/sequence/`.
- Deployment wrapper: local static responsive 95/95, live static responsive
  95/95 and exact-release canary 10/10 passed.
- Live CORE Sequence harness: 26/26, zero skips; actual deployed UI and adapter
  with isolated synthetic Auth/Firestore, no real data writes.
- Mirror: 4/4 responsive checks; 22 checks intentionally not run with
  `ARCHIVE_SEQUENCE_TEST_FILTER='^responsive '`. Not a full mirror regression.
- Six scoped assets match source SHA-256 on both domains; both release markers
  match the deployed code SHA.
- Live CORE report: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/archive-core-sequence-cloud-qa-vD3YLg/results.json`.
- Mirror report: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/archive-core-sequence-cloud-qa-fpDIac/results.json`.
- Hash evidence: `/var/folders/4q/7mtq1lfj5_x55y84ksrz9zfc0000gn/T/sequence-live-independent-hashes-Sdy5hg/results.json`.
- GitHub Actions `ARCHIVE IN Functions Affected Check` run `38147153319`:
  success at exact deployed SHA, affected codebases `[]`.
- Independent live 320/390/768/1440px screenshots reviewed; no overflow or
  clipped text. Main reviewed live 390px screenshot.
- Browser reports: disconnected, contexts/subscriptions/open transactions 0,
  servers stopped. Task-owned agents closed; no matching browser processes.
- Final audit updates only these two documents; no redeployment required.
