# Recommended Meal: Fixed Choices and Free-Only Generation

## Approved Scope

- Preserve existing member responses, drafts and reports, especially the existing 정유리 records.
- Replace new intake with 13 fixed-choice questions, targeting completion within three minutes; actual completion time still requires the recipient test.
- Review CORE recommended-meal UI, mobile layouts, save state and publication/send distinctions.
- Keep Gemini, with no paid model fallback. Never send member identity, health flags, allergies, medication, free text or InBody values to AI.
- Deploy reviewed Functions and exact Hosting paths, commit, push and promote to origin/main.
- One approved survey invitation to canonical 김기효 (native 1982133), campaign `meal-choice-test-20261029`, request `meal-test-20261029-3minute-v2`. This sole invitation has an explicit time-window exception, expiring 2026-10-29 23:00 KST; ordinary [09:00,23:00) remains unchanged. No report notice or other recipient is approved.

## Sources and Guards

- Canonical: recommendedMealProgramRequests, recommendedMealProgramResponses, recommendedMealProgramDrafts, recommendedMealProgramReports, memberProfiles, staffs, alimtalkCandidates and alimtalkSends.
- Test approval: systemSettings/recommendedMealTestWindow20261029, exact recipient hash/template/request/candidate, one consumed pre-transport transaction. Any accepted or ambiguous transport must never replay.
- Existing submitted links remain read-only. New submission requires exact schema/consent, token and fresh expiry/cancellation checks; arbitrary extra input is discarded.
- AI payload is a fixed-choice allowlist. Health/allergy flags route to internal review without AI. Free-project identity and disabled billing must be verified immediately before a single AI attempt. Unknown/paid billing or permissions return a labelled basic draft; no generation retry or alternate model.
- One generation claim per canonical request/day; same-source drafts are reused. Publication and cancellation are transactionally rechecked before draft/report writes.
- Member selection never comes from workLanes or CRM mirrors.

## Verified Locally

- 187 backend/API/privacy/billing/test-approval cases passed; 74 survey and 24 CORE UI cases passed. Responsive widths: 320, 390, 768 and 1440, zero horizontal overflow in mock browser checks.
- Additional shared queue/window tests cover exact approved single-test dispatch, unrelated-recipient rejection and no replay. Physical five-codebase build and boundary checks passed.
- SOLAPI GET confirmed the existing approved survey template contract; no actual invitation was sent during these checks.
- Gemini metadata lookup with the existing operator service account returned 403. No Gemini generation was attempted and no IAM/billing was changed. Live free-tier generation remains unverified and blocked safely.

## Release Procedure and State

- Development: /Users/archivepilates/codex-worktrees/recommended-meal-free-3minute-20261029, branch codex/mini/recommended-meal-free-3minute-20261029; base ff342109b8abb9e2575afddfd2e3f99f06492ed1.
- Functions runtime changes: functions-app and functions-alimtalk. Detector maintenance itself triggers broad CI checks, not a reason to deploy unrelated runtime codebases.
- Scoped Hosting helper preserves live manifest/config and checks pinned baseline source hashes. Exact CORE meal/app/rules/catalog assets plus member and compatibility survey paths only. No DNS or broad Hosting snapshot replacement.
- Release and test receipts go under ignored artifacts/recommended-meal-20261029. Final deployment/provider state is recorded in the accompanying HTML report after live verification.
- No member survey answers may be fabricated for end-to-end testing. Actual submission remains for 김기효; synthetic local cases test submission/generation/review gates without real member writes.

## Known Boundaries

- The old Documents-backed draft worktree suffered Git mmap timeout during a fast-forward attempt. Existing survey work was preserved and copied to this healthy dedicated lane. It is not a deployment source.
- Existing Gemini metadata permission is a blocker for verified free AI generation. The deployed safe fallback remains usable, but must not be described as Gemini-generated.

## Live Result

- Source 804bc17d promoted to origin/main; CI 40726882539 passed. App and Alimtalk codebases updated successfully. Other codebases were not deployed.
- CORE/member/compatibility Hosting versions: 6b025e739786dd1b / 0a7ed5f4c6968a83 / fffacfddefe49cf0. Original manifests/configuration preserved, exact approved assets independently matched on actual domains. Invalid API links rejected with400.
- Exact test message M4V20261029013826QBO7T3W4D74J4OB accepted once at01:38 KST; provider COMPLETE/4000 confirmed by bounded recipient/date GET at01:40:04, with identity/template/ledger binding and consumed once-only approval. No resend.
- Actual recipient submission at01:41:27; response contains13 fixed choices and current consent/schema. Server event created7-day safe_fallback/rule-based-v1 draft at01:41:30; generationError=gemini_free_tier_identity_unverified. AI was blocked before generation. Draft/report revision binding matches; publication remains draft. No fabricated answer, manual regeneration, publication or second Alimtalk.
- Live intake browser checks passed320/390/768; during1440 verification the actual recipient submitted, so the intake correctly became a completed read-only view. This state transition is not an intake UI defect. Completed-state live checks are recorded separately. All browser contexts are closed and non-read network requests were blocked.
- Existing 정유리 request/response/draft/report hashes all matched before-write baseline after deployment.
- Quality review: basic draft is not yet a fully personalized final result. Meal-count/breakfast precedence, shift-work structure, specific snack substitutions and short-preparation menu consistency need improvement. This review did not edit submitted answers or the generated draft and did not publish it.
