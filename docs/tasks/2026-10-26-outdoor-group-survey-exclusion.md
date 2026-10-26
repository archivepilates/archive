# Outdoor Group Survey Exclusion

- Date: 2026-10-26
- Project: ARCHIVE IN / ARCHIVE CORE
- Worktree: `/Users/archivepilates/codex-worktrees/outdoor-group-survey-exclusion-20261026`
- Branch: `codex/mini/outdoor-group-survey-exclusion-20261026`
- Status: implementation, production Functions and both CORE Hosting deployments complete; independent metadata/file checks and live responsive/canary verification passed. No actual member send or manual queue execution.
- Current release: Functions deployed from `fa7e765f621fc74979699ad41a2f93789ea0f72a`; CORE Hosting from `9c27227ede55044fa22fcfd23c7517b501e0a8ec`. Final combined no-send regression after adding actual esbuild consumer-graph coverage: 318/318 passed, superseding the earlier 317-case snapshot.
- Independent management API read at `2026-10-26T05:47:14.650Z`: 105 total ACTIVE, 51 updated across Alimtalk 15/private-chart 24/sync 12, from `05:42:15.080978636Z` through `05:46:43.096727799Z`. App/social 54 update timestamps and source hashes unchanged versus predeploy snapshot. OPTIONS `https://in.archivepilates.com/api/groupSurveySubmit` returned 204; no member submission was made.
- GitHub Actions run `40275291139` passed for implementation commit. Three dry-runs and three production codebase deploys succeeded with normal guards, Node 22 and the operator service account. This is not real member delivery proof.
- CORE release commit also passed all CI steps in `40276197168` at 14:51:05 KST. Final closeout changes documentation only; the deployed Functions/Hosting source commits above remain the actual release identities.
- Earlier predeploy snapshot: combined no-send suite 317/317 passed; focused five-file suite also passed 134/134 on Node 22. The final combined count is 318 above. Counts overlap and are not additive. All five codebases build, boundaries, rollback and CORE Hosting guards passed; local and live responsive QA each passed 95 cases. Catalog fingerprint: `f70ffafe1e0b920405c3424beb6c702628729495896eeccdd52a14ff3df48085`.
- This docs sidecar owns only this task note, its HTML report, and `core/rules/index.html`. Main owns TypeScript, tests, detector, catalog, release decisions and production commands. No commit, deploy or push is performed here.

## Approved Behavior

- Canonical selection uses the linked `bookings` record's `ticketName`, `ticketClassType`, and `ticketType`, not profile holdings, member mirrors, lecture display names or stale candidate payloads. Match `야외` / `outdoor` after NFKC normalization, whitespace removal and case-insensitive comparison.
- Exclude the outdoor booking from first-group-survey candidate generation and current-source presend, including explicit-test overrides. Outdoor attendance must not count as prior ordinary-group attendance.
- Block unsubmitted outdoor request GET/POST, missing-submission alerts, staff survey delivery and new survey memo output. Preserve existing submitted responses, memos, send claims and history; no deletion, reset, actual send or requeue is part of this change.
- Do not exclude an entire member with mixed outdoor/ordinary holdings. Existing free, one-off and trial semantics, private/instructor workflows, submission history and dedupe rules remain unchanged.

## Source Review

- `firebase/kangsain-functions/functions/src/privateSurvey/groupSurveyBookingPolicy.ts`: pure canonical-field normalization and outdoor match.
- `firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates.ts`: upcoming group selection and prior group attendance.
- `firebase/kangsain-functions/functions/src/alimtalk/recipientExclusion.ts` and `eligibility.ts`: canonical booking reload and outdoor guard before explicit-test bypass.
- `firebase/kangsain-functions/functions/src/privateSurvey/privateSurveyResponse.ts`: unsubmitted GET/POST guard, missing-submission skip, staff delivery guard and memo-output guard.
- `core/rules/index.html`: update the existing Alimtalk exclusions card, not a duplicate section or Notion record. `templateTargetRules.ts` and generated `core/assets/alimtalk-catalog.json` remain main-owned.
- Review finding at first read: an outdoor target-rule sentence appeared in `private_survey` in `templateTargetRules.ts`. Final source reread confirmed it is now in `group_survey` and absent from `private_survey`; main's final verification confirms group-only copy. Catalog was regenerated; `scripts/generate-alimtalk-catalog.mjs` now fingerprints the pure helper. Current catalog fingerprint, locally read from JSON: `f70ffafe1e0b920405c3424beb6c702628729495896eeccdd52a14ff3df48085`.

## Evidence Supplied by Main

These are main-provided results, not independently executed by the docs sidecar.

- Read-only Firestore: project `archive-pilates`, operator identity `archive-codex-operator`, checked at `2026-10-26T05:31:44.812Z` (14:31:44.812 KST).
- `bookings` query `lectureDate == 2026-11-07`, limit 1000: 20 returned, query complete; all 20 matched outdoor via canonical ticket fields. This completeness applies only to that date query, not all bookings.
- Bounded `where in` queries for only those 20 booking IDs: `groupSurveyRequests` 0, `alimtalkCandidates` 0, `studiomateMemoWriteJobs` 0. Do not generalize to other IDs or collections, existing member memos, or all send history.
- Evidence is saved canonical source, not live StudioMate readback, provider acceptance or member delivery. No production writes.
- Final main-reported no-send results: focused five-file suite 134/134 (outdoor behavior, presend, GET/POST, missing submission, memo output, member exclusion, affected mapping, parity and approval); separate source/window/checkpoint + affected suite 168/168; dedupe/safeguards/ticket/renewal 39/39; catalog + CORE 44/44.
- Counts overlap: some mapping cases recur in the 168 suite, and 13 catalog cases overlap. Do not add these to a unique test total. The earlier 80-case snapshot is superseded by these final suite results.
- All five codebases rebuilt successfully; Functions boundaries: 105 pass; rollback guard: pass; CORE Hosting guard: pass; local responsive verification: 95 cases across five viewports pass. These are predeploy/local results, not deployed-surface verification.
- Earlier general run: 207 tests, initial 11 failures. Three intended parity updates were fixed; main confirms the other eight resolved through test-harness corrections and an exact frozen `15ccdd571d27dc96434a5334aba3ed7bd887ab34` baseline exception for three function hashes. No new 207/207 aggregate is asserted.
- The frozen test exception covers only `canRecoverBlockedInstructorLessonSample`, `prepareInstructorLessonSampleApproval`, and `remindPendingInstructorLessonApprovals`; it is not a release-guard bypass. Main reports no production TypeScript changes to instructor execution or claim handling. Preserve all other parity/claim protections.

