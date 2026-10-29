# Recommended Meal Operator Call

- User scope: administrator invocation, CORE UI refresh, production deploy, and one unpublished draft save from the existing approved test response. Preserve responses; no publication or member messages; no additional AI API expense.
- Base: origin/main 4e287d5a1214c6f0b5362e0a81b47829417c4694.
- Worktree: /Users/archivepilates/codex-worktrees/recommended-meal-operator-call-20261029.
- Branch: codex/mini/recommended-meal-operator-call-20261029.
- Canonical sources: recommendedMealProgramRequests, recommendedMealProgramResponses, recommendedMealProgramDrafts, recommendedMealProgramReports. No mirror adoption.
- Legacy automatic and callable generation entrypoints remain deployed for compatibility, but only mark operator_call_required. They never invoke a model or create a draft/report.
- CORE copies an ID-only drafting request; it cannot start or wake a Codex chat. No scheduler or event-to-chat bridge added.
- Draft save uses one transaction, expectedResponseHash and expectedRevision, current submitted identity/studio guards, approval/publication/send locks, and immutable prior-revision history under recommendedMealProgramDrafts/{requestId}/revisions/{revision}.
- UI owner Aquinas: CORE meal page, meal-only app.js handlers, meal rule, browser tests. Survey owner Lovelace: survey consent/submit page and browser tests. Backend test owner Dalton: in-memory API/policy tests. Main owns backend, operator write, release, Git, final interpretation.
- New consent: meal-preferences-operator-v1-20261029. Existing response and historical consent remain unchanged.
- Private approved test plan/audit: /Users/archivepilates/ArchiveIN/operations/2026-10-29-meal-operator-draft/. Do not commit the personal plan or private audit.
- Primary drafting references: CDC NIOSH shift-work diet guidance and Health Canada food-guide plate. These are general lifestyle references, not personalized medical prescriptions.
- Deployment scope: functions-app and functions-alimtalk only; CORE four meal/UI/rule/catalog assets; member and compatibility survey HTML only. Retain unrelated live Hosting manifest/config and concurrent staff-video fix.
- No IAM, secrets, billing, DNS, Firestore client rules, invitation, report publication, notification or scheduler changes.
- Release evidence and final status: docs/reports/2026-10-29-recommended-meal-operator-call.html.

## Verified Outcome

- Code/UI ee961bb6 and operator audit fix 9c99ef79 are promoted to origin/main. Both CI runs succeeded.
- functions-app and functions-alimtalk deployed independently with root firebase.json and clean main guards. No force or function deletion used.
- Scoped Hosting releases: CORE 399a4f48728b12d2; member 638498271e27cb7a; compatibility b8af0ce038a7850c. Baseline config/manifests retained.
- Approved test draft saved and read back at 2026-10-29T00:59:55.748Z; source response unchanged, previous draft archived, matching invitation/report ledgers and unrelated original records unchanged.
- Authenticated CORE UI independently displayed the new draft. Actual member survey GET remains submitted/reportReady=false; report GET 404 confirms no public content.
- 398 focused tests pass (267 API/policy/test-window, 8 CLI, 123 UI/submit); five codebase builds, rollback guard and scoped dry-run pass. All browser resources cleaned.
- Prior-draft history is server-only operational audit under the existing draft identity. It is not a send/publication source, CRM mirror or new member-targeting collection.
- No model API, publication or member send executed. New live-member submission and browser re-save were intentionally not performed.
