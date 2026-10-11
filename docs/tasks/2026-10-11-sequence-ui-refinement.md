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
- [ ] Scoped commit, clean main promotion, Hosting deployment.
- [ ] Actual live asset checks, UI regression and GitHub CI.
- [ ] Git clean status and task-owned browser cleanup.

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
