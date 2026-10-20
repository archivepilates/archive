# Recommended Meal Survey Submit

- Workspace: `/Users/archivepilates/codex-worktrees/meal-survey-submit-20261020`
- Branch: `codex/mini/meal-survey-submit-20261020`
- Scope: survey submit feedback only; preserve existing responses and meal plans.
- Requested: retain the existing submitted survey and fix the submit button.
- Production writes, regeneration, publication and member sends: none.
- Release: user approved Hosting deployment, scoped commit and push on 2026-10-20.
- Deploy scope: archive-pilates-in and archive-pilates-core, plus archive-pilates
  compatibility paths. No Functions, Firestore rules or indexes deployment.

## Behavior

- Keep required and allergy/consent validation; reject whitespace-only required text.
- Show missing-field summary and focus links, clear resolved errors while editing.
- Block concurrent submit clicks.
- Keep every input after transport/API/protocol errors; focus the visible error.
- Show completion only on `{ok:true,status:submitted}`; accept duplicate confirmation.
- Previously submitted links stay read-only; endpoint and payload unchanged.

## Verification

- `node --test scripts/tests/recommended-meal-submit.test.mjs`: 16 passed.
- `node scripts/validate-recommended-meal-program.mjs`: 11-file static guard passed.
- `git diff --check`: passed.
- Independent focused source review: no additional confirmed defects.
- CUA isolated HTTP mock: missing-field focus, non-first radio choices, live error
  clearing, zero invalid POST, 503 response with input retention, manual retry
  with duplicate success confirmation. Two mock POSTs total, no production POST.
- Responsive checks: 320, 390, 768, 1440px; no horizontal overflow; submit 52px high.
- Canonical response, draft and report SHA-256 plus Firestore updateTime compared
  before/after: all three unchanged. No raw survey answers copied into this task.
- Temporary browser tab and mock server closed; existing user tab preserved.

## Remaining

- Hosting deployment and independent live verification are in progress; final
  outcome will be appended after deployment.
- Prior audit's expired queue display and backend publication-race/name-match
  findings are outside this submit-only patch and remain unmodified.