## Release Scope and Gates

- Exact runtime dependency set: `functions-alimtalk`, `functions-private-chart`, `functions-sync`. The pure helper has consumers in all three, including lecture-sync candidate rebuilding.
- `scripts/lib/affected-functions.mjs` is itself shared release metadata. Including that changed detector file in full change detection conservatively selects all five codebases; this is distinct from the three-codebase runtime dependency set. Retain and report the conservative result.
- Planned scoped deployment selects the reviewed runtime file list explicitly via the affected wrapper's `--files` option. Main must validate the full diff and explicit file list, document the 5-versus-3 distinction, and retain all release/predeploy guards. Do not change detection rules merely to suppress the conservative result.
- Planned runtime file list: `alimtalk/eligibility.ts`, `alimtalk/rebuildAlimtalkCandidates.ts`, `alimtalk/recipientExclusion.ts`, `alimtalk/templateTargetRules.ts`, `privateSurvey/privateSurveyResponse.ts`, `privateSurvey/groupSurveyBookingPolicy.ts`, all under `firebase/kangsain-functions/functions/src/`.
- Main-only release commands, after review and clean current `main`: `npm run deploy:affected-functions:dry -- --base <release-base-sha> --head HEAD --files <reviewed-comma-separated-runtime-paths>`, then the matching `npm run deploy:affected-functions -- ...` invocation. Firebase dry-run is networked, not an offline test. Both modes retain root `firebase.json`, project `archive-pilates`, branch cleanliness/current-origin checks, rollback guards and one-codebase-per-process deployment.
- CORE rules/catalog Hosting: `npm run deploy:archive-core-live` targets both `archive-pilates` and `archive-pilates-core`. No app/social runtime, Firestore rules/schema, new scheduler, actual sends or historical requeue planned. Main must stop if source review establishes a broader runtime dependency.
- Existing no-send checks for main: `node --test scripts/tests/outdoor-group-survey.test.mjs scripts/tests/affected-functions-outdoor-survey.test.mjs`; member-exclusion TypeScript suite using the local tsx loader; `npm run validate:live-release-rollback-guards`; `npm run validate:alimtalk-catalog`. Docs sidecar does not claim to have run them.
- Final Hosting receipt: both sites deployed successfully from clean exact-origin main `9c27227e`; release manifests generated `2026-10-26T05:48:32.239Z`. Both public rules and catalog HTTP 200, exact SHA-256 equality with deployed source. Postdeploy CORE responsive 95 and live canary passed. OPTIONS group-survey route 204 is routing evidence, not a member submission.
- Postdeploy bounded source audit `2026-10-26T05:50:01.655Z`: November 7 bookings 20, all outdoor; related requests/candidates/StudioMate memo jobs each 0. Existing pending memo-worker behavior is unchanged; this audit does not generalize to unrelated IDs or all historical jobs.
- Next: retain existing schedules and claims; no manual replay or additional member-facing test. Final Git receipt is recorded after this documentation-only closeout. The active CORE operating rule is updated; no Notion copy was made.

## Separate Baseline Hosting Guard Repair

- Existing `lesson-video-upload-notice` contained the raw template ID `KA01TP261025172058035A7GWKDTFl7Y`. Main explicitly approved replacing only that token with `강사레슨_수업영상 업로드 완료 v1`; all other notice content is preserved.
- At source review, that ID/title was absent from `src/alimtalk/templates.ts`. The exact label is documented in `docs/tasks/2026-10-26-lesson-video-notices.md` under Alimtalk Definition. Do not claim a templates.ts match or current provider approval.
- This is a separate pre-existing visible-ID guard issue, not an outdoor-survey runtime change. Main subsequently confirmed the full CORE Hosting guard passes. Neither that local guard pass nor token removal is a deployment or current provider-approval claim.

## Docs Sidecar Verification

- Local source review only; no network, credentials, browser, production operation or runtime test executed by this sidecar.
- `git diff --check -- core/rules/index.html docs/tasks/2026-10-26-outdoor-group-survey-exclusion.md docs/reports/2026-10-26-outdoor-group-survey-exclusion.html`: passed for tracked diff; the new documents were also read by the structural check.
- Local Node assertions passed: baseline notice differs only by the approved ID-to-label token, removing the four outdoor rule lines restores the remaining CORE bytes exactly to HEAD, a single Alimtalk section remains, report tags are balanced with unique labelled headings, and the report has no scripts, external styles/resources or dependencies.
- Browser rendering, full Hosting guard and runtime tests were not run by this sidecar; their results above are explicitly attributed to main. No task-owned browser state was created. Main alone will add the final deployment receipt and live verification after handoff.
